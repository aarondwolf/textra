# Startup performance

2026-10-27 Visual editor measurements: native small-document runs observed
15–44 ms from the prepared Visual control click to the next animation frame after
its surface appeared. An isolated Node 24 adapter probe used plain-text fixtures
with 1,667 and 8,334 paragraphs: a 100,000-character import took 576 ms and a
500,000-character import took 3,770 ms. Median localized edit projection plus a
structured clone over five samples took 29.3 ms and 103.1 ms respectively. The
import runs in a worker in the app; these are synthetic measurements, not native
large-document typing or cold packaged startup measurements. Very large documents
may still show noticeable editing delay.

2026-10-26 interaction follow-up: optional feature code now prepares sequentially
at idle after the first editor frame. Both the import and resolved React component
are cached across mounts, and the source editor stays mounted behind comparisons.
ES modules were already cached; the previous per-mount lazy wrappers could still
show a loading fallback, while unused panels waited until their first activation.
The native document-session fixture observed three existing-tab switches at
66.8, 54.0, and 54.1 ms from click to visible text; a final rerun observed
55.5, 50.6, and 49.1 ms. These are small-fixture samples,
not before/after measurements or a large-project performance guarantee. Startup
restoration checks still pass; packaged cold-launch targets remain open.

Run `npm run build`, then `npm run test:startup` on Windows with no other native
test suite or development instance running. The benchmark launches the production
app in an isolated disposable profile and writes a `startup-benchmark.json`
Playwright attachment under `test-results/`. It never uses a real profile or AI
credentials. `npm run test:e2e -- tests/e2e/startup.spec.ts` runs the functional
restoration regressions; the benchmark is skipped unless explicitly requested.

`npm run test:startup -- --unsynced-profile` is a separate diagnostic: Chromium,
preferences and offline AI storage use a fresh OS temporary directory outside the
Dropbox checkout, while the synthetic project and built app remain in the workspace.
It writes `startup-benchmark-unsynced-profile.json`; preserve it separately from the
default Dropbox-profile result. This does not move or use a real application profile.

## Method

The synthetic project contains ordinary UTF-8 LaTeX files. One setup launch seeds
the real Chromium localStorage session and closes; three measured process launches
then reuse that profile. These are warm profile/process restarts. OS filesystem
caches are not reset, so these numbers must not be described as cold-start results.

Observed shell, editor and compile-enabled timings begin immediately before
Playwright's `electron.launch()`. They include automation attachment overhead and
are upper bounds on UI readiness. Renderer `textra:` marks have a different origin
(renderer navigation start) and must not be subtracted directly from these values.
The report also records both clock origins and derives mark-to-launch elapsed
times using their epoch timestamps; these avoid Playwright's later DOM-observation
delay and assume the host wall clock remains stable during each short sample.
New diagnostic runs additionally record navigation request/response, DOMContentLoaded,
load and paint timings, plus up to 250 resource timings with asset basenames and
protocols. Local-file transfer sizes can be zero; interpret durations and scheduling
alongside the startup marks rather than treating zero bytes as no loading.
The benchmark checks that the Monaco input is visible and focusable, its editor
container is taller than 200 pixels, and Compile is enabled. It does not compile
automatically or send document content to a provider.

Renderer long tasks are collected using a buffered PerformanceObserver; unsupported
collection is recorded as null. Electron's per-process CPU and memory metrics are
recorded after a two-second settling period. Process working-set values are in KB
and include shared pages, so their sum is an indicative footprint rather than unique
physical memory. CPU metrics are samples, not a sustained idle CPU profile.

The architecture-refactor harness also samples main-process timer delay after
settling: 50 intervals of 10 ms, reporting median, p95 and maximum overshoot.
This test-only diagnostic adds no preload capability. It describes that short
post-startup window, not startup blocking or sustained responsiveness under load.

The basic benchmark has no generated PDF; PDF-ready is reported as absent. It
clicks Compile and verifies the real typed IPC reaches main, replacing subprocess
execution with an explicitly mocked error response. The real compile/PDF native
workflow remains the integration check for those paths. Compare like fixtures and tool availability when adding PDF
or real TeX timing, and separate dispatch latency from TeX execution duration.

Targets for the small local fixture are editing within two seconds on warm launch
and four seconds on a genuinely cold launch, with an available PDF within one
additional second. These are investigation targets, not flaky test assertions.
Record hardware, cache state and contention before interpreting changes.

## Refactor baseline

The pre-renderer-refactor production build on 2026-10-23 emitted a 10,124,403-byte
renderer entry bundle (unminified; worker assets separate). This build includes
additive main/preload project-opening interfaces already in progress, so it is not
a pristine HEAD comparison. Native timing evidence is recorded below only when a
measurement completes successfully.

