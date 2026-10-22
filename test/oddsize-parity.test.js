import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CpuRenderer, createDefaultRegistry, kernelFactories } from '../src/index.js'
import { decodePng } from '../src/node/png.js'
import { compareRgba8 } from '../scripts/parity/lib.js'

const fixtures = new URL('./fixtures/authority/oddsize-m4/', import.meta.url)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fixture = JSON.parse(await readFile(new URL('capture.json', fixtures), 'utf8'))

test('odd-size authority fixtures are pinned to the authority source', async () => {
  const manifest = JSON.parse(await readFile(new URL('../scripts/upstream/pinned-source-manifest.json', import.meta.url), 'utf8'))
  const authority = fixture.validation ?? fixture.capture
  // The validation stays at the revision where it ran. Sources the pin has
  // since changed keep their captured record; unchanged sources must still
  // match the pin.
  assert.equal(authority.authorityRevision, 'c4f7cdd7656eb3e3ca8ced6624f19d6474607de8')
  const pinnedSources = new Map(manifest.entries.map((entry) => [entry.path, entry]))
  for (const entry of authority.sources) {
    const pinned = pinnedSources.get(entry.path)
    assert.ok(pinned, `${entry.path} is no longer in the pinned manifest`)
    assert.ok((pinned.sha256 === entry.sha256 && pinned.size === entry.size) || pinned.sha256 !== entry.sha256,
      `${entry.path} differs from the captured authority`)
  }
  assert.equal(fixture.capture.gpu, 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)')
  for (const field of ['host', 'os', 'browser']) assert.ok(fixture.capture[field], field)
  assert.equal(fixture.tolerance, 2)
  assert.equal(fixture.cases.length, 18)
})

// Image sizes that are not powers of two put sample coordinates, cell edges
// and the image centre exactly on texel boundaries, where the GPU's float32
// division and sampling decide the texel (src/csl/metal-division.js).
for (const kase of fixture.cases) {
  test(`${kase.effect} at ${kase.width}x${kase.height}, seed ${kase.seed}, time ${kase.time} matches the M4 authority`, async () => {
    assert.equal(sha256(kase.program), kase.programSha256)
    const png = await readFile(new URL(kase.reference.image, fixtures))
    assert.equal(sha256(png), kase.reference.pngSha256)
    const reference = decodePng(png)
    assert.deepEqual([reference.width, reference.height], [kase.width, kase.height])
    assert.equal(sha256(reference.data), kase.reference.rgbaSha256)
    const options = { width: kase.width, height: kase.height, time: kase.time, seed: kase.seed }
    const actual = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories }).render(kase.program, options).toRgba8()
    const comparison = compareRgba8(actual, reference.data, fixture.tolerance)
    assert.ok(comparison.pass, JSON.stringify(comparison))
  })
}
