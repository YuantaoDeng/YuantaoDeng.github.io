from __future__ import annotations

import math
import random
from pathlib import Path

import numpy as np
from scipy.spatial import Voronoi


# =============================================================================
# Open Fracture Synapses — Quarto include generator
# =============================================================================
# Designed to be included inside:
#
# ::: {.home-stage .column-screen}
# {{< include _neural-field.qmd >}}
#
# ::: {.home-copy}
# # Yuantao Deng
# :::
# :::
#
# The script generates `_neural-field.qmd`, a Quarto include fragment.
# The SVG and CSS are wrapped in a Pandoc raw-HTML block so Quarto passes
# them through to the final HTML instead of printing SVG tags as text.
# =============================================================================

WIDTH, HEIGHT = 1600, 900
SEED = 3476
RNG = random.Random(SEED)

INK = "#111111"

NEURON_COUNT = 38
MIN_NEURON_DISTANCE = 126
NODE_MARGIN = 48

GUARD_PAD = 270
GUARD_STEP = 118

RIDGE_WIDTH = 1.55
RIDGE_ECHO_WIDTH = 0.56
RIDGE_ECHO_SPACING = 2.05
RIDGE_END_GAP_MIN = 7
RIDGE_END_GAP_MAX = 14
RIDGE_DROP_PROB = 0.035

SOMA_RADIUS = 6.8
AXON_WIDTH = 0.62
DENDRITE_WIDTH = 0.50
PROCESS_SPACING = 1.75
SYNAPTIC_GAP = 6.5
BOUTON_SIZE = 3.2

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = (
    SCRIPT_DIR.parent
    if SCRIPT_DIR.name.lower() == "scripts"
    else SCRIPT_DIR
)
QMD_OUT = PROJECT_ROOT / "_neural-field.qmd"


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def unit(a, b):
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length = math.hypot(dx, dy) or 1.0
    return dx / length, dy / length


def add(p, v, scale=1.0):
    return p[0] + v[0] * scale, p[1] + v[1] * scale


def sub(p, v, scale=1.0):
    return p[0] - v[0] * scale, p[1] - v[1] * scale


def svg_path(points, close=False):
    d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in points)
    return d + (" Z" if close else "")


def offset_segment(a, b, offset):
    ux, uy = unit(a, b)
    nx, ny = -uy, ux
    return (
        (a[0] + nx * offset, a[1] + ny * offset),
        (b[0] + nx * offset, b[1] + ny * offset),
    )


def trim_segment(a, b, trim_start, trim_end):
    length = distance(a, b)
    if length <= trim_start + trim_end + 8:
        return None

    ux, uy = unit(a, b)
    return (
        (a[0] + ux * trim_start, a[1] + uy * trim_start),
        (b[0] - ux * trim_end, b[1] - uy * trim_end),
    )


def bundle_offsets(count, spacing=PROCESS_SPACING):
    if count <= 1:
        return [0.0]

    center = (count - 1) / 2
    return [(i - center) * spacing for i in range(count)]


# -----------------------------------------------------------------------------
# Invisible planar scaffold
# -----------------------------------------------------------------------------

def sample_centers():
    centers = []

    for _ in range(180_000):
        if len(centers) == NEURON_COUNT:
            break

        p = (
            RNG.uniform(NODE_MARGIN, WIDTH - NODE_MARGIN),
            RNG.uniform(NODE_MARGIN, HEIGHT - NODE_MARGIN),
        )

        if any(distance(p, q) < MIN_NEURON_DISTANCE for q in centers):
            continue

        centers.append(p)

    if len(centers) != NEURON_COUNT:
        raise RuntimeError("Could not place all neuron centers")

    return centers


def guard_points():
    points = []

    for x in np.arange(
        -GUARD_PAD,
        WIDTH + GUARD_PAD + 1,
        GUARD_STEP,
    ):
        points.append((float(x), -GUARD_PAD))
        points.append((float(x), HEIGHT + GUARD_PAD))

    for y in np.arange(
        -GUARD_PAD + GUARD_STEP,
        HEIGHT + GUARD_PAD,
        GUARD_STEP,
    ):
        points.append((-GUARD_PAD, float(y)))
        points.append((WIDTH + GUARD_PAD, float(y)))

    return points


def collect_ridges(centers):
    vor = Voronoi(np.array(centers + guard_points()))
    ridges = []

    for ridge_id, (pair, vertices) in enumerate(
        zip(vor.ridge_points, vor.ridge_vertices)
    ):
        i, j = map(int, pair)

        if i >= NEURON_COUNT or j >= NEURON_COUNT:
            continue
        if -1 in vertices or len(vertices) != 2:
            continue

        a = tuple(vor.vertices[vertices[0]])
        b = tuple(vor.vertices[vertices[1]])
        length = distance(a, b)

        if length < 42:
            continue

        local = random.Random(SEED + ridge_id * 97)
        if local.random() < RIDGE_DROP_PROB:
            continue

        ridges.append(
            {
                "id": ridge_id,
                "i": i,
                "j": j,
                "a": a,
                "b": b,
                "length": length,
            }
        )

    return ridges


