import assert from 'node:assert/strict'
import test from 'node:test'

import { GlslCpuRuntime } from '../src/csl/glsl-runtime.js'

// Mirrors upstream be8ed4cd: a declared sampler that the pass lists no input
// for reads transparent black (the backends bind their default texture), and
// a binding that exists but is not a Surface stays an error.
test('an unbound sampler reads transparent black', () => {
  const runtime = new GlslCpuRuntime()
  runtime.beginPixel({ fragCoord: new Float32Array([0.5, 0.5]), uv: new Float32Array([0.25, 0.75]) })
  assert.deepEqual([...runtime.stdlib.texture(undefined, [0.25, 0.75])], [0, 0, 0, 0])
  assert.deepEqual([...runtime.stdlib.textureLod(undefined, [0.25, 0.75])], [0, 0, 0, 0])
  assert.deepEqual([...runtime.stdlib.texelFetch(undefined, [0, 0])], [0, 0, 0, 0])
})

test('a non-Surface sampler binding still fails', () => {
  const runtime = new GlslCpuRuntime()
  runtime.beginPixel({ fragCoord: new Float32Array([0.5, 0.5]), uv: new Float32Array([0.25, 0.75]) })
  assert.throws(() => runtime.stdlib.texture({ width: 2 }, [0.25, 0.75]), TypeError)
  assert.throws(() => runtime.stdlib.texelFetch({ width: 2 }, [0, 0]), TypeError)
})
