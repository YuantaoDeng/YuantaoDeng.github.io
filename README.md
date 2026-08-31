# Yuantao Deng — personal website

This is a static [Quarto](https://quarto.org/) website designed for GitHub
Pages. The homepage animation is implemented in plain JavaScript and does not
need a server or a JavaScript build step.

## Preview locally

```powershell
quarto preview
```

## Build

```powershell
quarto render
```

The publish-ready site is generated in `docs/`. The old `_site/` directory is
not used by this project.

## Publish with GitHub Pages

1. Create a repository named `YuantaoDeng.github.io` (replace `YuantaoDeng`
   if your GitHub username is different).
2. Commit the source files and the generated `docs/` directory to `main`.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, then select
   **main** and **/docs**.
5. The site will be available at `https://YuantaoDeng.github.io/` after GitHub
   finishes publishing.

Edit homepage copy in `index.qmd`, global styles in `styles.css`, and the
network animation in `assets/neural-field.js`.
