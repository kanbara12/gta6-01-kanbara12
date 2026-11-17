# INTEGRATION — AI (police + pedestrians) + missions

Koordinator: file ini + `game/src/combat/INTEGRATION.md` adalah satu-satunya
wiring yang dibutuhkan. Jangan ubah logika di dalam modul AI — swap import
saja, sesuai potongan exact di bawah. Semua nama/file di sini asli dari repo
(cek `main.js` HEAD cc17450); tidak ada yang difabrikasi.

## 1. Police — swap satu import di `game/src/core/main.js`

Lama (vehicles.js):

```js
import {
  makeCar, animateCar, spawnTraffic, updateTraffic, updatePolice, spawnPoliceCar,
} from '../vehicles/vehicles.js';
```

Baru — `updatePolice` + `spawnPoliceCar` pindah ke AI, sisanya tetap di
vehicles.js:

```js
import {
  makeCar, animateCar, spawnTraffic, updateTraffic,
} from '../vehicles/vehicles.js';
import {
  updatePolice, spawnPoliceCar,
} from '../AI/police.js';
```

Tidak ada perubahan lain: `updatePoliceSpawns(dt)` di main.js memanggil
`updatePolice(G.police, buildings, p, G.wanted, dt, cb)` dan
`spawnPoliceCar(scene, p, Math.random, buildings)` dengan signature yang
sama persis. `vehicles.js` TIDAK dihapus/diubah — fungsi polisinya di sana
tetap ada sebagai cadangan, tapi main.js tidak lagi memakainya.

Opsional (boleh, bukan wajib) — readout state untuk HUD, di
`updatePoliceSpawns` setelah `updatePolice(...)`:

```js
import { allPoliceLost, policePursuitState } from '../AI/police.js';
// contoh: const searching = G.police.length > 0 && G.police.every((c) => policePursuitState(c) === 'search');
// contoh: if (allPoliceLost(G.police)) showToast('YOU LOST THEM • KEEP HIDING');
```

JANGAN ganti logika heat-decay / despawn di `updatePoliceSpawns` — modul AI
hanya mengatur perilaku mobil saat heat menyala; main.js tetap otoritas
penurunan wanted.

Perilaku baru yang dijamin modul ini (terverifikasi harness, lihat laporan):
- PURSUE saat line-of-sight jelas; SEARCH saat hilang > loseAfter detik
  (6 dtk wanted 1–2, 9 dtk wanted 3, 11 dtk wanted 4, 14 dtk wanted 5):
  mobil menuju titik terakhir terlihat, lalu menyapu persimpangan tetangga
  satu leg axis-aligned per satu waktu — tidak pernah memotong blok.
- Top speed pursuit tetap `12 + wanted * 1.5`; SEARCH yang sudah dingin
  (> searchSeconds tanpa sight) melambat ke 6 agar pemain bisa lolos.
- D1 dipertahankan verbatim: unstick reverse-out 1.4 dtk, routing
  axis-aligned via `nearestRoadCoord`, margin-escape (ring 1.6 boleh
  dilewati saat keluar, core gedung tidak boleh dimasuki).

## 2. Pedestrians — swap satu import di `game/src/core/main.js`

Lama:

```js
import {
  createCharacter, animateWalk, animateIdle,
  spawnPedestrians, updatePedestrians, spawnEnemies, updateEnemies,
} from '../characters/characters.js';
```

Baru — hanya `updatePedestrians` pindah; spawn + karakter tetap di
characters.js:

```js
import {
  createCharacter, animateWalk, animateIdle,
  spawnPedestrians, spawnEnemies, updateEnemies,
} from '../characters/characters.js';
import { updatePedestrians } from '../AI/pedestrians.js';
```

Lalu di loop `animate()`, ganti SATU baris:

Lama:

```js
    updatePedestrians(G.peds, buildings, dt, G.gunfireEvent);
```

Baru:

```js
    updatePedestrians(G.peds, buildings, dt, G.gunfireEvent, {
      playerCar: G.currentCar,
      onWitness: () => triggerWanted(1),
    });
```

Catatan wiring:
- `G.currentCar` boleh null — modul mengeceknya; saat jalan kaki tidak ada
  near-miss panic. `playerCar.speed` dibaca dari `car.userData.speed`
  (fallback `car.speed`).
- `onWitness` dipanggil max 1x per ped per 12 dtk, hanya bila ped berada
  < 30 unit dari tembakan. `triggerWanted` adalah function declaration di
  main.js (hoisted), jadi bisa dipakai di loop.
- Tanpa argumen ke-5, perilaku = characters.js lama persis (stroll, flee
  3 dtk arah tetap, D2 90° saat terjepit, margin-escape 0.6).
- State baru: `cower` (tembakan < 9 unit: diam 1.5 dtk lalu lari),
  `panic` (mobil cepat < 7 unit: lari 6.0 u/s menjauhi mobil). State
  dibaca via `pedestrianState(ped)` bila HUD memerlukannya.

## 3. Missions — tidak ada wiring

`game/src/missions/missions.js` diedit in-place; semua export lama
(`GANG_ZONE`, `MISSION_POINTS`, `createMissionMarker`, `animateMarker`,
`updateMissions`, `placeMarker`) + nilai (titik, judul, objektif, reward,
radius, transisi, loop-reset, garage grace 45 dtk) dipertahankan.
`updateMissions(G, dt)` tetap dipanggil dari loop seperti sebelumnya.
Yang baru dan otomatis aktif:
- `onStageStart` — toast line fixer ("Rae", dialog orisinal) saat stage
  berganti; `getMissionBrief(stage)` / `getMissionProgress(G)` untuk HUD
  (stage x/6, jarak meter ke marker, kills tersisa).
- Stage 3: 3 crew tambahan masuk saat pertama kali stage dimulai
  (`G._stage3Reinforced`, reset saat loop selesai). Syarat 3 kill tetap.
- Side activities: 3 stash street-cash $250 (respawn 60 dtk), jalan
  otomatis lewat `updateMissions` — session-only, TIDAK masuk save.js
  (save.js tidak disentuh; `missionIndex` tetap satu-satunya progres
  misi yang persisten).
- `G.jobsCompleted` dihitung in-memory (bukan save field).

## 4. Yang TIDAK boleh dilakukan koordinator

- Jangan edit `vehicles.js` (cadangan fungsi polisi), `characters.js`,
  `world.js`, `core/*`, `save.js`, `UI/*`, `audio/*`.
- Jangan ubah nilai `WANTED_CONFIG`, `REWARDS`, radius stage, atau
  `PED_COWER_RADIUS` tanpa QA ulang harness di `/tmp/gta6-ai-harness/`.
- Jangan salin apa pun dari entry referensi #1 (nama, dialog, teks HUD,
  layout): fixer di sini bernama "Rae" (orisinal), semua teks ditulis baru.
