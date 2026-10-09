# TRI//ECHO — PR9: Offline Boot and Coherent Updates

Implementation contract: PR9, 9 October 2026. Source: the owner’s closed audit specification. Runtime/build implement the contract below; validation evidence is recorded in the PR. Merge/publication remain separate owner decisions. Changes to this contract must be explicit and justified.

## Implementation and review

The build emits `precache-manifest.json` and a standalone worker containing the same descriptor. Cache entries are verified on install and read, and repairs accept only the installed digest. The app registration contains offline update failures. No gameplay module changed beyond that registration statement.

The browser test entry point runs the existing characterization plus a same-origin `/client/` fixture matrix. Fixtures include the exact 4.7.1 source commit (fetched by immutable SHA when CI checkout is shallow), production A, and a deliberately different test-only B. HTTP faults reach worker requests. Statechange events prove rejected installations; an out-of-scope observer proves safe activation after application clients leave. Corruption, repair and cleanup failure are also injected only in test fixtures.

A01–A11 are exercised by the browser matrix and corresponding Node tests; A12 covers existing characterization/build and unchanged seed-1337 stress commands. Evidence and final SHA belong in the PR/local audit delivery record. `PR9_ONLY=1 python tests/playtest.py` runs the dedicated fixtures; the ordinary invocation runs them after the complete characterization. A03 uses the existing `british` mode identifier for Snooker.

Limitations: first-ever offline launch, full browser cache eviction recovery, cross-launch unfinished rounds, real-device/browser qualification and PR10–PR14 remain outside this change. Normal waiting requires all old app tabs to close/navigate away. The legacy worker retains its old behavior while waiting; the immutable bundle guarantee begins with controlled PR9.

## 1. Baseline, release and outcome

- Repository: https://github.com/ptcapa0/tri-echo ; current remote main independently checked at `897a45ca0ba1a9174c46baaf45c2d65c6f875233`, published 4.7.1 (PR #24).
- PR9 target version: **4.7.2**, package/lock/build metadata consistent. Use a clean isolated checkout based on refreshed main; preserve the principal checkout's user README edits.
- Existing PR7.1 and PR8 acceptances remain valid. The runtime source in the reproduction fixture is an unmodified archive of this exact baseline, not the older audit build.
- Required result: after a complete initial online installation, a controlled launch with HTTP cache empty and Cache Storage retained opens the menu, starts a Game and resolves a real shot offline. Updates install a verified complete release alongside the active release and activate only after the previous controlled clients are gone.
- Reproduction artifacts: `audit/2026-10-09-pr9/reproduce-cold-offline.py`, `cold-offline-4.7.1.json` and `cold-offline-4.7.1.png`. The JSON is the authoritative observed result; inspect it rather than inferring success from a screenshot.

### Observed baseline result

Reproduced on 9 October 2026 with Chromium 153.0.8010.12, fresh isolated context, built exact main at the `/client/` subpath. Initial online Game started and a real pointer shot resolved with no page errors. After CDP HTTP-cache clearing (Cache Storage retained) and offline reload, menu closed/hidden and app API undefined. Both omitted modules were returned by the service worker as status 200 `text/html`; Chromium logged two module MIME errors. The offline document/CSS and listed modules were served from the worker, excluding a total installation failure as the cause. Server stopped and isolated browser closed after capture. No mixed-version incident was reproduced in this task.

## 2. Exact scope and exclusions

Allowed surfaces: `sw.js`, `build.mjs`, `tests/service-worker.test.js`, `tests/build.test.js`, bounded offline/update scenarios in `tests/playtest.py`, PR9 documentation, package/lock release bookkeeping. A small registration change in `js/app.js` is permitted only for update cache policy/error containment; no gameplay/UI refactor.

No new runtime dependencies, framework migration, cache library or backend. No changes to physics, collisions, pocket geometry, aiming, generation/fairness algorithms, rules, scoring, powers, Rails, interaction ownership or PR8 progress schema/transaction behavior. No general storage resilience (PR10), lifecycle recovery (PR11), durable active-round persistence (PR12), or broad real-device qualification (PR14).

