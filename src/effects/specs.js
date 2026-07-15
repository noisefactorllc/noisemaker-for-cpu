const f = (defaultValue, min, max, uniform) => ({ type: 'float', default: defaultValue, min, max, uniform })
const i = (defaultValue, min, max, uniform) => ({ type: 'int', default: defaultValue, min, max, uniform })
const b = (defaultValue, uniform) => ({ type: 'bool', default: defaultValue, uniform })
const color = (defaultValue, uniform) => ({ type: 'color', default: defaultValue, uniform })
const e = (defaultValue, choices, uniform) => ({ type: 'enum', default: defaultValue, choices, uniform })
const surface = (texture) => ({ type: 'surface', texture })
const pass = (kernel, uniforms) => ({ kernel, ...(uniforms ? { uniforms } : {}) })

const WRAP = { mirror: 0, repeat: 1, clamp: 2 }

export const effectSpecs = Object.freeze([
  {
    namespace: 'synth', func: 'solid', kind: 'generator',
    params: { color: color([0.5, 0.5, 0.5]), alpha: f(1, 0, 1) },
    passes: [pass('synth/solid/main')],
  },
  {
    namespace: 'synth', func: 'gradient', kind: 'generator',
    params: {
      type: e(0, { conic: 0, diamond: 1, fourCorners: 2, linear: 3, noiseGradient: 4, radial: 5, spiral: 6 }, 'gradientType'),
      rotation: f(0, -180, 180), repeat: i(1, 1, 4), speed: i(0, -5, 5), seed: i(1, 0, 100),
      color1: color([1, 0, 0]), color2: color([1, 1, 0]), color3: color([0, 1, 0]), color4: color([0, 0, 1]),
      colorCount: i(4, 2, 4),
    },
    passes: [pass('synth/gradient/main')],
  },
  {
    namespace: 'synth', func: 'noise', kind: 'generator',
    params: {
      type: e(10, { constant: 0, linear: 1, hermite: 2, simplex: 10, sine: 11 }, 'noiseType'),
      octaves: i(2, 1, 8), scaleX: f(75, 1, 100), scaleY: f(75, 1, 100), seed: i(1, 1, 100),
      wrap: b(true), ridges: b(false), loopOffset: i(300, 10, 410), loopScale: f(75, 1, 100),
      speed: i(25, -100, 100), colorMode: e(1, { mono: 0, rgb: 1 }),
    },
    passes: [pass('synth/noise/main')],
  },
  {
    namespace: 'synth', func: 'cell', kind: 'generator',
    params: {
      shape: e(0, { circle: 0, diamond: 1, hexagon: 2, octagon: 3, square: 4, triangle: 6 }, 'metric'),
      scale: f(75, 1, 100), cellScale: f(87, 1, 100), cellSmooth: f(0, 0, 100),
      variation: f(50, 0, 100), speed: i(1, 0, 5), seed: i(1, 1, 100),
    },
    passes: [pass('synth/cell/main')],
  },
  {
    namespace: 'synth', func: 'shape', kind: 'generator',
    params: {
      loopAOffset: e(40, { circle: 10, triangle: 20, diamond: 30, square: 40, hexagon: 60, rings: 400, sine: 410 }, 'loopAOffset'),
      loopBOffset: e(30, { circle: 10, triangle: 20, diamond: 30, square: 40, hexagon: 60, rings: 400, sine: 410 }, 'loopBOffset'),
      loopAScale: f(1, 1, 100), loopBScale: f(1, 1, 100), speedA: i(50, -100, 100), speedB: i(50, -100, 100),
      seed: i(1, 1, 100), wrap: b(true),
    },
    passes: [pass('synth/shape/main')],
  },
  {
    namespace: 'synth', func: 'osc2d', kind: 'generator',
    params: {
      oscType: e(0, { sine: 0, linear: 1, sawtooth: 2, sawtoothInv: 3, square: 4, noise1d: 5, noise2d: 6 }),
      freq: i(5, 1, 32, 'frequency'), speed: i(4, 0, 10), rotation: f(0, -180, 180), seed: i(0, 0, 1000),
    },
    passes: [pass('synth/osc2d/main')],
  },
  {
    namespace: 'synth', func: 'testPattern', kind: 'generator',
    params: { pattern: e(0, { checkerboard: 0, colorBars: 1, gradient: 2, uvMap: 3, gridLines: 4, colorGrid: 5, dotGrid: 6 }), gridSize: i(4, 1, 16) },
    passes: [pass('synth/testPattern/main')],
  },
  {
    namespace: 'synth', func: 'mandelbrot', kind: 'generator',
    params: {
      poi: i(0, 0, 8), outputMode: e(0, { smoothIteration: 0, distance: 1, stripeAverage: 2, orbitTrap: 3, normalMap: 4 }),
      iterations: i(500, 50, 2000), centerX: f(-0.5, -3, 3), centerY: f(0, -3, 3), rotation: f(0, -180, 180),
      zoomSpeed: f(0, 0, 5), zoomDepth: f(0, 0, 14), stripeFreq: f(5, 0.5, 20), trapShape: i(0, 0, 2),
      lightAngle: f(45, 0, 360), invert: b(false),
    },
    passes: [pass('synth/mandelbrot/main')],
  },
  { namespace: 'filter', func: 'invert', kind: 'filter', params: {}, passes: [pass('filter/invert/main')] },
  { namespace: 'filter', func: 'bc', kind: 'filter', params: { brightness: f(1, 0, 10), contrast: f(0.5, 0, 1) }, passes: [pass('filter/bc/main')] },
  { namespace: 'filter', func: 'hs', kind: 'filter', params: { rotation: f(0, -180, 180), hueRange: f(100, 0, 200), saturation: f(1, 0, 4) }, passes: [pass('filter/hs/main')] },
  { namespace: 'filter', func: 'threshold', kind: 'filter', params: { level: f(0.5, 0, 1), sharpness: f(0.5, 0, 1) }, passes: [pass('filter/threshold/main')] },
  { namespace: 'filter', func: 'posterize', kind: 'filter', params: { levels: i(5, 2, 32), gamma: f(1, 0.1, 3), antialias: b(true) }, passes: [pass('filter/posterize/main')] },
  { namespace: 'filter', func: 'tint', kind: 'filter', params: { color: color([1, 1, 1]), alpha: f(0.5, 0, 1), mode: e(0, { overlay: 0, multiply: 1, recolor: 2 }) }, passes: [pass('filter/tint/main')] },
  { namespace: 'filter', func: 'channel', kind: 'filter', params: { channel: e(0, { r: 0, g: 1, b: 2, a: 3 }), scale: f(1, -10, 10), offset: f(0, -10, 10) }, passes: [pass('filter/channel/main')] },
  { namespace: 'filter', func: 'flipMirror', kind: 'filter', params: { mode: e(15, { none: 0, all: 1, horizontal: 2, vertical: 3, mirrorLtoR: 11, mirrorRtoL: 12, mirrorUtoD: 13, mirrorDtoU: 14, mirrorLtoRUtoD: 15 }, 'flipMode') }, passes: [pass('filter/flipMirror/main')] },
  { namespace: 'filter', func: 'pixels', kind: 'filter', params: { size: i(16, 1, 256) }, passes: [pass('filter/pixels/main')] },
  { namespace: 'filter', func: 'translate', kind: 'filter', params: { x: f(0, -1, 1), y: f(0, -1, 1), wrap: e(1, WRAP) }, passes: [pass('filter/translate/main')] },
  { namespace: 'filter', func: 'scale', kind: 'filter', params: { x: f(0.5, 0, 10, 'scaleX'), y: f(0.5, 0, 10, 'scaleY'), centerX: f(0.5, 0, 1), centerY: f(0.5, 0, 1), wrap: e(1, WRAP) }, passes: [pass('filter/scale/main')] },
  { namespace: 'filter', func: 'rotate', kind: 'filter', params: { rotation: f(45, -180, 180), wrap: e(1, WRAP), speed: i(0, -4, 4) }, passes: [pass('filter/rotate/main')] },
  { namespace: 'filter', func: 'tile', kind: 'filter', params: { symmetry: e(0, { mirrorXY: 0, rotate2: 1, rotate4: 2, rotate6: 3 }), scale: f(1, 0.1, 4), offsetX: f(0, -1, 1), offsetY: f(0, -1, 1), angle: f(0, 0, 360), repeat: f(2, 1, 10), aspectLens: b(true) }, passes: [pass('filter/tile/main')] },
  { namespace: 'filter', func: 'polar', kind: 'filter', params: { mode: e(0, { polar: 0, vortex: 1 }, 'polarMode'), scale: f(0, -2, 2), rotation: i(0, -2, 2), speed: i(0, -2, 2), aspectLens: b(true), antialias: b(true) }, passes: [pass('filter/polar/main')] },
  { namespace: 'filter', func: 'blur', kind: 'filter', params: { radiusX: f(5, 0, 50), radiusY: f(5, 0, 50) }, passes: [pass('filter/blur/h'), pass('filter/blur/v')] },
  { namespace: 'filter', func: 'sharpen', kind: 'filter', params: { amount: f(1, 0.1, 5) }, passes: [pass('filter/sharpen/main')] },
  { namespace: 'filter', func: 'sobel', kind: 'filter', params: { amount: f(1, 0.1, 5), alpha: f(1, 0, 1) }, passes: [pass('filter/sobel/main')] },
  { namespace: 'filter', func: 'vignette', kind: 'filter', params: { brightness: f(0, 0, 1, 'vignetteBrightness'), alpha: f(1, 0, 1) }, passes: [pass('filter/vignette/main')] },
  { namespace: 'filter', func: 'chromaticAberration', kind: 'filter', params: { aberration: f(50, 0, 100, 'aberrationAmt'), passthru: f(50, 0, 100) }, passes: [pass('filter/chromaticAberration/main')] },
  { namespace: 'mixer', func: 'blendMode', kind: 'mixer', params: { tex: surface('tex'), mode: e(0, { add: 0, burn: 1, darken: 2, diff: 3, dodge: 4, exclusion: 5, hardLight: 6, lighten: 7, mix: 8, multiply: 9, negation: 10, overlay: 11, phoenix: 12, screen: 13, softLight: 14, subtract: 15 }), mix: f(0, -100, 100, 'mixAmt') }, passes: [pass('mixer/blendMode/main')] },
  { namespace: 'mixer', func: 'alphaMask', kind: 'mixer', params: { tex: surface('tex'), mix: f(0, -100, 100, 'mixAmt'), maskMode: b(false) }, passes: [pass('mixer/alphaMask/main')] },
  { namespace: 'mixer', func: 'channelCombine', kind: 'mixer', params: { rTex: surface('rTex'), gTex: surface('gTex'), bTex: surface('bTex'), rLevel: f(100, 0, 100), gLevel: f(100, 0, 100), bLevel: f(100, 0, 100) }, passes: [pass('mixer/channelCombine/main')] },
  { namespace: 'classicNoisedeck', func: 'kaleido', kind: 'filter', params: { sides: i(8, 2, 32, 'kaleido'), metric: i(0, 0, 5), loopOffset: i(10, 10, 410), loopScale: f(1, 1, 100), speed: f(5, -100, 100), seed: i(1, 1, 100), wrap: b(true), direction: i(2, 0, 2), kernel: i(0, 0, 120), effectWidth: f(0, 0, 10) }, passes: [pass('classicNoisedeck/kaleido/main')] },
  { namespace: 'classicNoisedeck', func: 'lensDistortion', kind: 'filter', params: { shape: i(0, 0, 10), distortion: f(0, -100, 100), aspectLens: b(false), loopScale: f(100, 1, 100), speed: f(0, -100, 100), mode: i(0, 0, 1), aberration: f(50, 0, 100), blendMode: i(0, 0, 1), modulate: b(false), tint: color([0, 0, 0]), alpha: f(0, 0, 100), hueRotation: f(0, 0, 360), hueRange: f(0, 0, 100), saturation: f(0, -100, 100), passthru: f(50, 0, 100), vignetteAmt: f(0, -100, 100) }, passes: [pass('classicNoisedeck/lensDistortion/main')] },
])

