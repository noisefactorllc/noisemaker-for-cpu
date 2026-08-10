import assert from 'node:assert/strict'
import test from 'node:test'

import { Surface } from '../src/runtime/surface.js'
import { bindCanonicalKernel } from '../src/csl/glsl-kernel.js'
import { GlslCpuRuntime, bindGlslKernel, glslMod, hashUint32, pcg3d, uint32 } from '../src/csl/glsl-runtime.js'
import { canonicalKernelFactories } from '../src/effects/generated/canonical-kernels.js'

test('GLSL scalar semantics preserve signed mod and unsigned overflow', () => {
  assert.equal(glslMod(-1, 3), 2)
  assert.equal(glslMod(7, -3), -2)
  assert.equal(uint32(0xffffffff + 2), 1)
  assert.equal(uint32(-1), 0xffffffff)
  assert.deepEqual(pcg3d([1, 2, 3]), [4204755366, 1223881804, 1500469937])
  assert.equal(hashUint32(0x1234abcd), 737574769)
  assert.equal(new GlslCpuRuntime().stdlib.umul(0xffffffff, 374761393), Math.imul(0xffffffff, 374761393) >>> 0)
  assert.equal(new GlslCpuRuntime().stdlib.float(0xffffffff), 4294967296)
})

test('pooled vector and matrix helpers implement GLSL component operations', () => {
  const runtime = new GlslCpuRuntime()
  runtime.beginPixel({ fragCoord: new Float32Array([0.5, 0.5]), uv: new Float32Array([0.25, 0.75]) })

  assert.deepEqual([...runtime.stdlib.mod(new Float32Array([-1, 7]), 3)], [2, 1])
  assert.deepEqual([...runtime.stdlib.mix(new Float32Array([0, 2]), new Float32Array([2, 4]), 0.25)], [0.5, 2.5])
  assert.equal(runtime.stdlib.dot(new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])), 32)
  assert.deepEqual(
    [...runtime.stdlib.cross(new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0]))],
    [0, 0, 1],
  )
  assert.deepEqual([...runtime.stdlib.ivec2(1.9, -2.9)], [1, -2])
  assert.deepEqual(
    [...runtime.stdlib.matrixMult(new Float32Array([1, 0, 0, 1]), new Float32Array([3, 4]))],
    [3, 4],
  )
})

test('integer constructors and PCG registers reuse pools across pixels', () => {
  const runtime = new GlslCpuRuntime()
  const context = { fragCoord: new Float32Array([0.5, 0.5]), uv: new Float32Array([0.5, 0.5]) }
  const factoryBoundConstant = runtime.stdlib.ivec2(41, 42)
  runtime.beginPixel(context)
  const firstUnsigned = runtime.stdlib.uvec3(1, 2, 3)
  const firstSigned = runtime.stdlib.ivec2(-1, 2)
  const firstPcg = runtime.stdlib.pcg3d(firstUnsigned)
  assert.ok(Array.isArray(firstUnsigned))
  assert.ok(firstSigned instanceof Int32Array)
  assert.ok(Array.isArray(firstPcg))
  assert.deepEqual([...factoryBoundConstant], [41, 42])
  assert.notEqual(firstSigned, factoryBoundConstant)
  assert.notEqual(runtime.stdlib.uvec3(4, 5, 6), firstUnsigned)

  runtime.beginPixel(context)
  assert.equal(runtime.stdlib.uvec3(7, 8, 9), firstUnsigned)
  assert.equal(runtime.stdlib.ivec2(3, 4), firstSigned)
  assert.equal(runtime.stdlib.pcg3d(firstUnsigned), firstPcg)
})

test('generated kernels lower GLSL decimal literals to float32 constants', () => {
  const source = canonicalKernelFactories['filter/stipple:stipple'].toString()
  assert.match(source, /0\.1031000018119812/)
  assert.doesNotMatch(source, /\* 0\.1031\b/)
  assert.match(source, /cpu_float\(\(cpu_float\(p3\[0\] \+ p3\[1\]\)\) \* p3\[2\]\)/)
})

