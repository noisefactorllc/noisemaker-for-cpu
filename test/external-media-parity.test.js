import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { CpuRenderer, Surface, createDefaultRegistry, kernelFactories } from '../src/index.js'
import { decodePng } from '../src/node/png.js'
import { compareRgba8 } from '../scripts/parity/lib.js'

const fixtures = new URL('./fixtures/authority/posterize-97x43/', import.meta.url)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('external posterize at 97x43 matches the M4 authority through sync, async, and CLI renders', async () => {
  const fixture = JSON.parse(await readFile(new URL('capture.json', fixtures), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('../scripts/upstream/pinned-source-manifest.json', import.meta.url), 'utf8'))
  const pinnedSources = new Map(manifest.entries.map((entry) => [entry.path, entry]))
  const authority = fixture.validation ?? fixture.capture
  // The validation stays at the revision where it ran. Sources the pin has
  // since changed keep their captured record; unchanged sources must still
  // match the pin.
  for (const entry of authority.sources) {
    const pinned = pinnedSources.get(entry.path)
    assert.ok(pinned, `${entry.path} is no longer in the pinned manifest`)
    assert.ok((pinned.sha256 === entry.sha256 && pinned.size === entry.size) || pinned.sha256 !== entry.sha256,
      `${entry.path} differs from the captured authority`)
  }
  assert.equal(sha256(fixture.program), fixture.programSha256)
  assert.equal(fixture.tolerance, 2)

  const inputPng = await readFile(new URL(fixture.input.image, fixtures))
  const referencePng = await readFile(new URL(fixture.reference.image, fixtures))
  assert.equal(sha256(inputPng), fixture.input.pngSha256)
  assert.equal(sha256(referencePng), fixture.reference.pngSha256)
  const input = decodePng(inputPng)
  const reference = decodePng(referencePng)
  const { width, height, time, seed } = fixture
  assert.deepEqual([input.width, input.height], [width, height])
  assert.deepEqual([reference.width, reference.height], [width, height])
  assert.equal(sha256(input.data), fixture.input.rgbaSha256)
  assert.equal(sha256(reference.data), fixture.reference.rgbaSha256)

  const options = {
    width, height, time, seed,
    externalTextures: { imageTex: Surface.fromRgba8(width, height, input.data) },
  }
  const renderer = () => new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
  const synchronous = renderer().render(fixture.program, options)
  assert.ok(synchronous.surface.data.every(Number.isFinite))
  const actual = synchronous.toRgba8()
  const comparison = compareRgba8(actual, reference.data, fixture.tolerance)
  assert.ok(comparison.pass, JSON.stringify(comparison))
  const asynchronous = await renderer().renderAsync(fixture.program, options)
  assert.deepEqual(asynchronous.toRgba8(), actual)

  const directory = await mkdtemp(join(tmpdir(), 'noisemaker-external-parity-'))
  try {
    const outputPath = join(directory, 'output.png')
    execFileSync(process.execPath, [
      fileURLToPath(new URL('../bin/noisemaker-cpu.js', import.meta.url)), 'render', '-',
      '--width', String(width), '--height', String(height), '--time', String(time), '--seed', String(seed),
      '--input', fileURLToPath(new URL(fixture.input.image, fixtures)), '--output', outputPath,
    ], { input: fixture.program, encoding: 'utf8' })
    const cli = decodePng(await readFile(outputPath))
    assert.deepEqual([cli.width, cli.height], [width, height])
    assert.deepEqual(cli.data, Uint8Array.from(actual))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
