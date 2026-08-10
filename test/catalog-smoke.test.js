import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultRegistry, effectCatalog, kernelFactories, kernels } from '../src/effects/catalog.js'
import { eligibleEffectIds } from '../src/effects/generated/upstream-snapshot.js'
import { resolveScatterAdapter } from '../src/effects/cpu/scatter-registry.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { Surface } from '../src/runtime/surface.js'

function call(effect, args = []) {
  return `${effect.func}(${args.map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join(', ')})`
}

function hasArg(args, name) {
  return args.some(([candidate]) => candidate === name)
}

function smokeProgram(effect, suppliedArgs = []) {
  const args = [...suppliedArgs]
  if (effect.iterated && !hasArg(args, 'iterationCount')) args.push(['iterationCount', effect.domain === 'image' ? 4 : 1])
  if (effect.params.volumeSize && !hasArg(args, 'volumeSize')) args.push(['volumeSize', 2])
  if (effect.id === 'synth3d/flythrough3d' && !hasArg(args, 'type')) args.push(['type', 1])

  if (effect.domain === 'loop-begin' || effect.domain === 'loop-end') {
    const beginArgs = effect.domain === 'loop-begin' ? args : [['iterationCount', 2]]
    const endArgs = effect.domain === 'loop-end' ? args : []
    return `search render, synth\nsolid(color: #58c).${call(
      effect.domain === 'loop-begin' ? effect : { func: 'loopBegin' }, beginArgs,
    )}.${call(effect.domain === 'loop-end' ? effect : { func: 'loopEnd' }, endArgs)}.write(o0)\nrender(o0)`
  }

  if (effect.domain.startsWith('volume-')) {
    const search = 'search synth3d, filter3d, render'
    if (effect.domain === 'volume-generator') {
      return `${search}\n${call(effect, args)}.render3d(volumeSize: 2).write(o0)\nrender(o0)`
    }
    if (effect.domain === 'volume-filter') {
      return `${search}\nnoise3d(volumeSize: 2).${call(effect, args)}.render3d(volumeSize: 2).write(o0)\nrender(o0)`
    }
    return `${search}\nnoise3d(volumeSize: 2).${call(effect, args)}.write(o0)\nrender(o0)`
  }

  const search = effect.namespace === 'synth' ? 'search synth' : `search ${effect.namespace}, synth`
  if (effect.kind === 'generator') return `${search}\n${call(effect, args)}.write(o0)\nrender(o0)`
  return `${search}\nsolid(color: #58c).write(o0)\nread(o0).${call(effect, args)}.write(o1)\nrender(o1)`
}

function choiceProgram(effect, name, value) {
  return smokeProgram(effect, [[name, value]])
}

test('default catalog contains the exact canonical 205-effect coverage set', () => {
  assert.deepEqual(effectCatalog.map((effect) => effect.id), eligibleEffectIds)
  assert.equal(createDefaultRegistry().list().length, 205)
  assert.equal(kernelFactories.size, 289)
  assert.ok(kernels.size >= 33)
  for (const effect of effectCatalog) {
    for (const pass of effect.passes) {
      const key = `${effect.id}:${pass.program}`
      // Vertex-stage scatter passes (`drawMode: 'points'|'billboards'`) are dispatched through
      // the hand-written adapter registry, never through a transpiled fragment kernel - they
      // rasterize a variable point/quad count rather than filling every destination pixel once
      // (see src/effects/cpu/scatter-registry.js). Every other pass has a generated or
      // hand-adapted entry in kernelFactories.
      if (pass.drawMode === 'points' || pass.drawMode === 'billboards') {
        assert.equal(typeof resolveScatterAdapter(key), 'function', key)
      } else {
        assert.equal(typeof kernelFactories.get(key), 'function', key)
      }
    }
  }
})

test('every eligible canonical effect renders finite default pixels', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: 2 })
  const external = new Surface(2, 2)
  external.clear([0.2, 0.4, 0.6, 1])
  for (const effect of effectCatalog) {
    // Iterated effects default iterationCount to 60; override to a small fixed value so this
    // sweep stays fast, and render at 16x16 (rather than 2x2) so their pass graphs - some of
    // which allocate particle-state textures independent of the render surface - exercise a
    // realistic canvas.
    const size = effect.iterated ? 16 : 2
    const result = renderer.render(smokeProgram(effect), {
      width: size,
      height: size,
      seed: 3,
      time: 0.25,
      externalTextures: { imageTex: external, textTex: external },
    })
    assert.equal(result.width, size, effect.id)
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
  const expectedChoices = effectCatalog.reduce((total, effect) => total + Object.values(effect.params)
    .filter((param) => param.define && param.choices)
    .reduce((subtotal, param) => subtotal + Object.values(param.choices).filter((value) => value !== null).length, 0), 0)
  assert.equal(choices, expectedChoices)
})
