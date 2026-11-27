import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { cpus, release } from 'node:os'

import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'

// Replay the selected C++ define and corpus inputs at their recorded options.
const fixture = await readFile(new URL('./authority-cases.json', import.meta.url))
const { cppRevision, cases } = JSON.parse(fixture)
const [requested, ...extra] = process.argv.slice(2)
if (extra.length) throw new Error('Usage: node bench/authority.js [case-id]')
const selected = requested === undefined ? cases : cases.filter(({ id }) => id === requested)
if (selected.length === 0) throw new Error(`Unknown authority case: ${requested}`)

console.log(JSON.stringify({
  type: 'benchmark',
  cppRevision,
  caseSha256: createHash('sha256').update(fixture).digest('hex'),
  node: process.version,
  cpu: cpus()[0]?.model,
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  timing: 'render-call',
  cases: selected.length,
}))

let elapsedMs = 0
let cpuMs = 0
for (const { id, source, options } of selected) {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const startCpu = process.cpuUsage()
  const started = performance.now()
  const result = renderer.render(source, options)
  const renderMs = performance.now() - started
  const { user, system } = process.cpuUsage(startCpu)
  const renderCpuMs = (user + system) / 1000
  elapsedMs += renderMs
  cpuMs += renderCpuMs
  console.log(JSON.stringify({
    type: 'case', id, options, elapsedMs: renderMs, cpuMs: renderCpuMs, passes: result.stats.passes,
  }))
}
console.log(JSON.stringify({ type: 'summary', cases: selected.length, elapsedMs, cpuMs }))
