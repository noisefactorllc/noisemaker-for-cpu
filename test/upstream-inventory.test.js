import test from 'node:test'
import assert from 'node:assert/strict'

import {
  UPSTREAM_REVISION,
  effectRecords,
  eligibleEffectIds,
  excludedEffects,
} from '../src/effects/generated/upstream-snapshot.js'

const EXPECTED_IDS = [
  'classicNoisedeck/bitEffects',
  'classicNoisedeck/caustic',
  'classicNoisedeck/cellNoise',
  'classicNoisedeck/cellRefract',
  'classicNoisedeck/coalesce',
  'classicNoisedeck/colorLab',
  'classicNoisedeck/composite',
  'classicNoisedeck/effects',
  'classicNoisedeck/fractal',
  'classicNoisedeck/glitch',
  'classicNoisedeck/kaleido',
  'classicNoisedeck/lensDistortion',
  'classicNoisedeck/moodscape',
  'classicNoisedeck/noise',
  'classicNoisedeck/refract',
  'classicNoisedeck/shapeMixer',
  'classicNoisedeck/shapes',
  'classicNoisedeck/splat',
  'filter/adjust',
  'filter/bc',
  'filter/bloom',
  'filter/blur',
  'filter/bulge',
  'filter/celShading',
  'filter/channel',
  'filter/chroma',
  'filter/chromaticAberration',
  'filter/chrome',
  'filter/clouds',
  'filter/colorReplace',
  'filter/colorspace',
  'filter/corrupt',
  'filter/craquelure',
  'filter/crt',
  'filter/degauss',
  'filter/deriv',
  'filter/directionalBlur',
  'filter/dither',
  'filter/edge',
  'filter/emboss',
  'filter/extrude',
  'filter/fibers',
  'filter/flipMirror',
  'filter/fxaa',
  'filter/glowingEdge',
  'filter/glyphMap',
  'filter/grade',
  'filter/grain',
  'filter/grime',
  'filter/halftone',
  'filter/hatch',
  'filter/highPass',
  'filter/historicPalette',
  'filter/hs',
  'filter/invert',
  'filter/lens',
  'filter/lensFlare',
  'filter/lensWarp',
  'filter/lightLeak',
  'filter/lighting',
  'filter/lowPoly',
  'filter/median',
  'filter/morphology',
  'filter/mosaicTiles',
  'filter/normalMap',
  'filter/normalize',
  'filter/octaveWarp',
  'filter/oilPaint',
  'filter/osd',
  'filter/outline',
  'filter/palette',
  'filter/parallax',
  'filter/patchwork',
  'filter/photocopy',
  'filter/pinch',
  'filter/pixelSort',
  'filter/pixels',
  'filter/plasticWrap',
  'filter/polar',
  'filter/pondRipples',
  'filter/posterize',
  'filter/prismaticAberration',
  'filter/reindex',
  'filter/relief',
  'filter/repeat',
  'filter/reverb',
  'filter/ridge',
  'filter/rotate',
  'filter/scale',
  'filter/scanlineError',
  'filter/scatter',
  'filter/scratches',
  'filter/scroll',
  'filter/seamless',
  'filter/sharpen',
  'filter/simpleAberration',
  'filter/sine',
  'filter/skew',
  'filter/smooth',
  'filter/smoothstep',
  'filter/snow',
  'filter/sobel',
  'filter/spatter',
  'filter/spinBlur',
  'filter/spiral',
  'filter/spookyTicker',
  'filter/stamp',
  'filter/step',
  'filter/stipple',
  'filter/strayHair',
  'filter/strokes',
  'filter/tetraColorArray',
  'filter/tetraCosine',
  'filter/text',
  'filter/texture',
  'filter/threshold',
  'filter/tile',
  'filter/tint',
  'filter/translate',
  'filter/tunnel',
  'filter/unsharpMask',
  'filter/vaseline',
  'filter/vignette',
  'filter/warp',
  'filter/watercolor',
  'filter/waves',
  'filter/wind',
  'filter/wobble',
  'filter/wormhole',
  'filter/zoomBlur',
  'mixer/alphaMask',
  'mixer/applyMode',
  'mixer/blendMode',
  'mixer/cellSplit',
  'mixer/centerMask',
  'mixer/channelCombine',
  'mixer/distortion',
  'mixer/focusBlur',
  'mixer/mashup',
  'mixer/patternMix',
  'mixer/shadow',
  'mixer/shapeMask',
  'mixer/split',
  'mixer/thresholdMix',
  'mixer/uvRemap',
  'synth/bitwise',
  'synth/cell',
  'synth/curl',
  'synth/gabor',
  'synth/gradient',
  'synth/julia',
  'synth/mandala',
  'synth/mandelbrot',
  'synth/media',
  'synth/modPattern',
  'synth/newton',
  'synth/noise',
  'synth/osc2d',
  'synth/pattern',
  'synth/perlin',
  'synth/polygon',
  'synth/remap',
  'synth/sacredGeometry',
  'synth/shape',
  'synth/solid',
  'synth/subdivide',
  'synth/testPattern',
]