Do not promise first-ever offline installation, survival of browser storage eviction, or persistence of an unfinished round after the owner closes its tab. Closing every app tab is the chosen update boundary; existing same-tab Continue remains unchanged. A failed upgrade cannot repair the already-incomplete 4.7.1 offline cache.

## 3. Build contract: one verified release graph

1. Build the existing standalone client as today. Enumerate every regular client `js/**` and `assets/**` file plus `index.html`, `style.css`, `manifest.webmanifest` and `build-info.json`; sorted canonical relative paths, no duplicate aliases, traversal, outside-root symlinks or remote resources. Include `js/testability.js` and `js/fairness.js`.
2. Verify the local module graph and static resource references (HTML, CSS URLs and manifest icons) against that set. Relative references must resolve to emitted files within scope. Fail the build for missing required references, unsupported/unresolved dependency expressions or paths escaping the output. Enumerating all modules/assets prevents an allowlist drifting when a new module is added. Do not merely patch today's FILES array.
3. For each resource compute SHA-256 of exact emitted bytes and its expected media category. Generate a canonical release descriptor: schema version, package version, commit and sorted path/hash/category entries. `build-info.json` retains version/commit/builtAt; its digest participates in the descriptor.
4. Release ID is the SHA-256 of the canonical descriptor serialization. Emit `precache-manifest.json` containing the descriptor and ID; embed the same data into generated `dist/client/sw.js`. The worker and manifest are excluded from their own hashed resource set, avoiding circular hashing. Manifest responses may be synthesized from the embedded descriptor. The completion marker is private cache metadata, never an app resource.
5. Source `sw.js` is a build template. Missing/unresolved generation tokens must fail production build/tests; running the source dev server must not install an unverified placeholder worker. Built `sw.js` must parse standalone and contain the exact build descriptor. No timestamps or random values are added after hashes are computed.
6. Changes to any required file produce a different release ID even if the semantic version is accidentally unchanged. Tests independently recompute hashes and ID, inspect coverage, exercise a missing-import fixture and ensure repeat serialization is deterministic for identical build inputs. Production must be tested at a subpath equivalent to `/tri-echo/`, not only at origin root.

## 4. Installation and failure ordering

- Cache namespace: a PR9-specific prefix including an unambiguous encoded application scope, with the full release ID appended. Distinct scope/release caches must never collide. Use the worker's registration scope as the canonical base URL.
- Installation writes only its candidate cache. Fetch canonical resources using `cache: 'no-store'`, avoiding stale HTTP cache; require same-origin exact expected final URL, no redirect, status 200, compatible media type and matching SHA-256. Reject opaque/error responses, HTTP errors, HTML posing as a resource and stale bytes from another release.
- Store only validated responses. Await every fetch, validation and put inside the promise supplied to `installEvent.waitUntil`. Write a complete marker **last**, only after all resources are present and verified. Installation rejects on any download, validation or cache write failure. A partially downloaded candidate cannot activate.
- On failed installation, delete only that failed candidate cache, never the active/waiting release or user storage. Catch cleanup failure as best-effort cleanup; preserve the original install rejection. Activation may clean abandoned candidates later. Reusing an existing same-ID cache requires validating completeness; never delete a usable active same-ID release.
- Never call `skipWaiting`, expose a skip-wait message, force reload, or call `clients.claim`. A successfully installed update stays waiting while the old worker controls any client. First-install readiness means successful active worker plus a complete cache; it does not falsely claim that the initial network-loaded document is already controlled.
- An update check may use `register('./sw.js', {updateViaCache: 'none'})` and a bounded `registration.update()`; handle offline rejection without breaking boot or emitting unhandled promise errors. No reload loop or periodic polling mechanism.

## 5. Serving contract

