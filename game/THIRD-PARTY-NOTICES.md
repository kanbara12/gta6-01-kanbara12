# Third-Party Notices — SUNCOAST: HEATLINE

This game bundles exactly one third-party library. Everything else — code,
art, audio, names, story — is original work by the entry's author.

## Three.js 0.187.0

- What: the 3D engine, vendored as `game/vendor/three.module.min.js`
  (the official minified build of `three@0.187.0`).
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
