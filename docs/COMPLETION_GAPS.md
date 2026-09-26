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
Current served kit: `0.1.32`, source `bfbe54764eee87c8f67d2b281d5f304faad04a5b`. That tree differs from the audited source only in this register. [Retrieved metadata](https://kits.noisedeck.app/cpu/0/deployment-meta.json).
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
| C-004 | README, canonical schemas | Canonical parameters and choices | partial | The audit rejected landscape filtering. Current source accepts both choices and produces finite frames. Independent authority pixel comparison remains unavailable. |
| C-005 | README, Quick start and Browser API | Human usability through CLI and browser | partial | Installed CLI renders PNGs. Browser renders, resizes, reports invalid DSL, recovers, and executes with keyboard input. Accessible names remain incomplete. |
| C-006 | package.json and README | Ecosystem fit for dependency-free JavaScript | partial | Isolated tarball installation and ESM imports work. The public npm name returns E404. The README does not describe installation. |
| C-007 | Export kit template | Offline useful output and complete engine delivery | supported | All 93 published files match hashes. Rebuild reproduces all 93 files. Published CLI produces a 64×64 PNG. |
| C-008 | Existing workflow results | Release readiness | unverified | Exact-source release checks include a real PNG render. They do not execute the port's unit or parity gates. Platform and upgrade qualification remain incomplete. |

## 3. Methods and evidence

Review CI boundary: Exact-source runs: Export kit, Downstream. A passing export dispatch does not qualify rendered parity. Current complete-render enforcement remains an open verification requirement. [Exact-source responses and workflows](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/noisemaker-for-cpu-remote-evidence.json).

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

The existing full CPU gate exits 1: 164 cases executed, 114 byte-exact, 163 accepted at tolerance 2, and 41 skipped. filter/crt has maximum error 80 and mean error 5.05859375. The gate identifies authority 4891b9953f9fd8a61cf9ae0dda2fe747a9be82df. Five of the 210 current effect IDs are outside its 205-effect inventory. Full parity fails. [Raw evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/cpu-current-probe.json).
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
- Last verification: 2026-09-26 at `049273b` (all three required checks executed on this exact tree, the candidate head): `npm test`: 279 pass, 0 fail, 1 skipped with `NM_REFERENCE_ROOT` at upstream `6a0af04d` (277 pass / 2 skipped without it — the reference-tree manifest test at `test/upstream-source-lock.test.js:71` conditionally skips when the reference checkout is unavailable; the test set includes the three-configuration cos-wrap characterization test, executed as part of this run). Full parity: 163/164 within ±2, 114 byte-exact, 41 skipped. Independent channel comparison (`compareRgba8` against the retained golden, re-executed): `filter/crt` max=80, mean=5.05859375, 89 channels over tolerance. Goldens and tolerances are unchanged.

### GAP-002: Rendered coverage remains incomplete

- Status: open. Priority: P2. Category: verification.
- Affected scope: 41 skipped effects, external media, parameter combinations, stateful execution, image dimensions, seeds, and time.
- Expected behavior: Every declared behavioral scope has source-bound comparisons with explicit exclusions and tolerances.
- Observed behavior: The gate compares only default 8×8 fixtures. Choice smoke checks establish execution, not rendered correctness.
- Evidence: `parity.log`, `probe.json`, `media-comparison.json`, and `test/catalog-smoke.test.js`.
- Next action: Define one bounded external-input comparison using an asymmetric image and the retained authority.
- Dependencies: Preserve the current parity checkpoint. Do not add effects or regenerate goldens during this audit.
- Acceptance criteria: Record CPU and authority outputs, source revisions, dimensions, and channel metrics for the same input.
- Required checks: Public CLI and ESM entry points, sync/async equality, and unchanged existing parity fixtures.
- Remaining coverage: Multi-frame state, long renders, cancellation, and wider parameter combinations require separate qualification.

### GAP-003: Updated landscape modes lack authority pixel evidence

- Status: open. Priority: P2. Category: authority.
- Affected scope: `render/renderLandscape3d`, compiler schemas, and generated kernels.
- Expected behavior: Completion claims identify whether they target the recorded pin or current upstream.
- Historical behavior: the audited source rejected `filtering` choices `isosurface` and `voxel`.
- Current behavior: source `16c38245` accepts both choices and renders finite frames under pin `44bc4ed4`.
- Remaining uncertainty: landscape remains one of the parity gate's 41 skips. No authority pixel comparison qualifies these modes.
- Evidence: `landscape-current.js`, `authority-diff.json`, and `probe.json`.
- Next action: compare both existing modes against authority `44bc4ed4` at specified size, seed, time, and projection.
- Dependencies: retain the completed source update. Establish reference provenance under GAP-008 before accepting new rendered parity.
- Acceptance criteria: default, voxel, and isosurface frames satisfy a declared unchanged comparison gate. Record orthographic and perspective results separately.
- Required checks: `node --test test/volume-effects.test.js`, public rendering, and independent authority comparisons. Finite-pixel checks alone cannot close this gap.

### GAP-004: Parity summary is stale

- Status: open. Priority: P3. Category: contract.
- Affected scope: README Collection parity, CRT status narrative, and parity-runner comments.
- Expected behavior: Current summaries distinguish historical measurements from the current catalog denominator.
- Observed behavior: README reports 166/167 and 117 exact. Current measurements are 163/164 and 114 exact.
- Current check: `README.md:157` and `docs/CRT-PARITY.md:56` still state 166/167 with 117 byte-exact at source `ba1c89a`.
- Evidence: `parity.log`, README, and [CRT-PARITY.md](CRT-PARITY.md).
- Next action: Reconcile current summaries with three retired catalog effects while retaining historical measurements.
- Dependencies: Use this audit's recorded source and raw result. Do not reduce coverage to improve the summary.
- Acceptance criteria: Current counts total 205 eligible effects. Historical counts carry their source revision or date.
- Required checks: Full parity output and a catalog-to-fixture comparison.
- Last verification: 2026-09-26. The stale counts remain at the current source.

### GAP-005: Release CI does not enforce port parity

- Status: open. Priority: P2. Category: verification.
- Affected scope: Exact-source validation before kit publication.
- Expected behavior: Release claims distinguish delivery checks from the port's execution and parity gates.
- Observed behavior: Existing workflows dispatch releases and notifications. The downstream builder renders a PNG but does not run port parity.
- Evidence: `.github/workflows/export-kit.yml`, `.github/workflows/downstream.yml`, and `downstream-ci.log`.
- Next action: Define the required execution and parity evidence for the existing release system.
- Dependencies: GAP-001 remains an honest red parity result. Workflow changes belong to separately authorized implementation work.
- Acceptance criteria: A release record identifies exact-source port test results, parity failures, skips, and package checks.
- Required checks: Inspect complete job logs for the reviewed SHA. Do not infer execution from a dispatch success.
- Last verification: 2026-09-26. No workflow runs the port gates. The docs-only audited SHA triggered no runs. Exact-source dispatches for `bfbe547` passed.

### GAP-006: Distribution and platform qualification are incomplete

- Status: open. Priority: P2. Category: release.
- Affected scope: npm candidate, published kit, documentation, supported runtimes, and upgrades.
- Expected behavior: Developers can identify the distribution path, install it, use its documentation, and understand supported environments.
- Observed behavior: Kit delivery and local package installation work. The public npm name returns E404.
- Observed behavior: README starts with checkout-relative commands. Packed README links to `docs/CRT-PARITY.md`, which the package omits.
- Evidence: `pack.json`, `npm-registry.json`, `consumer-checks.json`, and `kit-verification.json`.
- Next action: Define the supported distribution path and check every required documentation link within its artifact.
- Dependencies: Preserve npm unavailability as a scope limit. Do not publish a package as an audit probe.
- Acceptance criteria: A clean consumer can install, render, recover, remove, and upgrade the documented distribution without hidden repository files.
- Required checks: Node 22 floor, supported LTS versions, Windows/Linux, declared browsers, and saved-program upgrade behavior.
- Limits: Linux CI proves one kit render. It does not qualify the full API. macOS checks cover only the recorded runtimes.
- License checks: The kit contains both MIT notices. No native binary signing requirement applies.
- Last verification: 2026-09-26. Served kit `0.1.32` tracks the current functional source. Bounded served-file hashes match. The public npm name still returns E404.

### GAP-007: Browser controls lack accessible names

- Status: open. Priority: P2. Category: usability.
- Affected scope: Browser demo sliders and DSL editor.
- Expected behavior: Assistive technology can identify each editable control's purpose.
- Observed behavior: Six sliders expose values without names. The DSL editor also has no accessible name.
- Evidence: `browser-observations.json` and the audit task's accessibility snapshots.
- Next action: Trace each generated control to its visible label before implementing accessible naming.
- Dependencies: Browser and handfish control behavior must remain consistent. The separate implementation job owns changes.
- Acceptance criteria: Each slider and editor exposes a distinct, accurate name. Keyboard changes remain functional.
- Required checks: Accessibility tree inspection, keyboard execution, invalid-input recovery, and a screen-reader pass.

### GAP-008: Parity reports do not identify golden provenance separately

- Status: open. Priority: P2. Category: verification.
- Affected scope: `scripts/parity/run.js`, retained reference images, and source-bound parity claims.
- Expected behavior: reports identify candidate source, kernel authority, and reference-image provenance separately.
- Observed behavior: `sourceRevision` follows the generated kernel pin. It changed to `44bc4ed4` while all retained golden files remained unchanged.
- Evidence: `parity.log`, source comparison, and `scripts/parity/run.js:138` in the reviewed source.
- Next action: map each retained golden hash to its existing capture record and authority before changing report fields.
- Dependencies: preserve the reference images and tolerances. Implementation owns any report-format correction.
- Acceptance criteria: each comparison has an explicit reference revision or a visible unknown-provenance marker. Kernel updates cannot relabel reference captures.
- Required checks: compare `git diff` for `parity/goldens` across the two source SHAs. Check recorded hashes against capture evidence.
- Last verification: 2026-09-23. No reference-image changes and no golden regeneration. 2026-09-26: goldens remain unchanged. The report's `sourceRevision` field now follows kernel pin `8eeb7b5a`. Reference-capture provenance remains unidentified.

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
Daily review on 2026-09-25 at `6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85`: source freshness and bounded evidence reviewed. Open qualification limits retained. [Retained review evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/cpu-current-probe.json). No new closure claimed.

| Date | Source SHA | Changes | Tested scope | Remaining limits |
| --- | --- | --- | --- | --- |
| 2026-09-23 | `36fbfac07be5a9a10b7a991209b566be3f54fe6e` | Created this register and added its README link. No implementation changes | 272 unit tests. 164 parity comparisons. 41 skips. Independent CRT probe. CLI/ESM and browser checks. 93 kit hashes. Build reproduction. Exact-source CI | Seven open gaps. No release approval or parity-checkpoint advancement |
| 2026-09-23 | `16c38245c42030c8ee46dc61108791d2fea4bda9` | Corrected stale landscape rejection and choice count. Added GAP-008 and executable CRT acceptance. | Repeated full parity and independent CRT comparison. Probed both landscape modes. Checked worker evidence, changed kit files, and exact-source CI. | Eight gaps remain. No closures. Current host, broad pixel, and platform qualification remains incomplete. |
| 2026-09-26 | `3ec3fe1270b8fc1f527938c71425929a7d58e1b6` (adds this row on top of merge `b644b468` of remote sync `bfbe5476`) | Register pass-history row added; functional tree otherwise unchanged from remote sync `bfbe5476`, which pins upstream `8eeb7b5ac14eb37a8d16037f607a88ce63924cd3` with manifest digest `7382c8ccee81a540d48e1298911d6960de9b2970817a0709ef1da58ab99567a8`. Ancestry check against a fresh upstream clone proves `9d3474dfdc6cb737ebb7b2f3598b16d940af1544` (this job's originally required end) is an ancestor of `8eeb7b5ac14e`, so the pin covers the required range; the four upstream `shaders/` commits in `9d3474df..8eeb7b5a` (GAP-005 pass fields, GAP-004 mipmaps/persistent/filter texture policies, allocation fixes) were ported by `bfbe5476` (snapshot, CpuRenderer viewport resolution, new render-graph test). Earlier in this job, candidate `41b92689` regenerated kernel artifacts with per-record `sourceSha256` and added the checkout-free manifest/coverage tie-in test while pinning `9d3474dfdc6c`; the later remote sync superseded that pin state. No effect behavior, tolerances, or goldens changed in the register row | Executed at `3ec3fe12` with `NM_REFERENCE_ROOT` at upstream `8eeb7b5a`: `npm test` (node --test) 278 pass / 0 fail / 1 skip (the second environment-gated test runs and passes with the reference root); `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` 8 pass / 0 fail / 0 skip, including the reference-tree manifest cross-checks that are skipped without `NM_REFERENCE_ROOT`. `npm run parity` exits 1 as recorded under GAP-001: 163/164 within ±2, 114 byte-exact, 41 skipped, filter/crt max 80 — unchanged, no gap closure. Exact-source CI at `41b92689` (export-kit 36204154657, downstream 36204154669) succeeded as delivery dispatches; the repo has no workflow that runs the unit suite, so the suite evidence above is the locally executed run | No gap closures claimed. GAP-001 CRT failure and the other seven gaps remain as recorded. Full rendered parity remains unverified |
| 2026-09-26 | `ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5` | Audit-only register and report update. No implementation change | `npm test` 278 pass, 0 fail, 1 skip with the pinned reference tree. Full parity gate exit 1: 163/164, 114 exact, 41 skips, CRT max 80. CLI quick start, chain render, and two error paths. Served kit `0.1.32` file checks. Fleet inventory and exact-source dispatch review | Eight gaps remain open. New authority `9574362` (`1.0.184`) unqualified. No browser, GPU, or platform checks this pass |
| 2026-09-26 | `a1801be` (this row) | Source-lock sync through upstream `6a0af04d3c4f` (job range end; proven descendant of prior pin `8eeb7b5a` and of range start `fca611fd`): pin, digest, manifest, snapshot, README/EFFECTS/inventory-test revision refs. Effect catalog byte-identical to the prior pin (205 eligible, five exclusions unchanged). Range's `shaders/src` commits (`6113da00` texture-pooling consumption, `95743621` viewport-without-clear pooling safety, `f83a427e` backend diagnostic union) are GPU pipeline/backend-only; the CPU renderer keeps one surface per virtual texture and has no WebGL2/WebGPU backends, so no CPU behavioral change applies | Executed at `a1801be` with `NM_REFERENCE_ROOT` at upstream `6a0af04d`: `npm test` 278 pass / 0 fail / 1 skip; `npm run parity -- --json` exit 1: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max error 80, mean 5.05859375 — identical to the prior pass; `sourceRevision` now `6a0af04d`, goldens unchanged. Re-executed at the published candidate `d03aed7b` (docs-only commits `f935c34`/`d03aed7` between them): `npm test` 278/0/1; source-lock+inventory tests 8/0/0 with the reference root; parity unchanged. Served kit `0.1.33` reports `git_hash d03aed7b`; served `engine/src/index.js` and `engine/bin/noisemaker-cpu.js` sha256-match the candidate tree | No gap closures claimed. GAP-001 CRT failure and the other seven gaps remain open; rendered parity for the new pin is unqualified under GAP-002/GAP-008 |
