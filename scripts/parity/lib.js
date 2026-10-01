import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export function compareRgba8(actual, expected, tolerance = 2) {
  if (actual.length !== expected.length) throw new TypeError('Parity images must have matching RGBA lengths')
  let maxError = 0
  let totalError = 0
  let differingChannels = 0
  let channelsOverTolerance = 0
  for (let index = 0; index < actual.length; index += 1) {
    const error = Math.abs(actual[index] - expected[index])
    if (error !== 0) differingChannels += 1
    if (error > tolerance) channelsOverTolerance += 1
    if (error > maxError) maxError = error
    totalError += error
  }
  return {
    exact: differingChannels === 0,
    pass: channelsOverTolerance === 0,
    maxError,
    meanError: totalError / actual.length,
    differingChannels,
    channelsOverTolerance,
  }
}

// GAP-008: reference-image provenance. The retained goldens are the REFERENCE captures;
// UPSTREAM_REVISION is the CANDIDATE source/kernel pin and must never be reported as a
// capture revision. parity/goldens/provenance.json (regenerate with
// scripts/parity/write-provenance.js) maps each golden to its capture record; goldens
// recorded without one report provenance 'unknown'. The recorded sha256 is cross-checked
// against the file bytes so a regenerated golden cannot be silently relabeled.
export async function loadGoldenProvenance(goldenRoot) {
  const manifestPath = resolve(goldenRoot, 'provenance.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    return new Map(Object.entries(manifest.goldens))
  } catch (error) {
    if (error.code === 'ENOENT') return new Map()
    throw error
  }
}

export async function goldenReference(goldenRoot, suite, name, provenance) {
  const key = `${suite}/${name}.golden.png`
  const goldenPath = resolve(goldenRoot, key)
  const sha256 = createHash('sha256').update(await readFile(goldenPath)).digest('hex')
  const entry = provenance.get(key)
  if (entry) {
    if (entry.sha256 !== sha256) {
      throw new Error(`Golden ${key} does not match its provenance record (recorded ${entry.sha256}, actual ${sha256}). Regenerate the capture record with scripts/parity/write-provenance.js and identify the capture revision — do not relabel the reference capture.`)
    }
    return {
      image: `parity/goldens/${key}`,
      sha256,
      captureRevision: entry.captureRevision ?? null,
      provenance: entry.captureRevision ? 'recorded' : 'unknown',
    }
  }
  return { image: `parity/goldens/${key}`, sha256, captureRevision: null, provenance: 'unknown' }
}

// Shared skip policy for the parity gate and the parity-summary entrypoint: the
// pre-existing CPU-divergent simulation effects and the ported volume/loop effects
// (the 17 earlier volume/loop ports plus the 3 landscape/heightfield effects from
// reference 0ed489ec) are explicit, preflighted skips until pinned GPU goldens
// exist for them.
export const NEW_CPU_EFFECT_IDS = Object.freeze(new Set([
  'classicNoisedeck/noise3d', 'classicNoisedeck/shapes3d',
  'filter3d/flow3d', 'filter3d/palette3d',
  'render/loopBegin', 'render/loopEnd', 'render/render3d', 'render/renderCubemap3d',
  'render/renderCubemapSurface', 'render/renderLit3d',
  'synth3d/cell3d', 'synth3d/cellularAutomata3d', 'synth3d/flythrough3d',
  'synth3d/fractal3d', 'synth3d/noise3d', 'synth3d/reactionDiffusion3d', 'synth3d/shape3d',
  // Reference 0ed489ec's landscape/heightfield release: no pinned GPU golden yet, same as the
  // 17 above when they were first ported. Fixtures exist and compile (see the skip-fixture
  // discipline above); a GPU session needs to render and commit parity/goldens/defaults/
  // {points__heightGrid,render__renderLandscape3d,synth3d__heightmap3d}.golden.png before these
  // can move into the graded set.
  'points/heightGrid', 'render/renderLandscape3d', 'synth3d/heightmap3d',
]))
