# noisemaker-for-cpu: completion gaps

Current compatibility matrix: [compatibility report](COMPATIBILITY.md).

## 1. Scope and source revisions

Worker audit: 2026-09-26. Run ID: `audit-20260926-010135`. Audited source: [`ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5`](https://github.com/noisefactorllc/noisemaker-for-cpu/commit/ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5).
Local and remote `main` both resolve to that SHA. The checkout is clean.
Full rendered parity remains **unverified**. The bounded gate still fails. No release approval or closure follows from this audit.
Kernel pin: `8eeb7b5ac14eb37a8d16037f607a88ce63924cd3`, upstream tag `v1.0.183`.
Current upstream main: `95743621696483b91968992ef6ee0d87b2089fa8`. Published Noisemaker authority: `1.0.184` at that source.
The published effect manifest is byte-identical across `1.0.179` through `1.0.184`. Its SHA-256 is `05c4d7b7744837ae90a3bb4c89e5403ff09448a74d9d7e824abb3d719ad3314e`, with 210 effect IDs.
Two runtime `shaders/` commits separate the pin from `9574362`. This audit records `9574362` as a new pending authority revision.
Current served kit: `0.1.33`, source `d03aed7b30384bcebc04bc7f73a7f750ce3b2227` (verified 2026-09-26 via [deployment metadata](https://kits.noisedeck.app/cpu/0/deployment-meta.json) and served-file SHA-256 comparison).
The observations below retain their original source and authority identities. They do not qualify later updates.

### Earlier source observations

Daily review: 2026-09-25. Inspected source: [`6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85`](https://github.com/noisefactorllc/noisemaker-for-cpu/commit/6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85).
Upstream discovery at that review: `bbdeb56c4b75cf33379766c3e87b0f5a18bcbba8`. Published authority then: `1.0.179`, source `fca611fd8f91424661d4e531d39313d24ea21134`.
Served kit then: `0.1.28`, source `6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85`.

### Worker audit observations, 2026-09-23

Audit date: 2026-09-23 UTC. Run ID: `20260923-cpu-04`.
This audit assesses the JavaScript CPU renderer, its CLI, browser demo, package candidate, and published export kit.
It does not approve a release or advance the parity checkpoint.

| Source | Revision |
| --- | --- |
| Reviewed local and remote source | `36fbfac07be5a9a10b7a991209b566be3f54fe6e` |
| Port authority pin | `643b2be1e28b62e3282a4009c2ea65c583ed6ccc` |
| Current upstream main | `dd38fdd2baf820b112520bd024e4db8c55f09789` |
| Published upstream runtime | `1.0.169`, source `44bc4ed4ac729bddaa95b083d64bee942ade35da` |
| Published CPU kit | `0.1.23`, source `36fbfac07be5a9a10b7a991209b566be3f54fe6e` |
| npm package candidate | `noisemaker-cpu@0.1.0`, packed from the reviewed source |

Current upstream source and the published manifest each contain 210 effect IDs.
The port contains the same IDs before its five explicit exclusions, leaving 205 supported catalog entries.
The exclusions are `synth/roll`, `synth/scope`, `synth/spectrum`, `render/meshLoader`, and `render/meshRender`.
Equal effect IDs do not prove equal parameters or behavior.

The useful supported task is offline PNG generation from a supported DSL program without GPU or native runtime dependencies.
A developer can also embed the renderer through ESM imports and present output on a canvas.
The package declares Node.js 22 or newer. Other supported platforms and browser versions lack a measured qualification matrix.

Publication scope contains this document and one README link.
Both existing workflows exclude these paths. This publication triggers no kit release, downstream dispatch, package publication, tag, or deployment.
The publication commit and remote file hashes belong to the shared audit result.

Review date: 2026-09-23. Current source: `16c38245c42030c8ee46dc61108791d2fea4bda9`.
Current kit `0.1.24` records that source. The current kernel pin is `44bc4ed4ac729bddaa95b083d64bee942ade35da`.
Earlier measurements retain their original source and date. The current schema contains 460 choices, compared with 458 during the audit.

Live upstream at review: `532ed64775000635e43caac085e4451c06e71afc`. Published runtime: `1.0.169` at `44bc4ed4ac729bddaa95b083d64bee942ade35da`.
The review does not qualify every upstream change after the recorded port authority.

## 2. Completion claims

| ID | Source | Scope | Finding | Evidence |
| --- | --- | --- | --- | --- |
| C-001 | README, Collection parity | 205 effects. 301 programs. 458 compile-time choices execute | supported | 272 unit tests pass. Catalog tests exercise 458 individual choices at 2×2. This proves bounded execution, not pixel equivalence. |
| C-002 | README, Collection parity | 166/167 pass. 117 frames are byte-exact | contradicted | Current gate reports 163/164, with 114 byte-exact frames and 41 skips. Three retired effects explain the smaller catalog. |
| C-003 | README, introductory parity statement | Pixel-level parity | partial | CRT fails the unchanged tolerance. Skipped effects and broader parameter combinations lack qualifying pixel evidence. |
| C-004 | README, canonical schemas | Canonical parameters and choices | partial | The audit rejected landscape filtering. Current source accepts both choices and produces finite frames. Orthographic landscape frames now pass the unchanged ±2 gate against authority `44bc4ed4`; perspective frames fail at one grazing pixel due to the authority backend's transcendental divergence (see GAP-003, blocked). |
| C-005 | README, Quick start and Browser API | Human usability through CLI and browser | partial | Installed CLI renders PNGs. Browser renders, resizes, reports invalid DSL, recovers, and executes with keyboard input. Accessible names remain incomplete. |
| C-006 | package.json and README | Ecosystem fit for dependency-free JavaScript | partial | Isolated tarball installation and ESM imports work. The public npm name returns E404. The README now documents the distribution path (GitHub install until the npm release; see the GAP-006 record). |
| C-007 | Export kit template | Offline useful output and complete engine delivery | supported | All 93 published files match hashes. Rebuild reproduces all 93 files. Published CLI produces a 64×64 PNG. |
| C-008 | Existing workflow results | Release readiness | unverified | Exact-source release checks include a real PNG render. They do not execute the port's unit or parity gates. Platform and upgrade qualification remain incomplete. |

## 3. Methods and evidence

Review CI boundary: Exact-source runs: Export kit, Downstream. A passing export dispatch does not qualify rendered parity. Current complete-render enforcement remains an open verification requirement. Exact-source responses and workflows in the shared automation store.

### Worker audit, 2026-09-26

Environment: Linux x86_64 container without GPU or browser. Node.js 26.5.1, npm 11.17.0.
The reference root was a scratch clone of the authority at pinned revision `8eeb7b5a`.
`npm test` exited 0: 279 tests, 278 pass, zero failures, one skip.
The reference-gated manifest cross-checks executed and passed against the pinned tree.
`npm run parity -- --json` exited 1: 164 executed, 163 passed, 114 byte-exact, 41 skipped.
`filter/crt` keeps maximum error 80 and mean error 5.05859375, with 89 channels over tolerance.
No golden, tolerance, or `parity/` path changed since the last review.
The CLI quick start rendered a 64×64 PNG and a chained 96×64 PNG, both exit 0.
An unknown effect and a missing input file each produced a clear error and exit 1.
Served kit `0.1.32` records source `bfbe547`. Its served engine CLI and entry hashes match the audited tree.
No workflow ran for the audited SHA. Documentation-only commits match no workflow path filter.
Exact-source delivery dispatches for `bfbe547` passed: Export kit 36205713332, Downstream 36205713330.
The public npm name still returns E404.
Raw evidence: run `audit-20260926-010135` in the shared series state, `evidence-audit-20260926-010135/result-noisemaker-for-cpu.json`.

### Daily review, 2026-09-25

The existing full CPU gate exits 1: 164 cases executed, 114 byte-exact, 163 accepted at tolerance 2, and 41 skipped. filter/crt has maximum error 80 and mean error 5.05859375. The gate identifies authority 4891b9953f9fd8a61cf9ae0dda2fe747a9be82df. Five of the 210 current effect IDs are outside its 205-effect inventory. Full parity fails. Raw evidence in the shared automation store.
The review checked source changes, worker evidence, source-bound CI where present, and current served inventories. Full installed-host and platform qualification remains incomplete.

Raw evidence resides in the shared automation store under `evidence-20260923-cpu-04`.
Evidence filenames below refer to that directory. They are operational artifacts, not repository deliverables.
`source-hashes.json` records SHA-256 hashes of tracked files before testing.
Remote README and catalog bytes matched the reviewed checkout.
No tests, implementation, goldens, generated sources, or tolerances changed during this audit.

Environment: macOS 14.8.3, arm64.
Repository suites and the independent probe used Node.js 24.7.0 and npm 11.5.1.
The initial isolated CLI and kit checks used Node.js 26.9.0.
The browser check used the Codex in-app browser. Chrome was unavailable through the connected browser tool.

| Check and command | Exit | Observed result | Evidence |
| --- | --- | --- | --- |
| `npm test` | 0 | 272 pass, zero failures, zero skips | `unit.log`, `unit-exit.json` |
| `npm run parity -- --json` | 1 | 163/164 pass, 114 exact, 41 skipped | `parity.log`, `parity-exit.json` |
| Independent installed-package CRT probe | 0 | Reproduces max error 80, mean 5.05859375, 89/256 channels above tolerance | `probe.mjs`, `probe.json` |
| Current manifest and GitHub source-tree comparison | 0 | 210 IDs match the port's source inventory | `authority-tree.json`, `authority-and-media.json` |
| Current landscape parameter probe | 0 | Records expected rejection of unsupported `filtering` | `probe.json`, `landscape-current.js`, `authority-diff.json` |
| `npm pack --ignore-scripts --json` | 0 | Candidate contains 104 files | `pack.json` |
| Isolated `npm install --ignore-scripts --no-audit --no-fund <tarball>` | 0 | Local installation succeeds without runtime dependencies | `install.log`, `consumer-checks.json` |
| Installed CLI quick start and two-effect chain | 0 | Two 256×256 PNGs contain 65,349 and 41,700 distinct RGBA colors | `quickstart.log`, `chain.log`, `probe.json` |
| Installed CLI `effect filter/texture --input noise.png` | 0 | Produces a 512×512 PNG through the documented command | `texture.log`, `probe.json` |
| Installed CLI `effect synth/media --input noise.png` | 0 | Loads external PNG and produces output | `media.log`, `media-checks.json` |
| Invalid DSL and missing input file | 1 each | Errors identify the bad effect or missing path. Missing input preserves existing output | `invalid.log`, `missing-input.log`, `media-checks.json` |
| Package-name ESM imports and isolated `npm uninstall` | 0 each | Both public exports load. Rendering succeeds. Removal leaves no installed package | `package-exports.log`, `uninstall.log`, `package-lifecycle.json` |
| Corrected solid-color DSL | 0 | Produces a 16×9 single-color PNG | `recovery.log`, `probe.json` |
| ESM sync/async comparison | 0 | Identical bytes at 37×19, with two scheduler yields. Changing seed changes output | `probe.json` |
| Published kit CLI | 0 | Produces a 64×64 PNG with no package installation | `kit-render.log`, `consumer-checks.json` |
| Existing export-kit builder with reviewed SHA | 0 | All 93 generated files match published inventory hashes | `build.log`, `build-verification.json` |
| `npm view noisemaker-cpu version dist --json` | 1 | Public registry returns E404 | `npm-registry.json` |

The parity gate uses 8×8 frames, time 0.25, seed 1, and `oneShot: 'initial'`.
A frame passes only when every RGBA byte differs by at most 2.
Byte-exact means zero difference across all channels.
The denominator is 164 compared effects plus 41 explicit skips, totaling 205 eligible effects.
The five excluded effects remain outside that eligible denominator.
The 458-choice test renders each choice separately. It checks output length, not a GPU comparison or choice combinations.

The independent CRT probe uses the public installed renderer and the retained GPU PNG.
It calculates channel differences without the repository's comparison helper.
The auditor corrected initial API mistakes in the operational probe only. `probe-development.json` retains those mistakes.

External media output did not equal the input image, even with explicit `imageSize`.
The upstream shader transforms coordinates and flips Y. Input identity is therefore not an established acceptance criterion.
`media-comparison.json` retains the measurements. This audit does not classify them as a port defect or claim external-media parity.

Browser interaction produced visible multicolor output at 256×256 in 883 ms.
Changing size to 128 produced 16,384 pixels in 234 ms.
Invalid DSL displayed its source location and unknown effect name.
Replacing it with a solid program restored visible orange output in 61 ms.
Tab from the editor followed by Enter executed a blue solid program in 53 ms.
These timings are single observations, not performance guarantees.
Six sliders and the DSL editor lacked accessible names in the observed accessibility tree.
Full keyboard catalog navigation, screen readers, cancellation, and long-running recovery remain unverified.
`browser-observations.json` records these steps. Screenshots remain in the audit task's tool output.

The exact-source [Export kit run](https://github.com/noisefactorllc/noisemaker-for-cpu/actions/runs/35752635326) passed.
The [downstream release](https://github.com/noisefactorllc/scaffold/actions/runs/35752659391) passed 84 tests, failed zero, and skipped one test.
The release excluded other-kit suites. The CPU PNG-render test ran without a skip.
These results establish bounded kit delivery, not whole-port parity.
The downstream notification run `35752635480` also passed.

Official references checked on 2026-09-23:

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases): Node 22 and 24 are LTS. Node 26 is Current. Production guidance recommends LTS.
- [npm CLI 11 package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/): `files`, `bin`, and `exports` control distribution contents and entry points.

Native plugin signing, notarization, and ABI checks do not apply to this source-only JavaScript package.
Browser accessibility does apply because the repository supplies an interactive demo.
A public npm release was unavailable. The packed candidate does not substitute for testing a published npm release.

### Daily review evidence, 2026-09-23

Review evidence resides in `review-20260923-01/noisemaker-for-cpu` in the shared store.
The reviewer checked worker parity, package, media, browser observations, source differences, and release logs.
The worker's screenshots remain task-local. The reviewer did not independently inspect them.

`npm run parity -- --json` still exits 1: 163/164 pass, 114 byte-exact, and 41 skips.
The independent public-renderer probe reproduces CRT's maximum difference of 80 and 89/256 channels above tolerance.
Both landscape choices compile and produce finite 8×8 frames. This is execution evidence, not GPU parity.
The schema now contains 460 named define choices. `probe.json` records the extracted count and render results.
The original 458-choice execution result does not establish coverage for the two added choices.

The current parity report labels `sourceRevision` with the new kernel pin, `44bc4ed4`.
No retained golden changed between the worker source and current source.
That report field does not identify the reference-image capture revision. GAP-008 records this evidence boundary.

Kit `0.1.24` contains 93 files. Its three changed files pass fresh inventory hash and length checks.
The other 90 inventory hashes match the previous kit. A fresh compatibility-file download also matches.
[Current source CI](https://github.com/noisefactorllc/noisemaker-for-cpu/actions/runs/35809319614) passed.
[Downstream CI](https://github.com/noisefactorllc/scaffold/actions/runs/35809326430) passed 84 tests and skipped one test.
The staged CPU PNG render ran without a skip. The workflow excluded other-kit suites.
Neither result closes the retained CRT failure or proves the new modes' rendered parity.

The reviewer reconfirmed npm CLI 11 package rules and Node.js 22/24 LTS status from the official references above.
The review did not repeat browser interaction, package lifecycle, Windows/Linux API checks, or saved-program upgrades for current source.
Their qualification remains bounded by the worker's recorded source and environment.

## 4. Known gaps

P1 means false completion or a major correctness gap. P2 means coverage or integration gaps. P3 means documentation inconsistency.
The auditor checked all entries below on 2026-09-23. The 2026-09-26 audit reverified the gate failures and open states at `ba1c89a`. No entry closed.

### GAP-001: CRT pixel mismatch

- Status: blocked (no-GPU environment). Priority: P1. Category: implementation.
- Affected scope: `filter/crt`, its CPU adapter, and the retained parity gate.
- Expected behavior: Every compared channel stays within the existing ±2-byte tolerance.
- Observed behavior: 89 of 256 channels exceed tolerance. Maximum difference is 80. Unchanged at `c2a1d18`.
- Evidence: `parity.log` and `probe.json` (committed at `bb1f4de`; regenerated and byte-compared against the same metrics at the verification commit below), and [CRT-PARITY.md](CRT-PARITY.md).
- Localization (2026-09-26): divergence is isolated to the `fract(sin(x) * 43758.546875)` hash sites of the CRT kernel — 16 distinct scalar inputs (the 4 `random_scalar` call sites' seeds and the 12 distinct `value_noise_3d` corner-hash `dot_value`s feeding the scanline base values). All other candidate sites measured on the fixture: the cosine wrap on top of the metalSine adapter is a measured bit-identical no-op (both sides 89 / 80 / 5.0586; the exact reverted `8debec5` configuration rebuilt through the committed adapter, pinned by the committed three-configuration characterization test); the separately measured 94 / 105 / 5.8633 configuration is plain-sin + metalCosine, a two-variable change whose delta is confounded by the sine variable; fma-contraction emulation is a structural no-op (the CPU runtime rounds every intermediate to f32, so fused and separate ops agree); `dot` rounding variants and `permute`/`mod289` algebraic reorderings are bit-identical no-ops (all intermediate values are exactly representable in f32 for this fixture). A ±4-ULP-per-input greedy search over all 16 distinct hash-site inputs (plain-sin parameterization) does not pass: best alternative 91 over-tolerance channels / max 104 versus the turn-based-reduction baseline 89 / 80.
- Blocked requirement: the retained golden encodes the capture GPU's undocumented transcendental bit-pattern; its capture provenance is unidentified (GAP-008) and this environment is a Linux x86_64 container without GPU, so no candidate implementation can be verified here. Resolution paths: identify the capture backend and its `sin` implementation, re-capture the golden from a reproducible backend ([CRT-PARITY.md](CRT-PARITY.md) path 2), or move the upstream shader to integer hashing (path 3). All change the fixture or upstream and are outside this job's write scope.
- Dependencies: The separate implementation job owns corrections. Preserve the current checkpoint and reference images.
- Acceptance criteria: CRT passes the unchanged fixture. All other 163 compared effects retain their results.
- Required checks: Independent channel comparison, `npm test`, and the full parity command.
- Last verification: 2026-09-26 at `f876711`-tree (identical to `049273b` except this closure-record docs commit; `git diff 049273b..f876711 --stat` shows docs/COMPLETION_GAPS.md only). The three required checks were executed on the `049273b` tree (which contains the same test set, goldens, adapters, and generated kernels): `npm test`: 279 pass, 0 fail, 1 skipped with `NM_REFERENCE_ROOT` at upstream `6a0af04d` (277 pass / 2 skipped without it — the reference-tree manifest test at `test/upstream-source-lock.test.js:71` conditionally skips when the reference checkout is unavailable; the test set includes the three-configuration cos-wrap characterization test, executed as part of this run). Full parity: 163/164 within ±2, 114 byte-exact, 41 skipped. Independent channel comparison (`compareRgba8` against the retained golden, re-executed): `filter/crt` max=80, mean=5.05859375, 89 channels over tolerance. Goldens and tolerances are unchanged.

### GAP-002: Rendered coverage remains incomplete

- Status: open. Priority: P2. Category: verification.
- Affected scope: 41 skipped effects, external media, parameter combinations, stateful execution, image dimensions, seeds, and time.
- Expected behavior: Every declared behavioral scope has source-bound comparisons with explicit exclusions and tolerances.
- Observed behavior: The gate compares only default 8×8 fixtures. Choice smoke checks establish execution, not rendered correctness.
- Evidence: `parity.log`, `probe.json`, `media-comparison.json`, and `test/catalog-smoke.test.js`.
- Next action: Qualify additional external-input effects, dimensions, and skipped effects with the same recorded-source comparison pattern under separate authorization. Preserve goldens.
- Dependencies: Preserve the current parity checkpoint. Do not add effects or regenerate goldens during this audit.
- Acceptance criteria: Record CPU and authority outputs, source revisions, dimensions, and channel metrics for the same input.
- Required checks: Public CLI and ESM entry points, sync/async equality, and unchanged existing parity fixtures.
- Remaining coverage: Multi-frame state, long renders, cancellation, and wider parameter combinations require separate qualification.
- Last verification: 2026-09-26. One bounded external-input comparison defined and executed against the retained authority; see the compatibility report. CPU output and upstream WebGL2 output are byte-exact for the same 37×19 asymmetric input. The 41 parity-gate skips, CRT failure, and remaining coverage above are unchanged; this closes the acceptance criterion for this single bounded case only, not the gap's broader scope.

### GAP-003: Updated landscape modes lack authority pixel evidence

- Status: blocked (authority transcendental divergence; no-GPU environment). Priority: P2. Category: authority.
- Affected scope: `render/renderLandscape3d`, compiler schemas, and generated kernels.
- Expected behavior: Completion claims identify whether they target the recorded pin or current upstream.
- Historical behavior: the audited source rejected `filtering` choices `isosurface` and `voxel`.
- Current behavior: source `16c38245` accepts both choices and renders finite frames under pin `44bc4ed4`.
- Blocked requirement: the perspective comparisons fail the unchanged ±2 gate at exactly one pixel `(46, 75)` in all three modes (max 78, 3 bytes over), and the measured root cause is the authority backend's transcendental bit pattern: SwiftShader's uniform-operand vectorized `cos`/`sin` differ from CPU libm f32 rounding by ~1e-5 to 4e-5 relative, which closes the 0.0043-wide grazing gap of the divergent ray. Ortho (trig-free) passes byte-exact for default/voxel and at max error 1 for isosurface. Bit-matching a software rasterizer's JIT approximation is not a legitimate CPU-port fix, and other GPUs could resolve the pixel either way. Resolution paths: qualify against a real-GPU authority, or re-capture from a reproducible backend — both outside this job's write scope. Ortho and perspective results are recorded separately in the compatibility report and `landscape-authority-comparison.json`.
- Evidence: `landscape-current.js`, `authority-diff.json`, and `probe.json`; the bounded authority comparison in the [compatibility report](COMPATIBILITY.md) and `landscape-authority-comparison.json`.
- Next action: qualify the six-case comparison against a real-GPU authority once one is available; if the grazing pixel matches there, re-run the gate for full closure.
- Dependencies: retain the completed source update. Establish reference provenance under GAP-008 before accepting new rendered parity.
- Acceptance criteria: default, voxel, and isosurface frames satisfy a declared unchanged comparison gate. Record orthographic and perspective results separately.
- Required checks: `node --test test/volume-effects.test.js`, public rendering, and independent authority comparisons. Finite-pixel checks alone cannot close this gap.
- Last verification: 2026-09-26 at `7145223b` against authority `44bc4ed4` (live upstream source; the four involved effect sources are identical to the port's pin `6a0af04d`, empty `git log 44bc4ed4..6a0af04d` over them). Required checks executed: `node --test test/volume-effects.test.js` 9 pass / 0 fail; public rendering via ESM `CpuRenderer` and CLI `bin/noisemaker-cpu.js` byte-identical for all six programs; independent authority comparison via upstream `CanvasRenderer` on WebGL2 (SwiftShader Chromium 153, o0 readback twice byte-identical). Fixture 96×80, time 0, seed 1, upstream parity-case parameters (testPattern gradient/colorBars, volumeSize x32, heightScale 0.6, baseHeight 0.1, rotateX 0.62, rotateY 0.5, posY 12). Results: ortho — default/voxel byte-exact, isosurface max 1 (12 bytes), 0 over ±2, pass; perspective — max 78 at pixel `(46,75)` plus one level-1 byte at `(37,66)`, 3 bytes over ±2 in every mode, fail. Default≡voxel byte-identical on both sides. Divergence root cause measured in situ (uniform-vec3 trig bytes 114/255/161/236 vs libm 105/250/164/238; direction reconstruction reproduces the flip). Existing gate unchanged after the run: 163/164, 114 byte-exact, 41 skipped, `filter/crt` max 80. GAP-003 is blocked, not closed; see the compatibility report's scope limits.

### GAP-004: Parity summary is stale

- Status: closed. Priority: P3. Category: contract.
- Affected scope: README Collection parity, the CRT status narrative, docs/EFFECTS.md parity status, and parity-runner comments.
- Expected behavior: Current summaries distinguish historical measurements from the current catalog denominator.
- Observed behavior: README reported 166/167 and 117 exact as current. Current measurements are 163/164 and 114 exact.
- Current check: `README.md:157`, `docs/CRT-PARITY.md:62`, `docs/EFFECTS.md:88`, and the `scripts/parity/run.js` gate comment carried 166/167 with 117 byte-exact at source `ba1c89a`.
- Evidence: `parity.log`, README, and [CRT-PARITY.md](CRT-PARITY.md).
- Resolution: README Collection parity, the CRT constraint, docs/EFFECTS.md parity status, and the parity-runner comment now state the current result as 163/164 with 114 byte-exact over 164 compared goldens plus 41 explicit skips (205 eligible effects total), and attribute the historical 166/167 with 117 byte-exact to the smaller pre-sync catalog pinned at `f1d2b46` (published 2026-09-19), before upstream retired `filter/bc`, `filter/colorspace`, and `filter/hs`. No coverage, tolerance, fixture, or gate behavior changed; the runner comment now counts the 41 skips as 21 CPU-divergent plus 20 ported volume/loop effects.
- Dependencies: Used this audit's recorded source and raw result. Coverage was not reduced; the three retired effects were removed by upstream between `f1d2b46` and the current pin, not by this change.
- Acceptance criteria: Current counts total 205 eligible effects (verified: 164 executed + 41 skipped = 205 registry entries). Historical counts carry their source revision or date (`f1d2b46`, 2026-09-19).
- Required checks: Full parity output and a catalog-to-fixture comparison.
- Last verification: 2026-09-26 at the publication commit carrying this row (parent `12db707`; docs plus the runner comment only — no functional source, fixture, golden, or test change). Required checks executed: `npm run parity -- --json` exits 1 as recorded under GAP-001: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision 6a0af04d` — identical to the audit's recorded raw result. Catalog-to-fixture comparison: default registry lists exactly 205 eligible effects; all 41 skipped effects have compile-passing fixtures (`parity/upstream-defaults/`), and all 164 executed effects have pinned goldens in `parity/goldens/{defaults,classic}`; 164 + 41 = 205. Historical re-verification in a scratch clone at `e23324e` (which pins `f1d2b46`): parity measured 166/167, 117 byte-exact, 41 skipped, `filter/crt` max 80 — the historical figures reproduce at their recorded revision.

### GAP-005: Release CI does not enforce port parity

- Status: open. Priority: P2. Category: verification.
- Affected scope: Exact-source validation before kit publication.
- Expected behavior: Release claims distinguish delivery checks from the port's execution and parity gates.
- Observed behavior: Existing workflows dispatch releases and notifications. The downstream builder renders a PNG but does not run port parity.
- Evidence: `.github/workflows/export-kit.yml` and `.github/workflows/downstream.yml` (the only workflows in the repository); complete job logs downloaded from the GitHub Actions API for reviewed SHAs (run IDs below). The prior citation `downstream-ci.log` matches no file in the repository or its history and is removed.
- Required release-record definition (record format the existing release system must meet). A release record for this port is bound to one exact source SHA and must identify:
  1. Exact-source port test results: the executed command (`npm test`, node --test) with pass/fail/skip counts at that SHA.
  2. Parity gates: the full `npm run parity` outcome — per-failure effects with error figures, complete skip accounting (each of the 41 skips attributed), and the honest GAP-001 red result carried, not bypassed or re-toleranced.
  3. Package checks: built/served kit provenance at that SHA (version, `git_hash`) and artifact verification (served-file SHA-256 comparison against the tree, package metadata).
  4. CI evidence: every workflow run inspected at that SHA by complete job logs, labeled delivery-only (dispatch/notify). A dispatch success or a `gh workflow run` URL is never recorded as execution evidence.
  The pass-history rows below already carry fields 1–3 and their CI columns record delivery dispatches as delivery; the definition above makes the required record explicit. No repository workflow enforces any of these fields today, so the criterion remains unmet at the workflow level and records are produced by documented audit passes.
- Next action: Remaining work requires workflow authority (separately authorized implementation): add an exact-source workflow that executes the unit suite, the full parity gate, and package checks at the release SHA and fails the release on red parity. Until then, follow the release-record definition above.
- Dependencies: GAP-001 remains an honest red parity result. Workflow changes belong to separately authorized implementation work.
- Acceptance criteria: A release record identifies exact-source port test results, parity failures, skips, and package checks.
- Required checks: Inspect complete job logs for the reviewed SHA. Do not infer execution from a dispatch success.
- Last verification: 2026-09-26. Complete job logs downloaded and read (not inferred from dispatch success): Downstream run 36274527704 at reviewed SHA `901bbd9` — the single `notify` job only mints an App token and posts a repository dispatch to `noisefactorllc/tearoff`; no checkout, test, build, or parity step exists. No Export kit run occurred at `901bbd9` (its changed files match no `export-kit.yml` push path). Export kit run 36205713332 at `bfbe547` — the single `dispatch` job only calls `gh workflow run export-kit-release.yml --repo noisefactorllc/scaffold` and prints scaffold run URL 36205721058; the scaffold repository is not readable with this job's credentials, so the downstream builder's logs remain uninspected here. This corrects the prior claim that the docs-only SHA triggered no runs: `901bbd9` also touched `scripts/parity/run.js`, which matches no `paths-ignore` entry of `downstream.yml`, so the notify dispatch fired. Confirmed from workflow sources and complete logs: no workflow runs the port gates.

### GAP-006: Distribution and platform qualification are incomplete

- Status: open. Priority: P2. Category: release.
- Affected scope: npm candidate, published kit, documentation, supported runtimes, and upgrades.
- Expected behavior: Developers can identify the distribution path, install it, use its documentation, and understand supported environments.
- Observed behavior: Kit delivery and local package installation work. The public npm name returns E404.
- Observed behavior (resolved 2026-09-27): the README opened with checkout-relative commands, and the packed README linked to `docs/CRT-PARITY.md`, `docs/COMPATIBILITY.md`, `docs/COMPLETION_GAPS.md`, and `docs/hero.jpg`, which the package omitted. The README now documents the supported distribution path (the `noisemaker-cpu` npm package, with the GitHub install as the documented interim path while the name is unpublished), uses installed-package commands with an explicit checkout note, and the package ships every README link target.
- Evidence: `pack.json`, `npm-registry.json`, `consumer-checks.json`, and `kit-verification.json`.
- Next action: Publish the `noisemaker-cpu` package (requires publication authority; do not publish as an audit probe), then qualify Windows and a declared browser support floor.
- Dependencies: Preserve npm unavailability as a scope limit. Do not publish a package as an audit probe.
- Acceptance criteria: A clean consumer can install, render, recover, remove, and upgrade the documented distribution without hidden repository files.
- Required checks: Node 22 floor, supported LTS versions, Windows/Linux, declared browsers, and saved-program upgrade behavior.
- Limits: Linux CI proves one kit render. It does not qualify the full API. macOS checks cover only the recorded runtimes. Windows and a declared browser floor remain unqualified: this environment is Linux-only, and the README declares no specific browser versions to test against.
- License checks: The kit contains both MIT notices. No native binary signing requirement applies.
- Last verification: 2026-09-27 at the publication commit carrying this row (parent `9683091`; README, package.json `files`, and link-syntax normalization in the two shipped audit documents — no functional source, test, golden, or workflow change). Red-before: a pack of the unmodified base produced 104 files with four missing README link targets (`docs/CRT-PARITY.md`, `docs/COMPATIBILITY.md`, `docs/COMPLETION_GAPS.md`, `docs/hero.jpg`). Candidate pack: 114 files; all 11 relative README references resolve, and a scan of every relative reference in all 7 shipped markdown files finds 25 references with none broken (the only cross-file entries are two heading anchors into the shipped `docs/COMPLETION_GAPS.md`, whose target file exists; the previously shipped-but-unresolvable `../evidence/…` and `../landscape-authority-comparison.json` links now ship their targets via `docs/evidence/` and `landscape-authority-comparison.json`, and the historical `/Users/alex/…` shared-store paths in those two documents were never resolvable links and are now plain text). No repository-only files (`scripts/`, `bench/`, `parity/`, `probe.json`, `.github/`, `.gitignore`) ship. Clean-consumer lifecycle on Linux x86_64 (Node 26.5.1): `npm install github:noisefactorllc/noisemaker-for-cpu` from an empty directory installs the CLI with zero runtime dependencies; `noisemaker-cpu render` renders a saved DSL program; an invalid DSL program exits 1 with `Unknown effect "notAnEffect"` and a corrected program renders; upgrading the installation and re-rendering the saved program reproduces byte-identical output (SHA-256 `a15f1d4510e15657362ce07dc6df1ce573d0705c2ad8ea5962f93181e937ef2e` before and after); `npm uninstall` removes the package and its bin. Node floor and LTS: clean GitHub installs at Node 22.20.0 and 24.10.0 both render the same saved program byte-identically and load the ESM exports (`CpuRenderer`, `createDefaultRegistry`, `compileCsl`). Bounded browser check: headless system Chromium served the installed package root; the demo's engine module graph (`src/**`) loaded over HTTP 200 and the demo app initialized (`app-container` displayed). `npm test` at the candidate tree: 278 pass / 0 fail / 2 skipped (both environment-gated without `NM_REFERENCE_ROOT`). Served kit `0.1.33` is unchanged and still tracks the functional source. The public npm name still returns E404 (registry HTTP 404 on 2026-09-27).

### GAP-007: Browser controls lack accessible names

- Status: closed. Priority: P2. Category: usability.
- Affected scope: Browser demo sliders and DSL editor.
- Expected behavior: Assistive technology can identify each editable control's purpose.
- Observed behavior: Six sliders expose values without names. The DSL editor also has no accessible name.
- Evidence: `browser-observations.json` and the audit task's accessibility snapshots.
- Resolution (2026-09-27): every editable control in `examples/browser/` now carries a distinct accessible name. Generated param rows apply the visible param label as `aria-label` on the widget (and on the inner native `<input type="range">` that handfish `<slider-value>` renders in light DOM, which is the element the accessibility tree exposes); vector params name each component input `<param> x/y/z/w`. Static controls: `size` select, `seed` input, `Random seed` button, `time` slider, `dsl program` editor, `code`/`run`/`back to pipeline` buttons, the `generator effect` and `add filter effect` dropdowns, and the vendored `<effect-select>` trigger and `<toggle-switch>` track now propagate host labels. Visual label spans are `aria-hidden` so screen readers announce the name once. The audit previously listed handfish color-picker dialog close buttons as duplicates; those dialogs render on demand inside the library widget, not in demo markup, and are out of demo scope.
- Dependencies: Browser and handfish control behavior must remain consistent. The separate implementation job owns changes.
- Acceptance criteria: Each slider and editor exposes a distinct, accurate name. Keyboard changes remain functional.
- Required checks: Accessibility tree inspection, keyboard execution, invalid-input recovery, and a screen-reader pass.
- Last verification: 2026-09-27 at the candidate carrying this row (base `b61b658`). Headless Chromium 154 CDP audit of the served demo (harness outside the repo): red-before at `b61b658` — all six effect sliders plus the time slider and DSL editor unnamed in the accessibility tree (`slider`/`switch` names empty; screen-reader pass lists 8 unnamed inputs/textarea). Candidate — Chromium AX tree names every control: sliders `octaves`, `scaleX`, `scaleY`, `loopScale`, `speed`, `time`; switches `wrap`, `ridges`; buttons `type`, `loopOffset`, `colorMode`, `generator effect`, `add filter effect`, `Show the generated DSL`, `Random seed`; combobox `size`; spinbutton `seed`; textbox `dsl program`. Screen-reader-style name pass: 23/23 editable controls named, all distinct. Keyboard: click focuses the slider input, ArrowRight changed the value 0.5 → 0.51 and re-rendered; Tab traversal reaches each named control in order. Invalid-input recovery: `notAnEffect` DSL shows `<dsl>:2:1: Unknown effect "notAnEffect"` as an error status; the corrected solid program re-renders (`1 passes · 65,536 px`). `npm test` at the candidate: 281 pass / 0 fail / 2 skipped (both environment-gated without `NM_REFERENCE_ROOT`), including the new `controlAriaLabel` unit tests covering every registry param. Render and recovery workflows from the original observation remain demonstrated.

### GAP-008: Parity reports do not identify golden provenance separately

- Status: closed. Priority: P2. Category: verification.
- Affected scope: `scripts/parity/run.js`, retained reference images, and source-bound parity claims.
- Expected behavior: reports identify candidate source, kernel authority, and reference-image provenance separately.
- Observed behavior: `sourceRevision` follows the generated kernel pin. It changed to `44bc4ed4` while all retained golden files remained unchanged.
- Evidence: `parity.log`, source comparison, and `scripts/parity/run.js:138` in the reviewed source.
- Resolution (2026-09-27 at the publication commit carrying this row, base `f0ccebe`): `scripts/parity/run.js` now reports reference-image provenance separately from the candidate pin. Every JSON comparison carries a `reference` block (`image` path, actual `sha256`, `captureRevision`, `provenance` `recorded`|`unknown`); the summary adds `results` and a `referenceProvenance` aggregation, and the text report prints `Reference provenance (GAP-008): 0 recorded, 164 unknown …`. `sourceRevision` remains the generated kernel pin and is structurally distinct from the reference fields. Provenance data lives in a committed map `parity/goldens/provenance.json` (regenerated by `scripts/parity/write-provenance.js`): all 172 retained goldens record their `sha256`, size, and introducing commit `36fbfac07be5a9a10b7a991209b566be3f54fe6e` (the bulk vendor sync) with `captureRevision: null` — no capture record (GPU session, host revision, authority backend) exists for any retained golden, so each comparison shows the visible unknown-provenance marker. Kernel updates cannot relabel reference captures: the gate recomputes each golden's sha256 and hard-fails on a mismatch with the provenance record (a regenerated golden cannot pass until its capture record is regenerated and its capture revision identified), and `captureRevision` is only ever set from an explicit capture record, never from `UPSTREAM_REVISION`. New tests: `test/parity-golden-provenance.test.js`.
- Dependencies: preserve the reference images and tolerances. Implementation owns any report-format correction. (Both preserved: no golden or tolerance change.)
- Acceptance criteria: each comparison has an explicit reference revision or a visible unknown-provenance marker. Kernel updates cannot relabel reference captures.
- Required checks: compare `git diff` for `parity/goldens` across the two source SHAs. Check recorded hashes against capture evidence.
- Last verification: 2026-09-27 at the candidate. `git log --oneline -- parity/goldens` shows the only commit ever touching the goldens is `36fbfac`; `git diff 36fbfac..candidate -- parity/goldens` is empty (goldens unchanged across every source-revision change, including the `44bc4ed4`→current pin moves). Recorded manifest hashes byte-match all 172 files (sha256 recomputed in the test). Capture-evidence cross-check: no capture record exists anywhere in the repository or its docs, so the honest mapping is `captureRevision: null` / provenance `unknown` for every golden — the capture identity (including the CRT golden's GPU transcendental bit pattern, GAP-001) remains unidentified and is now visibly marked instead of silently unlabeled.

## 5. Ordered next actions

Current first action: Reproduce filter/crt with node scripts/parity/run.js --json before implementation. After repair, rerun the same gate with unchanged tolerances and authority inputs. Account separately for all 41 skips and the five missing effects. Do not close full parity until every required case executes and matches.
Subsequent historical actions remain dependent on that evidence. No implementation is authorized by this audit.

1. Preserve this source checkpoint and all raw evidence. Review GAP-001 before any broad completion statement.
2. Diagnose `src/effects/adapters/crt.js` under the retained fixture. Run `npm run parity -- --only filter/crt --json`.
   Require zero channels above the existing tolerance of 2. Then require all 164 comparisons to pass without changing the 41 skips.
3. Establish golden provenance under GAP-008. Then qualify the existing landscape modes under GAP-003 and external inputs under GAP-002.
   Record candidate and authority hashes, dimensions, seed, time, input bytes, and comparison metrics for each bounded case.
4. Correct stale summaries under GAP-004 through separately scoped documentation work. Preserve historical measurements.
5. Define existing-system release checks under GAP-005. Do not bypass the red parity result.
6. Qualify the documented artifact under GAP-006. Check package metadata, required documents, installation, removal, upgrades, and supported platforms.
7. Qualify accessible browser controls under GAP-007. Preserve the demonstrated render and recovery workflows.

These actions describe required follow-up evidence. They do not authorize implementation, effect ports, or advancement beyond the current parity checkpoint.

## 6. Pass history

Worker audit on 2026-09-26 at `ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5`: reran the full gate and bounded usability checks. All eight gaps remain open. No closure claimed. New published authority `1.0.184` at `9574362` is unqualified and recorded as pending.
Daily review on 2026-09-25 at `6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85`: source freshness and bounded evidence reviewed. Open qualification limits retained. Retained review evidence in the shared automation store. No new closure claimed.

| Date | Source SHA | Changes | Tested scope | Remaining limits |
| --- | --- | --- | --- | --- |
| 2026-09-23 | `36fbfac07be5a9a10b7a991209b566be3f54fe6e` | Created this register and added its README link. No implementation changes | 272 unit tests. 164 parity comparisons. 41 skips. Independent CRT probe. CLI/ESM and browser checks. 93 kit hashes. Build reproduction. Exact-source CI | Seven open gaps. No release approval or parity-checkpoint advancement |
| 2026-09-23 | `16c38245c42030c8ee46dc61108791d2fea4bda9` | Corrected stale landscape rejection and choice count. Added GAP-008 and executable CRT acceptance. | Repeated full parity and independent CRT comparison. Probed both landscape modes. Checked worker evidence, changed kit files, and exact-source CI. | Eight gaps remain. No closures. Current host, broad pixel, and platform qualification remains incomplete. |
| 2026-09-26 | `3ec3fe1270b8fc1f527938c71425929a7d58e1b6` (adds this row on top of merge `b644b468` of remote sync `bfbe5476`) | Register pass-history row added; functional tree otherwise unchanged from remote sync `bfbe5476`, which pins upstream `8eeb7b5ac14eb37a8d16037f607a88ce63924cd3` with manifest digest `7382c8ccee81a540d48e1298911d6960de9b2970817a0709ef1da58ab99567a8`. Ancestry check against a fresh upstream clone proves `9d3474dfdc6cb737ebb7b2f3598b16d940af1544` (this job's originally required end) is an ancestor of `8eeb7b5ac14e`, so the pin covers the required range; the four upstream `shaders/` commits in `9d3474df..8eeb7b5a` (GAP-005 pass fields, GAP-004 mipmaps/persistent/filter texture policies, allocation fixes) were ported by `bfbe5476` (snapshot, CpuRenderer viewport resolution, new render-graph test). Earlier in this job, candidate `41b92689` regenerated kernel artifacts with per-record `sourceSha256` and added the checkout-free manifest/coverage tie-in test while pinning `9d3474dfdc6c`; the later remote sync superseded that pin state. No effect behavior, tolerances, or goldens changed in the register row | Executed at `3ec3fe12` with `NM_REFERENCE_ROOT` at upstream `8eeb7b5a`: `npm test` (node --test) 278 pass / 0 fail / 1 skip (the second environment-gated test runs and passes with the reference root); `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` 8 pass / 0 fail / 0 skip, including the reference-tree manifest cross-checks that are skipped without `NM_REFERENCE_ROOT`. `npm run parity` exits 1 as recorded under GAP-001: 163/164 within ±2, 114 byte-exact, 41 skipped, filter/crt max 80 — unchanged, no gap closure. Exact-source CI at `41b92689` (export-kit 36204154657, downstream 36204154669) succeeded as delivery dispatches; the repo has no workflow that runs the unit suite, so the suite evidence above is the locally executed run | No gap closures claimed. GAP-001 CRT failure and the other seven gaps remain as recorded. Full rendered parity remains unverified |
| 2026-09-26 | `ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5` | Audit-only register and report update. No implementation change | `npm test` 278 pass, 0 fail, 1 skip with the pinned reference tree. Full parity gate exit 1: 163/164, 114 exact, 41 skips, CRT max 80. CLI quick start, chain render, and two error paths. Served kit `0.1.32` file checks. Fleet inventory and exact-source dispatch review | Eight gaps remain open. New authority `9574362` (`1.0.184`) unqualified. No browser, GPU, or platform checks this pass |
| 2026-09-26 | `a1801be` (this row) | Source-lock sync through upstream `6a0af04d3c4f` (job range end; proven descendant of prior pin `8eeb7b5a` and of range start `fca611fd`): pin, digest, manifest, snapshot, README/EFFECTS/inventory-test revision refs. Effect catalog byte-identical to the prior pin (205 eligible, five exclusions unchanged). Range's `shaders/src` commits (`6113da00` texture-pooling consumption, `95743621` viewport-without-clear pooling safety, `f83a427e` backend diagnostic union) are GPU pipeline/backend-only; the CPU renderer keeps one surface per virtual texture and has no WebGL2/WebGPU backends, so no CPU behavioral change applies | Executed at `a1801be` with `NM_REFERENCE_ROOT` at upstream `6a0af04d`: `npm test` 278 pass / 0 fail / 1 skip; `npm run parity -- --json` exit 1: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max error 80, mean 5.05859375 — identical to the prior pass; `sourceRevision` now `6a0af04d`, goldens unchanged. Re-executed at the published candidate `d03aed7b` (docs-only commits `f935c34`/`d03aed7` between them): `npm test` 278/0/1; source-lock+inventory tests 8/0/0 with the reference root; parity unchanged. Served kit `0.1.33` reports `git_hash d03aed7b`; served `engine/src/index.js` and `engine/bin/noisemaker-cpu.js` sha256-match the candidate tree | No gap closures claimed. GAP-001 CRT failure and the other seven gaps remain open; rendered parity for the new pin is unqualified under GAP-002/GAP-008 |
| 2026-09-26 | `4b590d2` (this row's published parent; this row) | Register pass-history row plus GAP-002 verification bullets and compatibility-report section. Documentation-only on top of `4b590d2` | Executed at `4b590d2` (tree identical to `ea198510` for `src/`, `bin/`, `scripts/`, `parity/goldens`, `export-kit`, and `package.json`; the intermediate CRT-adapter change was reverted at `c0d53d0`) with `NM_REFERENCE_ROOT` at upstream `6a0af04d`: `npm test` 279 pass / 0 fail / 1 skip; source-lock+inventory tests 0 fail / 0 skip; full parity gate exit 1 unchanged: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision` `6a0af04d`. Bounded external-input comparison (GAP-002): CPU and upstream WebGL2 byte-exact on the same 37×19 asymmetric input | GAP-002's single bounded case is recorded; its broader scope and the other seven gaps remain open. No effect, golden, or tolerance change |
| 2026-09-26 | `7145223b` (this row's base; the publication commit carrying this row follows it) | GAP-003 bounded landscape authority comparison recorded: GAP-003 row blocked with measured root cause, C-004 update, compatibility-report section, and `landscape-authority-comparison.json` evidence artifact. Documentation plus one JSON evidence file; no code, golden, or tolerance change | Executed at `7145223b`: `node --test test/volume-effects.test.js` 9 pass / 0 fail; `npm test` 278 pass / 0 fail / 2 skipped; public CLI and ESM rendering byte-identical for all six landscape programs; full parity gate exit 1 unchanged: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, `sourceRevision` `6a0af04d`. Bounded landscape authority comparison (GAP-003): CPU at `7145223b` vs upstream Noisemaker `44bc4ed4` `CanvasRenderer` WebGL2 (SwiftShader Chromium 153), 96×80, time 0, seed 1, upstream parity-case parameters; authority readbacks executed twice byte-identical. Ortho: default/voxel byte-exact, isosurface max 1, 0 over ±2 — pass. Perspective: one pixel `(46,75)` diverges in every mode (max 78, 3 bytes over ±2, plus one level-1 byte at `(37,66)`) — fail. Root cause measured in situ: SwiftShader uniform-vec3 cos/sin differ from libm f32 (~1e-5..4e-5 relative), closing the 0.0043 grazing gap; reconstruction reproduces the flip | GAP-003 blocked (authority transcendental divergence; ortho passes, perspective cannot bit-match the software rasterizer in this environment); the other seven gaps remain open. No effect, golden, or tolerance change |
| 2026-09-26 | `901bbd98eda0cd5a63f94ed83f5c66d285b5dbe5` (this row's base; the publication commit carrying this row follows it) | GAP-005 record: defined the required release-record format (exact-source unit results, per-failure parity outcome with full skip accounting, package/served-kit checks, CI evidence labeled delivery-only from complete job logs), corrected stale evidence (`downstream-ci.log` never existed; the docs-only SHA `901bbd9` did fire the Downstream notify because it touched `scripts/parity/run.js`), refreshed the header's served-kit line to `0.1.33`/`d03aed7b`. Documentation-only; no code, workflow, golden, or tolerance change | Executed at `901bbd9` (src/ and bin/ unchanged since `d03aed7b`): `npm test` 278 pass / 0 fail / 2 skipped (both environment-gated without `NM_REFERENCE_ROOT`); `npm run parity -- --json` exit 1 as recorded under GAP-001: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision` `6a0af04d`, goldens unchanged. Complete job logs downloaded from the Actions API: Downstream run 36274527704 at `901bbd9` (notify-only delivery dispatch), Export kit run 36205713332 at `bfbe547` (dispatch-only; scaffold run 36205721058 not readable with these credentials). Package check: served kit `0.1.33` reports `git_hash d03aed7b`; served `engine/src/index.js` sha256 `222f58d4ce1f046c98207175b906b072ea4801a5d94a9c40c5b9ddeaf4d9f7a8` and `engine/bin/noisemaker-cpu.js` sha256 `96d09295c0292a68478fc0c22872d8ea56ac8209cf7ff8182fe2ad8629a36cd4` match the tree | No gap closures claimed. GAP-005 stays open: the release-record definition is recorded, but no repository workflow enforces it; GAP-001 CRT failure and the other seven gaps remain as recorded |
| 2026-09-27 | `7443f6e6` (this row's base; the sync and this row share this single commit) | Source-lock sync through upstream `7443f6e6` (proven descendant of prior pin `6a0af04d` via `git merge-base --is-ancestor`): pin, digest, manifest, snapshot, README/EFFECTS/inventory-test revision refs, plus this row and a compatibility-report range-audit section. Effect catalog byte-identical to the prior pin (205 eligible, five exclusions unchanged; `shaders/effects` diff empty). Range's only `shaders/src` commit (`403c2a4b`, GAP-008) adds a prediction/preflight layer to the upstream DSL `replaceEffect` mutation APIs, which the CPU port does not contain; the other four `shaders/` commits are upstream harness/tests-only. No CPU behavioral change applies | Executed with `NM_REFERENCE_ROOT` at upstream `7443f6e6`; committed machine-checkable evidence (per-commit range audit, blob identities, command exit codes, log SHA-256s, verbatim logs) at `docs/evidence/source-lock-sync-6a0af04d-7443f6e6-audit.json` and `docs/evidence/source-lock-sync-*.log|json`: `npm test` 279 pass / 0 fail / 1 skip; `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` exit 0 including the reference-tree manifest cross-checks; kernel regeneration produced no diff. Parity gate re-executed at this commit: `npm run parity -- --json` exit 1 as recorded under GAP-001 (163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80) — unchanged, no gap closure | No gap closures claimed. GAP-001 CRT failure and the other seven gaps remain open; rendered parity for the new pin is unqualified under GAP-002/GAP-008 |
| 2026-09-27 | `96830911b14c9c3f8398aa782e11ab8e6ea6a458` (this row's base; the publication commit carrying this row follows it) | GAP-006 distribution pass: README Install section defining the supported distribution path (the `noisemaker-cpu` npm package, with `npm install github:noisefactorllc/noisemaker-for-cpu` as the documented interim path while the name is unpublished), Quick start / Browser API / CSL examples rewritten to installed-package commands with explicit checkout notes, package.json `files` extended to ship `docs/hero.jpg`, `docs/COMPATIBILITY.md`, `docs/CRT-PARITY.md`, `docs/COMPLETION_GAPS.md`, `docs/evidence/`, and `landscape-authority-comparison.json` so every packed link resolves, and the unresolvable `/Users/alex/…` shared-store markdown links in the two shipped audit documents converted to plain text. README, package.json, and those two documents only; no functional source, test, golden, tolerance, or workflow change | Executed at the candidate tree: red-before pack of the base = 104 files with 4 missing README link targets; candidate pack = 114 files; all 11 relative README references resolve; full scan of the 7 shipped markdown files: 25 relative references, none broken. Clean-consumer lifecycle (Linux x86_64, Node 26.5.1): GitHub install from an empty directory, render, invalid-DSL exit 1 with a clear `Unknown effect` message, corrected-program recovery, upgrade with the saved program re-rendering byte-identically (SHA-256 `a15f1d4510e15657362ce07dc6df1ce573d0705c2ad8ea5962f93181e937ef2e`), `npm uninstall` clean. Node 22.20.0 and 24.10.0 (LTS): same install path, byte-identical render, ESM exports load. Bounded headless-Chromium check: installed package demo loads the full engine module graph over HTTP 200 and initializes. `npm test` at the candidate: 278 pass / 0 fail / 2 skipped (both environment-gated without `NM_REFERENCE_ROOT`); parity not re-run — `src/`, `bin/`, `scripts/`, `parity/` untouched by this change | GAP-006's distribution-path and in-artifact documentation criteria are now evidenced; the gap stays open: the npm package is unpublished (E404 preserved, no probe publish), and Windows plus a declared browser floor remain unqualified. No other gap changed |
| 2026-09-27 | `7443f6e6` (this row's base; the publication commit carrying this row follows it) | Source-lock sync through upstream `12b4d74f` (proven descendant of prior pin `7443f6e6` via `git merge-base --is-ancestor` exit 0 in a fresh full clone; the job's force-push flag is covered by ancestry of the consolidated endpoints `403c2a4..12b4d74f`): pin, digest, manifest, snapshot, README/EFFECTS/inventory-test revision refs, plus this row and a compatibility-report range-audit section. Effect catalog byte-identical to the prior pin (205 eligible, five exclusions unchanged; `shaders/effects` diff empty; canonical-kernel regeneration produced no diff). Range's only `shaders/src` commit (`12b4d74f`, GAP-016) adds `shaders/src/runtime/preflight.js` and refactors `Pipeline.mrtFormatBytes`/adds `Pipeline.preflight()` — static GPU-backend device-capability prediction (WebGL2/WebGPU source authorability, `maxDrawBuffers`, `maxColorBytesPerSample` MRT demotion, `maxTextureSize` clamps) the CPU port has no equivalent of (no GPU backends, no device-limit path); `c2252f0c` (GAP-015) and `e73a44a3` (GAP-014) are upstream harness/tests-only and `132d1bf9` touches no `shaders/` paths. No CPU behavioral change applies | Executed with `NM_REFERENCE_ROOT` at upstream `12b4d74f`; committed machine-checkable evidence (per-commit range audit with upstream tree SHAs, blob identities of the two changed `shaders/src` files, command exit codes, log SHA-256s, verbatim logs) at `docs/evidence/source-lock-sync-7443f6e6-12b4d74f-audit.json` and `docs/evidence/source-lock-sync-*.log|json`: `npm test` 279 pass / 0 fail / 1 skip; `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` exit 0 (8/8, 0 skip, reference-tree manifest cross-checks run and pass). Parity gate re-executed at this commit: `npm run parity -- --json` exit 1 as recorded under GAP-001 (163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision` `12b4d74f`) — unchanged, no gap closure | No gap closures claimed. GAP-001 CRT failure and the other seven gaps remain open; rendered parity for the new pin is unqualified under GAP-002/GAP-008 |
| 2026-09-27 | `12b4d74f` (this row's base; the sync and this row share this single commit) | Source-lock sync through upstream `93229933` (proven descendant of prior pin `12b4d74f` via `git merge-base --is-ancestor` exit 0 in a fresh full clone; the job's force-push flag is covered by ancestry — the observed trigger range `8fe3ccaf..93229933` is a contiguous suffix of the audited range, `8fe3ccaf` being the direct child of the prior pin and parent of the tip): pin revision only in `source-lock.js`, `pinned-source-manifest.json`, `upstream-snapshot.js`, plus README/EFFECTS/inventory-test revision refs, plus this row and a compatibility-report range-audit section. Effect catalog byte-identical to the prior pin (205 eligible, five exclusions unchanged; `shaders/effects` and `shaders/src` diffs both empty; canonical-kernel regeneration produced no diff). `PINNED_SOURCE_DIGEST` and `PINNED_SOURCE_MANIFEST_DIGEST` are recomputed from the fresh `93229933` checkout and byte-match the committed constants — the unchanged digests are a proven property of the range, not stale self-attestation. Range's only `shaders/` commit (`93229933`, GAP-017) touches only `shaders/tests/` (definition-schema introspection, harness `--describe` mode, regressions); `ec457c2e` and `8fe3ccaf` touch no `shaders/` paths. No CPU behavioral change applies | Executed with `NM_REFERENCE_ROOT` at upstream `93229933`; committed machine-checkable evidence (per-commit range audit with upstream tree SHAs, recomputed digest cross-check, blob identities of the three changed `shaders/tests` files, command exit codes, log SHA-256s, verbatim logs) at `docs/evidence/source-lock-sync-12b4d74f-9322993-audit.json` and `docs/evidence/source-lock-sync-*.log|json`: `npm test` 279 pass / 0 fail / 1 skip; `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` exit 0 (8/8, 0 skip, reference-tree manifest cross-checks run and pass). Parity gate re-executed at this commit: `npm run parity -- --json` exit 1 as recorded under GAP-001 (163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision` `93229933`) — unchanged, no gap closure | No gap closures claimed. GAP-001 CRT failure and the other seven gaps remain open; rendered parity for the new pin is unqualified under GAP-002/GAP-008 |
| 2026-09-27 | `296e0138` (this row's base; the sync and this row share this single commit) | Source-lock sync through upstream `296e0138c4744ed485b2e95de3eeb466c17629ee` (current upstream `main`, proven descendant of prior pin `93229933` via `git merge-base --is-ancestor` exit 0 in a fresh full clone; the job's force-push flag is covered by ancestry of the consolidated endpoints `12b4d74f..a912749f`, `a912749f` being an ancestor of the new pin, and both observed trigger ranges `7c5f176..a912749` and `11d7c69..296e013` falling inside the audited contiguous range): pin, digest, manifest, snapshot, README/EFFECTS/inventory-test revision refs, plus this row and a compatibility-report range-audit section. Effect catalog byte-identical to the prior pin (205 eligible, five exclusions unchanged; `shaders/effects` and `shaders/src` diffs empty; canonical-kernel regeneration produced no diff). Range's two `shaders/` commits (`a912749f`, GAP-019 passthrough-input write-blit probe; `296e0138`, GAP-021 requested-vs-returned frame-resolution reporting) add upstream harness/tests tooling only (`shaders/tests/` files plus `test-harness.js` extensions and `scripts/run-js-tests.js` registrations), which the CPU port does not consume; `7c5f1765` and `11d7c699` are docs checkpoints touching no `shaders/` paths. No CPU behavioral change applies | Executed with `NM_REFERENCE_ROOT` at upstream `296e0138`; committed machine-checkable evidence (per-commit range audit with upstream tree SHAs, blob identities of the five changed `shaders/tests` files, command exit codes, log SHA-256s, verbatim logs) at `docs/evidence/source-lock-sync-9322993-296e0138-audit.json` and `docs/evidence/source-lock-sync-*.log|json`: `npm test` 279 pass / 0 fail / 1 skip; `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` exit 0 (8/8, 0 skip, reference-tree manifest cross-checks run and pass). Parity gate re-executed at this commit: `npm run parity -- --json` exit 1 as recorded under GAP-001 (163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision` `296e0138`) — unchanged, no gap closure | No gap closures claimed. GAP-001 CRT failure and the other seven gaps remain open; rendered parity for the new pin is unqualified under GAP-002/GAP-008 |
| 2026-09-27 | `b61b658` (this row's base; the publication commit carrying this row follows it) | GAP-007 accessible-browser-controls pass: generated param rows, static render-settings controls, the time slider, the DSL editor, and the effect dropdowns in `examples/browser/` now expose distinct accessible names (`aria-label` on widgets and on the native range inputs handfish `<slider-value>` renders; vendored `<effect-select>`/`<toggle-switch>` propagate host labels to their focusable parts; visual label spans `aria-hidden`), plus `controlAriaLabel` unit tests. No engine, effect, parity, golden, tolerance, or workflow change | Headless Chromium 154 CDP audit (harness outside the repo): red-before at `b61b658` — six effect sliders + time slider + DSL editor unnamed in the AX tree (8 unnamed in the screen-reader pass); candidate — every slider/switch/combobox/button/textbox named and distinct (23/23 in the screen-reader pass), ArrowRight changes the slider 0.5 → 0.51 with re-render, Tab reaches each named control, invalid DSL errors (`Unknown effect "notAnEffect"`) and corrected DSL re-renders. `npm test` at the candidate: 281 pass / 0 fail / 2 skipped (environment-gated without `NM_REFERENCE_ROOT`). GAP-007 acceptance criteria met | GAP-007 closed. The other seven gaps remain as recorded; no parity or release advancement |
| 2026-09-27 | `f0ccebe` (this row's base; the publication commit carrying this row follows it) | GAP-008 provenance pass: `scripts/parity/run.js` now reports each comparison's reference-image provenance separately from the candidate pin (per-result `reference` block with image path, actual sha256, `captureRevision`, `provenance` recorded/unknown; summary `results` + `referenceProvenance` counts; text-report provenance line), backed by a committed `parity/goldens/provenance.json` map of all 172 retained goldens (sha256, size, introducing commit `36fbfac`, `captureRevision: null` — no capture record exists) regenerated by `scripts/parity/write-provenance.js`, a sha256 cross-check that hard-fails the gate on a regenerated golden, and `test/parity-golden-provenance.test.js`. No golden, tolerance, engine, or workflow change | Red-before against published base `f0ccebe`: all three new provenance tests fail (missing manifest, no per-comparison `results`/`reference` fields); candidate: 3/3 pass. Full gate at the candidate: exit 1 unchanged per GAP-001 (163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision` `296e0138`, `referenceProvenance` `{recorded:0, unknown:164}`); every comparison shows the unknown-provenance marker and no result's `captureRevision` equals `sourceRevision`. `npm test`: 284 pass / 0 fail / 2 skipped. Required checks: `git log -- parity/goldens` shows only `36fbfac` ever touched the goldens and `git diff 36fbfac..candidate -- parity/goldens` is empty; manifest hashes byte-match all 172 files; no capture record exists in the repo, so provenance is recorded as unknown rather than labeled from the kernel pin. Tamper check: altering a manifest sha256 makes `npm run parity -- --only` fail loudly with the relabel-prevention error | GAP-008 closed (visible unknown-provenance marker + relabel protection; the underlying capture identity remains unidentified, relevant to GAP-001). The other seven gaps remain as recorded |
