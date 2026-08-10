import test from 'node:test'
import assert from 'node:assert/strict'

import * as snapshot from '../src/effects/generated/upstream-snapshot.js'

const {
  UPSTREAM_REVISION,
  effectRecords,
  eligibleEffectIds,
  excludedEffects,
  sourceEffectIds,
} = snapshot

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
  'classicNoisedeck/noise3d',
  'classicNoisedeck/refract',
  'classicNoisedeck/shapeMixer',
  'classicNoisedeck/shapes',
  'classicNoisedeck/shapes3d',
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
  'filter/convolutionFeedback',
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
  'filter/feedback',
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
  'filter/motionBlur',
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
  'filter/temporalAberration',
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
  'filter3d/flow3d',
  'filter3d/palette3d',
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
  'points/attractor',
  'points/buddhabrot',
  'points/dla',
  'points/flock',
  'points/flow',
  'points/hydraulic',
  'points/lenia',
  'points/life',
  'points/physarum',
  'points/physical',
  'render/loopBegin',
  'render/loopEnd',
  'render/pointsBillboardRender',
  'render/pointsEmit',
  'render/pointsRender',
  'render/render3d',
  'render/renderCubemap3d',
  'render/renderCubemapSurface',
  'render/renderLit3d',
  'synth/bitwise',
  'synth/cell',
  'synth/cellularAutomata',
  'synth/curl',
  'synth/gabor',
  'synth/gradient',
  'synth/julia',
  'synth/mandala',
  'synth/mandelbrot',
  'synth/media',
  'synth/mnca',
  'synth/modPattern',
  'synth/navierStokes',
  'synth/newton',
  'synth/noise',
  'synth/osc2d',
  'synth/pattern',
  'synth/perlin',
  'synth/polygon',
  'synth/reactionDiffusion',
  'synth/remap',
  'synth/sacredGeometry',
  'synth/shape',
  'synth/solid',
  'synth/subdivide',
  'synth/testPattern',
  'synth3d/cell3d',
  'synth3d/cellularAutomata3d',
  'synth3d/flythrough3d',
  'synth3d/fractal3d',
  'synth3d/noise3d',
  'synth3d/reactionDiffusion3d',
  'synth3d/shape3d',
]

const EXPECTED_ITERATED = [
  'filter/convolutionFeedback',
  'filter/feedback',
  'filter/motionBlur',
  'filter/temporalAberration',
  'filter3d/flow3d',
  'points/attractor',
  'points/buddhabrot',
  'points/dla',
  'points/flock',
  'points/flow',
  'points/hydraulic',
  'points/lenia',
  'points/life',
  'points/physarum',
  'points/physical',
  'render/loopBegin',
  'render/pointsBillboardRender',
  'render/pointsEmit',
  'render/pointsRender',
  'synth/cellularAutomata',
  'synth/mnca',
  'synth/navierStokes',
  'synth/reactionDiffusion',
  'synth3d/cellularAutomata3d',
  'synth3d/reactionDiffusion3d',
]

const REACTIVE = [
  'synth/roll',
  'synth/scope',
  'synth/spectrum',
]

const EXCLUDED = [
  'render/meshLoader',
  'render/meshRender',
  ...REACTIVE,
].sort()

test('upstream snapshot partitions the exact source tree into 205 eligible and five excluded effects', () => {
  assert.equal(UPSTREAM_REVISION, 'a024dc3a960cc44af454abc7aebce50456c194e6')
  assert.deepEqual(eligibleEffectIds, EXPECTED_IDS)
  assert.deepEqual(
    Object.fromEntries(['classicNoisedeck', 'filter', 'filter3d', 'mixer', 'points', 'render', 'synth', 'synth3d'].map((namespace) => [
      namespace,
      eligibleEffectIds.filter((id) => id.startsWith(`${namespace}/`)).length,
    ])),
    { classicNoisedeck: 20, filter: 116, filter3d: 2, mixer: 15, points: 10, render: 9, synth: 26, synth3d: 7 },
  )
  assert.deepEqual(excludedEffects.reactive, REACTIVE)
  const excludedIds = Object.values(excludedEffects).flat().sort()
  assert.deepEqual(excludedIds, EXCLUDED)
  assert.equal(sourceEffectIds.length, 210)
  assert.equal(new Set([...eligibleEffectIds, ...excludedIds]).size, 210)
  assert.deepEqual([...eligibleEffectIds, ...excludedIds].sort(), [...sourceEffectIds].sort())
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

  const pondRipples = byId.get('filter/pondRipples')
  assert.equal(pondRipples.params.speed.type, 'int')
  assert.equal(pondRipples.params.speed.default, 0)
  assert.equal(pondRipples.params.speed.uniform, 'speed')
  assert.equal(pondRipples.params.speed.min, -5)
  assert.equal(pondRipples.params.speed.max, 5)

  const volumeNoise = byId.get('synth3d/noise3d')
  assert.equal(volumeNoise.domain, 'volume-generator')
  assert.equal(volumeNoise.outputTex3d, 'volumeCache')
  assert.equal(volumeNoise.outputGeo, 'geoBuffer')
  assert.deepEqual(volumeNoise.passes[0].viewport.height,
    { param: 'volumeSize', power: 2, default: 4096 })

  const volumeRenderer = byId.get('render/render3d')
  assert.equal(volumeRenderer.domain, 'volume-renderer')
  assert.equal(volumeRenderer.outputTex3d, 'inputTex3d')
  assert.equal(volumeRenderer.outputGeo, 'screenGeoBuffer')

  assert.equal(byId.get('render/loopBegin').loopRole, 'begin')
  assert.equal(byId.get('render/loopEnd').loopRole, 'end')
})

