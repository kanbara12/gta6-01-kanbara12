# INTEGRATION — Combat (drop-in untuk seksi combat main.js)

Koordinator: ganti seksi combat di `game/src/core/main.js` dengan potongan
EXACT di bawah. `WEAPONS` dan bentuk `G.weapon` tidak berubah, jadi save,
HUD, dan `selectWeapon`/`Digit1`/`Digit2`/`KeyR` tetap bekerja.

## Langkah 1 — import (di blok import main.js)

Tambah satu baris import:

```js
import { WEAPONS, fire, reloadWeapon, updateBullets } from '../combat/combat.js';
```

## Langkah 2 — hapus definisi WEAPONS lokal

Hapus blok ini dari main.js:

```js
const WEAPONS = {
  pistol: { id: 'pistol', name: 'Pistol', magSize: 12, fireRate: 0.28, damage: 1, bulletSpeed: 48 },
  smg: { id: 'smg', name: 'SMG', magSize: 30, fireRate: 0.09, damage: 1, bulletSpeed: 60 },
};
```

`WEAPONS` impor dari combat.js nilainya identik (pistol 12/0.28/1/48,
SMG 30/0.09/1/60).

## Langkah 3 — tambah 2 hook field pada G (tepat setelah literal G)

Setelah literal `const G = { ... };` (setelah `selectWeapon` di dalamnya),
tambah:

```js
G.triggerWanted = (n) => triggerWanted(n);
G.updateHud = () => updateHud(G);
```

Alasan: `triggerWanted` dan `updateHud` adalah closure/function di main.js
yang tidak ada di G; combat.js memanggilnya lewat `G.triggerWanted` /
`G.updateHud` bila ada (fallback: tidak ada wanted/HUD bila hook absen —
modul tidak pernah crash, tapi tanpa hook ini tembakan tidak menaikkan
wanted). `triggerWanted` adalah function declaration (hoisted), jadi
assignment ini valid meski definisinya muncul di bawah. `updateHud`
sudah di-import di main.js.

Juga inisialisasi state milik combat (boleh di literal G, atau biarkan
modul mengisinya lazy saat pertama dipakai — keduanya aman):

```js
  reloading: false,
  reloadTimer: 0,
  recoil: 0,
```

(`G._bloom` diisi lazy oleh modul.)

## Langkah 4 — ganti SEKSI COMBAT seutuhnya

Hapus dari main.js ketiga fungsi ini secara utuh:
`reloadWeapon()`, `fire()`, `updateBullets(dt)` — termasuk `const _tmpV`
di atas `fire()` bila hanya dipakai seksi itu — dan ganti dengan wrapper
tipis ini (satu-satunya kode combat yang tersisa di main.js):

```js
// ---------------------------------------------------------------- combat
// Shooting lives in src/combat/combat.js; these wrappers keep the existing
// call sites (onKey KeyR, input onFire, animate loop) unchanged.
function reloadWeapon() { reloadWeaponModule(G); }
function fire() { fireModule(G); }
function updateBullets(dt) { updateBulletsModule(G, dt); }
```

PERHATIAN NAMA: wrapper di atas bertabrakan nama dengan impor bila impor
bernama sama. Gunakan alias impor agar tidak bentrok — ganti Langkah 1
dengan:

```js
import {
  WEAPONS,
  fire as fireModule,
  reloadWeapon as reloadWeaponModule,
  updateBullets as updateBulletsModule,
} from '../combat/combat.js';
```

dan wrapper di atas persis seperti tertulis. Call site tidak berubah:
`onKey` memanggil `reloadWeapon()`, `onFire: () => fire()`, loop memanggil
`updateBullets(dt)`.

## Perilaku baru (semua di dalam combat.js, terverifikasi harness)

- Swept-segment hit detection: peluru diuji sebagai segmen prev→new
  terhadap sphere musuh radius 1.1 — tidak ada lagi tunneling SMG 60 u/s.
- Peluru mati saat memasuki footprint gedung (`collidesBuilding`, margin
  0.2) — tidak menembus tembok.
- Spread + bloom: pistol cone 0.015 rad, SMG 0.03 rad, bloom +0.006/+0.009
  per tembakan (maks 0.06), decay 0.05/dtk; `G.recoil` naik per tembakan
  dan decay eksponensial — dibaca HUD/kamera bila perlu, tidak menggerakkan
  kamera sendiri.
- Reload berwaktu: pistol 0.9 dtk, SMG 1.4 dtk; `fire()` diblokir selama
  `G.reloading`; selesai di dalam `updateBullets` (sudah dipanggil tiap
  frame). Aturan reserve identik (pistol ∞, SMG 120). Mag kosong → R /
  tembak memicu reload otomatis seperti sebelumnya.
- Kill tetap: `G.kills += 1`, `+$150`, toast `TARGET DOWN • +$150`, chime.
  Hit hidup menandai `e.userData.stagger = 0.3` — CATATAN JUJUR:
  `characters.js` saat ini mengabaikan field itu; stagger visual baru
  aktif bila specialist characters menambah pembacanya. Bukan perubahan
  perilaku diam-diam.

## Yang TIDAK boleh dilakukan koordinator

- Jangan ubah nilai `WEAPONS`, `RELOAD_TIME`, atau `ENEMY_HIT_RADIUS`
  tanpa QA ulang harness.
- Jangan panggil `fire(G)` dari luar loop/input (mis. auto-fire) — modul
  tidak punya guard di luar `gameStarted`/`gameOver`/fire-rate.
- Jangan salin apa pun dari entry referensi #1: semua teks/toast di sini
  adalah teks asli repo yang sudah ada.