The worker serves its own installed descriptor/cache; it never uses origin-global `caches.match` to select an arbitrary old/new response.

| Request | Required behavior |
| --- | --- |
| Non-GET, different origin or outside registration scope | Do not intercept or cache |
| In-scope HTML navigation, including root/index and navigation queries | Return this release's verified `index.html`; retain the document URL/query for existing app behavior |
| Known descriptor resource | Return this release's cached bytes; canonicalize query only for these immutable known paths; use normal request/destination semantics |
| Generated manifest diagnostic | Serve the descriptor belonging to this worker, never a network manifest belonging to another release |
| Known required resource missing/corrupt in cache | Attempt repair only with the descriptor's exact digest/media/URL checks; await put before returning verified bytes; otherwise a controlled resource/network failure |
| Unknown in-scope resource | Pass to network without caching; offline failure stays a resource failure, never HTML |
| Private completeness metadata | Not exposed as a resource |

Validate the cached media category and digest before serving a required resource; treat invalid entries as corruption and use the repair branch above. Do not overwrite installed resources opportunistically with network-first responses. Installed shell/assets remain pinned to the worker release while another candidate downloads. A repair fetch cannot substitute newer bytes. Cache eviction/corruption may prevent offline use; it must not produce a mixed bundle or false offline-ready result. Any essential repair/cleanup work belongs to `waitUntil` or an awaited response chain, with rejected promises contained.

## 6. Activation, cleanup and legacy transition

1. Activation checks its complete marker and required entries before serving. A failed install never reaches this stage. No deletion of old caches during download or waiting.
2. Keep normal browser waiting semantics: activation occurs when the preceding worker controls zero clients. Closing/navigating away from all application tabs and opening a new session is the defined safe update path. A mere refresh while another controlled tab remains open must not force an update.
3. Only after successful activation may obsolete caches in the exact same scope namespace be removed. Preserve unrelated origin caches and other TRI//ECHO scope caches. Cleanup failure must not destroy the new verified cache or invalidate boot; cleanup is retriable.
4. Legacy 4.7.1 keys (`tri-echo-v…`) may be deleted only when proven owned by this app: entries all lie within the registration scope, key matches the known legacy naming scheme, and old controlled clients are gone. Ambiguous legacy cache ownership means retain it. Do not delete all caches sharing an origin or a vague prefix.
5. Upgrade tests begin with the actual unmodified 4.7.1 worker and data, then replace server artifacts with PR9 at the **same origin and scope**. Record controller transitions, descriptor IDs, cached hashes and unchanged saves/preferences. During legacy waiting, the old network-first worker remains legacy behavior: PR9 must not claim retroactive coherence for it. The fully pinned guarantee begins with a controlled PR9 release.
6. Separately test a fully installed PR9 fixture A against a failing/new fixture B. This proves that a failed future update preserves a genuinely offline-capable prior release, which the broken 4.7.1 fixture cannot prove.

## 7. Mandatory acceptance and evidence

Each browser scenario uses an isolated context with service workers allowed. Deterministically wait for worker states and completed caches; arbitrary sleeps and Play-button visibility alone are insufficient. Fault injection must apply to worker network requests (use the fixture HTTP server, not only page routing).

