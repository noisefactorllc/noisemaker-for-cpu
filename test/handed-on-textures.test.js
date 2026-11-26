import assert from 'node:assert/strict'
import test from 'node:test'

import { EffectDefinition } from '../src/effects/definition.js'
import { EffectRegistry } from '../src/effects/registry.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

const options = { width: 2, height: 2, scheduler: async () => {} }
const pass = (target, value = 1) => ({
  name: target, program: 'fill', uniforms: { value }, outputs: { color: target },
})

function renderer(specs, factories = {}) {
  const registry = new EffectRegistry()
  const kernelFactories = new Map()
  const programs = {
    fill: ({ value }) => (_ctx, out) => out.fill(value),
    copy: ({ src }) => (_ctx, out) => out.set(src.data.subarray(0, 4)),
    ...factories,
  }
  for (const spec of specs) {
    const definition = new EffectDefinition({ namespace: 'probe', kind: 'generator', ...spec })
    registry.register(definition)
    for (const { program } of definition.passes) {
      kernelFactories.set(`${definition.id}:${program}`, programs[program])
    }
  }
  return new CpuRenderer({ registry, kernelFactories })
}

const tinyIterations = { iterationCount: { type: 'int', default: 2 } }
const copy = { name: 'copy', program: 'copy', inputs: { src: 'inputTex' }, outputs: { color: 'outputTex' } }
const fromChain = { func: 'fromChain', kind: 'filter', passes: [copy] }
const program = (chain) => `search probe\n${chain}.write(o0)\nrender(o0)`

test('effect definitions reject invalid handed-on texture names', () => {
  for (const field of ['outputTex', 'outputXyz', 'outputVel', 'outputRgba', 'outputTex3d', 'outputGeo']) {
    for (const invalid of ['', '   ', 7, null]) {
      assert.throws(() => new EffectDefinition({
        namespace: 'probe', func: 'invalid', kind: 'generator', passes: [pass('work')], [field]: invalid,
      }), new RegExp(field))
    }
  }
})

test('a registered definition with omitted texture names can be copied', () => {
  const engine = renderer([fromChain])
  const original = engine.registry.get('probe', 'fromChain')
  const copy = new EffectDefinition({ ...original, func: 'another' })
  assert.deepEqual(copy.passes, original.passes)
})

