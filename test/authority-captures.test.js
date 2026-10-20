import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CpuRenderer, Surface, createDefaultRegistry, kernelFactories } from '../src/index.js'
import { decodePng } from '../src/node/png.js'
import { compareRgba8 } from '../scripts/parity/lib.js'

// Apple M4 authority captures of single-frame programs outside the 8x8 default
// fixtures (other sizes, seeds, times and inputs). Each directory's capture.json
// records the pinned sources, the capture host and protocol, and one entry per
// case. A case expects exact bytes, the ±2 contract (strict), or a reviewed NEAR
// residual whose CPU candidate and measured difference are pinned.
const CAPTURE_DIRECTORIES = ['scatter-m4', 'snow-m4', 'spookyTicker-m4']
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const manifest = JSON.parse(await readFile(new URL('../scripts/upstream/pinned-source-manifest.json', import.meta.url), 'utf8'))
const pinnedSources = new Map(manifest.entries.map((entry) => [entry.path, entry]))

for (const directory of CAPTURE_DIRECTORIES) {
  const root = new URL(`./fixtures/authority/${directory}/`, import.meta.url)
  const fixture = JSON.parse(await readFile(new URL('capture.json', root), 'utf8'))

  test(`${directory} records pinned sources and stable captures`, () => {
    const authority = fixture.validation ?? fixture.capture
    assert.equal(authority.authorityRevision, manifest.revision)
    for (const entry of authority.sources) {
      assert.deepEqual(pinnedSources.get(entry.path), entry, `${entry.path} differs from the captured authority`)
    }
    assert.equal(fixture.tolerance, 2)
    for (const kase of fixture.cases) {
      assert.equal(sha256(kase.program), kase.programSha256, kase.name)
      const { writeSha256, repeatSha256, independentSha256 } = kase.independentCaptures
      assert.equal(writeSha256, kase.reference.rgbaSha256, kase.name)
      assert.equal(repeatSha256, writeSha256, kase.name)
      assert.equal(independentSha256, writeSha256, kase.name)
    }
  })

  for (const kase of fixture.cases) {
    test(`${directory} ${kase.name} matches the M4 authority (${kase.expect})`, async () => {
      const png = await readFile(new URL(kase.reference.image, root))
      assert.equal(sha256(png), kase.reference.pngSha256)
      const reference = decodePng(png)
      assert.deepEqual([reference.width, reference.height], [kase.width, kase.height])
      assert.equal(sha256(reference.data), kase.reference.rgbaSha256)

      const blank = () => {
        const surface = new Surface(kase.width, kase.height)
        surface.format = 'rgba16f'
        return surface
      }
      let imageTex = blank
      if (kase.input) {
        const inputPng = await readFile(new URL(kase.input.image, root))
        assert.equal(sha256(inputPng), kase.input.pngSha256)
        const input = decodePng(inputPng)
        assert.deepEqual([input.width, input.height], [kase.width, kase.height])
        assert.equal(sha256(input.data), kase.input.rgbaSha256)
        imageTex = () => Surface.fromRgba8(kase.width, kase.height, input.data)
      }
      const options = () => ({
        width: kase.width,
        height: kase.height,
        time: kase.time,
        seed: kase.seed,
        externalTextures: { imageTex: imageTex(), textTex: blank() },
        oneShot: 'initial',
      })
      const renderer = () => new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
      const actual = renderer().render(kase.program, options()).toRgba8()
      const comparison = compareRgba8(actual, reference.data, fixture.tolerance)
      if (kase.expect === 'exact') {
        assert.equal(sha256(actual), kase.reference.rgbaSha256)
      } else if (kase.expect === 'strict') {
        assert.ok(comparison.pass, JSON.stringify(comparison))
      } else {
        assert.equal(kase.expect, 'near')
        assert.equal(sha256(actual), kase.near.candidateRgbaSha256)
        const { maxError, channelsOverTolerance, differingChannels } = comparison
        assert.deepEqual({ maxError, channelsOverTolerance, differingChannels }, {
          maxError: kase.near.maxError,
          channelsOverTolerance: kase.near.channelsOverTolerance,
          differingChannels: kase.near.differingChannels,
        })
      }
      const asynchronous = await renderer().renderAsync(kase.program, options())
      assert.deepEqual(asynchronous.toRgba8(), actual)
    })
  }
}
