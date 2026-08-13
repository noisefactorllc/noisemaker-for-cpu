# Effect coverage

This is the exact CPU-eligible target imported from Noisemaker revision `c51037ad9e60850b74490c01a9eecf08c7d28e8c`, after the five explicit exclusions below. Canonical names, namespaces, kinds, descriptions, parameters, aliases, defaults, enum choices, texture bindings, and pass graphs live in the generated snapshot at `src/effects/generated/upstream-snapshot.js`; they are not maintained as a second hand-written schema.

The runtime contains 205 effects and 295 canonical programs (285 generated from canonical GLSL, 10 CPU adapters — see [CSL.md](CSL.md)). All 456 non-null compile-time shader choices and finite smoke programs for every effect execute in the test suite. Run `noisemaker-cpu effects` for the machine-readable command-line listing.

## `classicNoisedeck` — 20

`bitEffects`, `caustic`, `cellNoise`, `cellRefract`, `coalesce`, `colorLab`, `composite`, `effects`, `fractal`, `glitch`, `kaleido`, `lensDistortion`, `moodscape`, `noise`, `noise3d`, `refract`, `shapeMixer`, `shapes`, `shapes3d`, `splat`

## `filter` — 116

`adjust`, `bc`, `bloom`, `blur`, `bulge`, `celShading`, `channel`, `chroma`, `chromaticAberration`, `chrome`, `clouds`, `colorReplace`, `colorspace`, `convolutionFeedback`, `corrupt`, `craquelure`, `crt`, `degauss`, `deriv`, `directionalBlur`, `dither`, `edge`, `emboss`, `extrude`, `feedback`, `fibers`, `flipMirror`, `fxaa`, `glowingEdge`, `glyphMap`, `grade`, `grain`, `grime`, `halftone`, `hatch`, `highPass`, `historicPalette`, `hs`, `invert`, `lens`, `lensFlare`, `lensWarp`, `lightLeak`, `lighting`, `lowPoly`, `median`, `morphology`, `mosaicTiles`, `motionBlur`, `normalMap`, `normalize`, `octaveWarp`, `oilPaint`, `osd`, `outline`, `palette`, `parallax`, `patchwork`, `photocopy`, `pinch`, `pixelSort`, `pixels`, `plasticWrap`, `polar`, `pondRipples`, `posterize`, `prismaticAberration`, `reindex`, `relief`, `repeat`, `reverb`, `ridge`, `rotate`, `scale`, `scanlineError`, `scatter`, `scratches`, `scroll`, `seamless`, `sharpen`, `simpleAberration`, `sine`, `skew`, `smooth`, `smoothstep`, `snow`, `sobel`, `spatter`, `spinBlur`, `spiral`, `spookyTicker`, `stamp`, `step`, `stipple`, `strayHair`, `strokes`, `temporalAberration`, `tetraColorArray`, `tetraCosine`, `text`, `texture`, `threshold`, `tile`, `tint`, `translate`, `tunnel`, `unsharpMask`, `vaseline`, `vignette`, `warp`, `watercolor`, `waves`, `wind`, `wobble`, `wormhole`, `zoomBlur`

Twelve of these (`bloom`, `chrome`, `highPass`, `oilPaint`, `photocopy`, `plasticWrap`, `relief`, `smooth`, `stamp`, `strokes`, `unsharpMask`, `watercolor`) have their `kind` corrected from `mixer` to `filter`: the old inference keyed on a pass's internal scratch-texture input names rather than on whether an input is genuinely a second external image, and none of these twelve take one. This only affects `effect.kind` metadata consumers (the CLI's auto-wiring and `--effect random` pools, the browser demo's filter/mixer pickers) — it changes no rendering output.

## `filter3d` — 2

`flow3d`, `palette3d`

## `mixer` — 15

`alphaMask`, `applyMode`, `blendMode`, `cellSplit`, `centerMask`, `channelCombine`, `distortion`, `focusBlur`, `mashup`, `patternMix`, `shadow`, `shapeMask`, `split`, `thresholdMix`, `uvRemap`

## `points` — 10

`attractor`, `buddhabrot`, `dla`, `flock`, `flow`, `hydraulic`, `lenia`, `life`, `physarum`, `physical`