for (const method of ['render', 'renderAsync']) {
  test(`${method} updates an image and an agent channel that publish the same texture`, async () => {
    const engine = renderer([{
      func: 'source', outputTex: 'work', outputXyz: 'work', passes: [pass('work', 0.25)],
    }, {
      func: 'edit', kind: 'filter', passes: [pass('inputXyz', 0.75), copy],
    }])
    const result = await engine[method](program('source().edit()'), options)
    assert.equal(result.surface.data[0], 0.75)
  })

  test(`${method} keeps the published image bound to shared storage after a write`, async () => {
    const storage = value => ({
      name: 'store', program: 'fill', uniforms: { value }, storageTextures: { dst: 'global_work' },
    })
    for (const withAgent of [false, true]) {
      for (const mode of ['ordinary', 'iterated', 'particle group']) {
        const iterated = mode !== 'ordinary'
        const emitter = mode === 'particle group' ? { global_xyz: { width: 1, height: 1 } } : {}
        const inputs = mode === 'particle group' ? { src: 'inputTex', positions: 'global_xyz' } : copy.inputs
        const engine = renderer([{
          func: 'emit', iterated, params: tinyIterations, outputTex: 'global_work',
          ...(withAgent ? { outputXyz: 'global_work' } : {}),
          textures: { ...emitter, global_work: { width: 1, height: 1 } }, passes: [storage(0.25)],
        }, {
          func: 'edit', kind: 'filter', iterated, params: tinyIterations,
          passes: [storage(0.75), { ...copy, inputs }],
        }])
        const result = await engine[method](program('emit().edit()'), options)
        assert.equal(result.surface.data[0], 0.75, `withAgent=${withAgent}, mode=${mode}`)
        assert.equal(engine.pool.stats().inUse, 0)
      }
    }
  })

  for (const destination of ['shared', 'input', 'local']) {
    test(`${method} follows writes to the current particle targets (${destination})`, async () => {
      const globals = ['global_xyz', 'global_vel', 'global_rgba']
      const aliases = ['inputXyz', 'inputVel', 'inputRgba']
      const local = ['coordinates', 'velocity', 'color']
      const source = destination === 'local' ? local : globals
      const targets = destination === 'shared' ? globals : aliases
      const textures = Object.fromEntries(source.map(name => [name, { width: 1, height: 1, format: 'rgba32f' }]))
      const update = () => (_ctx, out) => out.set([0.75, 0, 0, 1, 0.625, 0, 0, 1, 0.375, 0, 0, 1])
      update.outputNames = ['x', 'v', 'r']
      const engine = renderer([{
        func: 'emit', iterated: destination !== 'local', params: tinyIterations, textures,
        outputXyz: source[0], outputVel: source[1], outputRgba: source[2],
        passes: [...source.map(name => pass(name, 0.25)), pass('outputTex', 0.125)],
      }, {
        func: 'edit', kind: 'filter', textures: { outputXyz: { width: 3, height: 3 } },
        passes: [
          { name: 'edit', program: 'update', drawBuffers: 3, outputs: { x: targets[0], v: targets[1], r: targets[2] } },
          pass('outputTex', 0.5),
        ],
      }, {
        func: 'reader', kind: 'filter', passes: [{ ...copy, program: 'read', inputs: { x: aliases[0], v: aliases[1], r: aliases[2] } }],
      }], { update, read: ({ x, v, r }) => (_ctx, out) => out.set([x.data[0], v.data[0], r.data[0], x.width]) })
      const result = await engine[method](program('emit().edit().reader()'), options)
      assert.deepEqual([...result.surface.data.slice(0, 4)], [0.75, 0.625, 0.375, 1])
      assert.equal(engine.pool.stats().inUse, 0)
    })
  }

  test(`${method} starts all agent channels fresh at the next emitter`, async () => {
    const start = {
      func: 'start', iterated: true, params: tinyIterations, outputVel: 'velocity',
      textures: { global_xyz: { width: 1, height: 1 } }, passes: [pass('velocity'), pass('outputTex')],
    }
    const engine = renderer([start, {
      func: 'next', kind: 'filter', iterated: true, params: tinyIterations, textures: start.textures,
      outputXyz: 'global_xyz', passes: [pass('global_xyz'), pass('outputTex')],
    }, { func: 'readVel', kind: 'filter', passes: [{ ...copy, inputs: { src: 'inputVel' } }] }])
    await assert.rejects(async () => engine[method](program('start().next().readVel()'), options), /requires texture "inputVel"/)
  })

  for (const iteratedWriter of [false, true]) {
    test(`${method} shares declared global storage only within its chain (iterated writer=${iteratedWriter})`, async () => {
      const engine = renderer([{
        func: 'writer', iterated: iteratedWriter, params: tinyIterations,
        textures: { global_work: { width: 1, height: 1, format: 'rgba32f' } },
        passes: [
          { name: 'storage', program: 'fill', uniforms: { value: 0.75 }, storageTextures: { outputBuffer: 'global_work' } },
          pass('outputTex', 0.25),
        ],
      }, {
        func: 'reader', kind: 'filter', iterated: !iteratedWriter, params: tinyIterations,
        passes: [{ ...copy, inputs: { src: 'global_work' }, program: 'read' }],
      }], {
        read: ({ src }) => (_ctx, out) => out.set([src.data[0], src.width, src.height, 1]),
      })
      const result = await engine[method](program('writer().reader()'), options)
      assert.deepEqual([...result.surface.data.slice(0, 4)], [0.75, 1, 1, 1])
      const separate = 'search probe\nwriter().write(o0)\nread(o0).reader().write(o1)\nrender(o1)'
      await assert.rejects(async () => engine[method](separate, options), /requires texture "global_work"/)
      assert.equal(engine.pool.stats().inUse, 0)
    })
  }

  test(`${method} runs readers of handed-on agent textures on every particle tick`, async () => {
    for (const [field, input, target] of [
      ['outputXyz', 'inputXyz', 'global_xyz'], ['outputVel', 'inputVel', 'velocity'], ['outputRgba', 'inputRgba', 'color'],
    ]) {
      const engine = renderer([{
        func: 'emit', iterated: true, params: tinyIterations, textures: { global_xyz: { width: 1, height: 1 } },
        [field]: target, passes: [{ ...pass(target), program: 'tick' }, pass('outputTex')],
      }, {
        func: 'sum', kind: 'filter', passes: [{ ...copy, program: 'sum', inputs: { state: input, prior: 'selfTex' } }],
      }], {
        tick: ({ frame }) => (_ctx, out) => out.fill((frame + 1) / 4),
        sum: ({ state, prior }) => (_ctx, out) => out.fill(state.data[0] + prior.data[0]),
      })
      const result = await engine[method](program('emit().sum()'), options)
      assert.equal(result.surface.data[0], 0.75, input)
    }
  })

  test(`${method} reads agent state from the latest particle scope`, async () => {
    const emitter = {
      func: 'emit', kind: 'filter', iterated: true, params: { ...tinyIterations, position: { type: 'float', default: 0 } },
      textures: { global_xyz: { width: 1, height: 1 } }, outputXyz: 'global_xyz',
      passes: [{ ...pass('global_xyz'), uniforms: { value: 'position' } }, pass('outputTex')],
    }
    const behavior = {
      func: 'behavior', kind: 'filter', outputXyz: 'global_xyz',
      passes: [{ ...copy, inputs: { src: 'global_xyz' } }],
    }
    const reader = { func: 'reader', kind: 'filter', passes: [{ ...copy, inputs: { src: 'inputXyz' } }] }
    const engine = renderer([{ func: 'start', passes: [pass('outputTex')] }, emitter, behavior, reader])
    const result = await engine[method](program('start().emit(position: 0.25).behavior().emit(position: 0.75).behavior().reader()'), options)
    assert.deepEqual([...result.surface.data.slice(0, 4)], [0.75, 0.75, 0.75, 0.75])
  })

  for (const iterated of [false, true]) {
    test(`${method} prefers a written output over its configured fallback (iterated=${iterated})`, async () => {
      const engine = renderer([{
        func: 'source', iterated, params: tinyIterations, outputTex: 'alternate', outputXyz: 'alternate',
        passes: [pass('alternate', 0.25), pass('outputTex', 0.5), pass('outputXyz', 0.75)],
      }, {
        func: 'reader', kind: 'filter', passes: [{
          ...copy, program: 'pick', inputs: { image: 'inputTex', xyz: 'inputXyz' },
        }],
      }], { pick: ({ image, xyz }) => (_ctx, out) => out.set([image.data[0], xyz.data[0], 0, 1]) })
      const result = await engine[method](program('source().reader()'), options)
      assert.deepEqual([...result.surface.data.slice(0, 4)], [0.5, 0.75, 0, 1])
    })

    test(`${method} forwards named image and agent textures through an image filter (iterated=${iterated})`, async () => {
      const producer = {
        func: 'producer', iterated, params: tinyIterations,
        textures: { outputTex: { width: 1, height: 1 } },
        outputTex: 'image', outputXyz: 'positions', outputVel: 'speed', outputRgba: 'color',
        passes: [pass('image', 0.125), pass('positions', 0.25), pass('speed', 0.5), pass('color', 0.75)],
      }
      const reader = {
        func: 'reader', kind: 'filter', iterated, params: tinyIterations,
        passes: [{
          name: 'read', program: 'read',
          inputs: { image: 'inputTex', xyz: 'inputXyz', vel: 'inputVel', rgba: 'inputRgba' },
          outputs: { color: 'outputTex' },
        }],
      }
      const engine = renderer([producer, fromChain, reader], {
        read: ({ image, xyz, vel, rgba }) => (_ctx, out) => out.set([image.data[0], xyz.data[0], vel.data[0], rgba.data[0]]),
      })
      const result = await engine[method](program('producer().fromChain().reader()'), options)
      assert.deepEqual([...result.surface.data.slice(0, 4)], [0.125, 0.25, 0.5, 0.75])
      assert.equal(engine.pool.stats().inUse, 0)
    })

    test(`${method} renders storage-only targets directly and through a named intermediate (iterated=${iterated})`, async () => {
      const storage = (target) => ({
        name: 'fill', program: 'fill', type: 'compute', uniforms: { value: 0.5 }, storageTextures: { outputBuffer: target },
      })
      const engine = renderer([
        { func: 'ordinary', passes: [pass('outputTex', 0.25)] },
        { func: 'direct', iterated, params: tinyIterations, passes: [storage('outputTex')] },
        {
          func: 'named', iterated, params: tinyIterations,
          textures: { work: { width: 1, height: 1, format: 'rgba8unorm' }, outputTex: { format: 'rgba32f' } },
          passes: [{ ...storage('work'), outputs: {} }, { ...copy, inputs: { src: 'work' } }],
        },
        fromChain,
      ])
      for (const [chain, expected] of [['ordinary()', 0.25], ['direct()', 0.5], ['direct().fromChain()', 0.5], ['named()', 128 / 255]]) {
        const result = await engine[method](program(chain), options)
        assert.deepEqual([...result.surface.data.slice(0, 4)], Array(4).fill(Math.fround(expected)), chain)
        if (chain === 'named()') assert.equal(result.stats.pixels, (1 + 4) * (iterated ? 2 : 1))
      }
    })
  }
}

test('standalone simulation frames preserve the synthetic delta through the loop seam', async () => {
  const engine = renderer([{
    func: 'clock', iterated: true, params: tinyIterations,
    textures: { outputTex: { format: 'rgba32f' } },
    passes: [{ name: 'clock', program: 'clock', inputs: { previous: 'selfTex' }, outputs: { color: 'outputTex' } }],
  }], {
    clock: ({ previous, time, deltaTime }) => (_ctx, out) => out.set([previous.data[2], previous.data[3], time, deltaTime]),
  })
  const frame = (method, time) => engine[method](program('clock()'), { ...options, time })
  const seam = await frame('render', 0)
  assert.deepEqual([...seam.surface.data.slice(0, 4)], [Math.fround(599 / 600), Math.fround(1 / 600), 0, Math.fround(1 / 600)])
  await frame('render', 0.5)
  const repeat = await frame('renderAsync', 0)
  assert.deepEqual(repeat.surface.data, seam.surface.data)
})
