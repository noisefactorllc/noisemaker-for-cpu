#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { compileCsl } from '../src/csl/compiler.js'
import { createDefaultRegistry, effectCatalog, kernelFactories, kernels } from '../src/effects/catalog.js'
import { runPass } from '../src/runtime/pass-runner.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { Surface } from '../src/runtime/surface.js'
import { readPng, writePng } from '../src/node/png.js'

const execFileAsync = promisify(execFile)

const HELP = `Usage: noisemaker-cpu COMMAND [OPTIONS]

CPU-only rendering for Noisemaker CSL and the Polymorphic DSL.

Commands:
  generate EFFECT      Render a catalog effect to a .png ('random' for a random generator)
  apply EFFECT INPUT   Apply an effect to an input .png ('random' for a random filter)
  animate EFFECT       Render an effect over time to an .mp4 (needs ffmpeg)
  run                  Render a DSL program read from STDIN
  render PROGRAM       Render a .dsl file (use - for stdin)
  effect EFFECT        Render one catalog effect (test inputs)
  csl SHADER           Render a generator .csl file
  effects              List available effects

Options:
  --width N            Output width [default: 512]
  --height N           Output height [default: 512]
  --time N             Normalized time [default: 0]
  --seed N             Deterministic seed [default: 1]
  --filename FILE      PNG/MP4 output (alias: --output) [default: art.png; apply: mangled.png; animate: animation.mp4]
  --input FILE         PNG bound as imageTex and textTex
  --texture NAME=FILE  Named external PNG texture (repeatable)
  --param NAME=VALUE   Effect parameter (repeatable)
  --uniform NAME=VALUE Custom CSL uniform (repeatable)
  --frame-count N      animate: total frames [default: 50]
  --fps N              animate: frames per second [default: 30]
  --speed N            animate: time-sweep multiplier [default: 1]
  --save-frames DIR    animate: also keep the PNG frames
  -h, --help           Show help
`

function parseOptions(tokens) {
  const options = { width: 512, height: 512, time: 0, seed: 1, output: null, input: null, frameCount: 50, fps: 30, speed: 1, saveFrames: null, params: [], uniforms: [], textures: [], positional: [] }
  const repeatable = new Set(['param', 'uniform', 'texture'])
  const strings = new Set(['output', 'input', 'filename', 'save-frames'])
  const numbers = { width: 'int', height: 'int', time: 'float', seed: 'int', 'frame-count': 'int', fps: 'int', speed: 'float' }
  const dest = { filename: 'output', 'frame-count': 'frameCount', 'save-frames': 'saveFrames' }
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
    const value = equals === -1 ? tokens[++index] : token.slice(equals + 1)
    if (value === undefined) throw new Error(`Option --${key} requires a value`)
    if (repeatable.has(key)) {
      options[`${key}s`].push(value)
      continue
    }
    if (!strings.has(key) && !(key in numbers)) throw new Error(`Unknown option "--${key}"`)
    options[dest[key] ?? key] = strings.has(key) ? value : Number(value)
  }
  if (!Number.isInteger(options.width) || options.width <= 0) throw new Error('width must be a positive integer')
  if (!Number.isInteger(options.height) || options.height <= 0) throw new Error('height must be a positive integer')
  if (!Number.isFinite(options.time)) throw new Error('time must be finite')
  if (!Number.isInteger(options.seed)) throw new Error('seed must be an integer')
  if (!Number.isInteger(options.frameCount) || options.frameCount <= 0) throw new Error('frame-count must be a positive integer')
  if (!Number.isInteger(options.fps) || options.fps <= 0) throw new Error('fps must be a positive integer')
  if (!Number.isFinite(options.speed)) throw new Error('speed must be finite')
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

function effectSearch(effect) {
  return effect.namespace === 'synth' ? 'search synth' : `search ${effect.namespace}, synth`
}