The original timing baseline is invalid for elapsed-time comparison: its fixture
preferences omitted required legacy fields, causing fallback defaults and failed
preference IPC. It also predates isolated AI-store handling: cached provider
settings were read from the repository-local AI store. No generation was requested.
Final fixtures use complete valid preferences and isolate the AI store. The original
bundle-size measurement remains valid; do not claim startup latency improvements
against the original timing samples below.

Three measured restarts completed before a Windows GPU-cache cleanup lock caused
the test to fail (cleanup now retries transient locks). Shell observations were
20.002s, 18.647s and 18.009s; editable document observations were 20.080s, 18.673s
and 18.035s. These include automation and filesystem overhead in this managed
desktop environment and do not establish normal desktop launch latency. The
median editable observation was 18.673s. Renderer startup long tasks were
308/109/350ms, 280/91/284ms and 314/97/296ms respectively. Renderer working sets
were approximately 332MiB in each sample; process-tree working sets approximately
1,073–1,079MiB include shared pages. Initial CPU snapshots were zero and are not
evidence of zero idle CPU; subsequent measurements prime CPU sampling first.
Raw observations are kept in
[`baseline-2026-10-23.json`](../tests/performance/baseline-2026-10-23.json).

## Refactored functional observation

The complete valid-profile native startup suite passed all three functional cases
(50 tabs with immediate edit/save, missing active file and cached PDF). No renderer
exceptions were reported. The synthetic missing path produced expected NOT_FOUND
IPC warnings; normal cases produced no preference or filesystem errors.

One cached-PDF observation before the final layout and close-tab race fixes recorded a visible
editor at 19.964s and first PDF canvas at 20.370s from launch in the managed desktop
environment. Renderer marks placed the first PDF page 497ms after editor readiness.
This is a preliminary observation without a normal editor-size assertion, not a
startup-speed comparison or an idle CPU measurement. Its raw data is in
[`pdf-startup-2026-10-23.json`](../tests/performance/pdf-startup-2026-10-23.json).

## Preliminary production benchmark (superseded)

`npm run test:startup` passed all three samples on the earlier race-fix build using
an isolated Chromium profile under the Dropbox workspace. The
fixture used complete valid preferences, an isolated AI store, one saved source
file and disabled TexLab. The host was Windows build 26200, Intel i7-1185G7,
8 logical CPUs, approximately 15.7GiB RAM and Node 24.14.0. There were no renderer
exceptions or unexpected main-process errors in the captured launch logs.

Subsequent native checks found that core editor layout styles had accidentally
followed the lazy Agent review stylesheet, collapsing the ordinary editor. Those
styles now load with the shell. These samples did not enforce normal editor height
and must not be used as evidence of a usable full-size editor or the final startup
latency. The final harness adds an explicit editor-size check.

| Measurement                                                      | Preliminary observation                           |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| Initial renderer entry                                           | 485,320 bytes, plus 8,539-byte React chunk        |
| Initial entry and React versus original monolithic entry         | Approximately 95.1% fewer bytes                   |
| Deferred file-icon manifest                                      | 622,808 bytes, loaded after core readiness        |
| Visible shell from launch, observed median                       | 17.509s                                           |
| Editable document from launch, observed median                   | 18.235s                                           |
| Editor mark from launch, epoch-adjusted median                   | 18.210s                                           |
| Compile enabled from launch, observed median                     | 18.242s                                           |
| Click to confirmed compile IPC receipt                           | 100–243ms, subprocess execution mocked            |
| Renderer startup long tasks                                      | 91–203ms                                          |
| Sum of process private-byte counters after settling              | Approximately 331–334MiB                          |
| Sum of process working-set counters after settling               | Approximately 850–1,013MiB, shared pages included |
| Sum of sampled process CPU percentages after two-second settling | 1.63–2.66%                                        |

The two-second warm-launch target was **not met** in this managed desktop run;
no OS-cold launch was measured. Code splitting and bundle reduction are established,
but elapsed startup improvement over the original fixture cannot be established
because that timing baseline was invalid. These memory and short CPU samples also
do not establish a generally lightweight footprint. Further profiling should split
native process initialization, module/file loading and renderer work, and repeat
on a normal desktop launch outside the automation environment.

Raw preliminary observations, origins, marks, per-process counters and asset sizes are in
[`pre-layout-2026-10-23.json`](../tests/performance/pre-layout-2026-10-23.json). The compile
response fixture's error-field spelling was corrected after this run; the measured
startup and request-dispatch path is unchanged.

