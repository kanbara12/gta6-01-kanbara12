# QA screenshots — independent re-QA, 18 Nov 2026

All 15 frames below are re-encodes (JPEG, quality 80) of the original PNG
screenshots taken during the independent re-QA session documented in
`~/workspace/gta6-qa/REQA-REPORT.md` (verdict: **PASS**, 9/9 defects fixed,
14/14 regression areas pass, 2 new minor observations). They are supporting
evidence only — they are NOT part of the submitted `screenshots/` folder.
The 4 submitted screenshots are the re-QA best frames
(`reqa-01-downtown`, `reqa-05-traffic`, `reqa-03-chase`, `reqa-08-mission`).

| File | Scene | What it proves |
|---|---|---|
| `reqa-02-beach.jpg` | Beach / boardwalk, sea, pier, umbrellas, palms | Beach palms stand on sand/boardwalk, not asphalt (D-QA9 side note). |
| `reqa-04-character.jpg` | Player third-person on the street, taxi, brick buildings | Character on foot; weak framing, not a submit candidate. |
| `reqa-06-police-chase.jpg` | Player on foot, police car approaching, wanted ★★★☆☆ | Wanted stars readable (D-QA8); chase feel weak, not a submit candidate. |
| `reqa-07-combat.jpg` | Player aiming a pistol, hostile crew, police, fleeing pedestrian | Combat + NPC reactions (R6/R8); enemy reads less clearly as a target. |
| `reqa-09-palm-low.jpg` | Palm from a low angle, beach | D-QA5 fixed: crown reads as a volumetric blob from low angles, no flat disc. |
| `reqa-10-palm-close.jpg` | Palm close-up | **N-QA1 (new, minor):** fronds read as spikes up close (<6u) — "spiky ball". |
| `reqa-11-tree-clip.jpg` | Tree area (-117,-117) | Poor framing; does NOT clearly prove crown/wall clipping (D-QA9 note). |
| `reqa-12-intersection.jpg` | Chase view of the (0,0) intersection, clean road | **D-QA9 fixed:** brown box gone, road clear, marker ring visible. |
| `reqa-13-marker.jpg` | Mission marker close-up: diamond + ring + beam | **D-QA7 fixed:** octahedron core, cylinder beam, torus halo. |
| `reqa-14-night-facade.jpg` | Night, camera against a wall | Weak framing; weak D-QA4 evidence (use `reqa-night.jpg` instead). |
| `reqa-crash-building.jpg` | Car crash into a building, toast `CRASH • VEHICLE 82%` | **R5 fixed:** health 100 → 81.6, bounce −3.68 on building impact. |
| `reqa-golden.jpg` | Golden-hour `?shot=start`: sunset, readable facades | D-QA4 comparison frame (mean luminance 79.6 vs night 16.0). |
| `reqa-mission-stage3.jpg` | HUD `MISSION 4/6`, cash $3,750 | **D-QA1 fixed:** +$2,500 exactly, jobs 0 → 1; also shows **N-QA2** (camera blocked by a barrier after safehouse teleport staging). |
| `reqa-night.jpg` | Night `?shot=start`: tower + lit window grid | **D-QA4 fixed:** night facades now readable (mean luminance 16.0, up from 12.3). |
| `reqa-ram-traffic.jpg` | Traffic crash: teal sedan stopped behind a red car, toast `CRASH • VEHICLE 92%` | **D-QA2 fixed:** min distance 4.53u (> car length 4.25u), no clipping through traffic. |
