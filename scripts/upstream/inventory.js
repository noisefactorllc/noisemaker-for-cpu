#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertPinnedSource } from './source-lock.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const referenceRoot = resolve(process.env.NM_REFERENCE_ROOT ?? resolve(projectRoot, '..', 'noisemaker'))
const effectsRoot = resolve(referenceRoot, 'shaders', 'effects')
const outputPath = resolve(projectRoot, 'src', 'effects', 'generated', 'upstream-snapshot.js')

const namespaces = ['classicNoisedeck', 'filter', 'mixer', 'points', 'render', 'synth']
const reactive = Object.freeze(['synth/roll', 'synth/scope', 'synth/spectrum'])
const classic3d = new Set(['classicNoisedeck/noise3d', 'classicNoisedeck/shapes3d'])
const renderAllowlist = new Set(['pointsEmit', 'pointsRender', 'pointsBillboardRender'])

// Stateful/particle effects (formerly excluded) now import with `iterated: true`.
// The CPU renderer re-runs their passes `iterationCount` times per frame (default 60);
// see `src/runtime/iteration.js` and `src/runtime/renderer.js` for the consumers.
const ITERATED = new Set([
  'filter/convolutionFeedback',
  'filter/feedback',
  'filter/motionBlur',
  'filter/temporalAberration',
  'points/attractor',
  'points/buddhabrot',
  'points/dla',
  'points/flock',
  'points/flow',
  'points/hydraulic',
  'points/lenia',
  'points/life',
  'points/physarum',
  'points/physical',
  'render/pointsBillboardRender',
  'render/pointsEmit',
  'render/pointsRender',
  'synth/cellularAutomata',
  'synth/mnca',
  'synth/navierStokes',
  'synth/reactionDiffusion',
])

function projectParam(param, stdEnums) {
  const projected = {}
  for (const key of ['type', 'default', 'uniform', 'define', 'min', 'max', 'zero', 'choices', 'enum', 'enumPath', 'colorModeUniform', 'cpuOnly']) {
    if (param[key] !== undefined) projected[key] = param[key]
  }
  if (!projected.choices && projected.enum && stdEnums[projected.enum]) {
    projected.choices = Object.fromEntries(Object.entries(stdEnums[projected.enum]).map(([name, value]) => [name, value.value]))
  }
  return projected
}

function projectPass(pass) {
  const projected = {
    name: pass.name,
    program: pass.program,
    inputs: pass.inputs ?? {},
    outputs: pass.outputs ?? {},
  }
  for (const key of ['uniforms', 'repeat', 'blend', 'clear', 'drawMode', 'count', 'countUniform', 'type', 'entryPoint', 'drawBuffers', 'conditions']) {
    if (pass[key] !== undefined) projected[key] = pass[key]
  }
  return projected
}

function projectTextures(textures = {}) {
  return Object.fromEntries(Object.entries(textures).map(([name, texture]) => [name, Object.fromEntries(
    ['width', 'height', 'depth', 'format', 'is3D'].filter((key) => texture[key] !== undefined).map((key) => [key, texture[key]]),
  )]))
}

function inferKind(namespace, definition) {
  if (namespace === 'synth') return 'generator'
  if (namespace === 'mixer') return 'mixer'
  // points/render effects thread the 2D chain through while mutating agent state, so they are
  // chain-position filters regardless of an optional sprite input (e.g.
  // render/pointsBillboardRender's `spriteTex`, a genuine `type: 'surface'` param); this keeps the
  // particle family uniform and visible in the browser demo's filter picker.
  if (namespace === 'points' || namespace === 'render') return 'filter'
  const textures = definition.textures ?? {}
  let hasInputs = false
  let external = false
  for (const pass of definition.passes ?? []) {
    for (const value of Object.values(pass.inputs ?? {})) {
      hasInputs = true
      if (typeof value !== 'string') continue
      if (value === 'inputTex' || value === 'outputTex') continue
      if (value.startsWith('_') || value.startsWith('global_')) continue
      if (value === 'selfTex' || value === 'feedback') continue
      // A fixed-numeric-size own texture (e.g. points/life's 8x8 forceMatrix lookup) is an
      // internal scratch/LUT buffer, not image-shaped data, so referencing it isn't a real
      // second input. A canvas- or state-relative own texture ("100%"/"input"/param-relative
      // width, e.g. filter/wormhole's wormhole_accum) is image-shaped and stays a real
      // reference; unlike the blanket "any own texture" exemption this rule doesn't also
      // exempt those, which is what previously flipped filter/wormhole and 17 others off
      // their shipped `mixer` classification. A genuine second-surface input (a `type: 'surface'`
      // param, e.g. classicNoisedeck/composite's `tex`) is NOT exempted either - that is exactly
      // what makes an effect a mixer rather than a filter.
      const texture = textures[value]
      if (texture && typeof texture.width === 'number' && typeof texture.height === 'number') continue
      external = true
    }
  }
  // Preserve the pre-existing rule: an effect whose passes take no inputs at all
  // (e.g. classicNoisedeck/fractal, .../noise) is a generator, not a filter.
  if (!hasInputs) return 'generator'
  return external ? 'mixer' : 'filter'
}