All 10 are stateful/particle effects (see "CPU iteration divergence"). Each reads and writes the `global_xyz`/`global_vel`/`global_rgba` agent-state textures a preceding `render/pointsEmit` call declares; used standalone (no `pointsEmit` ahead of it in the chain), it falls back to a fresh, zeroed 256×256 state (or its own `stateSize` default, for the effects that expose one) rather than throwing.

## `render` — 9

`loopBegin`, `loopEnd`, `pointsBillboardRender`, `pointsEmit`, `pointsRender`, `render3d`, `renderCubemap3d`, `renderCubemapSurface`, `renderLit3d`

The three `points*` render effects are stateful/particle effects. `pointsEmit` is the only definition in the whole catalog that declares `global_xyz`; it opens and owns an iteration group, seeding agent positions/velocities/colors from its own input image. `pointsRender` and `pointsBillboardRender` rasterize the current agent state into a trail texture (point sprites and billboard quads respectively) composited over the input.

## `synth` — 26

`bitwise`, `cell`, `cellularAutomata`, `curl`, `gabor`, `gradient`, `julia`, `mandala`, `mandelbrot`, `media`, `mnca`, `modPattern`, `navierStokes`, `newton`, `noise`, `osc2d`, `pattern`, `perlin`, `polygon`, `reactionDiffusion`, `remap`, `sacredGeometry`, `shape`, `solid`, `subdivide`, `testPattern`

## `synth3d` — 7

`cell3d`, `cellularAutomata3d`, `flythrough3d`, `fractal3d`, `noise3d`, `reactionDiffusion3d`, `shape3d`

## Intentional exclusions

These are excluded by the requested CPU-port scope, not by silent compiler failures:

- Reactive effects: `synth/roll` (MIDI plus feedback), `synth/scope` (audio waveform), and `synth/spectrum` (audio spectrum)
- Mesh pipeline: `render/meshLoader` and `render/meshRender`

Media and text are not excluded. `synth/media` and `filter/text` receive browser `Surface` values or CLI PNGs through `--input` and `--texture`.

## Volume and loop semantics

Volume effects carry a private bundle of image, volume, geometry, and `volumeSize` channels through a chain. Volumes and analytical geometry are flattened into `N × N²` atlas surfaces; producers are validated at their boundary, filters preserve the geometry channel unless they replace it, and a volume renderer converts the bundle back to the ordinary image channel before `.write(oN)`. An incoming atlas always determines the effective downstream `volumeSize`, overriding both defaults and explicitly mismatched values before resource allocation and shader binding. Iterated volume generators such as `cellularAutomata3d` and `reactionDiffusion3d` can consume the preceding volume/geometry bundle; when used at the start of a chain, they receive zeroed seed/geometry atlases instead. All resources reset between separate render calls.

`loopBegin(...).…loopEnd()` forms one balanced iteration region. `loopBegin` supplies `iterationCount` (default 60); each iteration receives the same frozen pre-loop input while the region shares its `global_accum` feedback surface. `iterationCount: 0` bypasses the whole region and clones its input. Nested loops, unmatched markers, and reads/writes crossing a loop boundary are rejected during DSL compilation.

An RGBA CPU atlas costs `16N³` bytes because storage is float32 even for a declared half-float attachment: about 0.5 MiB at 32³, 4 MiB at 64³, and 32 MiB at 128³. Stateful effects can retain several atlases at once, and cost multiplies by `iterationCount`. The shared surface allocator rejects unsafe dimensions and any individual image or atlas above 16,777,216 pixels (256 MiB float RGBA) before allocating memory.

## CPU iteration divergence

24 simulation effects — the prior 21 (`filter/convolutionFeedback`, `filter/feedback`, `filter/motionBlur`, `filter/temporalAberration`, all 10 `points/*`, all 3 `render/points*`, and `synth/cellularAutomata`, `synth/mnca`, `synth/navierStokes`, `synth/reactionDiffusion`) plus `filter3d/flow3d`, `synth3d/cellularAutomata3d`, and `synth3d/reactionDiffusion3d` — use a CPU iteration schedule rather than a frame-for-frame real-time loop. `render/loopBegin` is the 25th `iterated` catalog record, but its count applies to the explicit region described above.

**`iterationCount`.** Every simulation effect carries an `iterationCount` parameter (default 60, range 0–10000). Rendering one CPU frame re-runs the effect's entire pass graph that many times in place. `iterationCount: 0` short-circuits entirely: no pass runs, and the output is an exact clone of the input (or a zeroed image/volume for a generator).