function effectProgram(effect, assignments) {
  const args = assignments.map(({ name, value }) => `${name}: ${dslValue(value)}`).join(', ')
  const search = effectSearch(effect)
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

// Resolve an effect name to a catalog entry. 'random' picks one of the given
// kind ('generator' for generate/animate, 'filter' for apply) so it never lands
// on an effect that would render degenerately. Iterated (stateful/particle) effects are also
// excluded from the random pool: they default `iterationCount` to 60 and can take tens of seconds
// to minutes at real canvas sizes (see "CPU iteration divergence" in docs/EFFECTS.md) - `--effect
// random` should never silently hang. Effects requiring an external texture are excluded for the
// same reason in reverse: `random` has no image to bind, so the render fails outright. An explicit
// name (for either class) is used as-is regardless.
function pickEffect(name, kind) {
  if (name !== 'random') return resolveEffect(name)
  const pool = effectCatalog.filter(
    (effect) => effect.kind === kind && !effect.iterated && !effect.externalTexture,
  )
  if (pool.length === 0) throw new Error(`No ${kind} effects available`)
  return pool[Math.floor(Math.random() * pool.length)]
}

// Turn --param assignments into DSL args, defaulting seed to --seed when the
// effect exposes a seed parameter and the caller did not pass one explicitly.
function withSeed(effect, options) {
  const assignments = options.params.map(parseAssignment)
  if (effect.params.seed && !assignments.some(({ name }) => name === 'seed')) {
    assignments.push({ name: 'seed', value: options.seed })
  }
  return assignments
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

async function renderDsl(program, options, extraOptions = {}) {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const externalTextures = { ...(await loadExternalTextures(options)), ...(extraOptions.externalTextures ?? {}) }
  const result = renderer.render(program, { ...options, ...extraOptions, externalTextures })
  await writePng(resolve(options.output), result.surface)
  console.log(`Rendered ${result.width}x${result.height} CPU frame in ${result.elapsedMs.toFixed(1)} ms -> ${options.output}`)
}

// Apply a filter to a PNG. The DSL forbids starting a filter chain without an
// input, so we seed the loaded image as surface o0 and read from it; the image
// is also bound as imageTex/textTex for filters that sample the host texture
// (filter/text, synth/media). Output matches the input's dimensions.
async function applyEffect(effect, inputPath, options) {
  const image = await readPng(resolve(inputPath))
  const surface = Surface.fromRgba8(image.width, image.height, image.data)
  const args = withSeed(effect, options).map(({ name, value }) => `${name}: ${dslValue(value)}`).join(', ')
  const program = `${effectSearch(effect)}\nread(o0).${effect.func}(${args}).write(o7)\nrender(o7)`
  await renderDsl(program, { ...options, width: image.width, height: image.height }, {
    externalTextures: { imageTex: surface, textTex: surface },
    seedSurfaces: { o0: surface },
  })
}

// Encode the rendered PNG frames into an .mp4 with ffmpeg. Returns false when
// ffmpeg is not installed (ENOENT) so the caller can fall back to keeping the
// frames; throws with ffmpeg's tail output on any other encoding failure.
async function encodeVideo(options, framesDir) {
  const args = [
    '-y',
    '-framerate', String(options.fps),
    '-i', join(framesDir, 'frame_%04d.png'),
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    resolve(options.output),
  ]
  try {
    await execFileAsync('ffmpeg', args)
  } catch (error) {
    if (error.code === 'ENOENT') return false
    const tail = String(error.stderr ?? '').trim().split('\n').slice(-5).join('\n')
    throw new Error(`ffmpeg failed:\n${tail}`)
  }
  return true
}

// Render a generator over time to an .mp4. Frames sweep the [0,1) time phase
// (looped `speed` times) into a temp dir, then ffmpeg encodes them. --save-frames
// keeps the PNGs (and is the fallback target when ffmpeg is missing).
async function animateEffect(effect, options) {
  const program = effectProgram(effect, withSeed(effect, options))
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const externalTextures = await loadExternalTextures(options)
  const framesDir = options.saveFrames ? resolve(options.saveFrames) : await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  await mkdir(framesDir, { recursive: true })
  try {
    for (let index = 0; index < options.frameCount; index += 1) {
      const time = (index / options.frameCount) * options.speed
      const result = renderer.render(program, { ...options, time, externalTextures })
      await writePng(join(framesDir, `frame_${String(index).padStart(4, '0')}.png`), result.surface)
    }
    if (!(await encodeVideo(options, framesDir))) {
      if (options.saveFrames) {
        console.log(`ffmpeg not found; wrote ${options.frameCount} frames to ${framesDir} (no video).`)
        return
      }
      throw new Error('ffmpeg not found; install it, or pass --save-frames DIR to keep the PNG frames.')
    }
    console.log(`Rendered ${options.frameCount} frames (${options.width}x${options.height}) -> ${options.output}`)
  } finally {
    if (!options.saveFrames) await rm(framesDir, { recursive: true, force: true })
  }
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
  if (!['generate', 'apply', 'animate', 'run', 'render', 'effect', 'csl'].includes(command)) {
    throw new Error(`Unknown command "${command}"`)
  }
  const options = parseOptions(argv.slice(1))
  if (options.help) {
    console.log(HELP)
    return
  }
  // Command-aware output default (matches the Python CLI): animate writes an
  // .mp4, apply a mangled .png, everything else art.png. Without this, `animate`
  // with no --filename would feed an .mp4 stream to art.png and ffmpeg fails.
  options.output ??= command === 'animate' ? 'animation.mp4' : command === 'apply' ? 'mangled.png' : 'art.png'

  if (command === 'run') {
    if (options.positional.length > 0) throw new Error(`Unexpected argument "${options.positional[0]}"`)
    await renderDsl(await readStdin(), options)
    return
  }
  if (command === 'apply') {
    const [effectName, inputPath, ...rest] = options.positional
    if (!effectName) throw new Error('apply requires an effect name')
    if (!inputPath) throw new Error('apply requires an input file')
    if (rest.length > 0) throw new Error(`Unexpected argument "${rest[0]}"`)
    const effect = pickEffect(effectName, 'filter')
    console.log(effect.id)
    await applyEffect(effect, inputPath, options)
    return
  }

  const input = options.positional[0]
  const wantsEffect = command === 'generate' || command === 'animate' || command === 'effect'
  if (!input) throw new Error(`${command} requires ${wantsEffect ? 'an effect name' : 'an input file'}`)
  if (options.positional.length > 1) throw new Error(`Unexpected argument "${options.positional[1]}"`)

  if (command === 'generate') {
    const effect = pickEffect(input, 'generator')
    console.log(effect.id)
    await renderDsl(effectProgram(effect, withSeed(effect, options)), options)
    return
  }
  if (command === 'animate') {
    const effect = pickEffect(input, 'generator')
    console.log(effect.id)
    await animateEffect(effect, options)
    return
  }
  if (command === 'render') {
    const source = input === '-' ? await readStdin() : await readFile(resolve(input), 'utf8')
    await renderDsl(source, options)
    return
  }
  if (command === 'effect') {
    const effect = resolveEffect(input)
    await renderDsl(effectProgram(effect, withSeed(effect, options)), options)
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
