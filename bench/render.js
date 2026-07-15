import { readFile } from 'node:fs/promises'

import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

const sizeIndex = process.argv.indexOf('--size')
const sizeEquals = process.argv.find((arg) => arg.startsWith('--size='))
const size = Number(sizeEquals?.slice(7) ?? (sizeIndex >= 0 ? process.argv[sizeIndex + 1] : 128))
if (!Number.isInteger(size) || size <= 0) throw new Error('--size must be a positive integer')

const showcase = await readFile(new URL('../examples/programs/showcase.dsl', import.meta.url), 'utf8')
const workloads = [
  ['solid', 'search synth\nsolid(color: #f80).write(o0)\nrender(o0)'],
  ['sampled-filter', 'search synth, filter\nnoise(octaves: 2, scaleX: 12, scaleY: 12).invert().write(o0)\nrender(o0)'],
  ['blur', 'search synth, filter\nnoise(octaves: 2, scaleX: 12, scaleY: 12).blur(radiusX: 5, radiusY: 5).write(o0)\nrender(o0)'],
  ['showcase', showcase],
]

const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
const rows = []
for (const [name, source] of workloads) {
  renderer.render(source, { width: 32, height: 32, seed: 11, time: 0.25 })
  const result = renderer.render(source, { width: size, height: size, seed: 11, time: 0.25 })
  const megapixels = result.stats.pixels / 1_000_000
  rows.push({ workload: name, passes: result.stats.passes, milliseconds: Number(result.elapsedMs.toFixed(3)), megapixelsPerSecond: Number((megapixels / (result.elapsedMs / 1000)).toFixed(3)) })
}

console.table(rows)
console.log(JSON.stringify({ size, rows }))
