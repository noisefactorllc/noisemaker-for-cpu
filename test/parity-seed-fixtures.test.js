import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { pinDefaultSeeds } from '../scripts/parity/pin-default-seeds.js'

test('parity fixture normalization makes canonical effect seed defaults explicit', () => {
  assert.equal(pinDefaultSeeds('search synth\nnoise().write(o0)'), 'search synth\nnoise(seed: 1).write(o0)')
  assert.equal(pinDefaultSeeds('search synth\nperlin(scale: 100).write(o0)'), 'search synth\nperlin(seed: 0, scale: 100).write(o0)')
  assert.equal(pinDefaultSeeds('search synth\nnoise(seed: 9).write(o0)'), 'search synth\nnoise(seed: 9).write(o0)')
  assert.equal(pinDefaultSeeds('search classicNoisedeck\nsplat(splatSeed: 4).write(o0)'), 'search classicNoisedeck\nsplat(splatSeed: 4).write(o0)')
})

test('every checked-in upstream parity fixture pins all canonical seed defaults', async () => {
  const directory = resolve('parity/upstream-defaults')
  for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.dsl'))) {
    const source = await readFile(resolve(directory, name), 'utf8')
    assert.equal(pinDefaultSeeds(source, name), source, `${name} has an inherited seed`)
  }
})
