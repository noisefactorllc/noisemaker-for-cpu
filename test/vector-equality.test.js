import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CpuRenderer, createDefaultRegistry, kernelFactories } from '../src/index.js'

const kernelsSource = () => readFile(new URL('../src/effects/generated/canonical-kernels.js', import.meta.url), 'utf8')

// GLSL `vecN == vecN` is one bool (every component equal) and `!=` is one bool
// (any component differs). A component-wise array is always truthy in
// JavaScript, so a compiled kernel must never branch on one.
test('no compiled kernel branches on a component-wise vector comparison', async () => {
  // Elements may index (`color2[0] == 0`), so a `]` only ends the literal before `)`.
  const arrayConditions = (await kernelsSource()).match(/(?:\(new \$runtime\.PooledFloat32Array\(\[(?:[^\]]|\](?!\)))*?[=!]= (?:[^\]]|\](?!\)))*\]\)\) \?|if \(new \$runtime\.PooledFloat32Array\(\[(?:[^\]]|\](?!\)))*?[=!]= )/g) ?? []
  assert.deepEqual(arrayConditions, [])
})

// GLSL ES 3.0 component-wise builtins (round, trunc, tanh, ...) must be typed
// like floor: an untyped `s * round(v)` multiplies a number by an array (NaN).
test('no compiled kernel multiplies a scalar by an untyped vector builtin', async () => {
  const scalarTimesArray = (await kernelsSource()).match(/\b[A-Za-z_$][\w$]* \* \((?:round|roundEven|trunc|tanh|sinh|cosh)\(new /g) ?? []
  assert.deepEqual(scalarTimesArray, [])
})

// Non-default programs captured from the Apple M4/Metal WebGL2 authority. Each
// one exercises a branch the default fixtures never reach: lensDistortion's
// tint, coalesce's color burn and dodge, and colorLab's Bayer dither (vector
// equality, alone and combined with ||), and shapes3d's domain repetition
// (vector round).
test('non-default vector-comparison and round paths match the M4 authority', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/authority/nondefault-m4.json', import.meta.url), 'utf8'))
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
  for (const [name, { program, rgba8 }] of Object.entries(fixture.cases)) {
    const actual = renderer.render(program, { width: 8, height: 8, time: 0.25, seed: 1 }).toRgba8()
    let maxError = 0
    for (let index = 0; index < rgba8.length; index += 1) maxError = Math.max(maxError, Math.abs(actual[index] - rgba8[index]))
    assert.ok(maxError <= 2, `${name}: max error ${maxError} exceeds the ±2 contract`)
  }
})