test('stateful and particle records carry CPU iteration metadata', () => {
  const byId = new Map(effectRecords.map((record) => [record.id, record]))
  const iterated = effectRecords.filter((record) => record.iterated === true).map((record) => record.id)
  assert.deepEqual(iterated, EXPECTED_ITERATED)
  for (const id of EXPECTED_ITERATED) {
    const param = byId.get(id).params.iterationCount
    assert.deepEqual(param, { type: 'int', default: 60, min: 0, max: 10000, cpuOnly: true })
  }
  assert.equal(byId.get('synth/reactionDiffusion').passes[0].repeat, 'iterations')
  assert.equal(byId.get('synth/navierStokes').passes[3].repeat, 'iterations')
  assert.equal(byId.get('render/pointsEmit').passes[0].drawBuffers, 3)
  assert.equal(byId.get('points/life').passes[1].drawBuffers, 4)
  assert.deepEqual(byId.get('render/pointsBillboardRender').passes[2].conditions,
    { runIf: [{ uniform: 'blendMode', equals: 0 }] })
  assert.deepEqual(byId.get('synth/cellularAutomata').textures.global_ca_state.width,
    { screenDivide: 'zoom', default: 32 })
  assert.deepEqual(byId.get('render/pointsEmit').textures.global_xyz,
    { width: { param: 'stateSize', default: 256 }, height: { param: 'stateSize', default: 256 }, format: 'rgba32f' })
  assert.equal(byId.get('render/pointsEmit').outputXyz, 'global_xyz')
  assert.equal(byId.get('filter/feedback').kind, 'filter')
  assert.equal(byId.get('filter/temporalAberration').kind, 'filter')
  assert.equal(byId.get('points/flock').kind, 'filter')
  assert.equal(byId.get('render/pointsRender').kind, 'filter')
  assert.equal(byId.get('synth/reactionDiffusion').kind, 'generator')
  // points/life's forceMatrix is a fixed 8x8 lookup texture (internal, not image-shaped),
  // unlike filter/wormhole's canvas-relative "100%" accumulator, which stays a real
  // (mixer-classified) own-texture reference exactly as already shipped.
  assert.equal(byId.get('points/life').kind, 'filter')
  assert.equal(byId.get('filter/wormhole').kind, 'mixer')
  // `inferKind`'s old surface-param exemption existed only to force render/pointsBillboardRender
  // to `filter` (its `spriteTex` is a real `type: 'surface'` param). Removing that exemption
  // entirely and adding an explicit points/render namespace shortcut instead corrected 12
  // pre-existing filter/* effects that had no surface params at all (their old `mixer` label was
  // an artifact of the exemption's predecessor rule tripping on internal `_scratch` pass inputs),
  // while leaving 6 other pre-existing mixer/* effects - which DO reference a genuine
  // second-surface param - correctly unchanged. Pinned individually so a future regeneration
  // can't silently flip any of them.
  assert.equal(byId.get('render/pointsBillboardRender').kind, 'filter')
  for (const id of ['filter/bloom', 'filter/chrome', 'filter/highPass', 'filter/oilPaint',
    'filter/photocopy', 'filter/plasticWrap', 'filter/relief', 'filter/smooth', 'filter/stamp',
    'filter/strokes', 'filter/unsharpMask', 'filter/watercolor']) {
    assert.equal(byId.get(id).kind, 'filter', id)
  }
  for (const id of ['classicNoisedeck/cellNoise', 'classicNoisedeck/coalesce',
    'classicNoisedeck/composite', 'classicNoisedeck/shapeMixer', 'filter/lighting', 'filter/parallax']) {
    assert.equal(byId.get(id).kind, 'mixer', id)
  }
  assert.equal('stateful' in excludedEffects, false)
  assert.equal('particles' in excludedEffects, false)
  assert.equal('control' in excludedEffects, false)
  assert.deepEqual(excludedEffects.mesh, ['render/meshLoader', 'render/meshRender'])
})
