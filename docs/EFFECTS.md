# Effect coverage

This is the exact standalone-frame 2D target imported from Noisemaker revision `a024dc3a960cc44af454abc7aebce50456c194e6`, after the explicit exclusions below. Canonical names, namespaces, kinds, descriptions, parameters, aliases, defaults, enum choices, texture bindings, and pass graphs live in the generated snapshot at `src/effects/generated/upstream-snapshot.js`; they are not maintained as a second hand-written schema.

The runtime contains 188 effects and 274 fragment programs (265 generated from canonical GLSL, 9 CPU adapters — see [docs/CSL.md](docs/CSL.md)). Every default effect and all 410 non-null compile-time shader choices execute in the test suite. 21 of the 188 are CPU-only stateful/particle effects that re-run their pass graph `iterationCount` times per rendered frame instead of once; see "CPU iteration divergence" below before relying on their pixel output. Run `noisemaker-cpu effects` for the machine-readable command-line listing.

## `classicNoisedeck` — 18

`bitEffects`, `caustic`, `cellNoise`, `cellRefract`, `coalesce`, `colorLab`, `composite`, `effects`, `fractal`, `glitch`, `kaleido`, `lensDistortion`, `moodscape`, `noise`, `refract`, `shapeMixer`, `shapes`, `splat`

## `filter` — 116

`adjust`, `bc`, `bloom`, `blur`, `bulge`, `celShading`, `channel`, `chroma`, `chromaticAberration`, `chrome`, `clouds`, `colorReplace`, `colorspace`, `convolutionFeedback`, `corrupt`, `craquelure`, `crt`, `degauss`, `deriv`, `directionalBlur`, `dither`, `edge`, `emboss`, `extrude`, `feedback`, `fibers`, `flipMirror`, `fxaa`, `glowingEdge`, `glyphMap`, `grade`, `grain`, `grime`, `halftone`, `hatch`, `highPass`, `historicPalette`, `hs`, `invert`, `lens`, `lensFlare`, `lensWarp`, `lightLeak`, `lighting`, `lowPoly`, `median`, `morphology`, `mosaicTiles`, `motionBlur`, `normalMap`, `normalize`, `octaveWarp`, `oilPaint`, `osd`, `outline`, `palette`, `parallax`, `patchwork`, `photocopy`, `pinch`, `pixelSort`, `pixels`, `plasticWrap`, `polar`, `pondRipples`, `posterize`, `prismaticAberration`, `reindex`, `relief`, `repeat`, `reverb`, `ridge`, `rotate`, `scale`, `scanlineError`, `scatter`, `scratches`, `scroll`, `seamless`, `sharpen`, `simpleAberration`, `sine`, `skew`, `smooth`, `smoothstep`, `snow`, `sobel`, `spatter`, `spinBlur`, `spiral`, `spookyTicker`, `stamp`, `step`, `stipple`, `strayHair`, `strokes`, `temporalAberration`, `tetraColorArray`, `tetraCosine`, `text`, `texture`, `threshold`, `tile`, `tint`, `translate`, `tunnel`, `unsharpMask`, `vaseline`, `vignette`, `warp`, `watercolor`, `waves`, `wind`, `wobble`, `wormhole`, `zoomBlur`

Twelve of these (`bloom`, `chrome`, `highPass`, `oilPaint`, `photocopy`, `plasticWrap`, `relief`, `smooth`, `stamp`, `strokes`, `unsharpMask`, `watercolor`) have their `kind` corrected from `mixer` to `filter`: the old inference keyed on a pass's internal scratch-texture input names rather than on whether an input is genuinely a second external image, and none of these twelve take one. This only affects `effect.kind` metadata consumers (the CLI's auto-wiring and `--effect random` pools, the browser demo's filter/mixer pickers) — it changes no rendering output.

## `mixer` — 15

`alphaMask`, `applyMode`, `blendMode`, `cellSplit`, `centerMask`, `channelCombine`, `distortion`, `focusBlur`, `mashup`, `patternMix`, `shadow`, `shapeMask`, `split`, `thresholdMix`, `uvRemap`

## `points` — 10

`attractor`, `buddhabrot`, `dla`, `flock`, `flow`, `hydraulic`, `lenia`, `life`, `physarum`, `physical`

All 10 are stateful/particle effects (see "CPU iteration divergence"). Each reads and writes the `global_xyz`/`global_vel`/`global_rgba` agent-state textures a preceding `render/pointsEmit` call declares; used standalone (no `pointsEmit` ahead of it in the chain), it falls back to a fresh, zeroed 256×256 state (or its own `stateSize` default, for the effects that expose one) rather than throwing.

## `render` — 3

`pointsBillboardRender`, `pointsEmit`, `pointsRender`

All 3 are stateful/particle effects. `pointsEmit` is the only definition in the whole catalog that declares `global_xyz`; it opens and owns an iteration group, seeding agent positions/velocities/colors from its own input image. `pointsRender` and `pointsBillboardRender` rasterize the current agent state into a trail texture (point sprites and billboard quads respectively) composited over the input.

## Intentional exclusions

These are excluded by the requested CPU-port scope, not by silent compiler failures:

- Reactive effects removed from this port: `synth/roll` (MIDI plus feedback), `synth/scope` (audio waveform), and `synth/spectrum` (audio spectrum)
- 3D: `classicNoisedeck/noise3d`, `classicNoisedeck/shapes3d`, `filter3d/*`, `synth3d/*`, `render/*3d`, `render/*Cubemap*`, and `render/mesh*`
- Render control: `render/loopBegin` and `render/loopEnd`

Media and text are not excluded. `synth/media` and `filter/text` receive browser `Surface` values or CLI PNGs through `--input` and `--texture`.

