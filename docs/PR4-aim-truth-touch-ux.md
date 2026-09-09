# PR4 — Aim Truth & Touch UX

The guide is now a pure, first-contact preview. It ends at the nearest ball, rectangular cushion, physical cushion/jaw/throat, bumper, Echo Rail, or its power-limited travel horizon. It deliberately makes no post-impact or spin-path promise.

Physical-pocket tables read `pocketGeometry.segments` directly, so an open mouth is not represented as a closed rectangular rail. A ball first contact shows a translucent cue-ball ghost at the geometric contact center.

Aim assistance changes only the revealed reach: Relaxed is longest, Normal is intermediate, Hard is short, and Trace extends assistance without extending physical reach. Physics calibration, collision response, drag, resistance, pocket geometry, spin, and save schema are unchanged.

`npm run aim:validate -- --seed 1337 --cases 5000` is deterministic and runs in CI. Touch gestures are scoped to the gameplay surfaces; dialogs and panels retain vertical scrolling, while viewport zoom is no longer blocked.
