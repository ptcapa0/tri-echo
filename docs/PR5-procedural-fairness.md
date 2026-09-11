# PR5 — Procedural Fairness & Solvability

## Baseline

The 4.6.1 generator guaranteed static placement but had no explicit initial
opportunity contract. On a deterministic 1,000-table corpus (seed 1337), no
static layouts were invalid, while the direct-route analyzer found 65–80% of
candidates lacked a minimum portal route depending on difficulty.

## Contract

PR5 guarantees a bounded, deterministic initial feasibility approximation for
procedural three-ball Echo tables: finite/static-valid placement, a minimum
set of cue exits, an accessible object, and a clear object-to-target corridor
with physical cue reach. It measures a solution margin and difficulty score.
It does not prove a complete multi-shot solution, spin outcome, bank, or
optimal play.

## Architecture

`generateCandidate(seed, attempt)` preserves the former generator at attempt
zero. `analyzeTableFairness` is pure and deterministic. `generateFairTable`
tries eight derived candidate seeds, returns the first accepted candidate, or
the best physically feasible candidate; a final deterministic open fallback
is static-valid and aligned to the portal. Existing Echo Rails are supplied to
the candidate before analysis, without changing their creation or lifetime.

## Measurements and bands

The analyzer samples 24 fixed angles, requires six clear cue exits, reuses
PR4.1 table-aware reach, and reports open directions, direct objects, target
routes, reach ratio, margin, score, and reason codes. Bands are deliberately
broad after baseline measurement: Relaxed protects margin; Hard uses the same
feasibility floor but permits a smaller margin. The validator reports attempt
and fallback distributions instead of hiding them.

## Determinism and scope

Candidate seeds derive from base seed and attempt only; fairness never uses
clock, device state, network, or `Math.random`. Daily remains canonical at
720×1120. Traditional racks, authored Trick Shot layouts, rules, saves,
physics, pockets, aim, controls, and Echo Rail mechanics are unchanged.

## Final audit hardening

Rail clearance uses true segment-to-segment geometry, so interior crossings and
collinear overlap have zero distance. The final fallback evaluates six bounded
deterministic layouts against inherited Rails and returns only a physically
feasible table; exhaustion is an explicit invariant failure. Validation checks
cue first contact through Production Physics and independently checks the
object-to-portal corridor against balls, bumpers, and Rails. Fusion explicitly
defers PR5 portal fairness because its first phase is carom while the portal is
disabled. Hard degraded-difficulty fallbacks remain a reported tuning risk.
