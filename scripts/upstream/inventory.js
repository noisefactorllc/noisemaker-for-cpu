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

const namespaces = ['classicNoisedeck', 'filter', 'filter3d', 'mixer', 'points', 'render', 'synth', 'synth3d']
const reactive = Object.freeze(['synth/roll', 'synth/scope', 'synth/spectrum'])
const mesh = Object.freeze(['render/meshLoader', 'render/meshRender'])
const excluded = new Set([...reactive, ...mesh])
const renderAllowlist = new Set([
  'loopBegin',
  'loopEnd',
  'pointsEmit',
  'pointsRender',
  'pointsBillboardRender',
  'render3d',
  'renderCubemap3d',
  'renderCubemapSurface',
  'renderLit3d',
])

// Stateful/particle effects (formerly excluded) now import with `iterated: true`.
// The CPU renderer re-runs their passes `iterationCount` times per frame (default 60);
// see `src/runtime/iteration.js` and `src/runtime/renderer.js` for the consumers.
const ITERATED = new Set([
  'filter/convolutionFeedback',
  'filter/feedback',
  'filter/motionBlur',
  'filter/temporalAberration',
  'filter3d/flow3d',
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
  'render/loopBegin',
  'render/pointsBillboardRender',
  'render/pointsEmit',
  'render/pointsRender',
  'synth/cellularAutomata',
  'synth/mnca',
  'synth/navierStokes',
  'synth/reactionDiffusion',
  'synth3d/cellularAutomata3d',
  'synth3d/reactionDiffusion3d',
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
  // The volume MRT definitions call location 0 `color`, while all nine GLSL
  // programs declare it as `fragColor`. WebGL binds by location; the CPU
  // renderer binds by output name, so retain the shader name in the snapshot.
  const outputs = Object.fromEntries(Object.entries(pass.outputs ?? {}).map(([name, texture]) => [
    pass.drawBuffers >= 2 && name === 'color' ? 'fragColor' : name,
    texture,
  ]))
  const projected = {
    name: pass.name,
    program: pass.program,
    inputs: pass.inputs ?? {},
    outputs,
  }
  for (const key of ['uniforms', 'repeat', 'blend', 'clear', 'drawMode', 'count', 'countUniform', 'type', 'entryPoint', 'drawBuffers', 'conditions', 'viewport']) {
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
  if (namespace === 'synth' || namespace === 'synth3d') return 'generator'
  if (namespace === 'filter3d') return 'filter'
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

function inferDomain(id, namespace) {
  if (id === 'render/loopBegin') return 'loop-begin'
  if (id === 'render/loopEnd') return 'loop-end'
  if (namespace === 'synth3d') return 'volume-generator'
  if (namespace === 'filter3d') return 'volume-filter'
  if (id.startsWith('render/render')) return 'volume-renderer'
  return 'image'
}

const OUTPUT_KEYS = ['outputTex', 'outputTex3d', 'outputGeo', 'outputXyz', 'outputVel', 'outputRgba']

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
  if (OUTPUT_KEYS.some((key) => definition[key] === undefined)) {
    const source = await readFile(path, 'utf8')
    for (const key of OUTPUT_KEYS) {
      if (definition[key] !== undefined) continue
      const match = source.match(new RegExp(`\\b${key}\\s*[:=]\\s*["']([^"']+)["']`))
      if (match) definition[key] = match[1]
    }
  }
  return definition
}

async function sourceInventory() {
  const ids = []
  for (const namespace of namespaces) {
    for (const directoryName of (await readdir(resolve(effectsRoot, namespace))).sort()) {
      if (existsSync(resolve(effectsRoot, namespace, directoryName, 'definition.js'))) ids.push(`${namespace}/${directoryName}`)
    }
  }
  return ids.sort()
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
      if (!existsSync(definitionPath) || excluded.has(id)) continue
      const definition = await loadDefinition(namespace, directoryName)
      const record = {
        id,
        directoryName,
        name: definition.name ?? definition.func ?? directoryName,
        namespace: definition.namespace ?? namespace,
        func: definition.func ?? directoryName,
        kind: inferKind(namespace, definition),
        domain: inferDomain(id, namespace),
        tags: definition.tags ?? [],
        description: definition.description ?? '',
        paramAliases: definition.paramAliases ?? {},
        params: Object.fromEntries(Object.entries(definition.globals ?? {}).map(([name, param]) => [name, projectParam(param, stdEnums)])),
        passes: (definition.passes ?? []).map(projectPass),
        textures: projectTextures(definition.textures),
        externalTexture: definition.externalTexture ?? null,
      }
      for (const key of OUTPUT_KEYS) {
        if (definition[key] !== undefined) record[key] = definition[key]
      }
      if (id === 'render/loopBegin') record.loopRole = 'begin'
      if (id === 'render/loopEnd') record.loopRole = 'end'
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
const sourceEffectIds = await sourceInventory()
const effectRecords = await inventory()
const excludedEffects = {
  reactive: [...reactive],
  mesh: [...mesh],
}
const source = `// Generated by scripts/upstream/inventory.js. Do not edit.\n` +
  `export const UPSTREAM_REVISION = ${JSON.stringify(upstreamRevision)}\n` +
  `export const sourceEffectIds = Object.freeze(${JSON.stringify(sourceEffectIds, null, 2)})\n` +
  `export const excludedEffects = Object.freeze(${JSON.stringify(excludedEffects, null, 2)})\n` +
  `export const effectRecords = Object.freeze(${JSON.stringify(effectRecords, null, 2)})\n` +
  `export const eligibleEffectIds = Object.freeze(effectRecords.map((effect) => effect.id))\n`

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, source)
console.log(`Imported ${effectRecords.length} eligible effects from Noisemaker ${upstreamRevision}`)