export const kernelManifest = Object.freeze([
  ['synth/solid/main', 'synth/solid/main.csl'],
  ['synth/gradient/main', 'synth/gradient/main.csl'],
  ['synth/noise/main', 'synth/noise/main.csl'],
  ['synth/cell/main', 'synth/cell/main.csl'],
  ['synth/shape/main', 'synth/shape/main.csl'],
  ['synth/osc2d/main', 'synth/osc2d/main.csl'],
  ['synth/testPattern/main', 'synth/testPattern/main.csl'],
  ['synth/mandelbrot/main', 'synth/mandelbrot/main.csl'],
  ['filter/invert/main', 'filter/invert/main.csl'],
  ['filter/bc/main', 'filter/bc/main.csl'],
  ['filter/hs/main', 'filter/hs/main.csl'],
  ['filter/threshold/main', 'filter/threshold/main.csl'],
  ['filter/posterize/main', 'filter/posterize/main.csl'],
  ['filter/tint/main', 'filter/tint/main.csl'],
  ['filter/channel/main', 'filter/channel/main.csl'],
  ['filter/flipMirror/main', 'filter/flipMirror/main.csl'],
  ['filter/pixels/main', 'filter/pixels/main.csl'],
  ['filter/translate/main', 'filter/translate/main.csl'],
  ['filter/scale/main', 'filter/scale/main.csl'],
  ['filter/rotate/main', 'filter/rotate/main.csl'],
  ['filter/tile/main', 'filter/tile/main.csl'],
  ['filter/polar/main', 'filter/polar/main.csl'],
  ['filter/blur/h', 'filter/blur/h.csl'],
  ['filter/blur/v', 'filter/blur/v.csl'],
  ['filter/sharpen/main', 'filter/sharpen/main.csl'],
  ['filter/sobel/main', 'filter/sobel/main.csl'],
  ['filter/vignette/main', 'filter/vignette/main.csl'],
  ['filter/chromaticAberration/main', 'filter/chromaticAberration/main.csl'],
  ['mixer/blendMode/main', 'mixer/blendMode/main.csl'],
  ['mixer/alphaMask/main', 'mixer/alphaMask/main.csl'],
  ['mixer/channelCombine/main', 'mixer/channelCombine/main.csl'],
  ['classicNoisedeck/kaleido/main', 'classicNoisedeck/kaleido/main.csl'],
  ['classicNoisedeck/lensDistortion/main', 'classicNoisedeck/lensDistortion/main.csl'],
])
