// Records test/fixtures/seeded-agreement.json from an upstream noisemaker
// checkout on its 2.x line:
//
//   node scripts/upstream/seeded-agreement/record.mjs <noisemaker checkout>
//
// For each program in programs.json it compiles the program upstream and keeps
// every draw (seed, key and uint32) and, for each element, the values of the
// parameters that a random call or an inherited seed set. The port's test
// compiles the same programs and must match all of it.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

register(new URL('./hooks.mjs', import.meta.url))

const here = fileURLToPath(new URL('.', import.meta.url))
const root = process.argv[2]
if (!root) throw new Error('usage: record.mjs <noisemaker checkout>')
const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const { CanvasRenderer, compile, registerStarterOps } = await import(pathToFileURL(join(root, 'shaders/src/index.js')))
const { mergeIntoEnums } = await import(pathToFileURL(join(root, 'shaders/src/lang/enums.js')))
const programs = JSON.parse(readFileSync(join(here, 'programs.json'), 'utf8'))

const renderer = new CanvasRenderer()
for (const id of [...new Set(programs.flatMap((program) => program.effects))].sort()) {
  const { default: exported } = await import(pathToFileURL(join(root, 'shaders/effects', id, 'definition.js')))
  const instance = typeof exported === 'function' ? new exported() : exported
  const namespace = id.slice(0, id.lastIndexOf('/'))
  const choices = renderer.registerEffectWithRuntime({ namespace, name: instance.name, instance })
  if (choices && Object.keys(choices).length > 0) await mergeIntoEnums(choices)
  if (instance.starter || namespace === 'synth') registerStarterOps([`${namespace}.${instance.func}`])
}

// A drawn value as plain data: a let's value, an oscillator's fields, a number,
// a boolean or a color.
function plain(value) {
  if (value && typeof value === 'object' && '_varRef' in value) return plain(value.value)
  if (value?.type === 'Oscillator') {
    const { oscType, min, max, speed, offset, seed } = value
    return { type: 'Oscillator', oscType, min, max, speed, offset, seed }
  }
  return value
}

const out = []
for (const program of programs) {
  globalThis.__seededDrawLog = []
  const compiled = compile(program.dsl)
  const errors = compiled.diagnostics.filter((entry) => entry.severity === 'error')
  if (errors.length) throw new Error(`${program.name}: ${errors.map((entry) => `${entry.code} ${entry.message}`).join('; ')}`)
  const elements = compiled.plans.flatMap((plan) => plan.chain || []).filter((step) => !step.op.startsWith('_')).map((step) => {
    const drawn = [...Object.keys(step.randomSources ?? {}), ...Object.keys(step.inheritedSeeds ?? {})]
    const lets = Object.entries(step.args).filter(([, value]) => value && typeof value === 'object' && '_varRef' in value).map(([name]) => name)
    const names = [...new Set([...drawn, ...lets])].sort()
    return { op: step.op, values: Object.fromEntries(names.map((name) => [name, plain(step.args[name])])) }
  })
  out.push({ name: program.name, dsl: program.dsl, draws: globalThis.__seededDrawLog, elements })
}

const fixture = { source: 'noisemaker', branch: '2.x', commit, programs: out }
writeFileSync(fileURLToPath(new URL('../../../test/fixtures/seeded-agreement.json', import.meta.url)), `${JSON.stringify(fixture, null, 1)}\n`)
console.log(`recorded ${out.length} programs from ${commit}`)
