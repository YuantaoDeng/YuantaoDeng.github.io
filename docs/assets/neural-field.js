(() => {
  "use strict";

  /*
   * Neural field — reference-matched rewrite
   * -----------------------------------------
   * Visual goals:
   *  - many radial neuron-like cells, not Voronoi "cell walls"
   *  - dark soma + narrow star-shaped perisomatic wedges
   *  - dendrites/axons thick near the soma and progressively thinner
   *  - piecewise-linear organic branching with many small junctions/boutons
   *  - a dense, faint background web made from real branch junctions
   *
   * Animation logic intentionally kept from the previous version:
   *  1) somas appear first
   *  2) perisomatic structures appear
   *  3) processes grow outward
   *  4) hold
   *  5) processes retreat while somas remain
   *  6) pointer reveals the completed network locally
   */

  const canvas = document.querySelector("#neural-field");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  const stage = canvas.parentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const INK = [18, 18, 18];
  const SCENE_SEED = 3476;

  const pointer = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    strength: 0,
    targetStrength: 0,
    hasPosition: false,
  };

  let width = 0;
  let height = 0;
  let scene = emptyScene();
  let animationStart = 0;
  let animationFrame = 0;
  let resizeTimer = 0;
  let completed = false;

  function emptyScene() {
    return {
      config: null,
      hubs: [],
      segments: [],
      facets: [],
      boutons: [],
      junctions: [],
      junctionMap: new Map(),
      edgeKeys: new Set(),
      growthEnd: 0,
      holdDuration: 52,
      retreatDuration: 3300,
      cycleEnd: 0,
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function ease(t) {
    t = clamp(t, 0, 1);
    return 1 - Math.pow(1 - t, 3);
  }

  function mulberry32(seed) {
    let state = seed >>> 0;

    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pointFromPolar(center, angle, radius) {
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  }

  function lerpPoint(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
    };
  }

  function normalizeAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function hashPoint(point) {
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }

  function hashEdge(a, b) {
    const x = hashPoint(a);
    const y = hashPoint(b);

    return x < y ? `${x}|${y}` : `${y}|${x}`;
  }

  function getTextBounds() {
    const copy =
      stage?.querySelector(
        ".home-copy",
      );

    if (!copy) {
      return [];
    }

    const canvasBounds =
      canvas.getBoundingClientRect();

    const bounds = [];

    const walker =
      document.createTreeWalker(
        copy,
        NodeFilter.SHOW_TEXT,
      );

    while (
      walker.nextNode()
    ) {
      const node =
        walker.currentNode;

      if (
        !node.textContent?.trim()
      ) {
        continue;
      }

      const range =
        document.createRange();

      range.selectNodeContents(
        node,
      );

      for (
        const rect of
        range.getClientRects()
      ) {
        bounds.push({
          left:
            rect.left -
            canvasBounds.left,

          right:
            rect.right -
            canvasBounds.left,

          top:
            rect.top -
            canvasBounds.top,

          bottom:
            rect.bottom -
            canvasBounds.top,
        });
      }
    }

    if (
      bounds.length === 0
    ) {
      return bounds;
    }

    return [
      {
        left:
          Math.min(
            ...bounds.map(
              (rect) =>
                rect.left,
            ),
          ),

        right:
          Math.max(
            ...bounds.map(
              (rect) =>
                rect.right,
            ),
          ),

        top:
          Math.min(
            ...bounds.map(
              (rect) =>
                rect.top,
            ),
          ),

        bottom:
          Math.max(
            ...bounds.map(
              (rect) =>
                rect.bottom,
            ),
          ),
      },
    ];
  }

  function somaOverlapsText(
    point,
    radius,
    textBounds,
  ) {
    const clearance =
      radius + 6;

    return textBounds.some(
      (rect) =>
        point.x >
          rect.left -
            clearance &&
        point.x <
          rect.right +
            clearance &&
        point.y >
          rect.top -
            clearance &&
        point.y <
          rect.bottom +
            clearance,
    );
  }

  function moveSomaOutsideText(
    point,
    radius,
    textBounds,
  ) {
    const clearance =
      radius + 6;

    const candidates = [
      {
        x: point.x,
        y: point.y,
      },
    ];

    for (
      const rect of
      textBounds
    ) {
      candidates.push(
        {
          x:
            rect.left -
            clearance,
          y: point.y,
        },
        {
          x:
            rect.right +
            clearance,
          y: point.y,
        },
        {
          x: point.x,
          y:
            rect.top -
            clearance,
        },
        {
          x: point.x,
          y:
            rect.bottom +
            clearance,
        },
      );
    }

    const clearCandidates =
      candidates.filter(
        (candidate) =>
          !somaOverlapsText(
            candidate,
            radius,
            textBounds,
          ),
      );

    clearCandidates.sort(
        (a, b) =>
          dist(
            point,
            a,
          ) -
          dist(
            point,
            b,
          ),
      );

    return (
      clearCandidates[0] ??
      point
    );
  }

  function getSceneConfig() {
    const compact = width < 680;
    const medium = !compact && width < 1080;
    const minDim = Math.min(width, height);

    const primaryAnchors = compact
      ? [
          [-0.01, 0.22, 0.86],
          [0.65, 0.20, 0.92],
          [0.64, 0.43, 1.12],
          [0.76, 0.74, 1.03],
          [0.30, 0.82, 0.94],
          [0.97, 0.55, 0.68],
          [0.48, 0.83, 0.54],
          [0.10, 0.57, 0.56],
          [0.41, 0.12, 0.56],
          [0.90, 0.27, 0.88],
          [0.88, 0.88, 0.72],
          [0.18, 0.08, 0.66],
        ]
      : medium
        ? [
            [0.06, 0.22, 0.96],
            [0.37, 0.27, 0.78],
            [0.64, 0.20, 0.74],
            [0.78, 0.38, 1.08],
            [0.56, 0.48, 1.15],
            [0.22, 0.55, 0.74],
            [0.73, 0.66, 1.05],
            [0.30, 0.77, 0.92],
            [0.51, 0.83, 0.68],
            [0.94, 0.80, 0.60],
            [0.94, 0.54, 0.63],
            [0.10, 0.74, 0.58],
            [0.88, 0.10, 0.82],
            [0.84, 0.90, 0.78],
            [0.47, 0.08, 0.70],
            [0.04, 0.44, 0.66],
          ]
        : [
            [0.18, 0.27, 1.20],
            [0.49, 0.40, 1.18],
            [0.80, 0.36, 1.16],
            [0.72, 0.62, 1.05],
            [0.22, 0.72, 1.00],
            [0.55, 0.77, 0.72],
            [0.08, 0.50, 0.72],
            [0.32, 0.55, 0.66],
            [0.57, 0.17, 0.72],
            [0.69, 0.12, 0.66],
            [0.92, 0.53, 0.65],
            [0.91, 0.81, 0.62],
            [0.35, 0.28, 0.62],
            [0.47, 0.61, 0.58],
            [0.15, 0.12, 0.54],
            [0.84, 0.18, 0.52],
            [0.04, 0.83, 0.86],
            [0.96, 0.26, 0.84],
            [0.66, 0.90, 0.78],
            [0.40, 0.08, 0.72],
            [0.03, 0.67, 0.68],
          ];

    return {
      compact,
      medium,
      primaryAnchors,
      textBounds:
        getTextBounds(),

      primaryBaseRadius: compact
        ? clamp(minDim * 0.0125, 4.8, 7.2)
        : clamp(minDim * 0.0108, 6.2, 10.2),

      secondaryCount: compact
        ? 32
        : medium
          ? 54
          : 84,

      secondaryMinDistance: compact
        ? 42
        : medium
          ? 48
          : 56,

      segmentBudget: compact
        ? 1500
        : medium
          ? 2550
          : 4100,

      crosslinkBudget: compact
        ? 210
        : medium
          ? 410
          : 720,

      filamentBudget: compact
        ? 190
        : medium
          ? 360
          : 650,

      meshPointCount: compact
        ? 185
        : medium
          ? 340
          : 560,

      rootSteps: compact
        ? [4, 6]
        : medium
          ? [5, 7]
          : [5, 8],

      secondarySteps: compact
        ? [3, 5]
        : [3, 5],

      branchUnit: compact
        ? clamp(minDim * 0.064, 27, 42)
        : clamp(minDim * 0.050, 34, 54),

      crosslinkDistance: compact
        ? 82
        : medium
          ? 108
          : 132,

      textZone: compact
        ? [0.37, 0.50, 0.34, 0.23]
        : medium
          ? [0.30, 0.55, 0.26, 0.19]
          : [0.28, 0.56, 0.24, 0.18],
    };
  }

  function textZoneWeight(point, config) {
    const [cx, cy, rx, ry] = config.textZone;

    const nx = (point.x / width - cx) / rx;
    const ny = (point.y / height - cy) / ry;

    const d2 = nx * nx + ny * ny;

    if (d2 >= 1) {
      return 1;
    }

    return lerp(
      0.62,
      1,
      clamp(d2, 0, 1),
    );
  }

  function outsideSoftBounds(point) {
    const padding = 70;

    return (
      point.x < -padding ||
      point.x > width + padding ||
      point.y < -padding ||
      point.y > height + padding
    );
  }

  function makePrimaryHub(anchor, index, config, random) {
    const scale = anchor[2] ?? 1;

    const center = {
      x:
        anchor[0] * width +
        (random() - 0.5) * width * 0.008,

      y:
        anchor[1] * height +
        (random() - 0.5) * height * 0.010,
    };

    const somaRadius =
      config.primaryBaseRadius *
      scale *
      (0.90 + random() * 0.17);

    const clearCenter =
      moveSomaOutsideText(
        center,
        somaRadius,
        config.textBounds,
      );

    return makeHubGeometry({
      index,
      center: clearCenter,
      somaRadius,
      tier: "primary",
      rootCount: 8 + Math.floor(random() * 5),
      activity: 0.82 + random() * 0.18,
      config,
      random,
    });
  }

  function makeSecondaryHub(center, index, config, random) {
    const somaRadius =
      config.primaryBaseRadius *
      (0.24 + random() * 0.22);

    return makeHubGeometry({
      index,
      center,
      somaRadius,
      tier: "secondary",
      rootCount: 4 + Math.floor(random() * 4),
      activity: 0.35 + random() * 0.40,
      config,
      random,
    });
  }

  function makeHubGeometry({
    index,
    center,
    somaRadius,
    tier,
    rootCount,
    activity,
    config,
    random,
  }) {
    const primary = tier === "primary";

    const phase =
      random() *
      Math.PI *
      2;

    const averageStep =
      (Math.PI * 2) /
      rootCount;

    const weights = Array.from(
      { length: rootCount },
      () => 0.68 + random() * 0.72,
    );

    weights[
      Math.floor(random() * rootCount)
    ] *= 1.35 + random() * 0.35;

    const total =
      weights.reduce(
        (sum, value) => sum + value,
        0,
      );

    const roots = [];

    let cursor = phase;

    for (
      let i = 0;
      i < rootCount;
      i += 1
    ) {
      const angle =
        cursor +
        (random() - 0.5) *
          averageStep *
          0.15;

      const shoulderRadius =
        somaRadius *
        (primary ? 1.7 : 1.5) *
        (0.92 + random() * 0.18);

      const base =
        pointFromPolar(
          center,
          angle,
          somaRadius * 0.88,
        );

      const shoulder =
        pointFromPolar(
          center,
          angle,
          shoulderRadius,
        );

      roots.push({
        angle,
        base,
        shoulder,
      });

      cursor +=
        (weights[i] / total) *
        Math.PI *
        2;
    }

    const facets = [];

    if (primary) {
      for (
        let i = 0;
        i < rootCount;
        i += 1
      ) {
        const root =
          roots[i];

        const spread =
          averageStep *
          (0.24 + random() * 0.14);

        const left =
          pointFromPolar(
            center,
            root.angle - spread,
            somaRadius *
              (1.18 + random() * 0.20),
          );

        const right =
          pointFromPolar(
            center,
            root.angle + spread,
            somaRadius *
              (1.18 + random() * 0.20),
          );

        const tip =
          pointFromPolar(
            center,
            root.angle +
              (random() - 0.5) * 0.05,
            somaRadius *
              (3.65 + random() * 2.30),
          );

        facets.push({
          points: [
            left,
            tip,
            right,
          ],

          opacity:
            0.045 +
            random() *
              0.105,

          outlineOpacity:
            0.140 +
            random() *
              0.145,

          delay:
            i * 18 +
            random() *
              80,
        });

        if (
          random() < 0.52
        ) {
          const next =
            roots[
              (i + 1) %
                rootCount
            ];

          const midA =
            pointFromPolar(
              center,
              root.angle,
              somaRadius *
                (2.0 +
                  random() *
                    0.85),
            );

          const midB =
            pointFromPolar(
              center,
              next.angle,
              somaRadius *
                (1.8 +
                  random() *
                    0.80),
            );

          facets.push({
            points: [
              root.shoulder,
              midA,
              midB,
              next.shoulder,
            ],

            opacity:
              0.018 +
              random() *
                0.040,

            outlineOpacity:
              0.028 +
              random() *
                0.050,

            delay:
              90 +
              i * 15 +
              random() *
                100,
          });
        }
      }
    } else if (
      random() < 0.72 &&
      rootCount >= 5
    ) {
      const i =
        Math.floor(
          random() *
            rootCount,
        );

      const root =
        roots[i];

      const spread =
        averageStep *
        0.24;

      facets.push({
        points: [
          pointFromPolar(
            center,
            root.angle - spread,
            somaRadius * 1.12,
          ),

          pointFromPolar(
            center,
            root.angle,
            somaRadius *
              (2.6 +
                random() *
                  0.9),
          ),

          pointFromPolar(
            center,
            root.angle + spread,
            somaRadius * 1.12,
          ),
        ],

        opacity:
          0.020 +
          random() *
            0.035,

        outlineOpacity:
          0.025 +
          random() *
            0.035,

        delay:
          random() *
          100,
      });
    }

    return {
      index,

      x: center.x,
      y: center.y,

      somaRadius,

      tier,
      activity,

      roots,
      facets,

      appearStart:
        primary
          ? 55 +
            index * 22 +
            random() * 100
          : 140 +
            random() * 360,

      appearDuration:
        primary
          ? 430 +
            random() * 180
          : 300 +
            random() * 180,

      starStart:
        primary
          ? 350 +
            index * 14 +
            random() * 100
          : 520 +
            random() * 440,

      starDuration:
        primary
          ? 760 +
            random() * 330
          : 520 +
            random() * 260,
    };
  }

  function sampleSecondaryHubs(
    config,
    random,
  ) {
    const centers = [];

    const primaryCenters =
      scene.hubs.map(
        (hub) => ({
          x: hub.x,
          y: hub.y,
        }),
      );

    let attempts = 0;

    while (
      centers.length <
        config.secondaryCount &&
      attempts <
        config.secondaryCount *
          150
    ) {
      attempts += 1;

      const point = {
        x:
          random() *
          width,

        y:
          random() *
          height,
      };

      const minDist =
        config.secondaryMinDistance *
        (0.80 +
          random() *
            0.50);

      if (
        somaOverlapsText(
          point,
          config.primaryBaseRadius *
            0.46,
          config.textBounds,
        )
      ) {
        continue;
      }

      if (
        primaryCenters.some(
          (center) =>
            dist(
              center,
              point,
            ) <
            minDist *
              1.15,
        )
      ) {
        continue;
      }

      if (
        centers.some(
          (center) =>
            dist(
              center,
              point,
            ) <
            minDist,
        )
      ) {
        continue;
      }

      if (
        random() >
        textZoneWeight(
          point,
          config,
        )
      ) {
        continue;
      }

      centers.push(
        point,
      );
    }

    return centers;
  }

  function addTensionFacet(
    segment,
    random,
  ) {
    const budget =
      scene.config.compact
        ? 90
        : scene.config.medium
          ? 180
          : 320;

    if (
      scene.facets.length >=
      budget
    ) {
      return;
    }

    const length =
      dist(
        segment.a,
        segment.b,
      );

    if (
      length < 24
    ) {
      return;
    }

    const dx =
      segment.b.x -
      segment.a.x;

    const dy =
      segment.b.y -
      segment.a.y;

    const invLength =
      1 /
      (Math.hypot(
        dx,
        dy,
      ) || 1);

    const nx =
      -dy *
      invLength;

    const ny =
      dx *
      invLength;

    const side =
      random() < 0.5
        ? -1
        : 1;

    const t0 =
      0.12 +
      random() *
        0.32;

    const t1 =
      clamp(
        t0 +
          0.18 +
          random() *
            0.28,
        t0 + 0.10,
        0.88,
      );

    const a =
      lerpPoint(
        segment.a,
        segment.b,
        t0,
      );

    const b =
      lerpPoint(
        segment.a,
        segment.b,
        t1,
      );

    const anchor =
      lerpPoint(
        a,
        b,
        0.22 +
          random() *
            0.56,
      );

    const h =
      Math.min(
        18,
        length *
          (0.045 +
            random() *
              0.09),
      );

    const apex = {
      x:
        anchor.x +
        nx *
          h *
          side,

      y:
        anchor.y +
        ny *
          h *
          side,
    };

    scene.facets.push({
      points: [
        a,
        b,
        apex,
      ],

      opacity:
        segment.phase ===
        "tree"
          ? 0.012 +
            random() *
              0.040
          : 0.008 +
            random() *
              0.025,

      outlineOpacity:
        0.012 +
        random() *
          0.035,

      start:
        segment.start +
        segment.duration *
          (0.28 +
            random() *
              0.38),

      duration:
        300 +
        random() *
          420,
    });
  }

  function touchJunction(
    point,
    segment,
    arrival,
    metadata = {},
  ) {
    const key =
      hashPoint(
        point,
      );

    let junction =
      scene.junctionMap.get(
        key,
      );

    if (!junction) {
      junction = {
        x: point.x,
        y: point.y,

        degree: 0,

        maxOpacity: 0,

        arrival,

        terminal: false,

        primaryWeight: 0,

        webDegree: 0,

        ownerIds:
          new Set(),
      };

      scene.junctionMap.set(
        key,
        junction,
      );
    }

    junction.degree += 1;

    junction.maxOpacity =
      Math.max(
        junction.maxOpacity,
        segment.opacity,
      );

    junction.arrival =
      Math.min(
        junction.arrival,
        arrival,
      );

    junction.terminal ||=
      Boolean(
        metadata.terminal,
      );

    junction.primaryWeight =
      Math.max(
        junction.primaryWeight,
        metadata.primaryWeight ||
          0,
      );

    if (
      Number.isInteger(
        metadata.ownerId,
      )
    ) {
      junction.ownerIds.add(
        metadata.ownerId,
      );
    }

    if (
      segment.phase ===
      "web"
    ) {
      junction.webDegree += 1;
    }

    return junction;
  }

  function addSegment(
    a,
    b,
    style,
    start,
    random,
    metadata = {},
  ) {
    if (
      scene.segments.length >=
      scene.config.segmentBudget
    ) {
      return null;
    }

    const length =
      dist(
        a,
        b,
      );

    if (
      !Number.isFinite(
        length,
      ) ||
      length < 5
    ) {
      return null;
    }

    const key =
      hashEdge(
        a,
        b,
      );

    if (
      scene.edgeKeys.has(
        key,
      )
    ) {
      return null;
    }

    const duration =
      clamp(
        length *
          (5.6 +
            random() *
              2.0),
        330,
        980,
      );

    const segment = {
      a: {
        x: a.x,
        y: a.y,
      },

      b: {
        x: b.x,
        y: b.y,
      },

      widthStart:
        style.widthStart,

      widthEnd:
        style.widthEnd,

      opacity:
        style.opacity,

      layer:
        style.layer ??
        1,

      phase:
        style.phase ??
        "tree",

      start,
      duration,
    };

    scene.segments.push(
      segment,
    );

    scene.edgeKeys.add(
      key,
    );

    const facetChance =
      segment.phase ===
      "tree"
        ? segment.layer >= 1
          ? 0.11
          : 0.045
        : segment.phase ===
            "filament"
          ? 0.025
          : 0.035;

    if (
      random() <
      facetChance
    ) {
      addTensionFacet(
        segment,
        random,
      );
    }

    touchJunction(
      a,
      segment,
      start,
      {
        ownerId:
          metadata.ownerId,

        primaryWeight:
          metadata.primaryWeight,
      },
    );

    touchJunction(
      b,
      segment,
      start +
        duration *
          0.86,
      {
        ownerId:
          metadata.ownerId,

        terminal:
          metadata.terminal,

        primaryWeight:
          metadata.primaryWeight,
      },
    );

    if (
      metadata.boutonChance &&
      random() <
        metadata.boutonChance
    ) {
      scene.boutons.push({
        x: b.x,
        y: b.y,

        radius:
          metadata.primaryWeight >
          0.5
            ? 0.55 +
              random() *
                0.55
            : 0.28 +
              random() *
                0.38,

        opacity:
          clamp(
            style.opacity *
              (0.85 +
                random() *
                  0.35),
            0.10,
            0.88,
          ),

        arrival:
          start +
          duration *
            0.85,

        duration:
          180 +
          random() *
            180,
      });
    }

    return segment;
  }

  function branchStyle({
    primary,
    depth,
    rootIndex,
    random,
    continuation = true,
  }) {
    const rootStrong =
      primary &&
      rootIndex < 7;

    const base =
      primary
        ? rootStrong
          ? 1.78 +
            random() *
              0.62
          : 1.18 +
            random() *
              0.48
        : 0.46 +
          random() *
            0.32;

    const depthScale =
      Math.pow(
        primary
          ? 0.73
          : 0.76,
        depth,
      );

    const widthStart =
      Math.max(
        primary
          ? 0.34
          : 0.22,
        base *
          depthScale,
      );

    const widthEnd =
      Math.max(
        primary
          ? 0.26
          : 0.18,

        widthStart *
          (
            continuation
              ? 0.62 +
                random() *
                  0.10
              : 0.52 +
                random() *
                  0.12
          ),
      );

    const opacity =
      primary
        ? clamp(
            (
              rootStrong
                ? 0.66
                : 0.42
            ) *
              Math.pow(
                0.84,
                depth,
              ) *
              (0.88 +
                random() *
                  0.18),
            0.10,
            0.80,
          )
        : clamp(
            0.24 *
              Math.pow(
                0.82,
                depth,
              ) *
              (0.78 +
                random() *
                  0.26),
            0.035,
            0.28,
          );

    return {
      widthStart,
      widthEnd,
      opacity,

      layer:
        primary &&
        rootStrong &&
        depth < 2
          ? 2
          : depth > 3
            ? 0
            : 1,

      phase: "tree",
    };
  }

  function projectStep(
    start,
    heading,
    depth,
    primary,
    config,
    random,
    lengthScale = 1,
  ) {
    const turn =
      primary
        ? depth === 0
          ? 0.22
          : depth < 3
            ? 0.36
            : 0.50
        : depth < 2
          ? 0.48
          : 0.66;

    const nextHeading =
      heading +
      (random() - 0.5) *
        turn;

    const depthLength =
      primary
        ? Math.pow(
            0.92,
            Math.min(
              depth,
              4,
            ),
          )
        : Math.pow(
            0.86,
            Math.min(
              depth,
              3,
            ),
          );

    const length =
      config.branchUnit *
      depthLength *
      lengthScale *
      (0.72 +
        random() *
          0.58);

    const point =
      pointFromPolar(
        start,
        nextHeading,
        length,
      );

    return {
      point,
      heading:
        nextHeading,
      terminal:
        outsideSoftBounds(
          point,
        ),
    };
  }

  function growTree({
    start,
    heading,
    ownerId,
    primary,
    rootIndex,
    remaining,
    depth,
    startTime,
    config,
    random,
    lengthScale,
    inheritedWidthStart = null,
  }) {
    if (
      remaining <= 0 ||
      scene.segments.length >=
        config.segmentBudget -
          config.crosslinkBudget -
          config.filamentBudget
    ) {
      return;
    }

    const projection =
      projectStep(
        start,
        heading,
        depth,
        primary,
        config,
        random,
        lengthScale,
      );

    const style =
      branchStyle({
        primary,
        depth,
        rootIndex,
        random,
        continuation:
          remaining > 1,
      });

    if (
      inheritedWidthStart !=
      null
    ) {
      style.widthStart =
        Math.min(
          style.widthStart,
          inheritedWidthStart,
        );

      style.widthEnd =
        Math.min(
          style.widthEnd,
          style.widthStart *
            (0.60 +
              random() *
                0.10),
        );
    }

    const segment =
      addSegment(
        start,
        projection.point,
        style,
        startTime,
        random,
        {
          ownerId,

          terminal:
            projection.terminal ||
            remaining === 1,

          primaryWeight:
            primary
              ? 1
              : 0.18,

          boutonChance:
            primary
              ? 0.14
              : 0.04,
        },
      );

    if (!segment) {
      return;
    }

    const nextStart =
      segment.start +
      segment.duration *
        (0.72 +
          random() *
            0.12);

    if (
      remaining <= 1 ||
      projection.terminal
    ) {
      return;
    }

    const forkChance =
      primary
        ? depth === 0
          ? 0.66
          : depth === 1
            ? 0.56
            : depth === 2
              ? 0.43
              : 0.28
        : depth === 0
          ? 0.48
          : 0.26;

    const shouldFork =
      random() <
      forkChance;

    growTree({
      start:
        projection.point,

      heading:
        projection.heading +
        (random() - 0.5) *
          (primary
            ? 0.14
            : 0.28),

      ownerId,
      primary,
      rootIndex,

      remaining:
        remaining -
        1,

      depth:
        depth +
        1,

      startTime:
        nextStart,

      config,
      random,

      lengthScale:
        lengthScale *
        (0.92 +
          random() *
            0.08),

      inheritedWidthStart:
        segment.widthEnd,
    });

    if (
      shouldFork &&
      remaining >
        (primary
          ? 2
          : 1)
    ) {
      const sign =
        random() < 0.5
          ? -1
          : 1;

      const split =
        primary
          ? 0.45 +
            random() *
              0.60
          : 0.55 +
            random() *
              0.75;

      growTree({
        start:
          projection.point,

        heading:
          projection.heading +
          sign *
            split,

        ownerId,
        primary,

        rootIndex:
          rootIndex +
          7,

        remaining:
          Math.max(
            1,

            remaining -
              (
                primary
                  ? 2 +
                    Math.floor(
                      random() *
                        2,
                    )
                  : 2
              ),
          ),

        depth:
          depth +
          1,

        startTime:
          nextStart +
          55 +
          random() *
            150,

        config,
        random,

        lengthScale:
          lengthScale *
          (
            primary
              ? 0.72 +
                random() *
                  0.12
              : 0.62 +
                random() *
                  0.12
          ),

        inheritedWidthStart:
          Math.max(
            0.22,

            segment.widthEnd *
              (0.72 +
                random() *
                  0.08),
          ),
      });
    }
  }

  function buildHubTrees(
    random,
    config,
  ) {
    const jobs = [];

    for (
      const hub of
      scene.hubs
    ) {
      const primary =
        hub.tier ===
        "primary";

      const stepsMin =
        primary
          ? config.rootSteps[0]
          : config.secondarySteps[0];

      const stepsMax =
        primary
          ? config.rootSteps[1]
          : config.secondarySteps[1];

      for (
        let rootIndex = 0;
        rootIndex <
        hub.roots.length;
        rootIndex += 1
      ) {
        const root =
          hub.roots[
            rootIndex
          ];

        const steps =
          stepsMin +
          Math.floor(
            random() *
              (
                stepsMax -
                stepsMin +
                1
              ),
          );

        const start =
          primary
            ? 1050 +
              hub.index *
                18 +
              rootIndex *
                26 +
              random() *
                160
            : 1450 +
              random() *
                1200;

        jobs.push({
          hub,
          primary,
          rootIndex,
          root,
          steps,
          start,

          score:
            rootIndex *
              100 +
            random() *
              80 +
            (
              primary
                ? 0
                : 650
            ),
        });
      }
    }

    jobs.sort(
      (a, b) =>
        a.score -
        b.score,
    );

    for (
      const job of
      jobs
    ) {
      const shoulderStyle = {
        widthStart:
          job.primary
            ? 1.85 +
              random() *
                0.52
            : 0.54 +
              random() *
                0.18,

        widthEnd:
          job.primary
            ? 1.22 +
              random() *
                0.42
            : 0.34 +
              random() *
                0.14,

        opacity:
          job.primary
            ? 0.68 +
              random() *
                0.12
            : 0.18 +
              random() *
                0.10,

        layer:
          job.primary
            ? 2
            : 1,

        phase:
          "tree",
      };

      const shoulderSegment =
        addSegment(
          job.root.base,
          job.root.shoulder,
          shoulderStyle,
          job.start -
            280,
          random,
          {
            ownerId:
              job.hub.index,

            primaryWeight:
              job.primary
                ? 1
                : 0.18,

            boutonChance:
              0,
          },
        );

      growTree({
        start:
          job.root.shoulder,

        heading:
          job.root.angle +
          (random() - 0.5) *
            0.16,

        ownerId:
          job.hub.index,

        primary:
          job.primary,

        rootIndex:
          job.rootIndex,

        remaining:
          job.steps,

        depth: 0,

        startTime:
          job.start,

        config,
        random,

        lengthScale:
          job.primary
            ? job.rootIndex <
              2
              ? 1.22
              : 0.82 +
                job.hub.activity *
                  0.24
            : 0.58 +
              job.hub.activity *
                0.28,

        inheritedWidthStart:
          shoulderSegment
            ?.widthEnd ??
          shoulderStyle.widthEnd,
      });
    }
  }

  function buildMicroMesh(
    random,
    config,
  ) {
    const points = [];
    const hubs =
      scene.hubs;

    const minSpacing =
      config.compact
        ? 10
        : 12;

    let attempts = 0;

    while (
      points.length <
        config.meshPointCount &&
      attempts <
        config.meshPointCount *
          60
    ) {
      attempts += 1;

      let point;

      if (
        random() <
          0.62 &&
        hubs.length >
          0
      ) {
        const hub =
          hubs[
            Math.floor(
              random() *
                hubs.length,
            )
          ];

        const angle =
          random() *
          Math.PI *
          2;

        const radius =
          config.branchUnit *
          (
            0.7 +
            random() *
              3.2
          );

        point =
          pointFromPolar(
            hub,
            angle,
            radius,
          );
      } else {
        point = {
          x:
            random() *
            width,

          y:
            random() *
            height,
        };
      }

      if (
        outsideSoftBounds(
          point,
        )
      ) {
        continue;
      }

      if (
        random() >
        textZoneWeight(
          point,
          config,
        ) *
          0.98
      ) {
        continue;
      }

      if (
        points.some(
          (candidate) =>
            dist(
              candidate,
              point,
            ) <
            minSpacing,
        )
      ) {
        continue;
      }

      points.push(
        point,
      );
    }

    const degree =
      new Array(
        points.length,
      ).fill(0);

    const maxDistance =
      config.crosslinkDistance *
      (
        config.compact
          ? 0.88
          : 0.82
      );

    for (
      let i = 0;
      i <
      points.length;
      i += 1
    ) {
      const neighbors = [];

      for (
        let j = 0;
        j <
        points.length;
        j += 1
      ) {
        if (
          i === j
        ) {
          continue;
        }

        const d =
          dist(
            points[i],
            points[j],
          );

        if (
          d < 10 ||
          d >
            maxDistance
        ) {
          continue;
        }

        neighbors.push({
          j,
          d,
        });
      }

      neighbors.sort(
        (a, b) =>
          a.d -
          b.d,
      );

      const desired =
        random() < 0.18
          ? 3
          : 2;

      for (
        let k = 0;
        k <
        Math.min(
          desired,
          neighbors.length,
        );
        k += 1
      ) {
        const neighbor =
          neighbors[k];

        if (
          degree[i] >= 4 ||
          degree[
            neighbor.j
          ] >= 4
        ) {
          continue;
        }

        const a =
          points[i];

        const b =
          points[
            neighbor.j
          ];

        const midpoint =
          lerpPoint(
            a,
            b,
            0.5,
          );

        const zoneWeight =
          textZoneWeight(
            midpoint,
            config,
          );

        if (
          random() >
          0.72 *
            zoneWeight +
            0.20
        ) {
          continue;
        }

        const style = {
          widthStart:
            0.18 +
            random() *
              0.16,

          widthEnd:
            0.15 +
            random() *
              0.14,

          opacity:
            0.032 +
            random() *
              0.070,

          layer: 0,

          phase:
            "mesh",
        };

        const start =
          1650 +
          random() *
            1700;

        const segment =
          addSegment(
            a,
            b,
            style,
            start,
            random,
            {
              primaryWeight:
                0,

              boutonChance:
                0,
            },
          );

        if (
          segment
        ) {
          degree[i] +=
            1;

          degree[
            neighbor.j
          ] +=
            1;
        }
      }
    }

    for (
      let i = 0;
      i <
      points.length;
      i += 1
    ) {
      if (
        degree[i] <
          2 ||
        random() >
          0.72
      ) {
        continue;
      }

      scene.boutons.push({
        x:
          points[i].x,

        y:
          points[i].y,

        radius:
          0.28 +
          random() *
            0.40,

        opacity:
          0.14 +
          random() *
            0.26,

        arrival:
          1900 +
          random() *
            1500,

        duration:
          180 +
          random() *
            180,
      });
    }
  }

  function buildFineFilaments(
    random,
    config,
  ) {
    const candidates =
      [
        ...scene.junctionMap.values(),
      ]
        .filter(
          (junction) =>
            junction.degree <=
              3 &&
            junction.ownerIds.size >
              0 &&
            !outsideSoftBounds(
              junction,
            ),
        )
        .map(
          (junction) => ({
            junction,

            score:
              random() /
              textZoneWeight(
                junction,
                config,
              ),
          }),
        )
        .sort(
          (a, b) =>
            a.score -
            b.score,
        );

    let added = 0;

    for (
      const {
        junction,
      } of candidates
    ) {
      if (
        added >=
          config.filamentBudget ||
        scene.segments.length >=
          config.segmentBudget -
            config.crosslinkBudget
      ) {
        break;
      }

      if (
        random() >
        0.34 *
          textZoneWeight(
            junction,
            config,
          )
      ) {
        continue;
      }

      const ownerId =
        junction.ownerIds
          .values()
          .next()
          .value;

      const branchCount =
        random() < 0.23
          ? 2
          : 1;

      for (
        let branchIndex = 0;
        branchIndex <
        branchCount;
        branchIndex += 1
      ) {
        let start =
          junction;

        let heading =
          random() *
          Math.PI *
          2;

        let opacity =
          0.045 +
          random() *
            0.075;

        let widthValue =
          0.22 +
          random() *
            0.17;

        const steps =
          1 +
          Math.floor(
            random() *
              4,
          );

        let startTime =
          junction.arrival +
          180 +
          random() *
            700;

        for (
          let k = 0;
          k <
          steps;
          k += 1
        ) {
          if (
            added >=
            config.filamentBudget
          ) {
            break;
          }

          const length =
            config.branchUnit *
            (
              0.18 +
              random() *
                0.28
            );

          heading +=
            (random() - 0.5) *
            0.86;

          const end =
            pointFromPolar(
              start,
              heading,
              length,
            );

          if (
            outsideSoftBounds(
              end,
            )
          ) {
            break;
          }

          const style = {
            widthStart:
              widthValue,

            widthEnd:
              Math.max(
                0.16,

                widthValue *
                  (
                    0.72 +
                    random() *
                      0.10
                  ),
              ),

            opacity,

            layer: 0,

            phase:
              "filament",
          };

          const segment =
            addSegment(
              start,
              end,
              style,
              startTime,
              random,
              {
                ownerId,

                primaryWeight:
                  0,

                terminal:
                  k ===
                  steps - 1,

                boutonChance:
                  0.02,
              },
            );

          if (
            !segment
          ) {
            break;
          }

          added += 1;

          start =
            end;

          startTime =
            segment.start +
            segment.duration *
              0.72;

          opacity *=
            0.76 +
            random() *
              0.10;

          widthValue =
            style.widthEnd;
        }
      }
    }
  }

  function orientation(
    a,
    b,
    c,
  ) {
    return (
      (b.x - a.x) *
        (c.y - a.y) -
      (b.y - a.y) *
        (c.x - a.x)
    );
  }

  function sharesEndpoint(
    a,
    b,
    segment,
  ) {
    const tolerance =
      0.7;

    return (
      dist(
        a,
        segment.a,
      ) <
        tolerance ||
      dist(
        a,
        segment.b,
      ) <
        tolerance ||
      dist(
        b,
        segment.a,
      ) <
        tolerance ||
      dist(
        b,
        segment.b,
      ) <
        tolerance
    );
  }

  function hardCrossesExisting(
    a,
    b,
  ) {
    for (
      const segment of
      scene.segments
    ) {
      if (
        sharesEndpoint(
          a,
          b,
          segment,
        )
      ) {
        continue;
      }

      const o1 =
        orientation(
          a,
          b,
          segment.a,
        );

      const o2 =
        orientation(
          a,
          b,
          segment.b,
        );

      const o3 =
        orientation(
          segment.a,
          segment.b,
          a,
        );

      const o4 =
        orientation(
          segment.a,
          segment.b,
          b,
        );

      if (
        o1 * o2 <
          0 &&
        o3 * o4 <
          0
      ) {
        return true;
      }
    }

    return false;
  }

  function buildCrosslinks(
    random,
    config,
  ) {
    const junctions =
      [
        ...scene.junctionMap.values(),
      ].filter(
        (junction) =>
          junction.degree <=
            5 &&
          !outsideSoftBounds(
            junction,
          ),
      );

    const candidates = [];

    for (
      let i = 0;
      i <
      junctions.length;
      i += 1
    ) {
      const a =
        junctions[i];

      for (
        let j = i + 1;
        j <
        Math.min(
          junctions.length,
          i + 95,
        );
        j += 1
      ) {
        const b =
          junctions[j];

        const length =
          dist(
            a,
            b,
          );

        if (
          length < 16 ||
          length >
            config.crosslinkDistance
        ) {
          continue;
        }

        const midpoint =
          lerpPoint(
            a,
            b,
            0.5,
          );

        const zoneWeight =
          textZoneWeight(
            midpoint,
            config,
          );

        const sameOwner =
          [
            ...a.ownerIds,
          ].some(
            (id) =>
              b.ownerIds.has(
                id,
              ),
          );

        if (
          sameOwner &&
          random() >
            0.40
        ) {
          continue;
        }

        candidates.push({
          a,
          b,
          length,
          zoneWeight,

          score:
            (
              length *
              (
                0.82 +
                random() *
                  0.36
              ) *
              (
                sameOwner
                  ? 1.45
                  : 1
              )
            ) /
            (
              0.20 +
              zoneWeight
            ),
        });
      }
    }

    candidates.sort(
      (a, b) =>
        a.score -
        b.score,
    );

    let added = 0;

    for (
      const candidate of
      candidates
    ) {
      if (
        added >=
          config.crosslinkBudget ||
        scene.segments.length >=
          config.segmentBudget
      ) {
        break;
      }

      if (
        candidate.a.webDegree >=
          3 ||
        candidate.b.webDegree >=
          3
      ) {
        continue;
      }

      if (
        candidate.a.degree >=
          7 ||
        candidate.b.degree >=
          7
      ) {
        continue;
      }

      const dark =
        random() <
        0.09;

      if (
        dark &&
        hardCrossesExisting(
          candidate.a,
          candidate.b,
        )
      ) {
        continue;
      }

      if (
        !dark &&
        random() >
          candidate.zoneWeight
      ) {
        continue;
      }

      const style =
        dark
          ? {
              widthStart:
                0.46 +
                random() *
                  0.25,

              widthEnd:
                0.34 +
                random() *
                  0.20,

              opacity:
                0.16 +
                random() *
                  0.16,

              layer: 1,

              phase:
                "web",
            }
          : {
              widthStart:
                0.22 +
                random() *
                  0.20,

              widthEnd:
                0.18 +
                random() *
                  0.18,

              opacity:
                0.035 +
                random() *
                  0.085,

              layer: 0,

              phase:
                "web",
            };

      const start =
        Math.max(
          candidate.a.arrival,
          candidate.b.arrival,
        ) +
        240 +
        random() *
          900;

      const segment =
        addSegment(
          candidate.a,
          candidate.b,
          style,
          start,
          random,
          {
            primaryWeight:
              0,

            boutonChance:
              dark
                ? 0.06
                : 0,
          },
        );

      if (
        segment
      ) {
        added += 1;
      }
    }
  }

  function finalizeJunctions(
    random,
  ) {
    scene.junctions =
      [
        ...scene.junctionMap.values(),
      ];

    for (
      const junction of
      scene.junctions
    ) {
      let visibleChance;
      let radius;

      if (
        junction.degree <=
        1
      ) {
        visibleChance =
          0;

        radius =
          0.24 +
          random() *
            0.24;
      } else if (
        junction.degree ===
        2
      ) {
        visibleChance =
          0.02;

        radius =
          0.30 +
          random() *
            0.30;
      } else if (
        junction.degree ===
        3
      ) {
        visibleChance =
          0.66;

        radius =
          0.46 +
          random() *
            0.42;
      } else {
        visibleChance =
          0.92;

        radius =
          0.68 +
          random() *
            0.52;
      }

      junction.visible =
        random() <
        visibleChance;

      junction.radius =
        junction.visible
          ? Math.min(
              1.45,

              radius +
                junction.primaryWeight *
                  0.12,
            )
          : 0;

      junction.opacity =
        clamp(
          junction.maxOpacity *
            (
              0.82 +
              random() *
                0.25
            ),
          0.08,
          0.92,
        );

      junction.duration =
        190 +
        random() *
          190;
    }
  }

  function retimeGrowthTimeline() {
    const targetTimes = {
      branchStart: 450,
      coarseEnd: 1900,
      treeEnd: 2800,
      growthEnd: 3000,
    };

    const treeSegments =
      scene.segments.filter(
        (segment) =>
          segment.phase ===
          "tree",
      );

    const coarseSegments =
      treeSegments.filter(
        (segment) =>
          segment.layer === 2,
      );

    const sourceBranchStart =
      Math.min(
        ...treeSegments.map(
          (segment) =>
            segment.start,
        ),
      );

    const sourceCoarseEnd =
      Math.max(
        ...coarseSegments.map(
          (segment) =>
            segment.start +
            segment.duration,
        ),
      );

    const sourceTreeEnd =
      Math.max(
        ...treeSegments.map(
          (segment) =>
            segment.start +
            segment.duration,
        ),
      );

    const endings = [
      sourceTreeEnd,
    ];

    for (
      const segment of
      scene.segments
    ) {
      endings.push(
        segment.start +
          segment.duration,
      );
    }

    for (
      const facet of
      scene.facets
    ) {
      endings.push(
        facet.start +
          facet.duration,
      );
    }

    for (
      const bouton of
      scene.boutons
    ) {
      endings.push(
        bouton.arrival +
          bouton.duration,
      );
    }

    for (
      const junction of
      scene.junctions
    ) {
      endings.push(
        junction.arrival +
          junction.duration,
      );
    }

    for (
      const hub of
      scene.hubs
    ) {
      endings.push(
        hub.appearStart +
          hub.appearDuration,
      );

      const maxFacetDelay =
        Math.max(
          0,
          ...hub.facets.map(
            (facet) =>
              facet.delay,
          ),
        );

      endings.push(
        hub.starStart +
          maxFacetDelay +
          hub.starDuration,
      );
    }

    const sourceGrowthEnd =
      Math.max(
        ...endings,
      );

    const sourceTimes = [
      0,
      sourceBranchStart,
      Math.max(
        sourceBranchStart + 1,
        sourceCoarseEnd,
      ),
      Math.max(
        sourceCoarseEnd + 1,
        sourceTreeEnd,
      ),
      Math.max(
        sourceTreeEnd + 1,
        sourceGrowthEnd,
      ),
    ];

    const mappedTimes = [
      0,
      targetTimes.branchStart,
      targetTimes.coarseEnd,
      targetTimes.treeEnd,
      targetTimes.growthEnd,
    ];

    function mapTime(
      value,
    ) {
      const time =
        clamp(
          value,
          0,
          sourceTimes[
            sourceTimes.length - 1
          ],
        );

      for (
        let i = 1;
        i <
          sourceTimes.length;
        i += 1
      ) {
        if (
          time <=
          sourceTimes[i]
        ) {
          const progress =
            (
              time -
              sourceTimes[i - 1]
            ) /
            (
              sourceTimes[i] -
              sourceTimes[i - 1]
            );

          return lerp(
            mappedTimes[i - 1],
            mappedTimes[i],
            progress,
          );
        }
      }

      return targetTimes.growthEnd;
    }

    function remapSpan(
      item,
      startKey,
      durationKey,
    ) {
      const start =
        item[startKey];

      const end =
        start +
        item[durationKey];

      item[startKey] =
        mapTime(
          start,
        );

      item[durationKey] =
        Math.max(
          1,
          mapTime(end) -
            item[startKey],
        );
    }

    for (
      const segment of
      scene.segments
    ) {
      remapSpan(
        segment,
        "start",
        "duration",
      );
    }

    for (
      const facet of
      scene.facets
    ) {
      remapSpan(
        facet,
        "start",
        "duration",
      );
    }

    for (
      const bouton of
      scene.boutons
    ) {
      remapSpan(
        bouton,
        "arrival",
        "duration",
      );
    }

    for (
      const junction of
      scene.junctions
    ) {
      remapSpan(
        junction,
        "arrival",
        "duration",
      );
    }

    for (
      const hub of
      scene.hubs
    ) {
      remapSpan(
        hub,
        "appearStart",
        "appearDuration",
      );

      const starStart =
        hub.starStart;

      const starDuration =
        hub.starDuration;

      const maxFacetDelay =
        Math.max(
          0,
          ...hub.facets.map(
            (facet) =>
              facet.delay,
          ),
        );

      const mappedStarStart =
        mapTime(
          starStart,
        );

      for (
        const facet of
        hub.facets
      ) {
        facet.delay =
          mapTime(
            starStart +
              facet.delay,
          ) -
          mappedStarStart;
      }

      const mappedLastFacetStart =
        mappedStarStart +
        Math.max(
          0,
          ...hub.facets.map(
            (facet) =>
              facet.delay,
          ),
        );

      hub.starStart =
        mappedStarStart;

      hub.starDuration =
        Math.max(
          1,
          mapTime(
            starStart +
              maxFacetDelay +
              starDuration,
          ) -
            mappedLastFacetStart,
        );
    }
  }

  function finalizeTimeline() {
    const endings = [
      2400,
    ];

    for (
      const segment of
      scene.segments
    ) {
      endings.push(
        segment.start +
          segment.duration,
      );
    }

    for (
      const facet of
      scene.facets
    ) {
      endings.push(
        facet.start +
          facet.duration,
      );
    }

    for (
      const bouton of
      scene.boutons
    ) {
      endings.push(
        bouton.arrival +
          bouton.duration,
      );
    }

    for (
      const junction of
      scene.junctions
    ) {
      endings.push(
        junction.arrival +
          junction.duration,
      );
    }

    for (
      const hub of
      scene.hubs
    ) {
      endings.push(
        hub.appearStart +
          hub.appearDuration,
      );

      const maxFacetDelay =
        Math.max(
          0,
          ...hub.facets.map(
            (facet) =>
              facet.delay,
          ),
        );

      endings.push(
        hub.starStart +
          maxFacetDelay +
          hub.starDuration,
      );
    }

    scene.growthEnd =
      Math.max(
        ...endings,
      );

    scene.cycleEnd =
      scene.growthEnd +
      scene.holdDuration +
      scene.retreatDuration;
  }

  function makeScene() {
    const config =
      getSceneConfig();

    const aspectBucket =
      Math.round(
        clamp(
          width / height,
          0.45,
          2.3,
        ) *
          10,
      );

    const layoutSeed =
      SCENE_SEED +
      aspectBucket *
        97 +
      (
        config.compact
          ? 1000
          : config.medium
            ? 2000
            : 3000
      );

    const primaryRandom =
      mulberry32(
        layoutSeed +
          11,
      );

    const secondaryRandom =
      mulberry32(
        layoutSeed +
          101,
      );

    const branchRandom =
      mulberry32(
        layoutSeed +
          211,
      );

    const meshRandom =
      mulberry32(
        layoutSeed +
          263,
      );

    const filamentRandom =
      mulberry32(
        layoutSeed +
          307,
      );

    const webRandom =
      mulberry32(
        layoutSeed +
          401,
      );

    const finishRandom =
      mulberry32(
        layoutSeed +
          503,
      );

    scene =
      emptyScene();

    scene.config =
      config;

    scene.hubs =
      config.primaryAnchors.map(
        (
          anchor,
          index,
        ) =>
          makePrimaryHub(
            anchor,
            index,
            config,
            primaryRandom,
          ),
      );

    const secondaryCenters =
      sampleSecondaryHubs(
        config,
        secondaryRandom,
      );

    for (
      let i = 0;
      i <
      secondaryCenters.length;
      i += 1
    ) {
      scene.hubs.push(
        makeSecondaryHub(
          secondaryCenters[i],

          config.primaryAnchors
            .length +
            i,

          config,

          secondaryRandom,
        ),
      );
    }

    buildHubTrees(
      branchRandom,
      config,
    );

    buildMicroMesh(
      meshRandom,
      config,
    );

    buildFineFilaments(
      filamentRandom,
      config,
    );

    scene.junctionMap =
      new Map(
        [
          ...scene.junctionMap.entries(),
        ].sort(
          (a, b) =>
            a[1].x -
            b[1].x,
        ),
      );

    buildCrosslinks(
      webRandom,
      config,
    );

    finalizeJunctions(
      finishRandom,
    );

    retimeGrowthTimeline();

    finalizeTimeline();
  }

  function drawLine(
    a,
    b,
    progress,
  ) {
    context.beginPath();

    context.moveTo(
      a.x,
      a.y,
    );

    context.lineTo(
      lerp(
        a.x,
        b.x,
        progress,
      ),

      lerp(
        a.y,
        b.y,
        progress,
      ),
    );

    context.stroke();
  }

  function drawTaperedSegment(
    segment,
    progress,
  ) {
    const end =
      lerpPoint(
        segment.a,
        segment.b,
        progress,
      );

    const dx =
      end.x -
      segment.a.x;

    const dy =
      end.y -
      segment.a.y;

    const length =
      Math.hypot(
        dx,
        dy,
      ) || 1;

    const nx =
      -dy /
      length;

    const ny =
      dx /
      length;

    const startWidth =
      segment.widthStart;

    const endWidth =
      lerp(
        segment.widthStart,
        segment.widthEnd,
        progress,
      );

    if (
      Math.max(
        startWidth,
        endWidth,
      ) <
      0.72
    ) {
      context.lineWidth =
        Math.max(
          0.18,

          (
            startWidth +
            endWidth
          ) *
            0.50,
        );

      context.lineCap =
        "round";

      drawLine(
        segment.a,
        segment.b,
        progress,
      );

      return;
    }

    const startHalf =
      startWidth *
      0.5;

    const endHalf =
      endWidth *
      0.5;

    context.beginPath();

    context.moveTo(
      segment.a.x +
        nx *
          startHalf,

      segment.a.y +
        ny *
          startHalf,
    );

    context.lineTo(
      end.x +
        nx *
          endHalf,

      end.y +
        ny *
          endHalf,
    );

    context.lineTo(
      end.x -
        nx *
          endHalf,

      end.y -
        ny *
          endHalf,
    );

    context.lineTo(
      segment.a.x -
        nx *
          startHalf,

      segment.a.y -
        ny *
          startHalf,
    );

    context.closePath();

    context.fill();
  }

  function drawFacet(
    facet,
    elapsed,
  ) {
    const raw =
      reduceMotion.matches
        ? 1
        : (
            elapsed -
            facet.start
          ) /
          facet.duration;

    const progress =
      ease(
        raw,
      );

    if (
      progress <= 0
    ) {
      return;
    }

    const center =
      facet.points.reduce(
        (
          result,
          point,
        ) => ({
          x:
            result.x +
            point.x /
              facet.points.length,

          y:
            result.y +
            point.y /
              facet.points.length,
        }),
        {
          x: 0,
          y: 0,
        },
      );

    const points =
      facet.points.map(
        (point) =>
          lerpPoint(
            center,
            point,
            0.70 +
              progress *
                0.30,
          ),
      );

    context.beginPath();

    context.moveTo(
      points[0].x,
      points[0].y,
    );

    for (
      let i = 1;
      i <
      points.length;
      i += 1
    ) {
      context.lineTo(
        points[i].x,
        points[i].y,
      );
    }

    context.closePath();

    context.fillStyle =
      `rgba(${INK.join(",")},${facet.opacity * progress})`;

    context.fill();

    if (
      facet.outlineOpacity >
      0
    ) {
      context.strokeStyle =
        `rgba(${INK.join(",")},${facet.outlineOpacity * progress})`;

      context.lineWidth =
        0.34;

      context.stroke();
    }
  }

  function drawSegment(
    segment,
    elapsed,
  ) {
    const raw =
      reduceMotion.matches
        ? 1
        : (
            elapsed -
            segment.start
          ) /
          segment.duration;

    const progress =
      ease(
        raw,
      );

    if (
      progress <= 0
    ) {
      return;
    }

    const alpha =
      segment.opacity;

    context.strokeStyle =
      `rgba(${INK.join(",")},${alpha})`;

    context.fillStyle =
      `rgba(${INK.join(",")},${alpha})`;

    drawTaperedSegment(
      segment,
      progress,
    );
  }

  function drawBouton(
    bouton,
    elapsed,
  ) {
    const raw =
      reduceMotion.matches
        ? 1
        : (
            elapsed -
            bouton.arrival
          ) /
          bouton.duration;

    const progress =
      ease(
        raw,
      );

    if (
      progress <= 0
    ) {
      return;
    }

    context.beginPath();

    context.arc(
      bouton.x,
      bouton.y,

      bouton.radius *
        (
          0.36 +
          0.64 *
            progress
        ),

      0,
      Math.PI *
        2,
    );

    context.fillStyle =
      `rgba(${INK.join(",")},${bouton.opacity * progress})`;

    context.fill();
  }

  function drawJunction(
    junction,
    elapsed,
  ) {
    if (
      !junction.visible
    ) {
      return;
    }

    const raw =
      reduceMotion.matches
        ? 1
        : (
            elapsed -
            junction.arrival
          ) /
          junction.duration;

    const progress =
      ease(
        raw,
      );

    if (
      progress <= 0
    ) {
      return;
    }

    context.beginPath();

    context.arc(
      junction.x,
      junction.y,

      junction.radius *
        (
          0.35 +
          0.65 *
            progress
        ),

      0,
      Math.PI *
        2,
    );

    context.fillStyle =
      `rgba(${INK.join(",")},${junction.opacity * progress})`;

    context.fill();
  }

  function drawHubStructure(
    hub,
    elapsed,
    pulseScale = 1,
  ) {
    for (
      const facet of
      hub.facets
    ) {
      const raw =
        reduceMotion.matches
          ? 1
          : (
              elapsed -
              hub.starStart -
              facet.delay
            ) /
            hub.starDuration;

      const progress =
        ease(
          raw,
        );

      if (
        progress <= 0
      ) {
        continue;
      }

      const points =
        facet.points.map(
          (point) =>
            lerpPoint(
              hub,
              point,

              (
                0.25 +
                0.75 *
                  progress
              ) *
                pulseScale,
            ),
        );

      context.beginPath();

      context.moveTo(
        points[0].x,
        points[0].y,
      );

      for (
        let i = 1;
        i <
        points.length;
        i += 1
      ) {
        context.lineTo(
          points[i].x,
          points[i].y,
        );
      }

      context.closePath();

      context.fillStyle =
        `rgba(${INK.join(",")},${facet.opacity * progress})`;

      context.fill();

      if (
        facet.outlineOpacity >
        0
      ) {
        context.strokeStyle =
          `rgba(${INK.join(",")},${facet.outlineOpacity * progress})`;

        context.lineWidth =
          hub.tier ===
          "primary"
            ? 0.44
            : 0.28;

        context.lineJoin =
          "miter";

        context.stroke();
      }
    }

    const raw =
      reduceMotion.matches
        ? 1
        : (
            elapsed -
            hub.starStart
          ) /
          hub.starDuration;

    const progress =
      ease(
        raw,
      );

    if (
      progress <= 0
    ) {
      return;
    }

    context.strokeStyle =
      `rgba(${INK.join(",")},${
        (
          hub.tier ===
          "primary"
            ? 0.18
            : 0.08
        ) *
        progress
      })`;

    context.lineWidth =
      hub.tier ===
      "primary"
        ? 0.48
        : 0.26;

    context.lineCap =
      "round";

    for (
      const root of
      hub.roots
    ) {
      drawLine(
        lerpPoint(
          hub,
          root.base,
          pulseScale,
        ),

        lerpPoint(
          hub,
          root.shoulder,
          pulseScale,
        ),

        progress,
      );
    }
  }

  function drawHubCore(
    hub,
    elapsed,
    pulseScale = 1,
  ) {
    const raw =
      reduceMotion.matches
        ? 1
        : (
            elapsed -
            hub.appearStart
          ) /
          hub.appearDuration;

    const progress =
      ease(
        raw,
      );

    if (
      progress <= 0
    ) {
      return;
    }

    const radius =
      hub.somaRadius *
      (
        0.64 +
        0.36 *
          progress
      ) *
      pulseScale;

    if (
      hub.tier ===
      "primary"
    ) {
      context.beginPath();

      for (
        let i = 0;
        i <
        hub.roots.length;
        i += 1
      ) {
        const root =
          hub.roots[i];

        const point =
          lerpPoint(
            hub,
            root.base,

            (
              1.14 +
              (i % 3) *
                0.06
            ) *
              pulseScale,
          );

        if (
          i === 0
        ) {
          context.moveTo(
            point.x,
            point.y,
          );
        } else {
          context.lineTo(
            point.x,
            point.y,
          );
        }
      }

      context.closePath();

      context.strokeStyle =
        `rgba(${INK.join(",")},${0.14 * progress})`;

      context.lineWidth =
        0.38;

      context.stroke();
    }

    context.beginPath();

    context.arc(
      hub.x,
      hub.y,
      radius,
      0,
      Math.PI *
        2,
    );

    context.fillStyle =
      `rgba(${INK.join(",")},${
        (
          hub.tier ===
          "primary"
            ? 0.94
            : 0.78
        ) *
        progress
      })`;

    context.fill();
  }

  function drawBackConnections(
    elapsed,
  ) {
    for (
      const facet of
      scene.facets
    ) {
      drawFacet(
        facet,
        elapsed,
      );
    }

    for (
      const layer of
      [0, 1]
    ) {
      for (
        const segment of
        scene.segments
      ) {
        if (
          segment.layer ===
          layer
        ) {
          drawSegment(
            segment,
            elapsed,
          );
        }
      }
    }
  }

  function drawFrontConnections(
    elapsed,
  ) {
    for (
      const segment of
      scene.segments
    ) {
      if (
        segment.layer ===
        2
      ) {
        drawSegment(
          segment,
          elapsed,
        );
      }
    }

    for (
      const junction of
      scene.junctions
    ) {
      drawJunction(
        junction,
        elapsed,
      );
    }

    for (
      const bouton of
      scene.boutons
    ) {
      drawBouton(
        bouton,
        elapsed,
      );
    }
  }

  function drawHubStructures(
    elapsed,
    pulseScale = 1,
  ) {
    for (
      const hub of
      scene.hubs
    ) {
      drawHubStructure(
        hub,
        elapsed,
        pulseScale,
      );
    }
  }

  function drawHubCores(
    elapsed,
    pulseScale = 1,
  ) {
    for (
      const hub of
      scene.hubs
    ) {
      drawHubCore(
        hub,
        elapsed,
        pulseScale,
      );
    }
  }

  function drawGrowingScene(
    connectionElapsed,
    hubElapsed,
    pulseScale = 1,
  ) {
    drawBackConnections(
      connectionElapsed,
    );

    drawHubStructures(
      hubElapsed,
      pulseScale,
    );

    drawFrontConnections(
      connectionElapsed,
    );

    drawHubCores(
      hubElapsed,
      pulseScale,
    );
  }

  function applyPointerMask() {
    const radius =
      scene.config.compact
        ? clamp(
            Math.min(
              width,
              height,
            ) *
              0.30,
            118,
            165,
          )
        : clamp(
            Math.min(
              width,
              height,
            ) *
              0.26,
            175,
            245,
          );

    const gradient =
      context.createRadialGradient(
        pointer.x,
        pointer.y,
        radius * 0.08,

        pointer.x,
        pointer.y,
        radius,
      );

    const strength =
      clamp(
        pointer.strength,
        0,
        1,
      );

    gradient.addColorStop(
      0,
      `rgba(0,0,0,${strength})`,
    );

    gradient.addColorStop(
      0.58,
      `rgba(0,0,0,${strength * 0.96})`,
    );

    gradient.addColorStop(
      0.83,
      `rgba(0,0,0,${strength * 0.42})`,
    );

    gradient.addColorStop(
      1,
      "rgba(0,0,0,0)",
    );

    context.save();

    context.globalCompositeOperation =
      "destination-in";

    context.fillStyle =
      gradient;

    context.fillRect(
      0,
      0,
      width,
      height,
    );

    context.restore();
  }

  function drawInteractiveScene() {
    if (
      reduceMotion.matches
    ) {
      drawBackConnections(
        Number.POSITIVE_INFINITY,
      );

      drawFrontConnections(
        Number.POSITIVE_INFINITY,
      );
    } else if (
      pointer.strength >
        0.002 &&
      pointer.hasPosition
    ) {
      drawBackConnections(
        Number.POSITIVE_INFINITY,
      );

      drawFrontConnections(
        Number.POSITIVE_INFINITY,
      );

      applyPointerMask();
    }

    drawHubStructures(
      Number.POSITIVE_INFINITY,
    );

    drawHubCores(
      Number.POSITIVE_INFINITY,
    );
  }

  function updatePointer() {
    if (
      !pointer.hasPosition
    ) {
      return false;
    }

    if (
      reduceMotion.matches
    ) {
      pointer.x =
        pointer.targetX;

      pointer.y =
        pointer.targetY;

      pointer.strength =
        pointer.targetStrength;

      return false;
    }

    const positionEase =
      0.20;

    const strengthEase =
      pointer.targetStrength >
      pointer.strength
        ? 0.18
        : 0.12;

    const dx =
      pointer.targetX -
      pointer.x;

    const dy =
      pointer.targetY -
      pointer.y;

    const ds =
      pointer.targetStrength -
      pointer.strength;

    pointer.x +=
      dx *
      positionEase;

    pointer.y +=
      dy *
      positionEase;

    pointer.strength +=
      ds *
      strengthEase;

    if (
      Math.abs(
        dx,
      ) <
      0.08
    ) {
      pointer.x =
        pointer.targetX;
    }

    if (
      Math.abs(
        dy,
      ) <
      0.08
    ) {
      pointer.y =
        pointer.targetY;
    }

    if (
      Math.abs(
        ds,
      ) <
      0.002
    ) {
      pointer.strength =
        pointer.targetStrength;
    }

    return (
      Math.abs(dx) >=
        0.08 ||
      Math.abs(dy) >=
        0.08 ||
      Math.abs(ds) >=
        0.002
    );
  }

  function render(
    time,
  ) {
    let pending =
      false;

    context.clearRect(
      0,
      0,
      width,
      height,
    );

    if (
      completed ||
      reduceMotion.matches
    ) {
      completed =
        true;

      pending =
        updatePointer();

      drawInteractiveScene();
    } else {
      const elapsed =
        time -
        animationStart;

      const holdEnd =
        scene.growthEnd +
        scene.holdDuration;

      if (
        elapsed <=
        scene.growthEnd
      ) {
        drawGrowingScene(
          elapsed,
          elapsed,
        );

        pending =
          true;
      } else if (
        elapsed <=
        holdEnd
      ) {
        drawGrowingScene(
          Number.POSITIVE_INFINITY,
          Number.POSITIVE_INFINITY,
        );

        pending =
          true;
      } else if (
        elapsed <
        scene.cycleEnd
      ) {
        const retreatProgress =
          (
            elapsed -
            holdEnd
          ) /
          scene.retreatDuration;

        const reverseElapsed =
          scene.growthEnd *
          (
            1 -
            retreatProgress
          );

        drawGrowingScene(
          reverseElapsed,
          Number.POSITIVE_INFINITY,
          1,
        );

        pending =
          true;
      } else {
        completed =
          true;

        pending =
          updatePointer();

        drawInteractiveScene();
      }
    }

    if (
      pending
    ) {
      animationFrame =
        window.requestAnimationFrame(
          render,
        );
    } else {
      animationFrame =
        0;
    }
  }

  function restart(
    skipIntro = false,
  ) {
    window.cancelAnimationFrame(
      animationFrame,
    );

    completed =
      skipIntro ||
      reduceMotion.matches;

    animationStart =
      performance.now();

    animationFrame =
      window.requestAnimationFrame(
        render,
      );
  }

  function requestRender() {
    if (
      !animationFrame
    ) {
      animationFrame =
        window.requestAnimationFrame(
          render,
        );
    }
  }

  function movePointer(
    event,
  ) {
    if (
      event.pointerType ===
      "touch"
    ) {
      return;
    }

    const bounds =
      canvas.getBoundingClientRect();

    const targetX =
      clamp(
        event.clientX -
          bounds.left,
        0,
        bounds.width,
      );

    const targetY =
      clamp(
        event.clientY -
          bounds.top,
        0,
        bounds.height,
      );

    pointer.targetX =
      targetX;

    pointer.targetY =
      targetY;

    pointer.targetStrength =
      1;

    if (
      !pointer.hasPosition ||
      pointer.strength <
        0.002
    ) {
      pointer.x =
        targetX;

      pointer.y =
        targetY;
    }

    pointer.hasPosition =
      true;

    if (
      completed
    ) {
      requestRender();
    }
  }

  function hidePointer() {
    pointer.targetStrength =
      0;

    if (
      completed
    ) {
      requestRender();
    }
  }

  function resize() {
    const bounds =
      canvas.getBoundingClientRect();

    const nextWidth =
      Math.max(
        1,
        Math.round(
          bounds.width,
        ),
      );

    const nextHeight =
      Math.max(
        1,
        Math.round(
          bounds.height,
        ),
      );

    if (
      nextWidth ===
        width &&
      nextHeight ===
        height
    ) {
      return;
    }

    const keepFinalState =
      completed;

    width =
      nextWidth;

    height =
      nextHeight;

    pointer.strength =
      0;

    pointer.targetStrength =
      0;

    pointer.hasPosition =
      false;

    const pixelRatio =
      Math.min(
        window.devicePixelRatio ||
          1,
        2,
      );

    canvas.width =
      Math.round(
        width *
          pixelRatio,
      );

    canvas.height =
      Math.round(
        height *
          pixelRatio,
      );

    context.setTransform(
      pixelRatio,
      0,
      0,
      pixelRatio,
      0,
      0,
    );

    makeScene();

    restart(
      keepFinalState,
    );
  }

  stage?.addEventListener(
    "pointermove",
    movePointer,
    {
      passive: true,
    },
  );

  stage?.addEventListener(
    "pointerdown",
    movePointer,
    {
      passive: true,
    },
  );

  stage?.addEventListener(
    "pointerleave",
    hidePointer,
    {
      passive: true,
    },
  );

  stage?.addEventListener(
    "pointercancel",
    hidePointer,
    {
      passive: true,
    },
  );

  window.addEventListener(
    "blur",
    hidePointer,
  );

  if (
    "ResizeObserver" in
    window
  ) {
    const observer =
      new ResizeObserver(
        () => {
          window.clearTimeout(
            resizeTimer,
          );

          resizeTimer =
            window.setTimeout(
              resize,
              100,
            );
        },
      );

    observer.observe(
      canvas.parentElement,
    );
  } else {
    window.addEventListener(
      "resize",
      () => {
        window.clearTimeout(
          resizeTimer,
        );

        resizeTimer =
          window.setTimeout(
            resize,
            120,
          );
      },
      {
        passive: true,
      },
    );
  }

  reduceMotion.addEventListener?.(
    "change",
    () =>
      restart(
        true,
      ),
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        !document.hidden &&
        !animationFrame &&
        !completed
      ) {
        restart();
      }
    },
  );

  window.addEventListener(
    "pageshow",
    (event) => {
      if (
        event.persisted &&
        !completed
      ) {
        restart();
      }
    },
  );

  resize();
})();