const STATEFUL = [
  'filter/convolutionFeedback',
  'filter/feedback',
  'filter/motionBlur',
  'filter/temporalAberration',
  'synth/cellularAutomata',
  'synth/mnca',
  'synth/navierStokes',
  'synth/reactionDiffusion',
]

const REACTIVE = [
  'synth/roll',
  'synth/scope',
  'synth/spectrum',
]

test('upstream snapshot pins the exact 167-effect standalone-frame 2D inventory', () => {
  assert.equal(UPSTREAM_REVISION, 'dc67827bfc2d4e71d64cb6095cd8c922dc64360f')
  assert.deepEqual(eligibleEffectIds, EXPECTED_IDS)
  assert.deepEqual(
    Object.fromEntries(['classicNoisedeck', 'filter', 'mixer', 'synth'].map((namespace) => [
      namespace,
      eligibleEffectIds.filter((id) => id.startsWith(`${namespace}/`)).length,
    ])),
    { classicNoisedeck: 18, filter: 112, mixer: 15, synth: 22 },
  )
  assert.deepEqual(excludedEffects.stateful, STATEFUL)
  assert.deepEqual(excludedEffects.reactive, REACTIVE)
})

test('upstream snapshot preserves parity-critical definition metadata', () => {
  const byId = new Map(effectRecords.map((record) => [record.id, record]))
  const adjust = byId.get('filter/adjust')
  assert.equal(adjust.params.mode.default, 0)
  assert.deepEqual(adjust.params.mode.choices, { rgb: 0, hsv: 1, oklab: 2, oklch: 3 })
  assert.deepEqual(adjust.passes[0].inputs, { inputTex: 'inputTex' })

  const noise = byId.get('synth/noise')
  assert.equal(noise.params.type.define, 'NOISE_TYPE')
  assert.equal(noise.params.loopOffset.define, 'LOOP_OFFSET')
  assert.equal(noise.params.colorMode.default, 1)

  const blend = byId.get('mixer/blendMode')
  assert.deepEqual(blend.passes[0].inputs, { inputTex: 'inputTex', tex: 'tex' })
  assert.equal(blend.params.mode.choices.screen, 13)

  const media = byId.get('synth/media')
  assert.equal(media.externalTexture, 'imageTex')
  assert.equal(media.params.imageSize.type, 'vec2')

  const text = byId.get('filter/text')
  assert.equal(text.externalTexture, 'textTex')
  assert.equal(text.params.text.type, 'string')
  assert.equal(text.params.text.default, 'Hello World')
  assert.deepEqual(text.paramAliases, { bgOpacity: 'matteOpacity', bgAlpha: 'matteOpacity', bgColor: 'matteColor' })

  const channel = byId.get('filter/channel')
  assert.deepEqual(channel.params.channel.choices, { r: 0, g: 1, b: 2, a: 3 })
  assert.equal(channel.params.channel.default, 'channel.r')
})
