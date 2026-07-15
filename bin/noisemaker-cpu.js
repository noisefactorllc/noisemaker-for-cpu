#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { compileCsl } from '../src/csl/compiler.js'
import { createDefaultRegistry, effectCatalog, kernelFactories, kernels } from '../src/effects/catalog.js'
import { runPass } from '../src/runtime/pass-runner.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { Surface } from '../src/runtime/surface.js'
import { readPng, writePng } from '../src/node/png.js'

const HELP = `Usage: noisemaker-cpu COMMAND [OPTIONS]

CPU-only rendering for Noisemaker CSL and the Polymorphic DSL.

Commands:
  render PROGRAM       Render a .dsl file (use - for stdin)
  effect EFFECT        Render one catalog effect
  csl SHADER           Render a generator .csl file
  effects              List available effects

Options:
  --width N            Output width [default: 512]
  --height N           Output height [default: 512]
  --time N             Normalized time [default: 0]
  --seed N             Deterministic seed [default: 1]
  --output FILE        PNG output [default: art.png]
  --input FILE         PNG bound as imageTex and textTex
  --texture NAME=FILE  Named external PNG texture (repeatable)
  --param NAME=VALUE   Effect parameter (repeatable)
  --uniform NAME=VALUE Custom CSL uniform (repeatable)
  -h, --help           Show help
`

function parseOptions(tokens) {
  const options = { width: 512, height: 512, time: 0, seed: 1, output: 'art.png', input: null, params: [], uniforms: [], textures: [], positional: [] }
  const repeatable = new Set(['param', 'uniform', 'texture'])
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '-' || !token.startsWith('-')) {
      options.positional.push(token)
      continue
    }
    if (token === '-h' || token === '--help') {
      options.help = true
      continue
    }
    if (!token.startsWith('--')) throw new Error(`Unknown option "${token}"`)
    const equals = token.indexOf('=')
    const key = token.slice(2, equals === -1 ? undefined : equals)
    let value = equals === -1 ? tokens[++index] : token.slice(equals + 1)
    if (value === undefined) throw new Error(`Option --${key} requires a value`)
    if (repeatable.has(key)) {
      options[`${key}s`].push(value)
      continue
    }
    if (!['width', 'height', 'time', 'seed', 'output', 'input'].includes(key)) throw new Error(`Unknown option "--${key}"`)
    if (['output', 'input'].includes(key)) options[key] = value
    else options[key] = Number(value)
  }
  if (!Number.isInteger(options.width) || options.width <= 0) throw new Error('width must be a positive integer')
  if (!Number.isInteger(options.height) || options.height <= 0) throw new Error('height must be a positive integer')
  if (!Number.isFinite(options.time)) throw new Error('time must be finite')
  if (!Number.isInteger(options.seed)) throw new Error('seed must be an integer')
  if (options.width * options.height > 16_777_216) throw new Error('render exceeds the 16,777,216 pixel CLI limit')
  return options
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function parseAssignment(text) {
  const equals = text.indexOf('=')
  if (equals < 1) throw new Error(`Expected NAME=VALUE, received "${text}"`)
  const name = text.slice(0, equals)
  const raw = text.slice(equals + 1)
  let value
  if (raw === 'true' || raw === 'false') value = raw === 'true'
  else if (raw !== '' && Number.isFinite(Number(raw))) value = Number(raw)
  else if (/^#[0-9a-fA-F]{3,8}$/.test(raw) || /^\[.*\]$/.test(raw) || /^[A-Za-z_][\w.]*$/.test(raw)) value = raw
  else value = JSON.stringify(raw)
  return { name, value }
}

function dslValue(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return value
}

function effectProgram(effect, assignments) {
  const args = assignments.map(({ name, value }) => `${name}: ${dslValue(value)}`).join(', ')
  const search = effect.namespace === 'synth' ? 'search synth' : `search ${effect.namespace}, synth`
  if (effect.kind === 'generator') return `${search}\n${effect.func}(${args}).write(o0)\nrender(o0)`
  if (effect.kind === 'filter') return `${search}\nsolid().${effect.func}(${args}).write(o0)\nrender(o0)`
  const surfaceParams = effect.paramNames
    .filter((name) => effect.params[name].type === 'surface' && !assignments.some((item) => item.name === name))
    .slice(0, 6)
  const mixerArgs = [args, ...surfaceParams.map((name, index) => `${name}: o${index + 1}`)].filter(Boolean).join(', ')
  const sources = surfaceParams.map((_, index) => `solid(color: ${index % 2 ? '#0cf' : '#f30'}).write(o${index + 1})`).join('\n')
  return `${search}\nsolid().write(o0)\n${sources}\nread(o0).${effect.func}(${mixerArgs}).write(o7)\nrender(o7)`
}

function resolveEffect(name) {
  const matches = effectCatalog.filter((effect) => effect.id === name || effect.func === name)
  if (matches.length === 0) throw new Error(`Unknown effect "${name}"`)
  if (matches.length > 1) {
    const preferred = matches.find((effect) => effect.namespace === 'synth')
    if (preferred) return preferred
    throw new Error(`Effect "${name}" is ambiguous; use one of ${matches.map((effect) => effect.id).join(', ')}`)
  }
  return matches[0]
}

async function loadExternalTextures(options) {
  const externalTextures = {}
  if (options.input) {
    const image = await readPng(resolve(options.input))
    const surface = Surface.fromRgba8(image.width, image.height, image.data)
    externalTextures.imageTex = surface
    externalTextures.textTex = surface
  }
  for (const assignment of options.textures) {
    const equals = assignment.indexOf('=')
    if (equals < 1 || equals === assignment.length - 1) throw new Error(`Expected NAME=FILE, received "${assignment}"`)
    const name = assignment.slice(0, equals)
    const image = await readPng(resolve(assignment.slice(equals + 1)))
    externalTextures[name] = Surface.fromRgba8(image.width, image.height, image.data)
  }
  return externalTextures
}

async function renderDsl(program, options) {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const externalTextures = await loadExternalTextures(options)
  const result = renderer.render(program, { ...options, externalTextures })
  await writePng(resolve(options.output), result.surface)
  console.log(`Rendered ${result.width}x${result.height} CPU frame in ${result.elapsedMs.toFixed(1)} ms -> ${options.output}`)
}

function parseCslUniforms(compiled, assignments) {
  const declarations = new Map(compiled.uniforms.map((uniform) => [uniform.name, uniform.type]))
  const uniforms = {}
  for (const assignment of assignments.map(parseAssignment)) {
    const type = declarations.get(assignment.name)
    if (!type) throw new Error(`Unknown CSL uniform "${assignment.name}"`)
    if (type === 'sampler2D') throw new Error(`CSL sampler "${assignment.name}" must be supplied with --texture`)
    let value = assignment.value
    if (type === 'float') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`CSL uniform "${assignment.name}" must be a finite number`)
    } else if (type === 'int') {
      if (!Number.isInteger(value)) throw new TypeError(`CSL uniform "${assignment.name}" must be an integer`)
    } else if (type === 'bool') {
      if (typeof value !== 'boolean') throw new TypeError(`CSL uniform "${assignment.name}" must be boolean`)
    } else if (/^vec[234]$/.test(type)) {
      if (typeof value === 'string') {
        try { value = JSON.parse(value) } catch { value = null }
      }
      const width = Number(type.at(-1))
      if (!Array.isArray(value) || value.length !== width || value.some((component) => !Number.isFinite(component))) {
        throw new TypeError(`CSL uniform "${assignment.name}" must be a ${type} JSON array`)
      }
      value = Float32Array.from(value)
    }
    uniforms[assignment.name] = value
  }
  return uniforms
}

