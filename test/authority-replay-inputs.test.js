import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { rendererInputDigest } from '../bench/renderer-input-digest.js'

const SNAPSHOT = 'src/effects/generated/upstream-snapshot.js'
const REVISION = /^export const UPSTREAM_REVISION = "[0-9a-f]{40}"$/m
const replacement = `export const UPSTREAM_REVISION = "${'f'.repeat(40)}"`

async function fixtureDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'noisemaker-replay-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('renderer digest binds source bytes, paths and package inputs except the exact revision declaration', async (t) => {
  const root = await fixtureDirectory(t)
  const snapshot = join(root, SNAPSHOT)
  await mkdir(join(root, 'src/effects/generated'), { recursive: true })
  const declaration = `export const UPSTREAM_REVISION = "${'a'.repeat(40)}"`
  const snapshotText = `${declaration}\nexport const effectIds = ['synth/solid']\n`
  await writeFile(snapshot, snapshotText)
  const source = join(root, 'src/runtime.js')
  await writeFile(source, 'export const channel = 1\n')
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
  const initial = await rendererInputDigest(root)
  await writeFile(snapshot, snapshotText.replace(REVISION, replacement))
  assert.equal(await rendererInputDigest(root), initial)

  for (const [file, changed] of [
    [SNAPSHOT, snapshotText.replace("'synth/solid'", "'synth/noise'")],
    ['src/runtime.js', 'export const channel = 2\n'],
    ['package.json', '{"type":"module","name":"changed"}\n'],
    ['package-lock.json', '{"lockfileVersion":2}\n'],
  ]) {
    const path = join(root, file)
    const previous = await readFile(path)
    await writeFile(path, changed)
    assert.notEqual(await rendererInputDigest(root), initial, file)
    await writeFile(path, previous)
  }

  const extra = join(root, 'src/extra.js')
  await writeFile(extra, await readFile(source))
  assert.notEqual(await rendererInputDigest(root), initial, 'added file')
  await rm(extra)
  await rm(source)
  assert.notEqual(await rendererInputDigest(root), initial, 'removed file')
  await writeFile(snapshot, snapshotText.replace('const UPSTREAM', 'const  UPSTREAM'))
  await assert.rejects(rendererInputDigest(root), /exact UPSTREAM_REVISION declaration/)
})

test('changing only the declared revision preserves the actual render bytes', async (t) => {
  const root = await fixtureDirectory(t)
  const original = join(root, 'original')
  const changed = join(root, 'changed')
  await mkdir(original)
  for (const path of ['src', 'package.json', 'package-lock.json']) {
    await cp(new URL(`../${path}`, import.meta.url), join(original, path), { recursive: true })
  }
  await cp(original, changed, { recursive: true })
  const snapshot = join(changed, SNAPSHOT)
  const before = await readFile(snapshot, 'utf8')
  const updated = before.replace(REVISION, replacement)
  assert.notEqual(updated, before)
  await writeFile(snapshot, updated)
  assert.equal(await rendererInputDigest(changed), await rendererInputDigest(original))

  const render = async (directory) => {
    const { CpuRenderer, createDefaultRegistry, kernels, kernelFactories } = await import(pathToFileURL(join(directory, 'src/index.js')))
    const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
    const result = await renderer.render('search synth\nsolid(color: #3b79cb).write(o0)\nrender(o0)\n', {
      width: 3, height: 2, time: 0.25, frame: 0, seed: 1, oneShot: 'ready', renderScale: 1,
    })
    assert.equal(result.toRgba8().length, 24)
    return createHash('sha256').update(result.toRgba8()).digest('hex')
  }
  assert.equal(await render(changed), await render(original))
})