# -----------------------------------------------------------------------------
# Neural geometry
# -----------------------------------------------------------------------------

def soma_polygon(center, index):
    cx, cy = center
    phase = math.pi / 6 + (index % 3 - 1) * math.radians(5)
    points = []

    for k in range(6):
        angle = phase + k * math.pi / 3
        radius = SOMA_RADIUS * (1.0 if k % 2 == 0 else 0.86)
        points.append(
            (
                cx + radius * math.cos(angle),
                cy + radius * math.sin(angle),
            )
        )

    return points


def soma_exit(center, target):
    direction = unit(center, target)
    return add(center, direction, SOMA_RADIUS * 0.96)


def build_scene():
    centers = sample_centers()
    ridges = collect_ridges(centers)

    ridge_svg = []
    axon_svg = []
    dendrite_svg = []
    synapse_svg = []
    soma_svg = []

    for edge_index, ridge in enumerate(ridges):
        local = random.Random(SEED + ridge["id"] * 211)

        i, j = ridge["i"], ridge["j"]
        ci, cj = centers[i], centers[j]

        trim_a = local.uniform(RIDGE_END_GAP_MIN, RIDGE_END_GAP_MAX)
        trim_b = local.uniform(RIDGE_END_GAP_MIN, RIDGE_END_GAP_MAX)

        trimmed = trim_segment(ridge["a"], ridge["b"], trim_a, trim_b)
        if trimmed is None:
            continue

        ra, rb = trimmed
        ridge_dir = unit(ra, rb)

        t = local.uniform(0.32, 0.68)
        contact = (
            ra[0] + (rb[0] - ra[0]) * t,
            ra[1] + (rb[1] - ra[1]) * t,
        )

        if (i + j + ridge["id"]) % 2 == 0:
            pre_center, post_center = ci, cj
        else:
            pre_center, post_center = cj, ci

        n = unit(pre_center, post_center)

        # Main synaptic ridge
        ridge_svg.append(
            '<path class="ridge-main" '
            f'style="--edge-index:{edge_index}" '
            f'd="{svg_path([ra, rb])}" />'
        )

        # Parallel echoes
        echo_count = local.choice([0, 1, 1, 2, 2, 3, 4])
        echo_side = local.choice([-1, 1])

        for k in range(1, echo_count + 1):
            offset = echo_side * k * RIDGE_ECHO_SPACING
            ea, eb = offset_segment(ra, rb, offset)

            inset = 7 + 3.0 * k + local.uniform(0, 8)
            shorter = trim_segment(ea, eb, inset, inset)
            if shorter is None:
                continue

            ridge_svg.append(
                '<path class="ridge-echo" '
                f'd="{svg_path(list(shorter))}" />'
            )

        # Axon
        pre_terminal = sub(
            contact,
            n,
            SYNAPTIC_GAP / 2 + BOUTON_SIZE * 0.55,
        )
        axon_start = soma_exit(pre_center, pre_terminal)
        axon_count = local.choice([1, 2, 2, 3, 3])

        for line_index, offset in enumerate(bundle_offsets(axon_count)):
            a1, a2 = offset_segment(axon_start, pre_terminal, offset)

            # pathLength belongs on the SVG element, not in CSS.
            axon_svg.append(
                '<path class="axon" '
                'pathLength="1" '
                f'style="--edge-index:{edge_index}; '
                f'--line-index:{line_index}" '
                f'd="{svg_path([a1, a2])}" />'
            )

        # Dendrite
        post_contact = add(contact, n, SYNAPTIC_GAP / 2 + 0.7)
        dendrite_start = soma_exit(post_center, post_contact)
        dendrite_count = local.choice([1, 1, 1, 2, 2])

        for offset in bundle_offsets(dendrite_count, 1.55):
            d1, d2 = offset_segment(dendrite_start, post_contact, offset)

            dendrite_svg.append(
                '<path class="dendrite" '
                f'd="{svg_path([d1, d2])}" />'
            )

        # Bouton
        tangent = ridge_dir
        bx, by = pre_terminal
        b1 = (
            bx - tangent[0] * BOUTON_SIZE / 2,
            by - tangent[1] * BOUTON_SIZE / 2,
        )
        b2 = (
            bx + tangent[0] * BOUTON_SIZE / 2,
            by + tangent[1] * BOUTON_SIZE / 2,
        )

        synapse_svg.append(
            '<path class="bouton" '
            f'd="{svg_path([b1, b2])}" />'
        )

    # Somas
    for index, center in enumerate(centers):
        soma_svg.append(
            '<path class="soma" '
            f'd="{svg_path(soma_polygon(center, index), True)}" />'
        )

    return ridge_svg, axon_svg, dendrite_svg, synapse_svg, soma_svg


