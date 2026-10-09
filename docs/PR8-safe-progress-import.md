# PR8 — Safe Progress Import (4.7.1)

Progress previously interpolated achievement IDs into HTML; an imported
`<img src=x onerror="window.auditImportExecuted=true">` executed when the card
opened. Progress now creates DOM elements and sets textContent. The same ID is
accepted and displayed literally, including when loaded before startup.

## Save boundary and compatibility

`js/storage.js` reconstructs a fresh canonical save from own recognized fields.
The key remains `triEchoSaveV1`, exports remain plain JSON, and the download is
`tri-echo-progress.json`. No backend, envelope, dependency or migration is added.
Unknown ordinary fields are ignored. Accessors, custom prototypes and own
`__proto__`, `prototype` or `constructor` keys anywhere (even ignored extensions)
are rejected without evaluating getters. Root must be a plain record; file
imports require an own `stats` record, while local `{}` uses defaults.

Present recognized fields must have their specified type; no coercion. Missing
optional fields get fresh defaults:

| Field | Contract |
| --- | --- |
| best | Nonnegative safe integers for current modes and flow/zen/precision/rush; historical zero defaults retained |
| bestStreak, stats.shots, stats.successes | Nonnegative safe integers, default 0; independent counters need no arithmetic relationship |
| stats.recent | Boolean array ≤10,000, keeping latest 12; default [] |
| dailies | ≤10,000 real UTC YYYY-MM-DD dates; first-occurrence deduplication, no future-date exclusion |
| achievements | ≤1,000 records; order and duplicate IDs retained |
| achievement.id / desc / date | Required nonempty ID ≤128 UTF-16 units; description ≤512, default empty; optional UTC ISO timestamp ending Z ≤64, preserving text and absence |
| settings | Boolean sound/haptics/reducedMotion, defaults true/true/false; optional finite contactPos x/y in [0,1] |
| mode | Current production modes; missing or flow/zen/precision/rush → golf |
| difficulty / tableStyle | relaxed/normal/hard/adaptive (normal); echo/snooker (echo) |
| trainingDiscipline / trickDiscipline | golf/classic/american/snooker versus golf/classic/american/british; default golf |
| tutorial | Boolean, default false |

HTML-like IDs are text, not stripped or limited to today's award names. Invalid
recognized values reject the whole candidate. Input and defaults are unchanged;
normalization is deterministic and idempotent. Export does not mutate live data.

Files are limited to 1,048,576 bytes both by finite nonnegative file.size before
reading and UTF-8 encoded text before JSON.parse. Depth is at most eight
object/array levels, root level one. MIME type and filename are not authoritative.
Local loading uses the same depth/schema/byte boundary; denied storage access or
invalid bytes produce fresh defaults without overwriting raw recoverable bytes.

## Commit and application behavior

1. Capture the File and clear the input so the same file can be selected again.
2. Read, bound, parse and normalize an isolated candidate.
3. Check the monotonically increasing request token immediately before writing.
4. Serialize and persist with one synchronous setItem.
5. Only then publish live progress, reconcile controls and report success.

A newer selection invalidates older completions and errors. Closing/cancelling a
dialog, starting/continuing a game, repeating the tutorial or leaving the page
cancels pending imports. Existing modal pause/input gates prevent shots while the
read is pending. No stale read commits after gameplay resumes. A selection with
no file is a no-op. No rollback writes or multiple-key transactions are used.

Read/schema errors report FICHEIRO INVÁLIDO (oversize: FICHEIRO DEMASIADO GRANDE).
Write failures report NÃO FOI POSSÍVEL GUARDAR O PROGRESSO and preserve previous
storage bytes, live progress/preferences and active Game. PROGRESSO IMPORTADO
means the candidate persisted. An unexpected post-commit control error reports
PROGRESSO GUARDADO · ERRO AO ATUALIZAR CONTROLOS, without unsafe rollback.

Success updates audio, checkbox states, impact control placement, menu selectors
and mode copy. The existing Game/table/rules/powers/Rails/round epoch are retained;
Continue resumes that Game even when imported menu mode differs. Imports replace
aggregate progress/preferences; they do not restore or merge an active round.
Existing scheduled gameplay transitions remain governed by their existing epochs.
No cross-tab or disk-crash atomicity guarantee is made.

## Verification and limits

`tests/storage.test.js` covers schema, legacy compatibility, own keys/getters,
calendar/ISO dates, exact byte/depth/array/string limits, Unicode, independent
objects, safe loading, round trips and the single-write boundary.
`tests/playtest.py` exercises real file-input imports, poisoned local startup,
inert payload text with error/request monitoring, invalid/failed transactions,
out-of-order reads, cancellation/reselection, settings with an active round,
exports and Progress at 390×844, 412×915 and desktop. Test-only delayed File reads
and storage failures are injected in the browser; production seam is unchanged.

Run npm test and npm run build; serve dist/client on localhost and run
python tests/playtest.py with Playwright Chromium. CI additionally runs collision
10,000, pocket 10,000, aim 5,000 and fairness 10,000 cases with seed 1337.

Release bookkeeping only changes package/lock version and the existing worker
cache identifier to 4.7.1. PR9 still owns offline precache/fallback/update repair;
PR10 still owns general gameplay/settings write resilience and volatile mode.
These Chromium viewport checks do not establish real iOS/Android or all-browser
qualification. PR7.1 acceptance remains valid. Human PR8 usability review and
separate merge/publication authorization are still required.
