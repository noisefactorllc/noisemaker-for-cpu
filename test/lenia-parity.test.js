import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CpuRenderer, createDefaultRegistry, kernelFactories } from '../src/index.js'
import { readPng } from '../src/node/png.js'
import { compareRgba8 } from '../scripts/parity/lib.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = readFileSync(resolve(root, 'parity/upstream-defaults/points__lenia.dsl'), 'utf8')
  .replace('.pointsRender()', '.pointsRender(density: 0.1)')

test('Lenia 60-frame low-density output matches M4 authority and distinguishes one frame', async () => {
  const golden = await readPng(resolve(root, 'parity/goldens/variants/points__lenia_density01.golden.png'))
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
  const options = { width: 8, height: 8, seed: 1, time: 0.25 }
  const sixty = renderer.render(fixture, options).toRgba8()
  const one = renderer.render(fixture.replace('pointsEmit(seed: 0)', 'pointsEmit(seed: 0, iterationCount: 1)'), options).toRgba8()

  assert.equal(golden.width, 8)
  assert.equal(golden.height, 8)
  assert.equal(compareRgba8(sixty, golden.data, 2).pass, true)
  assert.equal(compareRgba8(one, golden.data, 2).pass, false)
})
