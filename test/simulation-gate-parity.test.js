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
