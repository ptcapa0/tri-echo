# TRI//ECHO — PR10: Storage Failure Resilience

Closed contract, 2026-10-09. Authorized by PT: execute specification, reproduce baseline, implement/validate and deliver draft PR. No merge/publication. Base main 11319baa848625b8a2feb52d1f356b5497c4c089, published 4.7.2; target 4.7.3.

## Scope and invariants
Preserve PR7.1/PR8/PR9 and all characterized gameplay. Only storage boundaries, minimal non-persistence feedback and tests/docs/version metadata change. No physics, rules, scores, generator, aiming, powers, Rails, service-worker/build strategy, new dependencies, storage schema/migration, lifecycle recovery or durable active-round persistence.
Allowed implementation files: js/storage.js, js/app.js, style.css (only storage notice rules), package.json/package-lock.json; tests/storage*.test.js, tests/storage-resilience.py, tests/playtest.py (only invoking the new suite), docs/PR10-storage-resilience.md. Evidence and specification live outside the repository in audit/.

## Required behavior
1. Retain the exact triEchoSaveV1 key and PR8 schema, validation limits, inert rendering and import cancellation rules. Preserve existing loadSave/save APIs for strict callers; gameplay uses a session storage adapter.
2. Read/getter/getItem failures start safe defaults in explicit temporary mode. Missing data is a normal fresh session. Malformed/oversized/schema-invalid stored data starts safe defaults, records corruption and never automatically overwrites/deletes the original bytes.
3. Ordinary writes (start, shots, resolution, end, tutorial, settings and control position) serialize current progress and keep a session memory snapshot. Getter/setItem denial/quota failures cannot interrupt gameplay or cleanup. The adapter catches storage I/O failures, not unrelated gameplay exceptions. Storage exceptions never escape these paths.
4. Temporary progress/preferences remain available throughout the page session and in Export. Show a persistent, non-blocking notice during play and in menu/settings/progress: changes are temporary and may be lost when closing; Export remains usable. Successful subsequent writes may return to persistent mode with truthful feedback.
5. Offer an explicit retry of the current session snapshot in Settings for transient unavailable/full storage. Write only the real save key; no probe keys, removeItem, clear or cache operations. A failed retry retains temporary mode and snapshot. Recovery success persists latest session state.
6. Corrupt stored bytes are protected throughout ordinary writes and retry, even if storage works. Explain preservation and recommend Export. Only a valid explicitly selected PR8 import successfully written to storage may replace them. No automatic repair/migration or silent destructive reset.
7. Import remains STRICT and transactional: validate candidate, attempt durable setItem, then replace live data/preferences. On getter/setter/quota failure preserve live progress, active Game, preferences and durable original. Never report successful import or adopt candidate in temporary mode. Existing cancellation/race/size/XSS contracts remain unchanged. A successful import clears temporary/corrupt status. Export always reflects live session data, not a stale durable save.
8. No multi-tab reconciliation or persistence guarantees after browser eviction/restart. A failing native setItem is treated as atomic according to Web Storage; hostile stores that mutate then throw are outside the contract.

## Acceptance matrix
A01: exact base and isolated checkout verified; existing principal README preserved; no equivalent PR10 open. Production base failure reproduced with denied setter/quota; retain JSON/screenshots separately.
A02: Node getter/getItem denial/missing valid data: defaults or normalized save, truthful persistent/temporary state, no write on load.
A03: browser getter denied and getItem denied from boot: menu/play/settings/progress/export usable; real shot resolves without page errors.
A04: setter SecurityError and QuotaExceededError before start: fresh and existing-save sessions start; settings/position/tutorial changes usable; real shot resolves, temporary snapshot export contains live counters/preferences; original durable bytes preserved.
A05: storage failure introduced after healthy start and during shot/finish/end paths: no lock/freeze or duplicate effects, end/menu transitions work; explicit temporary feedback.
A06: malformed JSON, oversized input, invalid recognized schema in durable storage: safe defaults, protected raw bytes after gameplay/settings/retry, visible recovery instructions, export works.
A07: transient failure then retry: failed retry preserves snapshot; successful retry writes latest live session data under the sole save key, returns truthful persistent status; next isolated reload loads it.
A08: ordinary subsequent successful write recovers temporary mode; temporary status never falsely claims durability.
A09: failed valid import under getter/setter/quota failure: candidate never adopted; live data, Game, preferences and existing bytes unchanged; valid import after recovery and from corrupt mode succeeds; all PR8 tests pass.
A10: production subpath, isolated profiles; storage notice visible during gameplay and modal views, focus/input remain usable; no uncaught errors. Never use user's browser storage.
A11: Node suite, build, entire existing Chromium suite including PR9 offline/coherent updates and new storage suite pass on delivered head.
A12: configured seed-1337 collisions 10000, pockets 10000, aim 5000, fairness 10000 regressions pass; only allowed files changed; draft PR contains before/after matrix, exact SHA, commands and limitations; Cognitive OS synced, preserving product ACCEPT separately from PR10 execution authority.

## Execution and delivery
Fault injection must reach native storage getter/method boundary in isolated Chromium contexts; record source SHA/version, injection timing and verdict. Use unmodified git archive of base for baseline and production builds served beneath /client/ for baseline/after. Keep prior PR8/PR9 evidence unchanged. Node tests must include strict transaction behavior and corruption protection, not merely mirror helpers. Full Chromium suite remains required; do not weaken checks. Verify the committed head and CI validate; deploy must be skipped for draft PR. Stop for human review; no merge/publication of 4.7.3.

## Implementation and validation guide

`createProgressStore` owns a serialized page-session snapshot and a persistence status. Ordinary saves retain the latest snapshot before attempting the actual key write. Storage I/O failures return false and show temporary feedback without aborting gameplay. A corrupt-load guard suppresses ordinary writes/retry; `commitImport` alone replaces that raw save after a successful strict durable write. The original PR8 validation, strict `save` API and file cancellation logic remain intact.

All existing app persistence call sites route through the adapter. Four notices provide feedback in gameplay, Menu, Settings and Progress. Temporary Settings exposes a retry action; successful retry saves the latest snapshot. Notices use textContent, remain in layout flow and preserve input; a status-driven canvas resize adjusts only the rendering surface/gesture profile, never an active table or physics state.

Validation commands:

```sh
npm test
npm run build
npm run physics:collisions -- --seed 1337 --cases 10000
npm run physics:pockets -- --seed 1337 --cases 10000
npm run aim:validate -- --seed 1337 --cases 5000
npm run fairness:validate -- --seed 1337 --cases 10000
# Existing production server followed by full suite:
PLAYTEST_ROOT=http://127.0.0.1:8080 PLAYTEST_ARTIFACTS=/tmp/tri-echo-pr10 python tests/playtest.py
# Standalone storage suite starts its own production server beneath /client/:
python tests/storage-resilience.py
```

The full playtest invokes the storage suite as well as all previous PR7/PR8/PR9 checks. Production faults are injected into native getter/getItem/setItem boundaries in fresh isolated contexts. Local audit evidence retains the immutable 4.7.2 failure separately from PR10 results. Browser/device-wide qualification and cross-launch active-round restoration remain separate milestones. Native failing setItem atomicity is assumed; no storage repair probe, destructive clear or multi-tab reconciliation is introduced.
