# Font Finder

Search local macOS fonts in Raycast, preview them via Quick Look thumbnails, and copy font names instantly.

## Features

- Fast local font search (Family → Styles).
- Hidden (dot-prefixed) system fonts are hidden by default (toggle from the Actions menu).
- Copy family names with Enter (primary action).
- Copy additional variants (Display Name, PostScript Name, CSS `font-family` snippet).
- Preview selected fonts with a generated Quick Look thumbnail in the Detail panel.
- Toggle Quick Look (`Cmd` + `Y`) as a reliable fallback preview.
- Cache-first font index for fast startup, with background refresh.

## How It Works

### Indexing (Local + Cached)

The extension scans the standard macOS font directories:

- `/System/Library/Fonts`
- `/System/Library/AssetsV2/com_apple_MobileAsset_Font*` (MobileAsset system fonts)
- `/Library/Fonts`
- `~/Library/Fonts`

It reads font metadata using `fontkit` and stores a cached index at:

- `environment.supportPath/font-index.v2.json`

### Preview (Quick Look Thumbnail + Cache)

The Detail panel preview uses:

- `/usr/bin/qlmanage -t` to generate a PNG thumbnail
- Cached under `environment.supportPath/previews/`

For font collections (`.ttc`), the extension generates a small vector preview (SVG) using `fontkit` to avoid thumbnail collisions across faces.

If thumbnail generation fails, you can still use Quick Look (`Cmd` + `Y`) from the action panel.

## Privacy

- No network requests.
- The extension only reads font files from standard macOS font directories.
- All indexes and previews are stored locally on your machine.

## Limitations

- Preview text is controlled by the system Quick Look generator and cannot be customized in this MVP.
- Font collections (`.ttc`) use a generated vector preview (SVG), which may differ from Font Book previews.

## Development

```bash
npm install
npm run dev
```

Other useful commands:

```bash
npm run build
npm run lint
npm run fix-lint
```

## Directory Structure

```txt
font-finder/
  assets/
    icon.png
  docs/
    plan/
      0001-font-finder-mvp.md
  metadata/
    .gitkeep
  src/
    lib/
      font-index.ts
      font-paths.ts
      font-preview.ts
      fs-walk.ts
      hash.ts
      strings.ts
    search-fonts.tsx
    types/
      fontkit.d.ts
  .gitignore
  CHANGELOG.md
  LICENSE
  README.md
  eslint.config.js
  package.json
  raycast-env.d.ts
  tsconfig.json
```
