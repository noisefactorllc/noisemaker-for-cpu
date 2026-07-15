import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultRegistry, effectCatalog, kernelFactories, kernels } from '../src/effects/catalog.js'
import { eligibleEffectIds } from '../src/effects/generated/upstream-snapshot.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { Surface } from '../src/runtime/surface.js'

function smokeProgram(effect) {
  const search = effect.namespace === 'synth' ? 'search synth' : `search ${effect.namespace}, synth`
  if (effect.kind === 'generator') return `${search}\n${effect.func}().write(o0)\nrender(o0)`
  return `${search}\nsolid(color: #58c).write(o0)\nread(o0).${effect.func}().write(o1)\nrender(o1)`
}

function choiceProgram(effect, name, value) {
  const search = effect.namespace === 'synth' ? 'search synth' : `search ${effect.namespace}, synth`
  const call = `${effect.func}(${name}: ${JSON.stringify(value)})`
  if (effect.kind === 'generator') return `${search}\n${call}.write(o0)\nrender(o0)`
  return `${search}\nsolid(color: #58c).write(o0)\nread(o0).${call}.write(o1)\nrender(o1)`
}

test('default catalog contains the exact canonical 169-effect coverage set', () => {
  assert.deepEqual(effectCatalog.map((effect) => effect.id), eligibleEffectIds)
  assert.equal(createDefaultRegistry().list().length, 169)
  assert.equal(kernelFactories.size, 214)
  assert.ok(kernels.size >= 33)
  for (const effect of effectCatalog) {
    for (const pass of effect.passes) {
      assert.equal(typeof kernelFactories.get(`${effect.id}:${pass.program}`), 'function', `${effect.id}:${pass.program}`)
    }
  }
})

test('every eligible canonical effect renders finite default pixels', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: 2 })
  const external = new Surface(2, 2)
  external.clear([0.2, 0.4, 0.6, 1])
  for (const effect of effectCatalog) {
    const result = renderer.render(smokeProgram(effect), {
      width: 2,
      height: 2,
      seed: 3,
      time: 0.25,
      externalTextures: { imageTex: external, textTex: external },
    })
    assert.equal(result.width, 2, effect.id)
    assert.ok(result.surface.data.every(Number.isFinite), `${effect.id} produced non-finite pixels`)
  }
})

test('every compile-time shader choice executes through the CPU backend', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: 1 })
  const external = new Surface(2, 2)
  external.clear([0.2, 0.4, 0.6, 1])
  let choices = 0
  for (const effect of effectCatalog) {
    for (const [name, param] of Object.entries(effect.params)) {
      if (!param.define || !param.choices) continue
      for (const value of Object.values(param.choices)) {
        if (value === null) continue
        const result = renderer.render(choiceProgram(effect, name, value), {
          width: 2,
          height: 2,
          seed: 3,
          time: 0.25,
          externalTextures: { imageTex: external, textTex: external },
        })
        assert.equal(result.toRgba8().length, 16, `${effect.id} ${name}=${value}`)
        choices += 1
      }
    }
  }
  assert.equal(choices, 410)
})
