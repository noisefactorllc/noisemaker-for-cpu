import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

// GAP-034: the classicNoisedeck/fractal adapter's Julia iteration must run in
// float32, like the GLSL does on the GPU. A float64 iteration diverges from
// the float32 result by one level in some pixels once `mode` returns the
// continuous |z| value instead of the quantized iteration count. These frames
// pin the float32 iteration so a float64 regression fails loudly.
const F32_CASES = [
  ['mode 1 defaults', 'search classicNoisedeck\nfractal(mode: 1).write(o0)\nrender(o0)',
    '24018d442f1d6b0a85c5be185ab3db36dc03248c34e395e24397fa6ea3fb6e2a'],
  ['mode 1 rotation 30, iterations 10',
    'search classicNoisedeck\nfractal(rotation: 30, iterations: 10, mode: 1).write(o0)\nrender(o0)',
    '8c9c0986069bd7859352ece912640cc9d8ec8292b559ebc3f5adde52281a5bcc'],
  ['mode 0 rotation 30, iterations 10',
    'search classicNoisedeck\nfractal(rotation: 30, iterations: 10).write(o0)\nrender(o0)',
    '8c7c7406e5039802b2266d64ae43f477b128e16bb4d2c95f18e1b7f1b5825f97'],
]

for (const [name, source, hash] of F32_CASES) {
  test(`fractal Julia iterates in float32 (${name})`, () => {
    const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
    const result = renderer.render(source, { width: 64, height: 64, seed: 1, time: 0.25 })
    const rendered = createHash('sha256').update(result.toRgba8()).digest('hex')
    assert.equal(rendered, hash)
  })
}
