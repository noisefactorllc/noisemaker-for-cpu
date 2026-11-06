import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { canonicalKernelFactories } from '../src/effects/generated/canonical-kernels.js'

// Upstream 8395d1da made feedback's hsv2rgb take its last sector as the else
// branch. fract() returns 1.0 for a hue just below a whole number, and a
// compiler that folds hsv2rgb's own fract() into the caller's fract() then
// reaches the sector chain with the raw h = 1.0. The pinned GLSL wraps that h
// through the last sector — rgb = (c, 0, x), the colour of h = 0.0 — instead
// of falling into a black vec3(0). The rendered pipeline always applies
// fract() before the call, so no render reaches h >= 1.0; this file therefore
// evaluates the generated kernel's own hsv2rgb (a plain string inside the
// module) twice: once with the port's fract, once with an identity fract that
// reproduces the folded-compiler case the fix defends against.

const kernelsSource = await readFile(new URL('../src/effects/generated/canonical-kernels.js', import.meta.url), 'utf8')

function extractFactory(name) {
  const start = kernelsSource.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} is missing`)
  const end = kernelsSource.indexOf('\nfunction canonicalFactory', start + 1)
  assert.ok(end > start, `${name} is not followed by another factory`)
  return kernelsSource.slice(start, end)
}

function extractHsv2rgb(factorySource) {
  const marker = 'function hsv2rgb (hsv) {'
  const start = factorySource.indexOf(marker)
  assert.ok(start >= 0, 'factory does not define hsv2rgb')
  let depth = 0
  for (let index = start + marker.length - 1; index < factorySource.length; index += 1) {
    const char = factorySource[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return factorySource.slice(start, index + 1)
    }
  }
  assert.fail('hsv2rgb is not closed')
}

// The feedback factory's hsv2rgb sees the port runtime's vector helpers plus
// the stdlib single-argument math builtins as bare names.
function evaluateHsv2rgb(source, fract) {
  const abs = Math.abs
  const mod = (left, right) => left - right * Math.floor(left / right)
  function pooledFloat32Array(initializer) {
    return new Float32Array(initializer)
  }
  const runtime = {
    copy: (value) => value,
    PooledFloat32Array: pooledFloat32Array,
  }
  return new Function('$runtime', 'fract', 'abs', 'mod', `${source}\nreturn hsv2rgb;`)(runtime, fract, abs, mod)
}

function fract(value) {
  return value - Math.floor(value)
}

const source = extractHsv2rgb(extractFactory('canonicalFactory51'))
const hsv2rgb = evaluateHsv2rgb(source, fract)
// The folded case: hsv2rgb's own fract() is compiled away, as Mesa did before
// the fix, so the raw h reaches the sector chain unchanged.
const hsv2rgbFolded = evaluateHsv2rgb(source, (value) => value)

test('the generated feedback hsv2rgb has no black fallback sector', () => {
  assert.equal(canonicalKernelFactories['filter/feedback:feedback']?.name, 'canonicalFactory51',
    'the extracted hsv2rgb must come from the generated filter/feedback factory')
  assert.ok(!/rgb\[0\] = 0, rgb\[1\] = 0, rgb\[2\] = 0/.test(source),
    'the old black vec3(0) fallback sector is gone')
})

test('the sector chain takes raw h = 1.0 as h = 0.0, not black', () => {
  // With the fold reproduced, h = 1.0 reaches the last sector (the else
  // branch) unchanged. There x is 0, so the colour is that of h = 0.0.
  assert.deepEqual([...hsv2rgbFolded(new Float32Array([1, 1, 1]))], [1, 0, 0])
  assert.deepEqual(hsv2rgbFolded(new Float32Array([1, 1, 1])), hsv2rgb(new Float32Array([0, 1, 1])))
})

test('h = 1.0 renders as h = 0.0, not black', () => {
  assert.deepEqual([...hsv2rgb(new Float32Array([1, 1, 1]))], [1, 0, 0])
  assert.deepEqual(hsv2rgb(new Float32Array([1, 1, 1])), hsv2rgb(new Float32Array([0, 1, 1])))
})

test('h = 1.25 renders as h = 0.25', () => {
  assert.deepEqual(hsv2rgb(new Float32Array([1.25, 1, 1])), hsv2rgb(new Float32Array([0.25, 1, 1])))
})

test('every h in [-1, 2) wraps to its fract(h) colour', () => {
  // Steps of 1/256 are exact in float32 and their fract() wrap is exact too,
  // so the wrapped and unwrapped calls must agree bit for bit.
  for (let step = -256; step < 512; step += 1) {
    const h = step / 256
    assert.deepEqual(hsv2rgb(new Float32Array([h, 0.75, 1])), hsv2rgb(new Float32Array([fract(h), 0.75, 1])), `h = ${h}`)
  }
})