## CPU iteration divergence

21 effects — `filter/convolutionFeedback`, `filter/feedback`, `filter/motionBlur`, `filter/temporalAberration`, all 10 `points/*`, all 3 `render/points*`, and `synth/cellularAutomata`, `synth/mnca`, `synth/navierStokes`, `synth/reactionDiffusion` — were formerly excluded as "other stateful effects" and "particles." They are now part of the 188-effect catalog, but their CPU execution model is a deliberate reinterpretation of upstream's real-time simulation loop, not a frame-for-frame port, so their pixel output does not (and is not meant to) match any single upstream GPU frame. Read this section before relying on their exact bytes.

**`iterationCount`.** Every one of the 21 carries an `iterationCount` parameter (default 60, range 0–10000, no upstream UI control — it stands in for "how many realtime simulation ticks would have run before this frame"). Rendering one CPU frame re-runs the effect's entire pass graph `iterationCount` times in place before producing output, rather than once. `iterationCount: 0` short-circuits entirely: no pass runs, and the output is an exact clone of the effect's input (or a zeroed frame, for a generator with no input) — a deliberate bypass, not an approximation of "zero simulation time."

**Cost.** These effects are expensive in direct proportion to `iterationCount`, and the default of 60 is not free. Measured on a 128×128 canvas: `synth/navierStokes` at its default `iterationCount` (60) is the worst case in the catalog — its per-iteration pressure solve multiplies against `iterationCount`, 2,160 total passes — and takes on the order of 35-45 seconds for a single frame (machine- and load-dependent); a `pointsEmit().physarum().pointsRender()` chain takes roughly 25 seconds. At the CLI's 512×512 default, scale accordingly — a `synth/navierStokes` frame can run into the tens of minutes. A standalone `points/*` effect with no preceding `pointsEmit` still burns roughly 5 seconds doing the full `iterationCount`-many passes before returning its input completely unchanged: with no emitter, every agent is dead on arrival (see "Particle groups" below), so the pass graph is a no-op, but not a *free* one. `iterationCount: 0` is a genuine, instant bypass (see above) when you need the shape of the chain without the simulation cost. `noisemaker-cpu`'s `--effect random` pools exclude all 21 of these effects for exactly this reason (they can still be named explicitly).

**Per-iteration schedule.** Iteration `i` of `N` binds `frame: i`, `deltaTime: 1/600` (upstream's fixed simulation step), and `time: wrap01(T - (N-1-i)/600)`, where `T` is the render's own `time` option and `wrap01(x) = ((x % 1) + 1) % 1`. The final iteration's offset is always 0, so its `time` is `wrap01(T)` — which is **not** always literally `T`: because `1.0 % 1 === 0` in JavaScript, `wrap01(1.0)` is `0`, not `1.0`. An animation sweeping `time` through `[0, 1]` sees a discontinuity at the closed endpoint on every iterated effect; sweep the half-open `[0, 1)` instead.

**Particle groups.** `render/pointsEmit` is the only definition that declares the `global_xyz` agent-state texture; it always opens and owns an iteration group. Any immediately-following step in the same chain whose own pass graph reads or writes `global_xyz`/`global_vel`/`global_rgba`/`global_life_data`/a `*_trail` texture joins that group and runs interleaved with it, once per iteration, rather than to completion in isolation — this is what lets a `pointsEmit().flock().pointsRender()` chain deposit each iteration's intermediate state into a trail instead of only the final one. A second `pointsEmit()` later in the same chain always closes the first group and opens an independent second one, even though both reference the same texture names — two particle segments in one chain never share state. The group runs the owner's (`pointsEmit`'s) `iterationCount` times; an `iterationCount` argument on a joining step is ignored. A joining step that declares its own `stateSize` parameter (for example `points/life`) has that parameter forced to the group owner's normalized `stateSize`, matching upstream marking a joining effect's own state-size control hidden; a `points/*`/`render/points*` effect used with no `pointsEmit` ahead of it falls back to a fresh state sized from its own `stateSize` default.

**`selfTex`/`feedback`.** `filter/convolutionFeedback` reads its own previous iteration's output through the reserved `selfTex` token. Inside an iterated effect this resolves to that same step's output from iteration `i - 1`, zeroed on iteration 0 (matching upstream's first-frame behavior); a non-iterated effect referencing it (none do, in the shipped catalog) would see the same zeroed placeholder on every render.

**Statelessness.** Nothing persists between separate `render()`/`renderAsync()` calls. Every iteration's state is `iterationCount`-many synchronous re-runs of the pass graph within one render, seeded fresh (zeroed particle/scratch textures, a zeroed `selfTex`) at the start of every render — calling `render()` twice with identical arguments is deterministic and byte-identical, exactly like every other effect in the catalog.

**Pixel parity.** `npm run parity` intentionally does not compare these 21 to a GPU golden — there is no single upstream frame their `iterationCount`-many-ticks-per-frame model corresponds to. They report as explicit skips (`SKIP <id> (cpu-divergent, no GPU golden)`), are never counted in the pass/fail denominator, and never affect the parity command's exit code. See "Parity status" below.

## Parity status

`npm run parity` compares all 167 non-iterated canonical default programs to pinned GPU goldens with an unchanged ±2-byte RGBA threshold. Current result: 166/167 pass and 117 are byte-exact. `filter/crt` remains failing, so the strict parity command intentionally exits nonzero. The remaining 21 effects (see "CPU iteration divergence") report as skips and never enter that denominator. Catalog, schema, graph, compile-time-choice, and execution coverage are exact for the full 188-effect target; the pixel-parity denominator stays at 167 by design, not by omission, and pixel parity remains an active one-effect gate.