| ID | Scenario | Required observation |
| --- | --- | --- |
| A01 | First online installation | Descriptor covers required graph; all digests/media match; complete marker written last; worker active; first uncontrolled page not forcibly claimed/reloaded |
| A02 | Cold offline controlled boot | Clear **only HTTP cache** via CDP, retain Cache Storage, set offline, reload; menu open, app API initialized, start real Game and real pointer shot resolves; no MIME/page errors |
| A03 | Offline modes | Golf/Echo, classic, american, snooker and Daily start offline; representative traditional/Daily shots resolve, existing mode assertions pass |
| A04 | Candidate faults | Individually inject missing module/404, 500, redirect, wrong MIME, stale/wrong digest, network interruption and cache put rejection; install rejects, no complete marker/activation, active cache unchanged |
| A05 | Request policy | Navigation fallback works at subpath; unknown/missing JS/CSS/image does not receive HTML; external/out-of-scope/non-GET requests untouched; known asset query cannot select network bytes |
| A06 | 4.7.1 → 4.7.2 | Install candidate on same origin; preserve raw save/preferences while waiting; after all old tabs leave, new controlled launch has matching version/commit/descriptor and cache bytes; PR8 import/export contract passes |
| A07 | Two tabs and active Game | One active round, another menu/Continue; install newer candidate; no controller switch/reload/new Game, round epoch/table/rules/Rails/inventory retained; reload of second tab stays old while first remains; close all and new session activates candidate |
| A08 | Complete PR9 A → failed B | Old active client unaffected, old cache retained; cold-offline new launch of A works after failed update; B not active; regain network, correct B install and safe activation succeed |
| A09 | Coherent bytes under deployment skew | Candidate worker/manifest from B with one required resource from A rejected; controlled A navigation/resources stay A even when network serves B; no mixed version accepted |
| A10 | Cache lifecycle/isolation | Unrelated cache and second app-scope cache survive; no early cleanup while old tabs use cache; same-ID install/repeated updates, orphan candidate and cleanup failure handled without deleting active resources |
| A11 | Corruption/eviction | Missing/corrupt required entry cannot be replaced by newer unverified resource or HTML; verified online repair succeeds; unavailable repair offline fails clearly; no promise of recovery after full browser eviction |
| A12 | Regression and production artifact | All required existing tests pass on final head/built client; no generated-token leakage; no physics/rules/PR8 changes; commit/version metadata agree |

Before/after evidence must use the same cold-offline protocol. Record commit, version, browser version, server scope, source hashes, worker/controller states, cache entries/digests, HTTP-cache clearing, module response status/media/from-worker flags, console/page errors, real-shot result and screenshot. Preserve baseline JSON/script as immutable evidence; write head results separately. Mixed-version risk requires its own controlled fixture; today's cold-offline reproduction is not proof of a mixed-version incident.

## 8. Verification and delivery gate

- Meaningful Node tests for build coverage/hash/circularity, install failure ordering, scope routing, pinned-cache response, lifetime/repair behavior and cleanup. Update the old activation test that currently expects forced claim.
- `npm test`, `npm run build`, complete existing built-client Chromium characterization/smoke plus A01–A12 browser fixtures. Use current unchanged configured seed 1337 collision 10,000 / pocket 10,000 / aim 5,000 / fairness 10,000 commands. Record actual commands/results; no repeated full runs without a material change.
- Production artifact served by a static server at the deployment subpath. Preserve original README edits and verify clean implementation diff/isolated checkout. CI must validate generated assets and the meaningful cold-offline test.
- Deliver a reviewable PR titled around offline boot/coherent updates with precise before/after, fixture update evidence, all acceptance results, target 4.7.2, and residual limitations. No silent weakening of criteria. If a criterion fails, report it as a blocker rather than mark PR9 complete.
- Human review remains required. Merge/publication of PR9 require separate explicit PT authorization. After authorized publication verify public build identity and legacy upgrade; no publication is part of this specification/reproduction task.

## 9. Immediate next action

Review the implementation and final-head validation evidence before authorizing merge/publication. The PR delivers the implementation for human review; it does not merge or publish.

## References

- `audit/PR9-NEXT-STEPS.md` (superseded as the implementation contract by this specification; retained as planning history).
- `audit/2026-10-06/PRODUCTION-AUDIT.md`, F02; `audit/2026-10-09-pr8/published-verification.json`.
- Current main `897a45c`: sw.js, build.mjs, js/app.js, tests/service-worker.test.js, tests/build.test.js and tests/playtest.py.
- https://web.dev/articles/service-worker-lifecycle — install rejection, normal waiting, client control and activation cleanup.
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest — SHA-256 digest API for candidate validation.