async function main(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(HELP)
    return
  }
  const command = argv[0]
  if (command === 'effects') {
    for (const effect of effectCatalog) console.log(`${effect.id}\t${effect.kind}`)
    return
  }
  if (!['render', 'effect', 'csl'].includes(command)) throw new Error(`Unknown command "${command}"`)
  const options = parseOptions(argv.slice(1))
  if (options.help) {
    console.log(HELP)
    return
  }
  const input = options.positional[0]
  if (!input) throw new Error(`${command} requires ${command === 'effect' ? 'an effect name' : 'an input file'}`)
  if (options.positional.length > 1) throw new Error(`Unexpected argument "${options.positional[1]}"`)

  if (command === 'render') {
    const source = input === '-' ? await readStdin() : await readFile(resolve(input), 'utf8')
    await renderDsl(source, options)
    return
  }
  if (command === 'effect') {
    const effect = resolveEffect(input)
    const assignments = options.params.map(parseAssignment)
    if (effect.params.seed && !assignments.some(({ name }) => name === 'seed')) {
      assignments.push({ name: 'seed', value: options.seed })
    }
    await renderDsl(effectProgram(effect, assignments), options)
    return
  }

  const source = input === '-' ? await readStdin() : await readFile(resolve(input), 'utf8')
  const compiled = compileCsl(source, { sourceName: input })
  const uniforms = parseCslUniforms(compiled, options.uniforms)
  const textures = await loadExternalTextures(options)
  const surface = new Surface(options.width, options.height)
  const startedAt = performance.now()
  runPass({ kernel: compiled.runPixel, destination: surface, uniforms, textures, time: options.time, seed: options.seed })
  await writePng(resolve(options.output), surface)
  console.log(`Rendered ${options.width}x${options.height} CPU frame in ${(performance.now() - startedAt).toFixed(1)} ms -> ${options.output}`)
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`noisemaker-cpu: ${error.message}`)
  process.exitCode = 1
})
