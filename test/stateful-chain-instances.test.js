import assert from 'node:assert/strict'
import test from 'node:test'

import { CpuRenderer } from '../src/runtime/renderer.js'
import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'

// Each stateful effect instance in a chain keeps its own state and zoom
// size. Upstream's shaders/tests/test_stateful_instances.js covers two
// instances of one stateful effect in one chain (an inline surface argument
// or a repeated filter); the port keeps stateful state in each step's own
// resources (src/runtime/renderer.js), so the same behavior is pinned through
// the existing DSL/render interface with the port's chain-argument
// convention: a chain with repeated stateful instances renders the same RGBA
// bytes as the flattened program where each instance runs on its own surface.

const SIZE = 8
const TIME = 0.25

const PAIRS = [
  // Two reactionDiffusion instances in one chain, each with its own state
  // texture and zoom size (256 vs 64 pixels in the authority's terms).
  [
    'search synth, mixer\nreactionDiffusion(zoom: x4).blendMode(tex: reactionDiffusion(zoom: x16)).write(o0)\nrender(o0)\n',
    'search synth, mixer\nreactionDiffusion(zoom: x16).write(o2)\nreactionDiffusion(zoom: x4).blendMode(tex: read(o2)).write(o0)\nrender(o0)\n',
  ],
  // Two reactionDiffusion instances behind a synth, as chain arguments.
  [
    'search synth, mixer\nnoise(seed: 1).blendMode(tex: reactionDiffusion(zoom: x4)).blendMode(tex: reactionDiffusion(zoom: x16)).write(o0)\nrender(o0)\n',
    'search synth, mixer\nreactionDiffusion(zoom: x4).write(o2)\nreactionDiffusion(zoom: x16).write(o3)\nnoise(seed: 1).blendMode(tex: read(o2)).blendMode(tex: read(o3)).write(o0)\nrender(o0)\n',
  ],
  // Repeated state preserves each explicit or default zoom.
  [
    'search synth, mixer\nreactionDiffusion(zoom: x4).blendMode(tex: reactionDiffusion()).blendMode(tex: reactionDiffusion(zoom: x16)).write(o0)\nrender(o0)\n',
    'search synth, mixer\nreactionDiffusion().write(o2)\nreactionDiffusion(zoom: x16).write(o3)\nreactionDiffusion(zoom: x4).blendMode(tex: read(o2)).blendMode(tex: read(o3)).write(o0)\nrender(o0)\n',
  ],
  // Repeated stateful filters keep independent ping-pong state.
  [
    'search synth, filter\nnoise(seed: 1).watercolor().watercolor().write(o0)\nrender(o0)\n',
    'search synth, filter\nnoise(seed: 1).watercolor().write(o1)\nread(o1).watercolor().write(o0)\nrender(o0)\n',
  ],
  // Different stateful effects in one chain size from their own zoom: the
  // reactionDiffusion state keeps the chain-scoped size, the cellularAutomata
  // instance gets its own.
  [
    'search synth, mixer\nreactionDiffusion(zoom: x4).blendMode(tex: cellularAutomata(zoom: x16)).write(o0)\nrender(o0)\n',
    'search synth, mixer\ncellularAutomata(zoom: x16).write(o2)\nreactionDiffusion(zoom: x4).blendMode(tex: read(o2)).write(o0)\nrender(o0)\n',
  ],
  [
    'search synth, mixer\nnoise(seed: 1).blendMode(tex: reactionDiffusion(zoom: x4)).blendMode(tex: cellularAutomata(zoom: x16)).write(o0)\nrender(o0)\n',
    'search synth, mixer\ncellularAutomata(zoom: x16).write(o2)\nreactionDiffusion(zoom: x4).write(o3)\nnoise(seed: 1).blendMode(tex: read(o3)).blendMode(tex: read(o2)).write(o0)\nrender(o0)\n',
  ],
]

const LOOP_CHAINS = [
  // Adjacent loop regions share the chain-scoped accumulator, whose content
  // equals the region input there, so each region passes the image through.
  ['search synth, render\nperlin(seed: 1).loopBegin().loopEnd().write(o0)\nrender(o0)\n',
   'search synth, render\nperlin(seed: 1).loopBegin().loopEnd().loopBegin().loopEnd().write(o0)\nrender(o0)\n'],
]

function renderBytes(source) {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  return Buffer.from(renderer.render(source, { width: SIZE, height: SIZE, time: TIME, seed: 1 }).toRgba8())
}

test('repeated stateful instances in one chain render as their flattened per-instance programs', () => {
  for (const [inline, flat] of PAIRS) assert.deepEqual(renderBytes(inline), renderBytes(flat), inline)
})

test('two loop regions in one chain share the chain-scoped accumulator', () => {
  for (const [single, pair] of LOOP_CHAINS) assert.deepEqual(renderBytes(pair), renderBytes(single), pair)
  // A step between the two regions makes the shared feedback observable: the
  // second region reads the first region's accumulator, which still holds the
  // pre-invert image, so the chain is not the flattened fresh-per-region form.
  const shared = 'search synth, filter, render\nperlin(seed: 1).loopBegin(alpha: 100).loopEnd().invert().loopBegin(alpha: 100).loopEnd().write(o0)\nrender(o0)\n'
  const fresh = 'search synth, filter, render\nperlin(seed: 1).loopBegin(alpha: 100).loopEnd().write(o1)\nread(o1).invert().loopBegin(alpha: 100).loopEnd().write(o0)\nrender(o0)\n'
  assert.notDeepEqual(renderBytes(shared), renderBytes(fresh), shared)
})

test('repeated mesh renderers keep the loader mesh and work with the loader in another chain', () => {
  const repeated = 'search render\nmeshLoader().meshRender().meshRender().write(o0)\nrender(o0)\n'
  const flattened = 'search render\nmeshLoader().meshRender().write(o1)\nread(o1).meshRender().write(o0)\nrender(o0)\n'
  assert.deepEqual(renderBytes(repeated), renderBytes(flattened), repeated)
  assert.equal(renderBytes('search render\nmeshLoader().write(o0)\nread(o0).meshRender().meshRender().write(o1)\nrender(o1)\n').length, SIZE * SIZE * 4)
})