test('snow hash keeps scalar float32 register writes before fract', () => {
  const source = canonicalKernelFactories['filter/snow:snow'].toString()
  assert.match(source, /var combined = cpu_float\(/)
  assert.match(source, /var scaled_time = cpu_float\(/)
  assert.match(source, /abs\(cos\(angle\)\) < 1\.0000000116860974e-7/)
  assert.match(source, /var dot_val = cpu_float\(cpu_float\(scaled\[0\]/)
})

test('texture helpers use canonical nearest surfaces and linear external sampling', () => {
  const surface = new Surface(2, 2, new Float32Array([
    1, 0, 0, 1, 0, 1, 0, 1,
    0, 0, 1, 1, 1, 1, 1, 1,
  ]))
  const runtime = new GlslCpuRuntime()
  runtime.beginPixel({ fragCoord: new Float32Array([0.5, 0.5]), uv: new Float32Array([0.25, 0.25]) })

  assert.deepEqual([...runtime.stdlib.textureSize(surface, 0)], [2, 2])
  assert.deepEqual([...runtime.stdlib.texelFetch(surface, new Int32Array([1, 0]), 0)], [1, 1, 1, 1])
  assert.deepEqual([...runtime.stdlib.texture(surface, new Float32Array([0.25, 0.25]))], [0, 0, 1, 1])
  assert.deepEqual([...runtime.stdlib.texture(surface, new Float32Array([0.5, 0.5]))], [0, 1, 0, 1])
  assert.deepEqual([...runtime.stdlib.texture(surface, new Float32Array([0.25, 0.75]))], [1, 0, 0, 1])
  assert.deepEqual(
    [...runtime.stdlib.texture({ ...surface, filter: 'linear' }, new Float32Array([0.5, 0.5]))],
    [0.5, 0.5, 0.5, 1],
  )
})

test('derivative compatibility returns typed finite footprints for vector expressions', () => {
  const runtime = new GlslCpuRuntime()
  runtime.beginPixel({
    fragCoord: new Float32Array([0.5, 0.5]),
    uv: new Float32Array([0.125, 0.25]),
    resolution: new Float32Array([8, 4]),
  })
  assert.deepEqual([...runtime.stdlib.dFdx(new Float32Array([0.1, 0.2]))], [0.125, 0])
  assert.deepEqual([...runtime.stdlib.dFdy(new Float32Array([0.1, 0.2]))], [0, 0.25])
  assert.deepEqual([...runtime.stdlib.fwidth(new Float32Array([0.1, 0.2]))], [0.125, 0.25])
})

test('factory-bound kernels expose GLSL registers without per-pixel setup closures', () => {
  let factoryCalls = 0
  const factory = ($bindings, runtime) => {
    factoryCalls += 1
    const fragColor = new Float32Array(4)
    return function canonicalKernel(context, out) {
      runtime.beginPixel(context)
      fragColor[0] = runtime.fragCoord[0] / $bindings.resolution[0]
      fragColor[1] = runtime.varyings.vUv[1]
      fragColor[2] = $bindings.gain
      fragColor[3] = 1
      runtime.writeColor(fragColor, out)
    }
  }
  const kernel = bindGlslKernel(factory, { resolution: new Float32Array([4, 2]), gain: 0.75 })
  const out = new Float32Array(4)
  const context = {
    fragCoord: new Float32Array([1.5, 0.5]),
    uv: new Float32Array([0.375, 0.25]),
  }

  kernel(context, out)
  kernel(context, out)

  assert.equal(factoryCalls, 1)
  assert.deepEqual([...out], [0.375, 0.25, 0.75, 1])
  assert.doesNotMatch(kernel.toString(), /=>|\.bind\(|new Function/)
})

test('AOT canonical factories execute transpiled GLSL without runtime evaluation', () => {
  const input = new Surface(1, 1, new Float32Array([0.2, 0.4, 0.8, 0.5]))
  const factory = canonicalKernelFactories['filter/invert:inv']
  assert.equal(typeof factory, 'function')
  const kernel = bindCanonicalKernel(factory, {
    width: 1,
    height: 1,
    uniforms: { mode: 0 },
    textures: { inputTex: input },
  })
  const out = new Float32Array(4)

  kernel({ fragCoord: new Float32Array([0.5, 0.5]), uv: new Float32Array([0.5, 0.5]) }, out)

  assert.deepEqual([...out], [0.800000011920929, 0.6000000238418579, 0.19999998807907104, 0.5])
  assert.doesNotMatch(factory.toString(), /new Function|eval\s*\(/)
})

test('AOT canonical PCG kernels dispatch to exact uint32 multiplication', () => {
  const factory = canonicalKernelFactories['synth/noise:noise']
  assert.match(factory.toString(), /stdlib\.pcg3d/)
  assert.doesNotMatch(factory.toString(), /v\[0\] \* 1664525/)
  assert.match(factory.toString(), /PooledFloat32Array/)
  assert.match(canonicalKernelFactories['classicNoisedeck/bitEffects:bitEffects'].toString(), /cpu_float\(prngState\[0\]\)/)
  assert.doesNotMatch(factory.toString(), /\.\.\.arguments/)
})

test('AOT canonical uint hash kernels dispatch to exact uint32 multiplication', () => {
  const factory = canonicalKernelFactories['filter/texture:texture']
  assert.match(factory.toString(), /stdlib\.hashUint/)
  assert.doesNotMatch(factory.toString(), /x \*= 2146121005/)
})

test('AOT matrix self-assignments preserve simultaneous GLSL component reads', () => {
  const factory = canonicalKernelFactories['filter/spinBlur:spinBlur']
  assert.match(factory.toString(), /cpu_matrix_assignment/)
})

test('AOT noise map preserves GPU runtime and constant-folding precision paths', () => {
  const factory = canonicalKernelFactories['synth/noise:noise']
  assert.match(factory.toString(), /return outMin \+ \(outMax - outMin\) \* \(value - inMin\) \/ \(inMax - inMin\)/)
  assert.match(factory.toString(), /var base = 7\.292929649353027/)
})

test('derivative factories replay exact 2x2 quad finite differences', () => {
  const factory = ($bindings, runtime) => (context, out) => {
    runtime.beginPixel(context)
    const value = context.fragCoord[0] * context.fragCoord[0]
    const derivative = runtime.stdlib.dFdx(value)
    out.set([derivative, derivative, derivative, 1])
  }
  factory.usesDerivatives = true
  const kernel = bindGlslKernel(factory, {})
  const out = new Float32Array(4)
  kernel({ fragCoord: new Float32Array([0.5, 0.5]), uv: new Float32Array([0.125, 0.25]), resolution: new Float32Array([4, 2]) }, out)
  assert.deepEqual([...out], [2, 2, 2, 1])
  kernel({ fragCoord: new Float32Array([2.5, 0.5]), uv: new Float32Array([0.625, 0.25]), resolution: new Float32Array([4, 2]) }, out)
  assert.deepEqual([...out], [6, 6, 6, 1])
})