**Cost.** These effects are expensive in direct proportion to `iterationCount`, and the default of 60 is not free. Measured on a 128×128 canvas: `synth/navierStokes` at its default `iterationCount` (60) is the worst case in the catalog — its per-iteration pressure solve multiplies against `iterationCount`, 2,160 total passes — and takes on the order of 35-45 seconds for a single frame (machine- and load-dependent); a `pointsEmit().physarum().pointsRender()` chain takes roughly 25 seconds. At the CLI's 512×512 default, scale accordingly — a `synth/navierStokes` frame can run into the tens of minutes. A standalone `points/*` effect with no preceding `pointsEmit` still burns roughly 5 seconds doing the full `iterationCount`-many passes before returning its input completely unchanged: with no emitter, every agent is dead on arrival (see "Particle groups" below), so the pass graph is a no-op, but not a *free* one. `iterationCount: 0` is a genuine, instant bypass (see above) when you need the shape of the chain without the simulation cost. `noisemaker-cpu`'s `--effect random` pools contain only non-iterated image-domain effects that need no external texture; volume and loop effects remain available by explicit name inside a typed chain.

**Per-iteration schedule.** Iteration `i` of `N` binds `frame: i`, `deltaTime: 1/600` (upstream's fixed simulation step), and `time: wrap01(T - (N-1-i)/600)`, where `T` is the render's own `time` option and `wrap01(x) = ((x % 1) + 1) % 1`. The final iteration's offset is always 0, so its `time` is `wrap01(T)` — which is **not** always literally `T`: because `1.0 % 1 === 0` in JavaScript, `wrap01(1.0)` is `0`, not `1.0`. An animation sweeping `time` through `[0, 1]` sees a discontinuity at the closed endpoint on every iterated effect; sweep the half-open `[0, 1)` instead.

**Particle groups.** `render/pointsEmit` is the only definition that declares the `global_xyz` agent-state texture; it always opens and owns an iteration group. Any immediately-following step in the same chain whose own pass graph reads or writes `global_xyz`/`global_vel`/`global_rgba`/`global_life_data`/a `*_trail` texture joins that group and runs interleaved with it, once per iteration, rather than to completion in isolation — this is what lets a `pointsEmit().flock().pointsRender()` chain deposit each iteration's intermediate state into a trail instead of only the final one. A second `pointsEmit()` later in the same chain always closes the first group and opens an independent second one, even though both reference the same texture names — two particle segments in one chain never share state. The group runs the owner's (`pointsEmit`'s) `iterationCount` times; an `iterationCount` argument on a joining step is ignored. A joining step that declares its own `stateSize` parameter (for example `points/life`) has that parameter forced to the group owner's normalized `stateSize`, matching upstream marking a joining effect's own state-size control hidden; a `points/*`/`render/points*` effect used with no `pointsEmit` ahead of it falls back to a fresh state sized from its own `stateSize` default.

**`selfTex`/`feedback`.** `filter/convolutionFeedback` reads its own previous iteration's output through the reserved `selfTex` token. Inside an iterated effect this resolves to that same step's output from iteration `i - 1`, zeroed on iteration 0 (matching upstream's first-frame behavior); a non-iterated effect referencing it (none do, in the shipped catalog) would see the same zeroed placeholder on every render.

**Statelessness.** Nothing persists between separate `render()`/`renderAsync()` calls. Every iteration's state is `iterationCount`-many synchronous re-runs of the pass graph within one render, seeded fresh (zeroed particle/scratch textures, a zeroed `selfTex`) at the start of every render — calling `render()` twice with identical arguments is deterministic and byte-identical, exactly like every other effect in the catalog.

**Pixel parity.** The prior 21 simulation effects remain explicit `cpu-divergent` skips. All 17 effects added in this coverage pass are separately reported as `newly ported, no GPU golden` until pinned references exist.

## Parity status

`npm run parity` keeps the established 167 pinned GPU goldens and unchanged ±2-byte RGBA threshold. Current result: 166/167 pass and 117 are byte-exact. `filter/crt` remains failing, so the strict command intentionally exits nonzero. The union of 21 prior CPU-divergent effects and 17 newly ported effects is 38 explicit skips; each skip fixture is still parsed and resolved before reporting. Catalog, schema, graph, compile-time-choice, and execution coverage are exact for the full 205-effect target while the pixel-parity denominator remains an active, unchanged gate.
