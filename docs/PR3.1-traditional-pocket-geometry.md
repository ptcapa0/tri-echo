# PR3.1 — Traditional Pocket Geometry

## Preflight and scope

Baseline: main `292990f925f52acec5e4307761798d2a252b0fb3`, package and production
4.4.0, SW `tri-echo-v4.4.0`. Latest merged PR: #13. Main Pages run 34030266676
succeeded. Only open PR was unrelated draft #1; no equivalent branch/PR existed.
Clean checkout. Before branching: 87/87 unit tests, collision seed 1337 / 10,000
cases, physics report, build, and the complete Playwright suite passed. Screenshot
inspection confirmed continuous cushions behind the old circular pockets.

This release changes how physical pockets capture balls. Rules, shot calibration,
Floating Pull, pointer ownership, lifecycle gates, Daily identity and arcade
mechanics remain in their existing modules. PR4 is not part of this work.

## Model mapping (audited against Game.newHole)

| Runtime mode | Pocket model | Profile |
| --- | --- | --- |
| American Pool, American training/tricks | physical | american |
| British Snooker, Snooker training/tricks | physical | snooker |
| Classic on Snooker, classic training, three-ball tricks | physical | classic |
| Classic on Echo | none | — |
| Golf/Tour/Fusion on Snooker (arcade) | magnetic | existing circles |
| Echo portal, including Daily and disabled Fusion phase | separate portal | unchanged |

Trick mode forces a Snooker table but does not set `traditional`. Its pocket model
is therefore passed explicitly, without changing its surface, power, obstacles,
Echo Rails or rules. All generated tables declare a pocket model. Legacy ad-hoc
physics fixtures without a model retain their prior magnetic behavior.

## Geometry contract

`js/pocket-geometry.js` owns the six mouths, rounded segment endpoints, jaws,
throats, shelves, capture boundaries and cushion segments. Canvas draws those
same segments and pocket polygons. Physics uses the existing segment collision
solver, the 1/180 external step and at most 16 adaptive internal steps.

Dimensions are intentional game-design ratios, not claims of tournament equipment
certification. D is ball diameter:

| Profile | Corner mouth / D | Side mouth / D | Throat / D |
| --- | --- | --- | --- |
| American | 2.20 | 2.40 | 1.40 |
| Snooker | 2.00 | 2.15 | 1.25 |
| Classic | 2.10 | 2.30 | 1.35 |

The segment radius is 0.06 D, giving a visible, rounded cushion/jaw nose. Throats
leave one ball plus explicit clearance, with American more permissive. Side
capture is 0.85 D outside the cushion line. Corner capture is half the mouth
width plus 0.60 D beyond its diagonal mouth, ensuring it lies beyond the original
playfield corner. The last 0.25 D before capture is a parallel throat; a closed
backstop one diameter beyond capture bounds malformed/unqualified shelf states.
All segment broad-phase boxes are derived from the same endpoints and radius.

A pot requires integrated motion through a mouth, followed by arrival beyond the
capture boundary inside the throat. Correction alone cannot authorize entry.
Physical pockets exert zero magnetic force, even with Gravity. The separate
portal remains magnetic. Phase does not bypass jaws. Cushion contact episodes
share an ID along each jaw/throat, so internal iterations do not multiply events;
opposite jaws can still produce distinct contacts and natural rattles.

Shelf entry lives on the ball (`pocketEntry`) so a ball resting on a shelf remains
eligible when struck after a reset or snapshot restore. Capture, escape and
respot/respawn clear it. This is transient table state, not a persisted-save schema
change. Initial placements and respots use the geometry exclusion test. A failed
respawn searches deterministic legal spots instead of unconditionally placing a
ball on the old occupied fallback.

## Test-first discoveries

- Nine tests first failed on 4.4.0: a ball fully on the cloth next to a side pocket
  was captured, and attraction remained active with or without Gravity.
- Shelf carry-over test failed before storing entry on the ball: after a stopped
  shot and `new Physics(structuredClone(table))`, the ball could no longer pot.
- Initial-placement regression first failed at seed 78 (also 79, 104, 160, 214):
  classic hard/720×620 could start a ball in a new corner opening.
- The existing empty-table collision/calibration fixtures now explicitly select
  `pocketModel: none` when stripping pockets. Their original closed-cushion
  characterization is preserved; physical racks are exercised in the new report.

## Characterization: before versus after

Old side-pocket attraction measured at center `(bounds.l + ball.r, midY)`:
American −702.38, Snooker −709.80, Classic −673.75 units/s². All three balls were
captured while still entirely on the playfield. New: zero attraction and zero
captures at those identical positions.