const AGENT_OUTPUT_KEYS = ['outputXyz', 'outputVel', 'outputRgba']

async function loadDefinition(namespace, directoryName) {
  const path = resolve(effectsRoot, namespace, directoryName, 'definition.js')
  let definition = (await import(pathToFileURL(path).href)).default
  if (typeof definition === 'function') definition = new definition()
  if (!definition) throw new Error(`${namespace}/${directoryName} has no default effect definition`)
  // Loader workaround: the pinned Effect base class (shaders/src/runtime/effect.js) only
  // copies a fixed whitelist of config keys from `new Effect({...})` onto the instance, and
  // that whitelist predates the Common Agent Architecture outputXyz/outputVel/outputRgba
  // fields used by points/render particle definitions, so they are silently dropped rather
  // than thrown. The pinned file itself must not be modified, so recover the (plain string)
  // values directly from source text when the constructed instance is missing them.
  if ((namespace === 'points' || namespace === 'render') && AGENT_OUTPUT_KEYS.some((key) => definition[key] === undefined)) {
    const source = await readFile(path, 'utf8')
    for (const key of AGENT_OUTPUT_KEYS) {
      if (definition[key] !== undefined) continue
      const match = source.match(new RegExp(`\\b${key}:\\s*["']([^"']+)["']`))
      if (match) definition[key] = match[1]
    }
  }
  return definition
}

async function inventory() {
  if (!existsSync(effectsRoot)) throw new Error(`No Noisemaker effect tree at ${effectsRoot}; set NM_REFERENCE_ROOT`)
  const { stdEnums } = await import(pathToFileURL(resolve(referenceRoot, 'shaders', 'src', 'lang', 'std_enums.js')).href)
  const records = []
  for (const namespace of namespaces) {
    for (const directoryName of (await readdir(resolve(effectsRoot, namespace))).sort()) {
      if (namespace === 'render' && !renderAllowlist.has(directoryName)) continue
      const id = `${namespace}/${directoryName}`
      const definitionPath = resolve(effectsRoot, id, 'definition.js')
      if (!existsSync(definitionPath) || reactive.includes(id) || classic3d.has(id)) continue
      const definition = await loadDefinition(namespace, directoryName)
      const record = {
        id,
        directoryName,
        name: definition.name ?? definition.func ?? directoryName,
        namespace: definition.namespace ?? namespace,
        func: definition.func ?? directoryName,
        kind: inferKind(namespace, definition),
        tags: definition.tags ?? [],
        description: definition.description ?? '',
        paramAliases: definition.paramAliases ?? {},
        params: Object.fromEntries(Object.entries(definition.globals ?? {}).map(([name, param]) => [name, projectParam(param, stdEnums)])),
        passes: (definition.passes ?? []).map(projectPass),
        textures: projectTextures(definition.textures),
        externalTexture: definition.externalTexture ?? null,
      }
      for (const key of ['outputXyz', 'outputVel', 'outputRgba']) {
        if (definition[key] !== undefined) record[key] = definition[key]
      }
      if (ITERATED.has(id)) {
        record.iterated = true
        record.params.iterationCount = { type: 'int', default: 60, min: 0, max: 10000, cpuOnly: true }
      }
      records.push(record)
    }
  }
  records.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  return records
}

const upstreamRevision = assertPinnedSource(referenceRoot)
const effectRecords = await inventory()
const excludedEffects = {
  reactive: [...reactive],
  threeD: [
    'classicNoisedeck/noise3d',
    'classicNoisedeck/shapes3d',
    'filter3d/*',
    'synth3d/*',
    'render/*3d',
    'render/*Cubemap*',
    'render/mesh*',
  ],
  control: ['render/loopBegin', 'render/loopEnd'],
}
const source = `// Generated by scripts/upstream/inventory.js. Do not edit.\n` +
  `export const UPSTREAM_REVISION = ${JSON.stringify(upstreamRevision)}\n` +
  `export const excludedEffects = Object.freeze(${JSON.stringify(excludedEffects, null, 2)})\n` +
  `export const effectRecords = Object.freeze(${JSON.stringify(effectRecords, null, 2)})\n` +
  `export const eligibleEffectIds = Object.freeze(effectRecords.map((effect) => effect.id))\n`

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, source)
console.log(`Imported ${effectRecords.length} eligible effects from Noisemaker ${upstreamRevision}`)
