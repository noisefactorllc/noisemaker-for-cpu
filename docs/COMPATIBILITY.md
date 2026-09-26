# noisemaker-for-cpu: compatibility report

## 1. Source and authority revisions

Worker audit: 2026-09-26. Run ID: `audit-20260926-010135`. Audited source: [`ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5`](https://github.com/noisefactorllc/noisemaker-for-cpu/commit/ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5).
Full rendered parity at this SHA: **unverified**. The bounded gate still fails. This is not a release approval.
Kernel pin: `8eeb7b5ac14eb37a8d16037f607a88ce63924cd3`, upstream tag `v1.0.183`.
Current upstream main: `95743621696483b91968992ef6ee0d87b2089fa8`. Published Noisemaker authority: `1.0.184` at that source.
The published effect manifest is byte-identical across `1.0.179` through `1.0.184`. Its SHA-256 is `05c4d7b7744837ae90a3bb4c89e5403ff09448a74d9d7e824abb3d719ad3314e`, with 210 effect IDs.
Two runtime `shaders/` commits separate the pin from the published source. Their parity is unqualified.
Current served kit: `0.1.32`, source `bfbe54764eee87c8f67d2b281d5f304faad04a5b`. [Retrieved metadata](https://kits.noisedeck.app/cpu/0/deployment-meta.json). That tree differs from the audited source only in the gap register.

### Source-lock sync, 2026-09-26 (commit `a1801be`)

The port's source lock now pins upstream `6a0af04d3c4f345ffab5e9f8e54e532216b4cdaa` (through current upstream `main`, proven a descendant of the prior pin `8eeb7b5a` and of range start `fca611fd`). The 205-effect catalog is byte-identical to the prior pin. The range's three runtime `shaders/` commits (texture-pooling consumption `6113da00`, viewport-without-clear pooling safety `95743621`, backend diagnostic union `f83a427e`) target the GPU pipeline and WebGL2/WebGPU backends; the CPU renderer keeps one surface per virtual texture and has no GPU backends, so no CPU behavioral change applies. Executed at `a1801be` with a reference checkout at `6a0af04d`: `npm test` 278 pass / 0 fail / 1 skip; `npm run parity -- --json` exit 1 as recorded under GAP-001: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max error 80 — unchanged, no gap closure. Rendered parity remains unqualified under GAP-002/GAP-008.

Range audit, 2026-09-26, against a fresh clone of `https://github.com/noisefactorllc/noisemaker.git` at `/state/cache/noisemaker` (checked out at `6a0af04d`). Reproduce with `git clone`, then `git merge-base --is-ancestor <A> <B>`:
- `git merge-base --is-ancestor 8eeb7b5a 6a0af04d` and `... fca611fd 6a0af04d` both exit 0, so the job range is contiguous delivery through the new pin; the force-push flag is covered by ancestry, not assumed.
- `git log --oneline fca611fd..6a0af04d -- shaders/` lists 11 commits. Eight pre-date the previous pin `8eeb7b5a` (`66b2c721`, `240740dd`, `ba87ffae`, `9d3474df`, `a021a283`, `62eb56fa`, `2f47612c`, `fa83eeab`) and were already ported by the `bfbe5476`/earlier syncs. Three are new in this sync:
- `8eeb7b5a..6a0af04d -- shaders/src` diffstat: `backends/diagnostics.js` +185 (new), `backends/webgl2.js` 33, `backends/webgpu.js` 95, `runtime/pipeline.js` 215; 4 files, 484 insertions, 44 deletions. No `shaders/effects` or `shaders/src/lang` file changes in this sub-range.
- `runtime/pipeline.js` +215 lines is exactly `6113da00` (+206: `Pipeline` `texturePooling` option, `buildTexturePoolingPlan`/`releaseRegroupedTextures`/`applyTextureAliases`/`getResourcePlan`, aliased allocation skip) plus `95743621` (+9: one `else if` adding viewport-without-clear outputs to the pooling plan's `partiallyWritten` set). Both only guard/serve the opt-in pooled-storage path; the CPU renderer allocates one surface per virtual texture (`this.pool.acquire`, no aliasing) and has no `Pipeline`/`backend.textures` equivalent, so neither changes CPU behavior. `f83a427e` touches only WebGL2/WebGPU backends and their new diagnostics module, which the CPU port does not contain.
- File identities at the two revisions: `shaders/src/runtime/pipeline.js` sha256 `863781417a198f76158c284e580765995a1f7668d8e5e446cec84a81bdb68306` at `8eeb7b5a`, `3675dca3b2126aad6e970cb671cdd2bd6c50d3d329d6cc45d3abba66ed8ec6f7` at `6a0af04d`.

Exact-source closure at the published candidate `d03aed7b30384bcebc04bc7f73a7f750ce3b2227` (2026-09-26): commits `f935c34` and `d03aed7` after the functional sync `a1801be` are documentation-only (`git diff --stat a1801be..d03aed7` shows only `docs/COMPATIBILITY.md` and `docs/COMPLETION_GAPS.md`, 13 insertions). Re-executed at `d03aed7` with `NM_REFERENCE_ROOT` at upstream `6a0af04d`: `npm test` 278 pass / 0 fail / 1 skip; `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` 8 pass / 0 fail / 0 skip (manifest cross-checks run); `npm run parity -- --json` exit 1 unchanged: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max error 80, mean 5.05859375, `sourceRevision` `6a0af04d`. Served kit: `https://kits.noisedeck.app/cpu/0/deployment-meta.json` now reports `version 0.1.33`, `git_hash d03aed7b30384bcebc04bc7f73a7f750ce3b2227` (the export-kit workflow's push paths include `src/**`, so the kit was rebuilt at the candidate SHA). Served files fetched from the kit host are byte-identical to the candidate tree: `engine/src/index.js` sha256 `222f58d4ce1f046c98207175b906b072ea4801a5d94a9c40c5b9ddeaf4d9f7a8`, `engine/bin/noisemaker-cpu.js` sha256 `96d09295c0292a68478fc0c22872d8ea56ac8209cf7ff8182fe2ad8629a36cd4`. The committed `pinned-source-manifest.json` diff corroborates the range audit: only the `revision` field and four `shaders/src/runtime` entry hashes/size changed (`pipeline.js`, `webgl2.js`, `webgpu.js`) plus the new `backends/diagnostics.js` entry; no `shaders/effects` entry changed.

The observations below retain their original source and authority identities. They do not qualify later updates.

### Earlier source observations

Daily review: 2026-09-25. Inspected source: [`6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85`](https://github.com/noisefactorllc/noisemaker-for-cpu/commit/6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85).
Upstream discovery at that review: `bbdeb56c4b75cf33379766c3e87b0f5a18bcbba8`. Published authority then: `1.0.179`, source `fca611fd8f91424661d4e531d39313d24ea21134`.
Served kit then: `0.1.28`, source `6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85`.

### Report observations, 2026-09-24

Report date: 2026-09-24. Source inspected: [`f2eb495d70abcb74e3632e7a652a4f83e4f3b11e`](https://github.com/noisefactorllc/noisemaker-for-cpu/commit/f2eb495d70abcb74e3632e7a652a4f83e4f3b11e).
Full rendered parity at this SHA: **unverified**. This is not a release approval.
A later documentation-only commit does not change this tested source identity.
Any runtime, package, or authority update requires fresh evidence before this report can qualify it.

Node.js CPU renderer and browser runtime with a 205-effect catalog. [Source contract](https://github.com/noisefactorllc/noisemaker-for-cpu/blob/f2eb495d70abcb74e3632e7a652a4f83e4f3b11e/README.md).

Historical tested authority revisions remain in the linked gap register. They are not relabeled as current qualification.
Current upstream discovery SHA: `c9ee8a049b2b63cd300da67c01ee40baf29dc288`.
Published authority: `1.0.176`, source `c9ee8a049b2b63cd300da67c01ee40baf29dc288`.
[Immutable published manifest](https://shaders.noisedeck.app/1.0.176/effects/manifest.json) contains 210 effect IDs.
Its SHA-256 is `05c4d7b7744837ae90a3bb4c89e5403ff09448a74d9d7e824abb3d719ad3314e`.
These IDs do not define complete parameter, state, input, or platform coverage.

Served kit `0.1.25` records `f2eb495d70abcb74e3632e7a652a4f83e4f3b11e`. [Source metadata](https://kits.noisedeck.app/cpu/0/deployment-meta.json).
Historical measurements remain bound to their original revisions in [completion gaps](COMPLETION_GAPS.md).

## 2. Host and distribution matrix

Current tests and qualification limits are in [section 3](#3-parity-coverage).
The matrix below retains the earlier measured scope. A historical verified row is not a current-source or full-platform certification.

| Dimension | Status | Measured scope or limit |
|---|---|---|
| Source-level checks | unverified | Historical image sweep: 163 of 164 passed, 41 skipped, and CRT failed. Current-source full parity was not rerun. |
| Actual host rendering | unverified | No new complete native or browser workflow qualified by this report. |
| Minimum and current host versions | unverified | Declared requirements are not a tested version matrix. |
| Supported operating systems and backends | unverified | This pass does not establish Windows, Linux, and macOS coverage. |
| Installed package and first useful result | unverified | Complete isolated installation was not qualified for this source. |
| Parameters, external inputs, state, and chains | unverified | Full current-authority combinations remain unmeasured. |
| Invalid input and recovery | unverified | Unit checks do not establish every installed public entry point. |
| Upgrade, removal, and resource cleanup | unverified | Prior defects and missing workflows remain in the gap register. |
| Accessibility of provided controls | unverified | Keyboard, focus, labels, and diagnostics need host observations where applicable. |
| Release readiness | blocked | Full parity, installation, host, and artifact evidence remain incomplete. |

## 3. Parity coverage

### Worker audit, 2026-09-26

The existing full CPU gate exits 1 at the audited source: 164 cases executed, 114 byte-exact, 163 accepted at tolerance 2, and 41 skipped.
`filter/crt` keeps maximum error 80 and mean error 5.05859375, with 89 channels over tolerance.
The gate labels its authority with kernel pin `8eeb7b5ac14eb37a8d16037f607a88ce63924cd3` (upstream `v1.0.183`).
Five of the 210 current effect IDs remain outside the 205-effect inventory. Full parity fails.
No golden or tolerance changed since the last review.
The newly published authority `1.0.184` at `9574362` is unqualified. It adds two runtime `shaders/` commits beyond the pin.
Raw evidence: run `audit-20260926-010135` in the shared series state, file `evidence-audit-20260926-010135/result-noisemaker-for-cpu.json`.

### Daily review, 2026-09-25

The existing full CPU gate exits 1: 164 cases executed, 114 byte-exact, 163 accepted at tolerance 2, and 41 skipped. filter/crt has maximum error 80 and mean error 5.05859375. The gate identifies authority 4891b9953f9fd8a61cf9ae0dda2fe747a9be82df. Five of the 210 current effect IDs are outside its 205-effect inventory. Full parity fails. [Raw evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/cpu-current-probe.json).

The current full case denominator remains incomplete. Missing parameters, hosts, external inputs, and stateful sequences remain qualification gaps. No skip or tolerated difference counts as exact parity.

### Earlier measurements

Full parity requires complete applicable coverage with no skips or missing cases.
Historical NEAR, CHAOS, and tolerated differences do not count as strict equality.
The existing numerical contracts remain separate from exact comparison. This report does not change tolerances or goldens.
Unknown values mean `not measured`, never zero.

| Gate | Expected cases | Executed | Strict passes | Failures | Skips | Status |
|---|---|---|---|---|---|---|
| Current full render suite | not measured | not measured | not measured | not measured | not measured | unverified |

Earlier served compatibility inventory declares 205 effect IDs. Declaration does not establish execution or parity.
IDs absent from the served declaration: `render/meshLoader`, `render/meshRender`, `synth/roll`, `synth/scope`, `synth/spectrum`.
Missing effects remain visible toward the full-parity goal. Contract exclusions do not become successful tests.

Current served declaration: 205 effect IDs. This inventory is not evidence of execution. The declaration column below reflects kit `0.1.28`.

### Effect inventory

| Effect ID | Declared in served kit | Current full parity |
|---|---|---|
| `classicNoisedeck/bitEffects` | yes | unverified |
| `classicNoisedeck/caustic` | yes | unverified |
| `classicNoisedeck/cellNoise` | yes | unverified |
| `classicNoisedeck/cellRefract` | yes | unverified |
| `classicNoisedeck/coalesce` | yes | unverified |
| `classicNoisedeck/colorLab` | yes | unverified |
| `classicNoisedeck/composite` | yes | unverified |
| `classicNoisedeck/effects` | yes | unverified |
| `classicNoisedeck/fractal` | yes | unverified |
| `classicNoisedeck/glitch` | yes | unverified |
| `classicNoisedeck/kaleido` | yes | unverified |
| `classicNoisedeck/lensDistortion` | yes | unverified |
| `classicNoisedeck/moodscape` | yes | unverified |
| `classicNoisedeck/noise` | yes | unverified |
| `classicNoisedeck/noise3d` | yes | unverified |
| `classicNoisedeck/refract` | yes | unverified |
| `classicNoisedeck/shapeMixer` | yes | unverified |
| `classicNoisedeck/shapes` | yes | unverified |
| `classicNoisedeck/shapes3d` | yes | unverified |
| `classicNoisedeck/splat` | yes | unverified |
| `filter/adjust` | yes | unverified |
| `filter/bloom` | yes | unverified |
| `filter/blur` | yes | unverified |
| `filter/bulge` | yes | unverified |
| `filter/celShading` | yes | unverified |
| `filter/channel` | yes | unverified |
| `filter/chroma` | yes | unverified |
| `filter/chromaticAberration` | yes | unverified |
| `filter/chrome` | yes | unverified |
| `filter/clouds` | yes | unverified |
| `filter/colorReplace` | yes | unverified |
| `filter/convolutionFeedback` | yes | unverified |
| `filter/corrupt` | yes | unverified |
| `filter/craquelure` | yes | unverified |
| `filter/crt` | yes | unverified |
| `filter/degauss` | yes | unverified |
| `filter/deriv` | yes | unverified |
| `filter/directionalBlur` | yes | unverified |
| `filter/dither` | yes | unverified |
| `filter/edge` | yes | unverified |
| `filter/emboss` | yes | unverified |
| `filter/extrude` | yes | unverified |
| `filter/feedback` | yes | unverified |
| `filter/fibers` | yes | unverified |
| `filter/flipMirror` | yes | unverified |
| `filter/fxaa` | yes | unverified |
| `filter/glowingEdge` | yes | unverified |
| `filter/glyphMap` | yes | unverified |
| `filter/grade` | yes | unverified |
| `filter/grain` | yes | unverified |
| `filter/grime` | yes | unverified |
| `filter/halftone` | yes | unverified |
| `filter/hatch` | yes | unverified |
| `filter/highPass` | yes | unverified |
| `filter/historicPalette` | yes | unverified |
| `filter/invert` | yes | unverified |
| `filter/lens` | yes | unverified |
| `filter/lensFlare` | yes | unverified |
| `filter/lensWarp` | yes | unverified |
| `filter/lightLeak` | yes | unverified |
| `filter/lighting` | yes | unverified |
| `filter/lowPoly` | yes | unverified |
| `filter/median` | yes | unverified |
| `filter/morphology` | yes | unverified |
| `filter/mosaicTiles` | yes | unverified |
| `filter/motionBlur` | yes | unverified |
| `filter/normalMap` | yes | unverified |
| `filter/normalize` | yes | unverified |
| `filter/octaveWarp` | yes | unverified |
| `filter/oilPaint` | yes | unverified |
| `filter/osd` | yes | unverified |
| `filter/outline` | yes | unverified |
| `filter/palette` | yes | unverified |
| `filter/parallax` | yes | unverified |
| `filter/patchwork` | yes | unverified |
| `filter/photocopy` | yes | unverified |
| `filter/pinch` | yes | unverified |
| `filter/pixelSort` | yes | unverified |
| `filter/pixels` | yes | unverified |
| `filter/plasticWrap` | yes | unverified |
| `filter/polar` | yes | unverified |
| `filter/pondRipples` | yes | unverified |
| `filter/posterize` | yes | unverified |
| `filter/prismaticAberration` | yes | unverified |
| `filter/reindex` | yes | unverified |
| `filter/relief` | yes | unverified |
| `filter/repeat` | yes | unverified |
| `filter/reverb` | yes | unverified |
| `filter/ridge` | yes | unverified |
| `filter/rotate` | yes | unverified |
| `filter/scale` | yes | unverified |
| `filter/scanlineError` | yes | unverified |
| `filter/scatter` | yes | unverified |
| `filter/scratches` | yes | unverified |
| `filter/scroll` | yes | unverified |
| `filter/seamless` | yes | unverified |
| `filter/sharpen` | yes | unverified |
| `filter/simpleAberration` | yes | unverified |
| `filter/sine` | yes | unverified |
| `filter/skew` | yes | unverified |
| `filter/smooth` | yes | unverified |
| `filter/smoothstep` | yes | unverified |
| `filter/snow` | yes | unverified |
| `filter/sobel` | yes | unverified |
| `filter/spatter` | yes | unverified |
| `filter/spinBlur` | yes | unverified |
| `filter/spiral` | yes | unverified |
| `filter/spookyTicker` | yes | unverified |
| `filter/stamp` | yes | unverified |
| `filter/step` | yes | unverified |
| `filter/stipple` | yes | unverified |
| `filter/strayHair` | yes | unverified |
| `filter/strokes` | yes | unverified |
| `filter/temporalAberration` | yes | unverified |
| `filter/tetraColorArray` | yes | unverified |
| `filter/tetraCosine` | yes | unverified |
| `filter/text` | yes | unverified |
| `filter/texture` | yes | unverified |
| `filter/threshold` | yes | unverified |
| `filter/tile` | yes | unverified |
| `filter/tint` | yes | unverified |
| `filter/translate` | yes | unverified |
| `filter/tunnel` | yes | unverified |
| `filter/unsharpMask` | yes | unverified |
| `filter/vaseline` | yes | unverified |
| `filter/vignette` | yes | unverified |
| `filter/warp` | yes | unverified |
| `filter/watercolor` | yes | unverified |
| `filter/waves` | yes | unverified |
| `filter/wind` | yes | unverified |
| `filter/wobble` | yes | unverified |
| `filter/wormhole` | yes | unverified |
| `filter/zoomBlur` | yes | unverified |
| `filter3d/flow3d` | yes | unverified |
| `filter3d/palette3d` | yes | unverified |
| `mixer/alphaMask` | yes | unverified |
| `mixer/applyMode` | yes | unverified |
| `mixer/blendMode` | yes | unverified |
| `mixer/cellSplit` | yes | unverified |
| `mixer/centerMask` | yes | unverified |
| `mixer/channelCombine` | yes | unverified |
| `mixer/distortion` | yes | unverified |
| `mixer/focusBlur` | yes | unverified |
| `mixer/mashup` | yes | unverified |
| `mixer/patternMix` | yes | unverified |
| `mixer/shadow` | yes | unverified |
| `mixer/shapeMask` | yes | unverified |
| `mixer/split` | yes | unverified |
| `mixer/thresholdMix` | yes | unverified |
| `mixer/uvRemap` | yes | unverified |
| `points/attractor` | yes | unverified |
| `points/buddhabrot` | yes | unverified |
| `points/dla` | yes | unverified |
| `points/flock` | yes | unverified |
| `points/flow` | yes | unverified |
| `points/heightGrid` | yes | unverified |
| `points/hydraulic` | yes | unverified |
| `points/lenia` | yes | unverified |
| `points/life` | yes | unverified |
| `points/physarum` | yes | unverified |
| `points/physical` | yes | unverified |
| `render/loopBegin` | yes | unverified |
| `render/loopEnd` | yes | unverified |
| `render/meshLoader` | no | unverified |
| `render/meshRender` | no | unverified |
| `render/pointsBillboardRender` | yes | unverified |
| `render/pointsEmit` | yes | unverified |
| `render/pointsRender` | yes | unverified |
| `render/render3d` | yes | unverified |
| `render/renderCubemap3d` | yes | unverified |
| `render/renderCubemapSurface` | yes | unverified |
| `render/renderLandscape3d` | yes | unverified |
| `render/renderLit3d` | yes | unverified |
| `synth/bitwise` | yes | unverified |
| `synth/cell` | yes | unverified |
| `synth/cellularAutomata` | yes | unverified |
| `synth/curl` | yes | unverified |
| `synth/gabor` | yes | unverified |
| `synth/gradient` | yes | unverified |
| `synth/julia` | yes | unverified |
| `synth/mandala` | yes | unverified |
| `synth/mandelbrot` | yes | unverified |
| `synth/media` | yes | unverified |
| `synth/mnca` | yes | unverified |
| `synth/modPattern` | yes | unverified |
| `synth/navierStokes` | yes | unverified |
| `synth/newton` | yes | unverified |
| `synth/noise` | yes | unverified |
| `synth/osc2d` | yes | unverified |
| `synth/pattern` | yes | unverified |
| `synth/perlin` | yes | unverified |
| `synth/polygon` | yes | unverified |
| `synth/reactionDiffusion` | yes | unverified |
| `synth/remap` | yes | unverified |
| `synth/roll` | no | unverified |
| `synth/sacredGeometry` | yes | unverified |
| `synth/scope` | no | unverified |
| `synth/shape` | yes | unverified |
| `synth/solid` | yes | unverified |
| `synth/spectrum` | no | unverified |
| `synth/subdivide` | yes | unverified |
| `synth/testPattern` | yes | unverified |
| `synth3d/cell3d` | yes | unverified |
| `synth3d/cellularAutomata3d` | yes | unverified |
| `synth3d/flythrough3d` | yes | unverified |
| `synth3d/fractal3d` | yes | unverified |
| `synth3d/heightmap3d` | yes | unverified |
| `synth3d/noise3d` | yes | unverified |
| `synth3d/reactionDiffusion3d` | yes | unverified |
| `synth3d/shape3d` | yes | unverified |

## 4. Evidence

Worker audit CI boundary, 2026-09-26: the audited SHA triggered no workflow. Documentation-only commits match no path filter.
Nearest exact-source delivery dispatches at `bfbe547` passed: Export kit 36205713332 and Downstream 36205713330.
No workflow runs the port unit or parity gates. A passing dispatch does not qualify rendered parity.
Raw evidence: run `audit-20260926-010135` in the shared series state, file `evidence-audit-20260926-010135/result-noisemaker-for-cpu.json`.

Review CI boundary: Exact-source runs: Export kit, Downstream. A passing export dispatch does not qualify rendered parity. Current complete-render enforcement remains an open verification requirement. [Exact-source responses and workflows](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/noisemaker-for-cpu-remote-evidence.json).

[Earlier audit and review evidence](COMPLETION_GAPS.md#3-methods-and-evidence). [Exact-source Actions](https://github.com/noisefactorllc/noisemaker-for-cpu/actions?query=head_sha%3Af2eb495d70abcb74e3632e7a652a4f83e4f3b11e).
[This run evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-20260924-remaining-gap-documents) retains commands, exit codes, source identities, and distribution metadata.
Official host references and historical environment limits remain in the linked gap register.
Source CI, export dispatch, artifact delivery, and rendered parity are separate evidence dimensions.
A successful dispatch or unit-test summary does not establish a full rendered gate.

## 5. Open compatibility limits

Next bounded check: the implementation job repairs `filter/crt`. Then rerun `node scripts/parity/run.js --json` with unchanged tolerances and authority inputs.
This audit reproduced the failure on 2026-09-26. Account separately for all 41 skips and the five missing effects. Do not close full parity until every required case executes and matches.
See the stable entries in [completion gaps](COMPLETION_GAPS.md).

See [GAP-002 and the complete gap register](COMPLETION_GAPS.md#4-known-gaps) for evidence, dependencies, and acceptance criteria.

1. Reconcile the current authority and complete case inventory, including parameters, inputs, stateful frames, and host versions.
2. Run the existing actual-renderer suite without skip options. Record every missing, failed, refused, or timed-out case.
3. Verify installation, useful output, errors, recovery, upgrades, and removal with the actual distribution.
4. Inspect exact-source CI and retain artifact hashes. Keep unresolved qualification failed or unverified.

All eligible ports have equal priority. Full parity and zero skipped cases remain the goal.
Implementation corrections remain with the separate job. This report does not advance the parity checkpoint.

## 6. History

Worker audit on 2026-09-26 at `ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5`: reran the full gate and bounded usability checks. All eight gaps remain open. No closure claimed. New published authority `1.0.184` at `9574362` is unqualified and recorded as pending.
Daily review on 2026-09-25 at `6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85`: source freshness and bounded evidence reviewed. Open qualification limits retained. [Retained review evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/cpu-current-probe.json). No new closure claimed.

| Date | Source | Result | Change |
| --- | --- | --- | --- |
| 2026-09-26 | `ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5` | Full qualification unverified | Worker audit updated this report and the gap register. Gate and CLI checks rerun. New authority revision recorded. |
| 2026-09-24 | `f2eb495d70abcb74e3632e7a652a4f83e4f3b11e` | Full qualification unverified | Created the requested maintained compatibility report. Preserved historical evidence and open gaps. |

Run: `20260924-remaining-gap-documents`. Later audits and reviews update this report with source-bound results.
