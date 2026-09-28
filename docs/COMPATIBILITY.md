# noisemaker-for-cpu: compatibility report

## 1. Source and authority revisions

Worker audit: 2026-09-26. Run ID: `audit-20260926-010135`. Audited source: [`ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5`](https://github.com/noisefactorllc/noisemaker-for-cpu/commit/ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5).
Full rendered parity at this SHA: **unverified**. The bounded gate still fails. This is not a release approval.
Kernel pin: `8eeb7b5ac14eb37a8d16037f607a88ce63924cd3`, upstream tag `v1.0.183`.
Current upstream main: `95743621696483b91968992ef6ee0d87b2089fa8`. Published Noisemaker authority: `1.0.184` at that source.
The published effect manifest is byte-identical across `1.0.179` through `1.0.184`. Its SHA-256 is `05c4d7b7744837ae90a3bb4c89e5403ff09448a74d9d7e824abb3d719ad3314e`, with 210 effect IDs.
Two runtime `shaders/` commits separate the pin from the published source. Their parity is unqualified.
Served kit then: `0.1.32`, source `bfbe54764eee87c8f67d2b281d5f304faad04a5b`. [Retrieved metadata](https://kits.noisedeck.app/cpu/0/deployment-meta.json). That tree differs from the audited source only in the gap register.

### Daily review, 2026-09-28

Reviewed source: `fd9d56c74ce7500b7eaeea90a93d3bf49375d28e`, current local and remote `main`. Full rendered parity stays **unverified**. Kernel pin: `73c15be0`. Upstream `main` `6b05a270` sits three docs or dependency commits past it. The `shaders/` tree stays unchanged. Published authority: `1.0.196` at `296e0138`. Served kit: `0.1.38` at this source.
The review reopened GAP-003 under the 2026-09-27 closure rule and verified the GAP-004, GAP-007, and GAP-008 closures. Evidence: run `review-20260928-213000` in the shared series state.

### Source-lock sync, 2026-09-28 (upstream `296e0138`..`73c15be0`)

The port's source lock now pins upstream `73c15be00d6888f4b5d2835d8e242ee9e840df45` (current upstream `main`, which equals this job's declared end `73c15be0`; `git merge-base --is-ancestor 296e0138c4744ed485b2e95de3eeb466c17629ee 73c15be00d6888f4b5d2835d8e242ee9e840df45` exits 0 against a fresh full clone, so the delivery is proven contiguous ancestry from the prior pin. The job's consolidated source range `a912749fab5c..73c15be00d68` is covered transitively: `a912749f` is an ancestor of the prior pin `296e0138` (verified during the prior sync), and the three observed trigger ranges `04e8582..c28e8fdb`, `c28e8fdb..7aff843`, and `7aff843..73c15be` are consecutive slices of the audited range `296e0138..73c15be0`).

Unlike the two prior syncs, `shaders/src/` is not byte-identical across the range, so `PINNED_SOURCE_DIGEST` changes to `b78f27e2…` and `PINNED_SOURCE_MANIFEST_DIGEST` to `1cb5f244…`; both were recomputed from the fresh clone checked out at `73c15be0` (1132 entries) and are cross-checked entry-by-entry against that checkout by the env-gated test. `shaders/effects/` remains byte-identical (0-byte diff), so the 205-effect catalog, parameter contracts, and generated canonical kernels are unchanged — canonical-kernel regeneration produced no diff, and the snapshot changed only in its `revision` field.

Range audit, 2026-09-28, against a fresh clone at `/state/cache/noisemaker-upstream` (checked out at `73c15be0`):

- `git log --oneline 296e0138..73c15be0 -- shaders/` lists 3 commits; range diffstat over `shaders/` is 8 files, 1486 insertions, 14 deletions.
- `04e8582c` (docs checkpoint) touches no `shaders/` paths.
- `c28e8fdb` re-binds the framebuffer after initial depth allocation in the upstream WebGL2 backend (`shaders/src/runtime/backends/webgl2.js`, +2) with a `shaders/tests/test_mesh_first_frame.mjs` regression.
- `7aff843a` (GAP-024) is upstream harness/tests-only: session-identity tooling and browser readiness/backend-switch binding under `shaders/tests/`.
- `73c15be0` (GAP-026) adds production `onInit`/`onUpdate`/`onDestroy` lifecycle-hook invocation to the upstream GPU `Pipeline` (`shaders/src/runtime/pipeline.js`, +129/-1) plus an optional `initLifecycleEffects` call in the recompile path (`shaders/src/runtime/compiler.js`, +3), with `shaders/tests/test_lifecycle_hooks.js` regressions.
- The CPU port consumes the pinned tree only through the `shaders/effects` definitions at inventory time; it has no GPU backends and no upstream-Pipeline/lifecycle-hook surface (grep over `src/` and `bin/` for `onInit|onUpdate|onDestroy|initAsyncEffects|lifecycle` matches only an unrelated comment), and its parity gate compares against committed GPU goldens rather than a live reference renderer. None of the three `shaders/src` changes has a CPU-side equivalent to change; only the pinned manifest's three `shaders/src` entries (sizes/hashes) and the revision field change.

Executed with `NM_REFERENCE_ROOT` at upstream `73c15be0` (evidence per the current no-committed-logs policy: `/workspace/evidence/source-lock-sync-296e013-73c15be-audit.json` carries the per-commit range audit with upstream tree SHAs, blob identities of the three changed `shaders/src` files, digest recomputation results, command exit codes, and SHA-256s of the verbatim logs `source-lock-sync-test-full.log`, `source-lock-sync-source-tests.log`, and `source-lock-sync-parity.json`, archived with the job; no new logs were committed under `docs/evidence/`): `npm test` 285 pass / 0 fail / 1 skip (the skip is the ffmpeg-gated CLI animation test; the reference-tree manifest cross-check runs and passes); `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` exit 0 (8/8, 0 skip). Full parity gate re-run at the sync commit: `npm run parity -- --json` exit 1 as recorded under GAP-001 (163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision` `73c15be0`) — unchanged, no gap closure.

### Source-lock sync, 2026-09-27 (upstream `93229933`..`296e0138`)

The port's source lock now pins upstream `296e0138c4744ed485b2e95de3eeb466c17629ee` (current upstream `main`; `git merge-base --is-ancestor 93229933b102ba82e713402be19db57207698850 296e0138c4744ed485b2e95de3eeb466c17629ee` exits 0 against a fresh clone, so the delivery — including the job's flagged force-push/observed-range ambiguity — is proven contiguous ancestry from the prior pin, not assumed: the job's consolidated range `12b4d74f..a912749f` ends at `a912749f`, an ancestor of the new pin whose observed trigger range `7c5f176..a912749` is a contiguous suffix of the audited range (`7c5f176` is the direct child of the prior pin and the parent of `a912749f`), and the second observed trigger range `11d7c69..296e013` falls inside the audited range by transitivity: `93229933` (the prior pin) is an ancestor of `11d7c69`, and `11d7c69` is an ancestor of `296e013` and of the new pin). The 205-effect catalog is byte-identical to the prior pin: `git diff 93229933b102ba82e713402be19db57207698850..296e0138c4744ed485b2e95de3eeb466c17629ee -- shaders/effects/ shaders/src/` is empty, and regenerating the canonical kernels produces no diff. Because both pinned paths are byte-identical across the range, the unchanged `PINNED_SOURCE_DIGEST` (`e371a165…`) and `PINNED_SOURCE_MANIFEST_DIGEST` (`8bb68100…`) are not stale artifacts: both were recomputed from the fresh clone checked out at `296e0138c4744ed485b2e95de3eeb466c17629ee` and match the committed constants exactly, and the reference-tree manifest cross-check (1132 entries) ran and passed.

Range audit, 2026-09-27, against a fresh clone of `https://github.com/noisefactorllc/noisemaker.git` at `/state/cache/noisemaker-upstream` (checked out at `296e0138c4744ed485b2e95de3eeb466c17629ee`):

- `git log --oneline 93229933b102ba82e713402be19db57207698850..296e0138c4744ed485b2e95de3eeb466c17629ee -- shaders/` lists 2 commits; range diffstat over `shaders/` is 5 files, 1135 insertions, 1 deletion. `shaders/effects/` and `shaders/src/` are both untouched (0-byte diffs).
- `7c5f1765` and `11d7c699` touch no `shaders/` paths (upstream `LEDGER.md`/`llms-full.txt` docs checkpoints).
- `a912749f` (GAP-019) and `296e0138` (GAP-021) are the only `shaders/` commits, and they touch only `shaders/tests/`: `a912749f` adds `shaders/tests/passthrough-input.js` (a live write-blit control probe that distinguishes true input passthrough from a re-upload path) and `test_passthrough_input.js` regressions; `296e0138` adds `shaders/tests/frame-resolution.js` (requested-vs-returned frame-resolution reporting on every `renderEffectFrame` result) and `test_frame_resolution.js` regressions; both extend the upstream test harness (`test-harness.js`) and register their new tests in upstream `scripts/run-js-tests.js` (outside `shaders/`). All of this is upstream's own test-harness tooling; the CPU port consumes the pinned tree only through the `shaders/effects` definitions and the `shaders/src` Effect base class at inventory time, and has no code path into `shaders/tests`, so there is no CPU-side equivalent to change and `pinned-source-manifest.json` changes only in its `revision` field.

Executed with `NM_REFERENCE_ROOT` at upstream `296e0138` (committed evidence: `docs/evidence/source-lock-sync-9322993-296e0138-audit.json` carries the per-commit range audit, the recomputed digest cross-check, blob identities of the five changed `shaders/tests` files, the executed commands with exit codes, and SHA-256s of the verbatim committed logs `source-lock-sync-test-full.log`, `source-lock-sync-source-tests.log`, and `source-lock-sync-parity.json`): `npm test` 279 pass / 0 fail / 1 skip (the reference-tree manifest cross-check runs and passes); `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` exit 0 (8/8, 0 skip). Full parity gate re-run at the sync commit: `npm run parity -- --json` exit 1 as recorded under GAP-001 (163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision` `296e0138`) — unchanged, no gap closure.

### Source-lock sync, 2026-09-27 (upstream `12b4d74f`..`93229933`)

The port's source lock now pins upstream `93229933b102ba82e713402be19db57207698850` (through current upstream `main`; `git merge-base --is-ancestor 12b4d74fb4f28d5f00bb1dde107fa8673814d8b9 93229933b102ba82e713402be19db57207698850` exits 0 against a fresh clone, so the delivery — including the job's flagged force-push/observed-range ambiguity, whose observed range `8fe3ccaf..93229933` is a contiguous suffix of the audited range (`8fe3ccaf` is the direct child of the prior pin `12b4d74f` and the parent of the tip) — is proven contiguous ancestry from the prior pin, not assumed). The 205-effect catalog is byte-identical to the prior pin: `git diff 12b4d74fb4f28d5f00bb1dde107fa8673814d8b9..93229933b102ba82e713402be19db57207698850 -- shaders/effects/ shaders/src/` is empty, and regenerating the canonical kernels produces no diff. Because both pinned paths are byte-identical across the range, the unchanged `PINNED_SOURCE_DIGEST` (`e371a165…`) and `PINNED_SOURCE_MANIFEST_DIGEST` (`8bb68100…`) are not stale artifacts: both were recomputed from the fresh clone checked out at `93229933b102ba82e713402be19db57207698850` and match the committed constants exactly, and the reference-tree manifest cross-check (1132 entries) ran and passed.

Range audit, 2026-09-27, against a fresh clone of `https://github.com/noisefactorllc/noisemaker.git` at `/state/cache/noisemaker` (checked out at `93229933b102ba82e713402be19db57207698850`):
- `git log --oneline 12b4d74fb4f28d5f00bb1dde107fa8673814d8b9..93229933b102ba82e713402be19db57207698850 -- shaders/` lists 1 commit; range diffstat over `shaders/` is 3 files, 439 insertions, 2 deletions. `shaders/effects/` and `shaders/src/` are both untouched (0-byte diffs).
- `ec457c2e` and `8fe3ccaf` touch no `shaders/` paths (upstream `LEDGER.md`/`llms-full.txt` docs checkpoints only).
- `93229933` (GAP-017) is the only `shaders/` commit, and it touches only `shaders/tests/`: it adds `shaders/tests/definition-schema.js` (lossless definition-schema introspection auditing live definitions against the vendored Shade MCP projection), extends the upstream Node/WebGPU test harness (`test-harness.js`) with a no-browser `--describe` mode, adds `test_definition_schema.js` regressions, and (outside `shaders/`) registers the new test in upstream `scripts/run-js-tests.js`. All of this is upstream's own test-harness tooling; the CPU port consumes the pinned tree only through the `shaders/effects` definitions and the `shaders/src` Effect base class at inventory time, and has no code path into `shaders/tests`, so there is no CPU-side equivalent to change and `pinned-source-manifest.json` changes only in its `revision` field.

Executed with `NM_REFERENCE_ROOT` at upstream `93229933` (committed evidence: `docs/evidence/source-lock-sync-12b4d74f-9322993-audit.json` carries the per-commit range audit, the recomputed digest cross-check, blob identities of the three changed `shaders/tests` files, the executed commands with exit codes, and SHA-256s of the verbatim committed logs `source-lock-sync-test-full.log`, `source-lock-sync-source-tests.log`, and `source-lock-sync-parity.json`): `npm test` 279 pass / 0 fail / 1 skip (the reference-tree manifest cross-check runs and passes); `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` exit 0 (8/8, 0 skip). Full parity gate re-run at the sync commit: `npm run parity -- --json` exit 1 as recorded under GAP-001 (163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, mean 5.05859375, `sourceRevision` `93229933`) — unchanged, no gap closure.

### Source-lock sync, 2026-09-27 (upstream `7443f6e6`..`12b4d74f`)

The port's source lock now pins upstream `12b4d74fb4f28d5f00bb1dde107fa8673814d8b9` (through current upstream `main`; `git merge-base --is-ancestor 7443f6e6180300a45c5b97608459e5094504659d 12b4d74fb4f28d5f00bb1dde107fa8673814d8b9` exits 0 against a fresh clone, so the delivery — including the job's flagged force-push/observed-range ambiguity, whose three observed ranges all fall inside the already-audited-and-pinned `403c2a4..7443f6e6` window plus this one — is proven contiguous ancestry from the prior pin, not assumed). The 205-effect catalog is byte-identical to the prior pin: `git diff --stat 7443f6e6180300a45c5b97608459e5094504659d..12b4d74fb4f28d5f00bb1dde107fa8673814d8b9 -- shaders/effects/` is empty, and regenerating the canonical kernels produces no diff.

Range audit, 2026-09-27, against a fresh clone of `https://github.com/noisefactorllc/noisemaker.git` at `/state/cache/noisemaker-upstream` (checked out at `12b4d74fb4f28d5f00bb1dde107fa8673814d8b9`):
- `git log --oneline 7443f6e6180300a45c5b97608459e5094504659d..12b4d74fb4f28d5f00bb1dde107fa8673814d8b9 -- shaders/` lists 3 commits; range diffstat over `shaders/` is 8 files, 1158 insertions, 18 deletions. `shaders/effects/` is untouched.
- `c2252f0c` (GAP-015 metric interchangeability mirror) and `e73a44a3` (GAP-014 frame warm-up before explicit-time pauses) touch only `shaders/tests/` (upstream's Node/WebGPU render harness) — harness code the CPU port does not consume. `132d1bf9` touches no `shaders/` paths (upstream `LEDGER.md`/`llms-full.txt` docs checkpoint only).
- `12b4d74f` (GAP-016) is the only `shaders/src` commit: it adds `shaders/src/runtime/preflight.js` (`preflightEffect`/`mrtFormatBytes` — static per-backend authorability and device-limit prediction: WebGL2/WebGPU GLSL-vs-WGSL source availability, `maxDrawBuffers`, `maxColorBytesPerSample` MRT demotion, `maxTextureSize` clamps) and refactors `Pipeline.mrtFormatBytes` to delegate to it plus a read-only `Pipeline.preflight()`. All of this is GPU-backend device-capability machinery; the CPU port has no GPU backends and no device-limit path (grep for `mrtFormatBytes|preflight|applyMrtFormatBudget|maxDrawBuffers|maxTextureSize|maxColorBytesPerSample` over the port's `src/` and `scripts/` returns no definitions, and the port consumes the pinned `shaders/src` only through the unmodified `Effect` base class at inventory time), so there is no CPU-side equivalent to change; the committed manifest entries for the two files are the only carrier of this change.
- `pinned-source-manifest.json` diff corroborates the audit: the `revision` field plus exactly two `shaders/src/runtime` entries (`pipeline.js` hash/size update, new `preflight.js` entry) change; no `shaders/effects` entry changes.

Executed with `NM_REFERENCE_ROOT` at upstream `12b4d74f` (committed evidence: `docs/evidence/source-lock-sync-7443f6e6-12b4d74f-audit.json` carries the per-commit range audit, blob identities of the two changed `shaders/src` files, the executed commands with exit codes, and SHA-256s of the verbatim committed logs `source-lock-sync-test-full.log`, `source-lock-sync-source-tests.log`, and `source-lock-sync-parity.json`): `npm test` 279 pass / 0 fail / 1 skip (the reference-tree manifest cross-check runs and passes); `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` exit 0 (8/8, 0 skip). Full parity gate re-run at the sync commit: results recorded in the pass-history row.

### Source-lock sync, 2026-09-27 (upstream `6a0af04d`..`7443f6e6`)

The port's source lock now pins upstream `7443f6e6180300a45c5b97608459e5094504659d` (through current upstream `main`; `git merge-base --is-ancestor 6a0af04d3c4f345ffab5e9f8e54e532216b4cdaa 7443f6e6180300a45c5b97608459e5094504659d` exits 0 against a fresh clone, so the delivery — including the flagged force-push/observed-range ambiguity — is proven contiguous ancestry from the prior pin, not assumed). The 205-effect catalog is byte-identical to the prior pin: `git diff --stat 6a0af04d3c4f345ffab5e9f8e54e532216b4cdaa..7443f6e6180300a45c5b97608459e5094504659d -- shaders/effects/` is empty, and regenerating the canonical kernels produces no diff.

Range audit, 2026-09-27, against a fresh clone of `https://github.com/noisefactorllc/noisemaker.git` at `/state/cache/noisemaker-upstream` (checked out at `7443f6e6180300a45c5b97608459e5094504659d`):
- `git log --oneline 6a0af04d3c4f345ffab5e9f8e54e532216b4cdaa..7443f6e6180300a45c5b97608459e5094504659d -- shaders/` lists 5 commits; range diffstat over `shaders/` is 14 files, 1826 insertions, 18 deletions. `shaders/effects/` is untouched.
- Four commits (`b35361e0` GAP-009, `9f85687d` GAP-010, `7dc0f564` GAP-011, `7443f6e6` GAP-012) touch only `shaders/tests/` (upstream's Node/WebGPU render harness: frame metrics, readback pinning, uniform-delta/status aggregation) — harness code the CPU port does not consume.
- `403c2a4b` (GAP-008) is the only `shaders/src` commit: `shaders/src/index.js`, `shaders/src/lang/index.js`, `shaders/src/lang/paramAliases.js`, `shaders/src/lang/transform.js`, adding a `predictReplacement`/`preflight` prediction layer to the upstream DSL's `replaceEffect`/`getCompatibleReplacements` mutation APIs. The CPU port has no replacement/transform layer (its `src/dsl` compiler exposes no `replaceEffect` or compatible-replacements API — the only `paramAliases` use is argument-name resolution in `src/effects/definition.js` and `src/dsl/compiler.js`), so there is no CPU-side equivalent to change; the committed manifest entries for the four files are the only carrier of this change.
- `pinned-source-manifest.json` diff corroborates the audit: the `revision` field plus exactly the four `shaders/src` entry hashes/sizes change; no `shaders/effects` entry changes.

Executed with `NM_REFERENCE_ROOT` at upstream `7443f6e6` (committed evidence: `docs/evidence/source-lock-sync-6a0af04d-7443f6e6-audit.json` carries the per-commit range audit, blob identities of the four changed `shaders/src` files, the executed commands with exit codes, and SHA-256s of the verbatim committed logs `source-lock-sync-test-full.log`, `source-lock-sync-source-tests.log`, and `source-lock-sync-parity.json`): `npm test` 279 pass / 0 fail / 1 skip (the reference-tree manifest cross-check runs and passes); `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` exit 0. Full parity gate re-run at the sync commit: results recorded in the pass-history row.

### Source-lock sync, 2026-09-26 (commit `a1801be`)

The port's source lock now pins upstream `6a0af04d3c4f345ffab5e9f8e54e532216b4cdaa` (through current upstream `main`, proven a descendant of the prior pin `8eeb7b5a` and of range start `fca611fd`). The 205-effect catalog is byte-identical to the prior pin. The range's three runtime `shaders/` commits (texture-pooling consumption `6113da00`, viewport-without-clear pooling safety `95743621`, backend diagnostic union `f83a427e`) target the GPU pipeline and WebGL2/WebGPU backends; the CPU renderer keeps one surface per virtual texture and has no GPU backends, so no CPU behavioral change applies. Executed at `a1801be` with a reference checkout at `6a0af04d`: `npm test` 278 pass / 0 fail / 1 skip; `npm run parity -- --json` exit 1 as recorded under GAP-001: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max error 80 — unchanged, no gap closure. Rendered parity remains unqualified under GAP-002/GAP-008.

Range audit, 2026-09-26, against a fresh clone of `https://github.com/noisefactorllc/noisemaker.git` at `/state/cache/noisemaker` (checked out at `6a0af04d`). Reproduce with `git clone`, then `git merge-base --is-ancestor <A> <B>`:
- `git merge-base --is-ancestor 8eeb7b5a 6a0af04d` and `... fca611fd 6a0af04d` both exit 0, so the job range is contiguous delivery through the new pin; the force-push flag is covered by ancestry, not assumed.
- `git log --oneline fca611fd..6a0af04d -- shaders/` lists 11 commits. Eight pre-date the previous pin `8eeb7b5a` (`66b2c721`, `240740dd`, `ba87ffae`, `9d3474df`, `a021a283`, `62eb56fa`, `2f47612c`, `fa83eeab`) and were already ported by the `bfbe5476`/earlier syncs. Three are new in this sync:
- `8eeb7b5a..6a0af04d -- shaders/src` diffstat: `backends/diagnostics.js` +185 (new), `backends/webgl2.js` 33, `backends/webgpu.js` 95, `runtime/pipeline.js` 215; 4 files, 484 insertions, 44 deletions. No `shaders/effects` or `shaders/src/lang` file changes in this sub-range.
- `runtime/pipeline.js` +215 lines is exactly `6113da00` (+206: `Pipeline` `texturePooling` option, `buildTexturePoolingPlan`/`releaseRegroupedTextures`/`applyTextureAliases`/`getResourcePlan`, aliased allocation skip) plus `95743621` (+9: one `else if` adding viewport-without-clear outputs to the pooling plan's `partiallyWritten` set). Both only guard/serve the opt-in pooled-storage path; the CPU renderer allocates one surface per virtual texture (`this.pool.acquire`, no aliasing) and has no `Pipeline`/`backend.textures` equivalent, so neither changes CPU behavior. `f83a427e` touches only WebGL2/WebGPU backends and their new diagnostics module, which the CPU port does not contain.
- File identities at the two revisions: `shaders/src/runtime/pipeline.js` sha256 `863781417a198f76158c284e580765995a1f7668d8e5e446cec84a81bdb68306` at `8eeb7b5a`, `3675dca3b2126aad6e970cb671cdd2bd6c50d3d329d6cc45d3abba66ed8ec6f7` at `6a0af04d`.

Exact-source closure at the published candidate `d03aed7b30384bcebc04bc7f73a7f750ce3b2227` (2026-09-26): commits `f935c34` and `d03aed7` after the functional sync `a1801be` are documentation-only (`git diff --stat a1801be..d03aed7` shows only `docs/COMPATIBILITY.md` and `docs/COMPLETION_GAPS.md`, 13 insertions). Re-executed at `d03aed7` with `NM_REFERENCE_ROOT` at upstream `6a0af04d`: `npm test` 278 pass / 0 fail / 1 skip; `node --test test/upstream-source-lock.test.js test/upstream-inventory.test.js` 8 pass / 0 fail / 0 skip (manifest cross-checks run); `npm run parity -- --json` exit 1 unchanged: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max error 80, mean 5.05859375, `sourceRevision` `6a0af04d`. Served kit: `https://kits.noisedeck.app/cpu/0/deployment-meta.json` now reports `version 0.1.33`, `git_hash d03aed7b30384bcebc04bc7f73a7f750ce3b2227` (the export-kit workflow's push paths include `src/**`, so the kit was rebuilt at the candidate SHA). Served files fetched from the kit host are byte-identical to the candidate tree: `engine/src/index.js` sha256 `222f58d4ce1f046c98207175b906b072ea4801a5d94a9c40c5b9ddeaf4d9f7a8`, `engine/bin/noisemaker-cpu.js` sha256 `96d09295c0292a68478fc0c22872d8ea56ac8209cf7ff8182fe2ad8629a36cd4`. The committed `pinned-source-manifest.json` diff corroborates the range audit: only the `revision` field and four `shaders/src/runtime` entry hashes/size changed (`pipeline.js`, `webgl2.js`, `webgpu.js`) plus the new `backends/diagnostics.js` entry; no `shaders/effects` entry changed.

### Bounded external-input comparison, 2026-09-26 (GAP-002)

One bounded external-input comparison, as GAP-002's next action required, defined and executed with the retained authority.

- Input: a deterministic asymmetric 37×19 RGBA8 PNG. Channel recipe, for pixel `(x, y)`: R `(x*7+13) mod 256`, G `(y*11+x*3) mod 256`, B `200` for `x < 19` else `(x+y*5) mod 256`, A `255`. sha256 `697e387f067377be726917cbd03d2923a259595cada53e0e8dcb59f1904e5df8`.
- Program (identical bytes on both sides):

```
search synth

media(bgColor: #000000, bgAlpha: 1)
  .write(o0)

render(o0)
```

- CPU side at `ea198510` and re-executed at `4b590d2` (same functional tree; Node 26.5.1): the public CLI (`node bin/noisemaker-cpu.js render <program> --input <input> --width 37 --height 19 --time 0 --seed 1`) and `effect synth/media --input ...` produced byte-identical PNGs, sha256 `75335647e2336c2e9d50651c0df940564d112bc953ce88fdbe6b5767f66b81b5`. The ESM entry (`CpuRenderer` from `src/index.js` with the PNG bound as `imageTex`/`textTex` through `Surface.fromRgba8`) produced the same bytes synchronously and asynchronously (`render` and `renderAsync` byte-identical, matching the CLI PNG).
- Authority side: upstream Noisemaker at `6a0af04d3c4f345ffab5e9f8e54e532216b4cdaa` (the port's source-lock pin), its `CanvasRenderer` on WebGL2 under headless Chromium 154.0.8037.57 (SwiftShader, `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader-webgl`), the same DSL compiled by the upstream compiler, the same PNG uploaded as the `imageTex_step_0` pass input via `updateTextureFromSource` (37×19 confirmed), canvas 37×19, `render(0)` twice, `o0` read back via `backend.readPixels` (2,812 bytes, 37×19×4). The authority render was executed twice with byte-identical readbacks; RGBA readback sha256 `cb793babf1fa776c9ed177b3032d16a7b29ff7490261ec19f810ddb8eee4aae0`.
- Channel metrics for the same input, CPU PNG bytes vs authority readback (and vs the vertically flipped CPU bytes, since readback orientation is ambiguous without the retained golden convention): max error 0, mean error 0, differing channels 0, channels over ±2 tolerance 0 — byte-exact, well inside the gate's ±2 tolerance.
- Scope limits: this qualifies one effect (`synth/media`), one input, one size, `time 0`, `seed 1` on one machine. It does not close the 41 parity-gate skips, GAP-001's CRT failure, multi-frame state, cancellation, long renders, or wider parameter combinations, and no cross-machine or real-GPU stability is claimed for the SwiftShader authority run.

### Bounded landscape authority comparison, 2026-09-26 (GAP-003)

2026-09-27 native follow-up: all six identical cases are byte-exact on Apple M4/Metal (Chromium 151.0.7922.34) at authority `6a0af04d`, with the involved effect sources unchanged through candidate pin `296e0138`. The 2026-09-28 review re-hashed the six effect sources at pin `73c15be0`; they are unchanged, so the qualification covers the current pin. GAP-003 stays open under the operator's 2026-09-27 rendered-parity closure rule: the port publishes no supervisor-run `scripts/parity-summary`, and the whole-port count remains 164 executed of 205 eligible with 41 skips and `filter/crt` failing. The native result is retained as bounded evidence. Historical SwiftShader results below remain valid for that backend. CRT remains open and failing; retained fixtures, tolerance, and 41 full-gate skips are unchanged. [Native hashes and metrics](../landscape-authority-comparison.json).

The authority pixel comparison GAP-003 required, for both existing `filtering` modes and both projections, defined and executed against the recorded authority pin. It is recorded as required evidence while the retained goldens' capture identity remained unestablished (GAP-008 has since given every comparison a visible unknown-provenance marker; the capture backend itself is still unidentified); rendered parity against the retained goldens is still unaccepted. Full methodology, program bytes, SHA-256s, channel metrics, and the root-cause measurements are in `landscape-authority-comparison.json`.

- Authority: upstream Noisemaker at the recorded pin `44bc4ed4ac729bddaa95b083d64bee942ade35da` (published runtime `1.0.169`), `CanvasRenderer` on WebGL2 under headless Chromium 153.0.8010.12 (SwiftShader, `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader-webgl`), from a fresh clone. Provenance: `git log 44bc4ed4..6a0af04d -- shaders/effects/render/renderLandscape3d shaders/effects/synth3d/heightmap3d shaders/effects/synth/testPattern` is empty, so the shipped landscape/heightfield/testPattern effect sources are identical between the authority pin and the port's current kernel pin `6a0af04d`. Involved source SHA-256s at `44bc4ed4`: `landscape.glsl` `c9e9ab5c…b07ff8`, `renderLandscape3d/definition.js` `cc31afef…a9b29`, `heightmap3d/glsl/precompute.glsl` `d43f213b…36d759`, `heightmap3d/definition.js` `2720f1d0…e6fa8`, `testPattern/glsl/testPattern.glsl` `f913300a…3cb20`, `testPattern/definition.js` `35a71f6a…5dbe4`.
- Fixture (identical program bytes on both sides, parameters taken from the upstream effect's own `parity-case.json` at `44bc4ed4`): 96×80 canvas, time 0, seed 1, DSL `search synth, synth3d, render`; `testPattern(pattern: gradient).write(o1)`; `testPattern(pattern: colorBars).write(o2)`; `heightmap3d(heightTex: read(o1), tex: read(o2), volumeSize: x32, heightScale: 0.6, baseHeight: 0.1).renderLandscape3d(viewMode: <ortho|perspective>[, filtering: <voxel|isosurface>], rotateX: 0.62, rotateY: 0.5, posY: 12).write(o0)`; `render(o0)`. The nested-call form of the upstream parity case is used in its `read(o1)`/`read(o2)` form because the CPU DSL parser does not accept effect calls as texture arguments; both sides run this exact same text.
- Authority readback: after `compile`, `stop`, `render(0)` twice, `o0` was read through `backend.readPixels('global_o0_write')`, which returns top-down RGBA8 (the backend flips the bottom-up GL readback and quantizes the o0 `rgba16f` surface with `round(v*255)`). Each of the six readbacks was produced twice across two independent harness runs with byte-identical results.
- CPU side: public ESM entry (`CpuRenderer` from `src/index.js`, `render(dsl, { width: 96, height: 80, time: 0, seed: 1 }).toRgba8()`) at source `7145223b`, Node 26.5.1; re-executed twice with byte-identical results, and the public CLI (`bin/noisemaker-cpu.js render`, 96×80, time 0, seed 1) produced PNGs that decode to the identical RGBA bytes for all six programs.
- Declared gate (unchanged): the existing parity gate's rule — every RGBA byte difference at most 2. Orientation verified by byte-exact agreement in one orientation only (the flipped CPU bytes disagree everywhere, as expected, so orientation is unambiguous).

| mode | projection | max error | mean error | differing bytes | bytes over ±2 | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| default (voxel) | ortho | 0 | 0 | 0 | 0 | pass, byte-exact |
| voxel | ortho | 0 | 0 | 0 | 0 | pass, byte-exact |
| isosurface | ortho | 1 | 0.000391 | 12 | 0 | pass |
| default (voxel) | perspective | 78 | 0.0033854 | 4 | 3 | fail |
| voxel | perspective | 78 | 0.0033854 | 4 | 3 | fail |
| isosurface | perspective | 78 | 0.0063147 | 94 | 3 | fail |

Ortho is byte-exact for default and voxel (CPU SHA-256 `82164e81…3a82f` equals the authority readback; isosurface `55436ae7…0f6cb` differs from the authority `a7c0d3b6…3e7a` only in 12 of 30,720 bytes). Default and voxel are byte-identical on each side, matching the upstream release test's default≡voxel expectation. Perspective diverges in all three modes at exactly one pixel, `(46, 75)`, where the CPU renders one extra silhouette voxel pixel (`0,89,0,255`) and the authority shows background (`6,11,19,255`) — 3 bytes over ±2 carrying 103 of the 104 total byte difference; the fourth differing byte is a level-1 quantization byte at `(37, 66)`. CPU threshold probes (0.5, 0.499, 0.49, 0.45) do not move this pixel, so it is not a threshold knife-edge on the CPU side. The isosurface ortho delta is 12 bytes at quantization level 1.

Root cause of the perspective divergence (measured; see the JSON artifact for the numbers): the grazed ray enters and leaves the volume box only 0.0043 apart (`enter` 68.3732, `leave` 68.3775), and both engines agree the first DDA cell `(13,0,31)` is solid — the GPU atlas at that voxel has density 1 and color `(0,1,0,1)`, identical to the CPU's — but SwiftShader's runtime (uniform-operand) vectorized `cos`/`sin` differ from CPU libm f32 rounding by roughly 1e-5 to 4e-5 relative (`cos(0.62)` 0.8139131 vs 0.8138785), which moves `farT.y`/`nearT.z` enough to close the gap, so the authority's ray exits before the solid voxel. Recomputing the rotation with the measured SwiftShader trig reproduces the GPU-decoded direction and the sign flip. Ortho uses no trigonometry and is byte-exact, which localizes the divergence to exactly these trig sites. This is the same blocker class as GAP-001: an authority backend's undocumented transcendental bit pattern. Emulating one software rasterizer's JIT approximation in the CPU port is not a legitimate parity fix, and on other GPUs the grazing pixel could resolve either way.

- Scope limits: one fixture, one size, one time, one seed, one machine; the authority is SwiftShader WebGL2, not a real GPU; no WebGPU side was compared. GAP-003 becomes blocked: ortho satisfies the unchanged ±2 gate, but the perspective cases fail it at the grazing pixel and the root cause is the authority backend's transcendental bit pattern, which cannot be reproduced by automation in this environment (same blocker class as GAP-001). Orthographic evidence above is bounded qualification of one fixture, not full rendered parity; the 41 parity-gate skips and GAP-001's CRT failure are unchanged (`npm run parity -- --json` at `7145223b` after the comparison: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` max 80, `sourceRevision` `6a0af04d`).

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
The matrix below states each row's measured scope as of the 2026-09-28 review. A bounded verified row is not a full-platform certification.

| Dimension | Status | Measured scope or limit |
|---|---|---|
| Source-level checks | verified, bounded | Review re-ran the full gate at `fd9d56c` on 2026-09-28: 163/164 within ±2, 114 byte-exact, 41 skipped, `filter/crt` red (GAP-001). `npm test` 285 pass, 0 fail, 1 skip. |
| Actual host rendering | verified, bounded | Six 96×80 landscape cases byte-exact against the Apple M4/Metal authority on 2026-09-27, one fixture, one backend. No cross-GPU claim. The full gate keeps 41 skips and CRT failing. |
| Minimum and current host versions | verified, bounded | Clean GitHub installs at Node 22.20.0, 24.10.0, and 26.5.1 render byte-identically (2026-09-27, GAP-006 record). No wider version matrix. |
| Supported operating systems and backends | unverified | Linux container checks and one Apple M4/Metal comparison. Windows and other macOS backends remain unqualified. |
| Installed package and first useful result | verified, bounded | GitHub-install lifecycle qualified 2026-09-27: install, render, invalid-DSL recovery, byte-identical upgrade re-render, uninstall. The npm name stays unpublished (E404). |
| Parameters, external inputs, state, and chains | unverified | One bounded external-input case is byte-exact (GAP-002 record). Full current-authority combinations remain unmeasured. |
| Invalid input and recovery | verified, bounded | CLI unknown-effect and missing-input errors exit 1 with clear messages. Installed invalid-DSL recovery recorded. Not every public entry point is covered. |
| Upgrade, removal, and resource cleanup | verified, bounded | One upgrade re-rendered byte-identically and uninstall removed the package (2026-09-27). Saved-program upgrades across versions remain unqualified. |
| Accessibility of provided controls | verified, bounded | Headless Chromium 154 CDP audit on 2026-09-27: 23/23 demo controls named, keyboard and recovery checks pass (GAP-007). Real screen readers and other browsers unqualified. |
| Release readiness | blocked | Full parity fails, the npm name is unpublished, Windows and a browser floor are unqualified, and release CI runs no port gate. |

## 3. Parity coverage

### Worker audit, 2026-09-26

The existing full CPU gate exits 1 at the audited source: 164 cases executed, 114 byte-exact, 163 accepted at tolerance 2, and 41 skipped.
`filter/crt` keeps maximum error 80 and mean error 5.05859375, with 89 channels over tolerance.
The gate labels its authority with kernel pin `8eeb7b5ac14eb37a8d16037f607a88ce63924cd3` (upstream `v1.0.183`).
Five of the 210 current effect IDs remain outside the 205-effect inventory. Full parity fails.
No golden or tolerance changed since the last review.
The newly published authority `1.0.184` at `9574362` is unqualified. It adds two runtime `shaders/` commits beyond the pin.
Raw evidence: run `audit-20260926-010135` in the shared series state, file `evidence-audit-20260926-010135/result-noisemaker-for-cpu.json`.

### Daily review, 2026-09-28

The review re-executed both gates at this source. The reference root stayed at pin `73c15be0`. `npm test` gave 285 pass, 0 fail, and 1 skip. The parity gate exited 1, unchanged: 163 of 164 compared cases within ±2, 114 byte-exact, 41 skipped, and `filter/crt` red.
The whole-port expectation is 210 authority-manifest effect IDs. The five exclusions count as missing cases until this port publishes a `Parity cases:` field.
Commands, exit codes, and served-kit hash checks: run `review-20260928-213000` in the shared series state, `review-20260928-213000/result.json`.

### Daily review, 2026-09-25

The existing full CPU gate exits 1: 164 cases executed, 114 byte-exact, 163 accepted at tolerance 2, and 41 skipped. filter/crt has maximum error 80 and mean error 5.05859375. The gate identifies authority 4891b9953f9fd8a61cf9ae0dda2fe747a9be82df. Five of the 210 current effect IDs are outside its 205-effect inventory. Full parity fails. Raw evidence in the shared automation store.

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

Current served declaration: 205 effect IDs. This inventory is not evidence of execution. The declaration column below reflects the served engine of kit `0.1.38` at `fd9d56c`, whose `engine/src/index.js` matches the tree byte-for-byte.

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

Review CI boundary: Exact-source runs: Export kit, Downstream. A passing export dispatch does not qualify rendered parity. Current complete-render enforcement remains an open verification requirement. Exact-source responses and workflows in the shared automation store.

[Earlier audit and review evidence](COMPLETION_GAPS.md#3-methods-and-evidence). [Exact-source Actions](https://github.com/noisefactorllc/noisemaker-for-cpu/actions?query=head_sha%3Af2eb495d70abcb74e3632e7a652a4f83e4f3b11e).
This run evidence in the shared automation store retains commands, exit codes, source identities, and distribution metadata.
Official host references and historical environment limits remain in the linked gap register.
Source CI, export dispatch, artifact delivery, and rendered parity are separate evidence dimensions.
A successful dispatch or unit-test summary does not establish a full rendered gate.

## 5. Open compatibility limits

Next bounded check: continue GAP-001 on the qualified native host. Trace the isolated CRT hash-site inputs against the current Metal render and reconcile the retained golden. Then rerun `node scripts/parity/run.js --json` with unchanged tolerances and authority inputs.
This audit reproduced the failure on 2026-09-26 and the review reproduced it on 2026-09-28. Account separately for all 41 skips and the five missing effects. Do not close full parity until every required case executes and matches.
GAP-003 is open under the operator's 2026-09-27 closure rule, which counts the whole port: 210 authority-manifest IDs, with the five exclusions as missing cases. See the gap register.
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
Daily review on 2026-09-28 at `fd9d56c`: reopened GAP-003, verified the GAP-004, GAP-007, and GAP-008 closures, refreshed the served-kit and matrix rows. No release approval. Evidence: run `review-20260928-213000` in the shared series state.
Daily review on 2026-09-25 at `6c3edb868bce8c9c9f93aea9c952dbf4d49e8e85`: source freshness and bounded evidence reviewed. Open qualification limits retained. Retained review evidence in the shared automation store. No new closure claimed.

| Date | Source | Result | Change |
| --- | --- | --- | --- |
| 2026-09-28 | `fd9d56c74ce7500b7eaeea90a93d3bf49375d28e` | Full qualification unverified. GAP-003 reopened | Daily review updated this report and the gap register. Gate re-executed at the current source. Served-kit identity refreshed to `0.1.38`. Matrix rows restated with measured scope. |
| 2026-09-26 | `ba1c89a3bf37ac6f4e425fc7df43bc02d5c67ce5` | Full qualification unverified | Worker audit updated this report and the gap register. Gate and CLI checks rerun. New authority revision recorded. |
| 2026-09-24 | `f2eb495d70abcb74e3632e7a652a4f83e4f3b11e` | Full qualification unverified | Created the requested maintained compatibility report. Preserved historical evidence and open gaps. |

Run: `20260924-remaining-gap-documents`. Later audits and reviews update this report with source-bound results.
