import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CpuRenderer, Surface, createDefaultRegistry, kernelFactories } from '../src/index.js'
import { readPng } from '../src/node/png.js'
import { compareRgba8 } from '../scripts/parity/lib.js'
import { runSummary } from '../scripts/parity/summary.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const records = JSON.parse(readFileSync(resolve(root, 'scripts/parity/capture-records.json'), 'utf8'))

// Each gate golden below is a non-uniform M4/Metal authority capture of its fixture.
// A uniform golden cannot detect a wrong simulation, so each case also checks that a
// one-step run of the same chain fails the ±2 contract. The cellular chains step
// through iterationCount; reactionDiffusion steps through its own `iterations` pass
// repeat, and the CPU clamps its iterationCount to one frame.
const CASES = [
  ['synth/cellularAutomata', (dsl) => dsl.replace('cellularAutomata(seed: 1, ', 'cellularAutomata(seed: 1, iterationCount: 1, ')],
  ['synth/mnca', (dsl) => dsl.replace('mnca(seed: 1, ', 'mnca(seed: 1, iterationCount: 1, ')],
  ['synth/reactionDiffusion', (dsl) => dsl.replace('reactionDiffusion(seed: 1, ', 'reactionDiffusion(seed: 1, iterations: 1, ')],
  // Particle chains step through their pointsEmit group's iterationCount.
  ...['points/physical', 'render/pointsEmit', 'render/pointsRender', 'points/flow', 'points/physarum', 'render/pointsBillboardRender']
    .map((id) => [id, (dsl) => dsl.replace('pointsEmit(seed: 0, ', 'pointsEmit(seed: 0, iterationCount: 1, ')]),
]

function distinctRgba(bytes) {
  const values = new Set()
  for (let index = 0; index < bytes.length; index += 4) values.add(bytes.slice(index, index + 4).join(','))
  return values.size
}

for (const [id, oneStep] of CASES) {
  test(`${id} gate golden is a non-uniform authority capture that one step cannot reach`, async () => {
    const name = id.replace('/', '__')
    const fixture = readFileSync(resolve(root, `parity/upstream-defaults/${name}.dsl`), 'utf8')
    const key = `defaults/${name}.golden.png`
    const golden = await readPng(resolve(root, 'parity/goldens', key))
    assert.equal(golden.width, 8)
    assert.equal(golden.height, 8)
    assert.ok(distinctRgba(golden.data) >= 2, `${key} holds one RGBA value`)
    const record = records[key]?.captureRecord
    assert.equal(record?.sourceRevision, '6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d', key)
    assert.equal(record.fixtureSha256, createHash('sha256').update(fixture.replace(/\r\n/g, '\n')).digest('hex'), key)

    const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
    const blank = new Surface(8, 8)
    blank.format = 'rgba16f'
    const options = { width: 8, height: 8, seed: 1, time: 0.25, oneShot: 'initial', externalTextures: { imageTex: blank, textTex: blank } }
    const stepped = oneStep(fixture)
    assert.notEqual(stepped, fixture)
    assert.equal(compareRgba8(renderer.render(fixture, options).toRgba8(), golden.data, 2).pass, true)
    assert.equal(compareRgba8(renderer.render(stepped, options).toRgba8(), golden.data, 2).pass, false)
  })
}

// points/hydraulic is a particle simulation: after 60 frames the CPU differs from its
// authority capture in 6 of 64 pixels, which a reviewed NEAR policy bounds (near.js).
test('points/hydraulic gate golden is a non-uniform 60-frame authority capture, a reviewed NEAR that one step cannot reach', async () => {
  const fixture = readFileSync(resolve(root, 'parity/upstream-defaults/points__hydraulic.dsl'), 'utf8')
  const key = 'defaults/points__hydraulic.golden.png'
  const golden = await readPng(resolve(root, 'parity/goldens', key))
  assert.equal(golden.width, 8)
  assert.equal(golden.height, 8)
  assert.ok(distinctRgba(golden.data) >= 2, `${key} holds one RGBA value`)
  const record = records[key]?.captureRecord
  assert.equal(record?.sourceRevision, '6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d')
  assert.equal(record.fixtureSha256, createHash('sha256').update(fixture.replace(/\r\n/g, '\n')).digest('hex'))
  assert.equal(record.frames, 60)
  assert.equal(record.surface.presented, 'global_o0_read')

  const result = await runSummary({ requested: ['points/hydraulic'] })
  assert.deepEqual([result.summary.executed, result.summary.near, result.summary.fail], [1, 1, 0])
  assert.equal(result.rendered[0].near.accepted, true)

  const blank = new Surface(8, 8)
  blank.format = 'rgba16f'
  const stepped = fixture.replace('pointsEmit(seed: 0)', 'pointsEmit(seed: 0, iterationCount: 1)')
  assert.notEqual(stepped, fixture)
  const one = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories }).render(stepped, {
    width: 8, height: 8, seed: 1, time: 0.25, oneShot: 'initial', externalTextures: { imageTex: blank, textTex: blank },
  }).toRgba8()
  assert.equal(compareRgba8(one, golden.data, 2).pass, false)
})

// Particle cases whose CPU output is not within ±2 of their non-uniform authority capture.
// They pass only as reviewed visual matches under the operator's 2026-10-17 particle
// direction (scripts/parity/near.js), bound to these exact candidate bytes and to their
// 128x128 review captures. A one-step run is neither within ±2 nor a reviewed match.
for (const id of ['points/dla', 'points/flock']) {
  test(`${id} gate golden is non-uniform and passes only as its reviewed visual match`, async () => {
    const { reviewedNearComparison } = await import('../scripts/parity/near.js')
    const name = id.replace('/', '__')
    const fixture = readFileSync(resolve(root, `parity/upstream-defaults/${name}.dsl`), 'utf8')
    const key = `defaults/${name}.golden.png`
    const golden = await readPng(resolve(root, 'parity/goldens', key))
    assert.ok(distinctRgba(golden.data) >= 2, `${key} holds one RGBA value`)

    const result = await runSummary({ requested: [id] })
    assert.deepEqual([result.summary.executed, result.summary.exact, result.summary.strict, result.summary.near, result.summary.fail], [1, 0, 0, 1, 0])
    const review = result.rendered[0].near
    assert.equal(review.accepted, true)
    assert.match(review.mechanism, /operator 2026-10-17/)
    assert.equal(review.review.size, 128)

    const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
    const blank = new Surface(8, 8)
    blank.format = 'rgba16f'
    const options = { width: 8, height: 8, seed: 1, time: 0.25, oneShot: 'initial', externalTextures: { imageTex: blank, textTex: blank } }
    const stepped = fixture.replace('pointsEmit(seed: 0, ', 'pointsEmit(seed: 0, iterationCount: 1, ')
    assert.notEqual(stepped, fixture)
    const one = renderer.render(stepped, options).toRgba8()
    assert.equal(compareRgba8(one, golden.data, 2).pass, false)
    const reference = { ...result.rendered[0].reference }
    assert.equal(await reviewedNearComparison({ id, actual: one, source: stepped, meta: { size: 8, time: 0.25, seed: 1, tolerance: 2 }, reference, authorityRevision: '6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d' }), null)

    // The reviewed 128x128 candidate is reproducible from this source.
    const reviewBlank = new Surface(128, 128)
    reviewBlank.format = 'rgba16f'
    const large = renderer.render(fixture, { ...options, width: 128, height: 128, externalTextures: { imageTex: reviewBlank, textTex: reviewBlank } }).toRgba8()
    assert.equal(createHash('sha256').update(large).digest('hex'), review.review.candidate.rawSha256)
  })
}
