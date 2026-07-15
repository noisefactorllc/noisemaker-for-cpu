# Effect coverage

This is the exact stateless 2D catalog imported from Noisemaker revision `dc67827bfc2d4e71d64cb6095cd8c922dc64360f`. Canonical names, namespaces, kinds, descriptions, parameters, aliases, defaults, enum choices, texture bindings, and pass graphs live in the generated snapshot at `src/effects/generated/upstream-snapshot.js`; they are not maintained as a second hand-written schema.

The runtime contains 169 effects and 214 fragment programs. Every default effect and all 410 non-null compile-time shader choices execute in the test suite. Run `noisemaker-cpu effects` for the machine-readable command-line listing.

## `classicNoisedeck` — 18

`bitEffects`, `caustic`, `cellNoise`, `cellRefract`, `coalesce`, `colorLab`, `composite`, `effects`, `fractal`, `glitch`, `kaleido`, `lensDistortion`, `moodscape`, `noise`, `refract`, `shapeMixer`, `shapes`, `splat`

## `filter` — 112

`adjust`, `bc`, `bloom`, `blur`, `bulge`, `celShading`, `channel`, `chroma`, `chromaticAberration`, `chrome`, `clouds`, `colorReplace`, `colorspace`, `corrupt`, `craquelure`, `crt`, `degauss`, `deriv`, `directionalBlur`, `dither`, `edge`, `emboss`, `extrude`, `fibers`, `flipMirror`, `fxaa`, `glowingEdge`, `glyphMap`, `grade`, `grain`, `grime`, `halftone`, `hatch`, `highPass`, `historicPalette`, `hs`, `invert`, `lens`, `lensFlare`, `lensWarp`, `lightLeak`, `lighting`, `lowPoly`, `median`, `morphology`, `mosaicTiles`, `normalMap`, `normalize`, `octaveWarp`, `oilPaint`, `osd`, `outline`, `palette`, `parallax`, `patchwork`, `photocopy`, `pinch`, `pixelSort`, `pixels`, `plasticWrap`, `polar`, `pondRipples`, `posterize`, `prismaticAberration`, `reindex`, `relief`, `repeat`, `reverb`, `ridge`, `rotate`, `scale`, `scanlineError`, `scatter`, `scratches`, `scroll`, `seamless`, `sharpen`, `simpleAberration`, `sine`, `skew`, `smooth`, `smoothstep`, `snow`, `sobel`, `spatter`, `spinBlur`, `spiral`, `spookyTicker`, `stamp`, `step`, `stipple`, `strayHair`, `strokes`, `tetraColorArray`, `tetraCosine`, `text`, `texture`, `threshold`, `tile`, `tint`, `translate`, `tunnel`, `unsharpMask`, `vaseline`, `vignette`, `warp`, `watercolor`, `waves`, `wind`, `wobble`, `wormhole`, `zoomBlur`

## `mixer` — 15

`alphaMask`, `applyMode`, `blendMode`, `cellSplit`, `centerMask`, `channelCombine`, `distortion`, `focusBlur`, `mashup`, `patternMix`, `shadow`, `shapeMask`, `split`, `thresholdMix`, `uvRemap`

## `synth` — 24

`bitwise`, `cell`, `curl`, `gabor`, `gradient`, `julia`, `mandala`, `mandelbrot`, `media`, `modPattern`, `newton`, `noise`, `osc2d`, `pattern`, `perlin`, `polygon`, `remap`, `sacredGeometry`, `scope`, `shape`, `solid`, `spectrum`, `subdivide`, `testPattern`

## Intentional exclusions

These are excluded by the requested CPU-port scope, not by silent compiler failures:

- Stateful (9): `filter/convolutionFeedback`, `filter/feedback`, `filter/motionBlur`, `filter/temporalAberration`, `synth/cellularAutomata`, `synth/mnca`, `synth/navierStokes`, `synth/reactionDiffusion`, `synth/roll`
- 3D: `classicNoisedeck/noise3d`, `classicNoisedeck/shapes3d`, `filter3d/*`, `synth3d/*`, `render/*3d`, `render/*Cubemap*`, and `render/mesh*`
- Particles: `points/*` and `render/points*`
- Render control: `render/loopBegin` and `render/loopEnd`

Media and text are not excluded. `synth/media` and `filter/text` receive browser `Surface` values or CLI PNGs through `--input` and `--texture`.

## Parity status

`npm run parity` compares all 169 canonical default programs to pinned GPU goldens with an unchanged ±2-byte RGBA threshold. Current result: 168/169 pass and 119 are byte-exact. `filter/crt` remains failing, so the strict parity command intentionally exits nonzero. Catalog, schema, graph, compile-time-choice, and execution coverage are exact for the 169-effect target; pixel parity remains an active one-effect gate.