## Final production benchmark

The final layout-corrected build passed three samples using
`npm run test:startup -- --unsynced-profile`. Every sample checked an editor
container taller than 200px, focused Monaco, and confirmed Compile availability.
The isolated Chromium/preferences/AI profile was in OS temporary storage outside
Dropbox; the application and synthetic project remained in the Dropbox checkout.
The host and complete-preference fixture otherwise match the preliminary run.

| Measurement                                              | Final observation                                   |
| -------------------------------------------------------- | --------------------------------------------------- |
| Initial renderer entry                                   | 485,331 bytes, plus 8,539-byte React chunk          |
| Initial entry and React versus original unminified entry | Approximately 95.1% fewer bytes                     |
| Deferred editor module / shared Monaco module            | 974,401 / 2,722,667 bytes                           |
| Visible shell from launch, observed median               | 16.281s                                             |
| Normal-sized editable document, observed median          | 17.074s                                             |
| Editor mark from launch, epoch-adjusted median           | 16.806s                                             |
| Compile enabled from launch, observed median             | 17.087s                                             |
| Click to confirmed compile IPC receipt                   | 235–619ms, subprocess execution mocked              |
| Navigation start to first contentful paint               | 9.628–11.948s                                       |
| Collected renderer long-task durations, sum per sample   | 300–351ms                                           |
| Sum of process private-byte counters after settling      | Approximately 320–327MiB                            |
| Sum of process working-set counters after settling       | Approximately 1,058–1,063MiB, shared pages included |
| Sum of sampled process CPU percentages after settling    | 1.91–2.14%                                          |

The two-second warm target remains **unmet**. HTML response completion was within
515ms of navigation start, while DOMContentLoaded occurred at 9.547–11.570s.
No resource entries were exposed for the local-file modules, so these measurements
cannot assign that gap to particular assets. Moving the profile alone did not
remove it. Profiling native/module initialization and first paint in a packaged,
ordinary desktop launch is the next step. These results do not establish a cold
launch time, a latency improvement over the invalid baseline, or a generally
lightweight footprint. There were no renderer exceptions in this benchmark.

Raw final data, loading/paint timings, origins, process counters and bundle sizes:
[`final-2026-10-23.json`](../tests/performance/final-2026-10-23.json).

## Functional coverage

Native startup regressions restore an active document from 50 saved tabs, preserve
editing and saving, and recover an available document when the saved active path is
missing. A synthetic valid cached PDF verifies real main validation and PDF.js
rendering without running TeX, and attaches its observed first-page timing. Tests
use real Electron, Monaco, filesystem operations and session storage;
no provider is configured and TexLab is disabled to keep this fixture independent
of external tools. Other native suites retain coverage of TexLab and compilation.

## Electron architecture milestone, 2026-10-24

The final production build passed `npm run test:startup -- --unsynced-profile`
(three measured launches, 24.5s total). The fixture, host and clock definitions
above apply: one synthetic file, disabled TexLab, unconfigured AI, OS-temp profile,
warm caches, and mocked TeX execution after startup. No renderer exceptions occurred.

| Measurement                                          | Observation                       |
| ---------------------------------------------------- | --------------------------------- |
| Initial renderer entry / React chunk                 | 503,754 / 8,539 bytes             |
| Visible shell from launch, observed median           | 1.008s                            |
| Editable editor from launch, observed median (range) | 2.133s (1.879–2.666s)             |
| Editor mark from launch, epoch-adjusted median       | 1.947s                            |
| Compile enabled from launch, observed median         | 2.147s                            |
| Click to compile IPC receipt                         | 93–218ms, subprocess mocked       |
| Main timer-delay p95 per sample / overall maximum    | 9.57–10.67ms / 16.81ms            |
| Collected renderer long-task total per sample        | 498–744ms                         |
| Sum of private-byte counters after settling          | 316–322MiB                        |
| Sum of working-set counters after settling           | 479–484MiB, shared pages included |
| Sum of sampled process CPU percentages               | 1.38–1.60%                        |

The observed median remains above the two-second warm investigation target. The
much lower launch observations than the earlier managed run do not establish a
causal speedup: cache/scheduling and managed desktop conditions were not controlled
between dates. Timer delay includes Windows timer scheduling and describes only
50 post-settle intervals, not main-process work under load. Memory/CPU samples do
not establish a generally lightweight footprint. Genuinely cold packaged launches
and first-paint profiling remain open.

Run-specific raw observations are retained locally in
`.test-data/architecture-startup.json`; rerunning the command produces a fresh
Playwright JSON attachment. Generated profiles and test outputs are not committed.
