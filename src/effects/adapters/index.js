import { bitEffectsFactory } from './bit-effects.js'
import { crtFactory } from './crt.js'
import { fractalFactory } from './fractal.js'
import { juliaFactory } from './julia.js'
import { historicPaletteFactory, paletteFactory } from './palette.js'
import { medianFactory } from './median.js'
import { pixelSortLuminanceFactory, reindexApplyFactory, reindexStatsFactory } from './f32-color.js'
import { snowFactory } from './snow.js'

export const canonicalAdapterFactories = Object.freeze({
  'classicNoisedeck/bitEffects:bitEffects': bitEffectsFactory,
  'classicNoisedeck/fractal:fractal': fractalFactory,
  'filter/crt:crt': crtFactory,
  'filter/historicPalette:historicPalette': historicPaletteFactory,
  'filter/median:median': medianFactory,
  'filter/palette:palette': paletteFactory,
  'filter/pixelSort:luminance': pixelSortLuminanceFactory,
  'filter/reindex:nmReindexApply': reindexApplyFactory,
  'filter/reindex:nmReindexStats': reindexStatsFactory,
  'filter/snow:snow': snowFactory,
  'synth/julia:julia': juliaFactory,
})
