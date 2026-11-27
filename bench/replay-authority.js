import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { CpuRenderer, Surface, createDefaultRegistry, kernels, kernelFactories } from '../src/index.js'
import { rendererInputDigest } from './renderer-input-digest.js'

// Case records from the pinned C++ sweep, captured at its CPU runner boundary.
// The C++ revision and independently recorded RGBA8 hashes live in authority-pixels.json.
const CASE_SHA256 = '928599de53a686949a9dab9784616e707490289d79dbac9777e7ef9281c07438'
const root = fileURLToPath(new URL('..', import.meta.url))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

function candidateRevision() {
  const status = git('status', '--porcelain', '--untracked-files=all', '--', 'src', 'package.json', 'package-lock.json')
  assert.equal(status, '', 'Candidate renderer source must match HEAD')
  return git('rev-parse', 'HEAD')
}

function unpackFloat32(hex) {
  const bytes = Buffer.from(hex, 'hex')
  const words = new Uint32Array(bytes.length / Uint32Array.BYTES_PER_ELEMENT)
  for (let index = 0; index < words.length; index++) {
    words[index] = bytes.readUInt32LE(index * Uint32Array.BYTES_PER_ELEMENT)
  }
  return new Float32Array(words.buffer)
}

function renderOptions({ options, externalInputs, externalTextures }) {
  const extras = {}
  const mesh = externalInputs?.meshData
  if (mesh) {
    extras.meshData = {
      texWidth: mesh.texWidth, texHeight: mesh.texHeight,
      positionData: unpackFloat32(mesh.positionRgba32f), normalData: unpackFloat32(mesh.normalRgba32f),
    }
  }
  const audio = externalInputs?.audioState
  if (audio) {
    extras.audioState = { waveform: unpackFloat32(audio.waveformFloat32), spectrum: unpackFloat32(audio.spectrumFloat32) }
  }
  const midi = externalInputs?.midiState
  if (midi) {
    extras.midiState = { noteGrid: unpackFloat32(midi.noteGridRgba32f), clockCount: midi.clockCount }
  }
  const textures = externalTextures?.map(({ name, width, height, rgba8 }) => [
    name, Surface.fromRgba8(width, height, Buffer.from(rgba8, 'hex')),
  ])
  return {
    ...options,
    externalInputs: externalInputs && extras,
    externalTextures: textures && Object.fromEntries(textures),
  }
}

async function saveReceipt(directory, filename, receipt) {
  const temporary = join(directory, `${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(receipt)}\n`, { flag: 'wx' })
    await rename(temporary, filename)
  } finally {
    await rm(temporary, { force: true })
  }
}

const [proofRoot, ...requested] = process.argv.slice(2)
if (!proofRoot) throw new Error('Usage: node bench/replay-authority.js PROOF_DIRECTORY [CASE_ID ...]')
const revision = candidateRevision()
const referenceBytes = await readFile(new URL('./authority-pixels.json', import.meta.url))
const inputBytes = gunzipSync(await readFile(new URL('./authority-replay-cases.jsonl.gz', import.meta.url)))
const reference = JSON.parse(referenceBytes)
assert.equal(sha256(inputBytes), CASE_SHA256, 'Canonical replay input fingerprint')
const expected = new Map(Object.values(reference.suites).flatMap(({ rgba8 }) => Object.entries(rgba8)))
const cases = inputBytes.toString('utf8').trim().split('\n').map(JSON.parse)
assert.equal(cases.length, reference.expected, 'Canonical replay case count')
assert.equal(expected.size, reference.expected, 'Reference RGBA8 count')
assert.equal(new Set(cases.map(({ id }) => id)).size, reference.expected, 'Unique replay cases')
for (const { id, source, sourceSha256 } of cases) {
  assert.match(expected.get(id) ?? '', /^[0-9a-f]{64}$/, `${id}: missing or malformed RGBA8 hash`)
  assert.equal(sha256(source), sourceSha256, `${id}: program fingerprint`)
}

