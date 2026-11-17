# game/assets/world/ — texture manifest

There are intentionally NO binary image files in this directory.

All world textures are **procedural canvas textures**, generated at runtime
by `game/src/world/textures.js` from `<canvas>` 2D drawing. They exist only
in GPU memory; nothing is fetched, nothing is stored on disk. This keeps
the game at zero external network requests (P0) and keeps the kit small.

Generated textures (see `textures.js` for the generators):

| Texture | Used on |
|---|---|
| `facadeTexture` | stucco / concrete building facades |
| `glassTexture` | downtown + waterfront tower skins |
| `asphaltTexture` | roads (baked edge lines + dashed centre line) |
| `sidewalkTexture` | sidewalk strips, park paths |
| `sandTexture` | beach |
| `boardwalkTexture` | boardwalk |
| `brickTexture` | warehouses |
| `containerTexture` | shipping containers, cargo ship deck |
| `awningTexture` | shop awnings |
| `neonSignTexture` | shop / club / gas / pier / bus signs (original copy) |
| `billboardTexture` | roadside billboards (original copy) |
| `zebraTexture` | intersection crosswalks + stop lines |
| `lighthouseTexture` | lighthouse bands |

If a future specialist wants a baked image asset instead, add the file
here and load it with a local relative URL only — never a remote URL.
