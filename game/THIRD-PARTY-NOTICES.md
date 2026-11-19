# Third-Party Notices — SUNCOAST: HEATLINE

This game bundles exactly one third-party library. Everything else — code,
art, audio, names, story — is original work by the entry's author.

## Three.js 0.187.0

- What: the 3D engine, vendored as minified `*.min.js` builds from the
  official `three@0.187.0` release: `game/vendor/three.module.min.js` (the
  entry point, which re-exports the whole API) and
  `game/vendor/three.core.min.js` (the implementation it imports with
  `./three.core.min.js`; minified with esbuild from the release build). Both files are required; deleting either one breaks the
  game. The GLTF loader is likewise vendored minified:
  `game/vendor/GLTFLoader.min.js` + `game/vendor/utils/
  {BufferGeometryUtils, SkeletonUtils}.min.js` (esbuild-minified from the
  release's `examples/jsm/` files).
- License: MIT License. Full text in `game/vendor/LICENSE-threejs.txt`.
- Copyright: (c) 2010-2025 three.js authors.
- Source: https://github.com/mrdoob/three.js (release 0.187.0).
- Use: loaded locally through the import map in `game/index.html`
  (`"three": "./vendor/three.module.min.js"`). No CDN, no network request.

## This game's own work

- License: MIT (see `LICENSE` at the repository root).
- All city geometry, characters, vehicles, missions, story text, HUD design
  and WebAudio sound synthesis in `game/src/` and `game/index.html` are
  original and written for this entry.
