# noisemaker-for-cpu: completion gaps

## 1. Scope and source revisions

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

## 2. Completion claims

| ID | Source | Scope | Finding | Evidence |
| --- | --- | --- | --- | --- |
| C-001 | README, Collection parity | 205 effects. 301 programs. 458 compile-time choices execute | supported | 272 unit tests pass. Catalog tests exercise 458 individual choices at 2×2. This proves bounded execution, not pixel equivalence. |
| C-002 | README, Collection parity | 166/167 pass. 117 frames are byte-exact | contradicted | Current gate reports 163/164, with 114 byte-exact frames and 41 skips. Three retired effects explain the smaller catalog. |
| C-003 | README, introductory parity statement | Pixel-level parity | partial | CRT fails the unchanged tolerance. Skipped effects and broader parameter combinations lack qualifying pixel evidence. |
| C-004 | README, canonical schemas | Canonical parameters and choices | partial | The recorded pin is explicit. Current upstream adds landscape `filtering`, which the port rejects. |
| C-005 | README, Quick start and Browser API | Human usability through CLI and browser | partial | Installed CLI renders PNGs. Browser renders, resizes, reports invalid DSL, recovers, and executes with keyboard input. Accessible names remain incomplete. |
| C-006 | package.json and README | Ecosystem fit for dependency-free JavaScript | partial | Isolated tarball installation and ESM imports work. The public npm name returns E404. The README does not describe installation. |
| C-007 | Export kit template | Offline useful output and complete engine delivery | supported | All 93 published files match hashes. Rebuild reproduces all 93 files. Published CLI produces a 64×64 PNG. |
| C-008 | Existing workflow results | Release readiness | unverified | Exact-source release checks include a real PNG render. They do not execute the port's unit or parity gates. Platform and upgrade qualification remain incomplete. |

## 3. Methods and evidence

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

## 4. Known gaps

P1 means false completion or a major correctness gap. P2 means coverage or integration gaps. P3 means documentation inconsistency.
The auditor checked all entries below on 2026-09-23. No entry closed during this pass.

### GAP-001: CRT pixel mismatch

- Status: open. Priority: P1. Category: implementation.
- Affected scope: `filter/crt`, its CPU adapter, and the retained parity gate.
- Expected behavior: Every compared channel stays within the existing ±2-byte tolerance.
- Observed behavior: 89 of 256 channels exceed tolerance. Maximum difference is 80.
- Evidence: `parity.log`, `probe.json`, and [CRT-PARITY.md](CRT-PARITY.md).
- Next action: Localize the first divergent intermediate value under the retained CRT fixture.
- Dependencies: The separate implementation job owns corrections. Preserve the current checkpoint and reference images.
- Acceptance criteria: CRT passes the unchanged fixture. All other 163 compared effects retain their results.
- Required checks: Independent channel comparison, `npm test`, and the full parity command.

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

### GAP-003: Current landscape authority differs

- Status: open. Priority: P2. Category: authority.
- Affected scope: `render/renderLandscape3d`, compiler schemas, and generated kernels.
- Expected behavior: Completion claims identify whether they target the recorded pin or current upstream.
- Observed behavior: Current upstream adds `filtering` choices `isosurface` and `voxel`. The port rejects that parameter.
- Evidence: `landscape-current.js`, `authority-diff.json`, and `probe.json`.
- Next action: Record the parameter and shader delta as deferred work at the current checkpoint.
- Dependencies: A separate scope decision must authorize any authority migration or new mode implementation.
- Acceptance criteria: Until migration, compatibility statements identify the pin and reject unsupported current modes explicitly.
- Required checks: Exact-source schema comparison and public compiler rejection. Future migration requires rendered evidence for each mode.

### GAP-004: Parity summary is stale

- Status: open. Priority: P3. Category: contract.
- Affected scope: README Collection parity, CRT status narrative, and parity-runner comments.
- Expected behavior: Current summaries distinguish historical measurements from the current catalog denominator.
- Observed behavior: README reports 166/167 and 117 exact. Current measurements are 163/164 and 114 exact.
- Evidence: `parity.log`, README, and [CRT-PARITY.md](CRT-PARITY.md).
- Next action: Reconcile current summaries with three retired catalog effects while retaining historical measurements.
- Dependencies: Use this audit's recorded source and raw result. Do not reduce coverage to improve the summary.
- Acceptance criteria: Current counts total 205 eligible effects. Historical counts carry their source revision or date.
- Required checks: Full parity output and a catalog-to-fixture comparison.

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

## 5. Ordered next actions

1. Preserve this source checkpoint and all raw evidence. Review GAP-001 before any broad completion statement.
2. Diagnose CRT under the existing fixture. Scope affected files to the CRT adapter and its required regression checks.
3. Define external-input acceptance under GAP-002. Keep new authority modes deferred under GAP-003.
4. Correct stale summaries under GAP-004 through separately scoped documentation work. Preserve historical measurements.
5. Define existing-system release checks under GAP-005. Do not bypass the red parity result.
6. Qualify the documented artifact under GAP-006. Check package metadata, required documents, installation, removal, upgrades, and supported platforms.
7. Qualify accessible browser controls under GAP-007. Preserve the demonstrated render and recovery workflows.

These actions describe required follow-up evidence. They do not authorize implementation, effect ports, or advancement beyond the current parity checkpoint.

## 6. Pass history

| Date | Source SHA | Changes | Tested scope | Remaining limits |
| --- | --- | --- | --- | --- |
| 2026-09-23 | `36fbfac07be5a9a10b7a991209b566be3f54fe6e` | Created this register and added its README link. No implementation changes | 272 unit tests. 164 parity comparisons. 41 skips. Independent CRT probe. CLI/ESM and browser checks. 93 kit hashes. Build reproduction. Exact-source CI | Seven open gaps. No release approval or parity-checkpoint advancement |