Central accepted lateral window, in D, with normal incidence, starting two D
before the new mouth, sampled at 0.01 D. Same bounds and native ball radii
(15/13/18), zero spin. Stop at pot, rest, 900 steps, or return three D behind the
mouth. “Before” used the baseline Physics and sixPockets from the SHA above;
“after” is reproduced by `npm run physics:pockets`.

| Profile / type | Before at 110 / 600 / 2400 | After at 110 / 600 / 2400 |
| --- | --- | --- |
| American corner | 2.16 / 0.50 / 0.50 | 1.12 / 1.12 / 1.12 |
| American side | 2.70 / 1.38 / 1.40 | 0.44 / 0.46 / 0.44 |
| Snooker corner | 2.14 / 0.62 / 0.58 | 0.52 / 0.52 / 0.54 |
| Snooker side | 2.62 / 1.52 / 1.52 | 0.26 / 0.26 / 0.26 |
| Classic corner | 1.86 / 0.16 / 0.16 | 0.84 / 1.00 / 1.00 |
| Classic side | 2.48 / 1.02 / 1.04 | 0.38 / 0.40 / 0.40 |

The old slow windows were inflated by attraction. New side pockets are more
selective; this is a profile/geometry change, not a power retune. Snooker stays
more demanding than American. Rattle outcomes can create disconnected accepted
regions, which are deliberately excluded from the central-window measurement.

Calibration remains unchanged: 2066.30 mobile Echo, 1625.38 Daily, 1068.23 desktop
Echo and 1338.34 Snooker maximum speed in the existing report. No power curve,
fullPull, deadZone or SHOT_ENVELOPE changes.

## Stress and performance

`npm run physics:pockets -- --seed 1337 --cases 10000` varies all six pockets,
three profiles, radii 13/15/18, offset ±1.1 D, angle ±0.45 rad, speed 100–2400,
and side spin −1…1. It reports pots, rejects, rattles and escapes (overlapping
categories), invalid captures and silent crossings. The oracle observes every
production microstep, independently checks finite-solid center crossings and
residual overlap, and verifies that capture follows entry outside the playfield.

Measured: 10,000 cases, zero failures/invalid captures/silent crossings, maximum
11 microsteps, energy ratio ≤0.999651, maximum residual overlap 2.71e−13 units.
Single-ball overlap above 0.05 D fails the stress gate. Existing collision stress:
10,000 cases, zero NaN/Infinity/energy violations, maximum 13 microsteps.

Physical production racks, seed 1337:

| Balls | Steps | Narrow-phase checks | Max microsteps | Local p95 step |
| --- | --- | --- | --- | --- |
| 16 | 1431 | 352,928 | 6 | ~0.24 ms |
| 22 | 1537 | 810,126 | 6 | ~0.33 ms |

Before static broad-phase rejection, those same physical racks needed 2,046,936
and 3,587,661 checks. Their trajectories and number of steps were unchanged by
that optimization. Legacy production racks measured ~0.17/0.35 ms p95 on this
host. Timings are noisy local CPU observations, not Android hardware benchmarks.
The original closed-table rack tests remain 1426/1515 steps and 349800/788172
checks, matching the preflight.

## Release validation

Release target: 4.5.0; cache `tri-echo-v4.5.0`, including the new geometry module.
CI runs unit/build tests, both 10,000-case stress gates, build, then Playwright;
deployment still depends on validation. Tests verify deletion of older TRI//ECHO
caches while preserving unrelated origin caches. `dist/` stays untracked.

The unit suite contains 157 tests, including 70 pocket tests. Playwright covers
390×844, 412×915, 430×932 and 1024×800, physical-mode screenshots, all 18
profile/pocket combinations in built browser modules, lifecycle/pointer checks
and offline reload. Merge/deploy/production evidence is recorded in the PR and
completion report after validation.

## Review and remaining limits

Scope-related fixes: shelf persistence and safe initial/respawn placement.
Rejected: global power increase, rules redesign, replacing arcade magnets,
a separate pocket solver, random rattle scripts, and new save schema.

This is planar arcade physics: no vertical fall or airborne-ball model. Shelf
balls can legitimately stop and remain playable. Stress explores the declared
runtime envelope, not arbitrary velocities or arbitrary initial interpenetration.
Phone-size Chromium tests do not substitute for physical Android device testing.
No PR4 work was started. Next: PR4 — Aim & Touch UX, in a separate session.