const selected = new Set(requested)
const selection = requested.length ? cases.filter(({ id }) => selected.has(id)) : cases
assert.equal(selection.length, requested.length || reference.expected, 'Unknown or duplicate requested case')

const rendererDigest = await rendererInputDigest(root)
// Each completed case is an atomic receipt. The renderer inputs, replay
// harness, Node version, and platform identify compatible receipts.
const identity = sha256(JSON.stringify({
  rendererDigest,
  cases: CASE_SHA256,
  reference: sha256(referenceBytes),
  script: sha256(await readFile(new URL(import.meta.url))),
  digestScript: sha256(await readFile(new URL('./renderer-input-digest.js', import.meta.url))),
  node: process.version,
  nodeArgs: process.execArgv,
  nodeOptions: sha256(process.env.NODE_OPTIONS ?? ''),
  platform: process.platform,
  arch: process.arch,
}))
const directory = join(proofRoot, identity)
const current = join(directory, revision)
await mkdir(current, { recursive: true })
const saved = new Set(await readdir(current))
const nameFor = (id) => `${sha256(id)}.json`
const receiptFor = (id, sourceRevision) => ({ identity, revision: sourceRevision, id, rgba8Sha256: expected.get(id) })

async function checkReceipt(id, sourceRevision) {
  const filename = join(directory, sourceRevision, nameFor(id))
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), receiptFor(id, sourceRevision), `${id}: invalid saved receipt`)
}

async function replay(record) {
  const receipt = receiptFor(record.id, revision)
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = await renderer.render(record.source, renderOptions(record))
  assert.equal(result.width, record.options.width, `${record.id}: output width`)
  assert.equal(result.height, record.options.height, `${record.id}: output height`)
  assert.equal(sha256(result.toRgba8()), receipt.rgba8Sha256, `${record.id}: RGBA8 mismatch`)
  assert.equal(candidateRevision(), revision, 'Candidate source changed during replay')
  const name = nameFor(record.id)
  await saveReceipt(current, join(current, name), receipt)
  saved.add(name)
}

const previous = new Map()
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === revision || !/^[0-9a-f]{40}$/.test(entry.name)) continue
  for (const name of await readdir(join(directory, entry.name))) {
    if (/^[0-9a-f]{64}\.json$/.test(name)) previous.set(name, entry.name)
  }
}

// Cross-revision evidence is eligible only after the current revision has
// rendered and matched an authoritative default for every registered effect.
// A resumed spot check may reuse defaults actually rendered on this revision.
let spotCompared = 0
const willCarry = selection.some(({ id }) => previous.has(nameFor(id)) && !saved.has(nameFor(id)))
if (willCarry) {
  const defaultIds = new Set(createDefaultRegistry().list().map(({ id }) => `${id.replace('/', '__')}__default`))
  const defaults = cases.filter(({ id }) => defaultIds.has(id))
  assert(defaultIds.size > 0, 'Expected registered defaults for carry-over')
  assert.equal(defaults.length, defaultIds.size, 'Carry-over requires one authoritative default per effect')
  for (const record of defaults) {
    if (saved.has(nameFor(record.id))) await checkReceipt(record.id, revision)
    else await replay(record)
  }
  spotCompared = defaults.length
}

let rendered = 0
let carried = 0
for (const record of selection) {
  const name = nameFor(record.id)
  if (saved.has(name)) {
    await checkReceipt(record.id, revision)
  } else if (previous.has(name)) {
    await checkReceipt(record.id, previous.get(name))
    carried++
  } else {
    await replay(record)
    rendered++
  }
}
assert.equal(candidateRevision(), revision, 'Candidate source changed during replay')
assert.equal(await rendererInputDigest(root), rendererDigest, 'Renderer inputs changed during replay')
console.log(JSON.stringify({
  revision, identity, rendererDigest, compared: selection.length, expected: reference.expected,
  coverage: selection.length === reference.expected ? 'complete' : 'selected', rendered, carried, spotCompared,
}))