# -----------------------------------------------------------------------------
# Quarto raw-HTML include
# -----------------------------------------------------------------------------

def build_html():
    ridges, axons, dendrites, synapses, somas = build_scene()

    return f"""
<div class="neural-field-shell" aria-hidden="true">
  <svg
    class="neural-field"
    viewBox="0 0 {WIDTH} {HEIGHT}"
    preserveAspectRatio="xMidYMid slice"
    focusable="false"
  >
    <defs>
      <linearGradient
        id="neural-left-fade"
        gradientUnits="userSpaceOnUse"
        x1="0"
        y1="0"
        x2="{WIDTH}"
        y2="0"
      >
        <stop offset="0%" stop-color="white" stop-opacity="0.28" />
        <stop offset="24%" stop-color="white" stop-opacity="0.52" />
        <stop offset="50%" stop-color="white" stop-opacity="1" />
        <stop offset="100%" stop-color="white" stop-opacity="1" />
      </linearGradient>

      <mask
        id="neural-mask"
        maskUnits="userSpaceOnUse"
        maskContentUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="{WIDTH}"
        height="{HEIGHT}"
      >
        <rect
          x="0"
          y="0"
          width="{WIDTH}"
          height="{HEIGHT}"
          fill="url(#neural-left-fade)"
        />
      </mask>
    </defs>

    <g class="neural-field-art" mask="url(#neural-mask)">
      <g class="synaptic-ridges">{''.join(ridges)}</g>
      <g class="dendrites">{''.join(dendrites)}</g>
      <g class="axons">{''.join(axons)}</g>
      <g class="synapses">{''.join(synapses)}</g>
      <g class="somas">{''.join(somas)}</g>
    </g>
  </svg>
</div>

<style>
/* --------------------------------------------------------------------------
   Quarto layout integration
   -------------------------------------------------------------------------- */

/*
  The include lives inside `.home-stage`.
  Giving the stage an explicit viewport-height prevents the absolute SVG layer
  from collapsing to zero height when `.home-copy` is positioned independently.
*/
.home-stage {{
  position: relative;
  min-height: 100svh;
  overflow: hidden;
  isolation: isolate;
}}

/*
  Text/content stays above the neural layer.
*/
.home-stage > .home-copy {{
  position: relative;
  z-index: 2;
}}

/*
  The generated neural artwork fills the hero only.
*/
.home-stage > .neural-field-shell {{
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}}

/*
  Quarto sometimes gives inner containers their own backgrounds.
  Keep the hero itself transparent so the artwork remains visible.
*/
.home-page .home-stage {{
  background: transparent;
}}

.neural-field {{
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}}

.neural-field-art {{
  opacity: 0.84;
}}

.ridge-main,
.ridge-echo,
.axon,
.dendrite,
.bouton {{
  fill: none;
  stroke: {INK};
  vector-effect: non-scaling-stroke;
  stroke-linecap: square;
  stroke-linejoin: miter;
}}

.ridge-main {{
  stroke-width: {RIDGE_WIDTH};
  opacity: 0.94;
}}

.ridge-echo {{
  stroke-width: {RIDGE_ECHO_WIDTH};
  opacity: 0.72;
}}

.axon {{
  stroke-width: {AXON_WIDTH};
  opacity: 0.82;

  stroke-dasharray: 1;
  stroke-dashoffset: 1;

  animation:
    neural-draw 1s cubic-bezier(.2, .65, .35, 1) forwards;

  animation-delay:
    calc(var(--edge-index) * 5ms + var(--line-index) * 5ms);
}}

.dendrite {{
  stroke-width: {DENDRITE_WIDTH};
  opacity: 0.62;
}}

.bouton {{
  stroke-width: 2.5;
  opacity: 0.96;
}}

.soma {{
  fill: {INK};
  stroke: none;
}}

@keyframes neural-draw {{
  from {{
    stroke-dashoffset: 1;
  }}
  to {{
    stroke-dashoffset: 0;
  }}
}}

@media (prefers-reduced-motion: reduce) {{
  .axon {{
    animation: none;
    stroke-dashoffset: 0;
  }}
}}

/*
  Fallback for browsers without svh support.
*/
@supports not (height: 100svh) {{
  .home-stage {{
    min-height: 100vh;
  }}
}}
</style>
""".strip()


def build_quarto_fragment():
    html = build_html()
    return "```{=html}\n" + html + "\n```\n"


def main():
    fragment = build_quarto_fragment()
    QMD_OUT.write_text(fragment, encoding="utf-8")

    print(f"Created: {QMD_OUT}")
    print(f"Size: {QMD_OUT.stat().st_size / 1024:.1f} KB")
    print("Include it with: {{< include _neural-field.qmd >}}")


if __name__ == "__main__":
    main()
