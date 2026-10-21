import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fixtureSha256(source) {
  return createHash('sha256').update(source.toString().replace(/\r\n/g, '\n')).digest('hex')
}

function listGoldenPngs(directory) {
  return readdir(directory, { withFileTypes: true, recursive: true }).then((entries) =>
    entries.filter((entry) => entry.isFile() && entry.name.endsWith('.golden.png')).map((entry) => join(entry.parentPath ?? entry.path, entry.name)),
  )
}

test('every retained golden has a provenance manifest entry whose sha256 matches the file bytes', async () => {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'parity/goldens/provenance.json'), 'utf8'))
  const goldens = await listGoldenPngs(join(projectRoot, 'parity/goldens'))
  assert.ok(goldens.length > 100, `expected the full retained golden set, found ${goldens.length}`)
  for (const path of goldens) {
    const key = relative(join(projectRoot, 'parity/goldens'), path).split('\\').join('/')
    const entry = manifest.goldens[key]
    assert.ok(entry, `golden ${key} is missing from parity/goldens/provenance.json`)
    const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
    assert.equal(entry.sha256, sha256, `manifest sha256 for ${key} does not match the file bytes; regenerate the capture record, do not relabel`)
  }
})

test('a re-added golden records the current addition rather than its deleted predecessor', async () => {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'parity/goldens/provenance.json'), 'utf8'))
  const path = 'parity/goldens/defaults/filter3d__flow3d.golden.png'
  const currentAddition = 'a39f94f24fd9550a74384867334fbd55cf173a84'
  assert.equal(manifest.goldens['defaults/filter3d__flow3d.golden.png'].introducedIn, currentAddition)
  const { stdout: shallow } = await execFileAsync('git', ['rev-parse', '--is-shallow-repository'], { cwd: projectRoot })
  if (shallow.trim() === 'true') return
  const { stdout } = await execFileAsync('git', ['log', '--diff-filter=A', '--follow', '--format=%H', '--', path], { cwd: projectRoot })
  const latestAddition = stdout.trim().split('\n').filter(Boolean)[0]
  assert.ok(latestAddition)
  assert.equal(currentAddition, latestAddition)
})

test('provenance entries never borrow the generated kernel pin as a capture revision', async () => {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'parity/goldens/provenance.json'), 'utf8'))
  const { UPSTREAM_REVISION } = await import(new URL('../src/effects/generated/upstream-snapshot.js', import.meta.url))
  for (const [key, entry] of Object.entries(manifest.goldens)) {
    if (entry.captureRevision !== null) {
      assert.notEqual(entry.captureRevision, UPSTREAM_REVISION, `${key}: the kernel pin must not be recorded as the reference capture revision`)
      assert.ok(typeof entry.captureRevision === 'string' && entry.captureRevision.length > 0, `${key}: a recorded capture revision must be a non-empty string`)
    }
  }
})

test('parity report identifies reference-image provenance separately from the source revision', async () => {
  const { stdout } = await execFileAsync('node', ['scripts/parity/run.js', '--only', 'filter/bloom', '--json'], { cwd: projectRoot })
  const summary = JSON.parse(stdout)
  assert.ok(summary.sourceRevision, 'summary must keep the candidate source revision')
  assert.ok(summary.results, 'summary must expose per-comparison results')
  for (const result of summary.results) {
    assert.ok(result.reference, `${result.id}: comparison is missing its reference provenance block`)
    assert.equal(result.reference.provenance === 'recorded', typeof result.reference.captureRevision === 'string', `${result.id}: provenance label and captureRevision must agree`)
    if (result.reference.provenance === 'unknown') {
      assert.equal(result.reference.captureRevision, null, `${result.id}: unknown provenance must not borrow a revision label`)
    }
    assert.notEqual(result.reference.captureRevision, summary.sourceRevision, `${result.id}: kernel updates cannot relabel reference captures`)
  }
  assert.ok(summary.referenceProvenance, 'summary must aggregate reference provenance counts')
  assert.equal(summary.referenceProvenance.unknown + summary.referenceProvenance.recorded, summary.results.length)
})

test('current NEAR authority validation preserves each original capture and binds its exact pixels', async () => {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'parity/goldens/provenance.json'), 'utf8'))
  const records = JSON.parse(await readFile(join(projectRoot, 'scripts/parity/capture-records.json'), 'utf8'))
  const { UPSTREAM_REVISION } = await import('../src/effects/generated/upstream-snapshot.js')
  for (const id of ['points/buddhabrot', 'synth/navierStokes', 'points/hydraulic', 'points/dla', 'points/flock']) {
    const key = `defaults/${id.replace('/', '__')}.golden.png`
    const capture = manifest.goldens[key].captureRecord
    assert.equal(capture.sourceRevision, '6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d')
    const validation = capture.authorityValidation
    assert.equal(validation?.sourceRevision, UPSTREAM_REVISION, id)
    assert.deepEqual(records[key].captureRecord.authorityValidation, validation)
    assert.equal(validation.independentRenderers, 2)
    assert.equal(validation.readsPerRenderer, 2)
    const fixture = await readFile(join(projectRoot, `parity/upstream-defaults/${id.replace('/', '__')}.dsl`))
    assert.equal(validation.fixtureSha256, fixtureSha256(fixture))
    for (const readback of validation.readbacks) {
      const original = capture.readbacks.find(value => value.id === readback.surface)
      assert.equal(readback.sha256, original.sha256)
      assert.deepEqual([readback.repeatSha256, readback.independentSha256, readback.independentRepeatSha256], [readback.sha256, readback.sha256, readback.sha256])
    }
  }
})

test('NEAR authority validation records the actual current-source capture times and verified input count', async () => {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'parity/goldens/provenance.json'), 'utf8'))
  const times = [
    ['points/buddhabrot', '2026-10-21T00:20:44.822Z', '2026-10-21T00:20:45.798Z'],
    ['synth/navierStokes', '2026-10-21T00:20:46.160Z', '2026-10-21T00:20:46.823Z'],
    ['points/hydraulic', '2026-10-21T00:20:47.165Z', '2026-10-21T00:20:47.989Z'],
    ['points/dla', '2026-10-21T00:20:49.824Z', '2026-10-21T00:20:50.581Z'],
    ['points/flock', '2026-10-21T00:20:52.449Z', '2026-10-21T00:20:53.194Z'],
  ]
  for (const [id, startedAt, completedAt] of times) {
    const capture = manifest.goldens[`defaults/${id.replace('/', '__')}.golden.png`].captureRecord
    assert.equal(capture.sourceRevision, '6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d')
    const validation = capture.authorityValidation
    assert.equal(validation.sourceRevision, 'b71a896a4dbdbc01e682b277f6d9a41fe786485e', id)
    assert.deepEqual([validation.startedAt, validation.completedAt], [startedAt, completedAt], id)
    assert.equal(validation.sourceFilesVerified, 1384, id)
    assert.equal(validation.programStateApplied, true, id)
  }
})

test('current source revalidation does not relabel historical renderer protocols or dates', async () => {
  const { UPSTREAM_REVISION } = await import('../src/effects/generated/upstream-snapshot.js')
  for (const directory of ['oddsize-m4', 'posterize-97x43', 'scatter-m4', 'seeded-hashes-m4', 'seeded-volumes-m4', 'snow-m4', 'spookyTicker-m4']) {
    const fixture = JSON.parse(await readFile(join(projectRoot, `test/fixtures/authority/${directory}/capture.json`), 'utf8'))
    assert.equal(fixture.capture.authorityRevision, '6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d', directory)
    assert.equal(fixture.validation?.authorityRevision, UPSTREAM_REVISION, directory)
    assert.equal(fixture.validation.verifiedRendererCount, 1)
    assert.equal(fixture.validation.readsPerVerifiedRenderer, directory === 'seeded-volumes-m4' ? 2 : 3)
    assert.equal(fixture.validation.programStateApplied, false)
    assert.ok(Date.parse(fixture.validation.startedAt) <= Date.parse(fixture.validation.completedAt))
    assert.ok(Date.parse(fixture.validation.completedAt) <= Date.parse('2026-10-20T16:16:47.931806Z'))
    const cases = directory === 'posterize-97x43' ? [fixture] : [...fixture.cases, ...(fixture.volumes ?? [])]
    assert.equal(fixture.validation.readbacks.length, cases.length)
    for (let index = 0; index < cases.length; index++) {
      assert.equal(fixture.validation.readbacks[index].sha256, cases[index].reference?.rgbaSha256 ?? cases[index].rgbaSha256)
    }
  }
})

test('text capture records the measured unchanged pixels and its actual fixture', async () => {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'parity/goldens/provenance.json'), 'utf8'))
  const capture = manifest.goldens['defaults/filter__text.golden.png'].captureRecord
  const { decodePng } = await import('../src/node/png.js')
  const image = decodePng(await readFile(join(projectRoot, 'parity/goldens/defaults/filter__text.golden.png')))
  const raw = createHash('sha256').update(image.data).digest('hex')
  assert.equal(capture.pixelComparison?.previousPngSha256, '6624f33d8078372bd43bd4f074ad21b5c04c167df82b6bb70a1707aeae91f632')
  assert.equal(capture.pixelComparison.previousRawSha256, raw)
  assert.equal(capture.pixelComparison.identicalPixels, true)
  assert.equal(capture.fixtureSha256, fixtureSha256(await readFile(join(projectRoot, 'parity/upstream-defaults/filter__text.dsl'))))
})

test('fixture provenance hashes ignore checkout newlines but retain source changes', async () => {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'parity/goldens/provenance.json'), 'utf8'))
  for (const id of ['points/buddhabrot', 'synth/navierStokes', 'points/hydraulic', 'points/dla', 'points/flock', 'filter/text']) {
    const name = id.replace('/', '__')
    const capture = manifest.goldens[`defaults/${name}.golden.png`].captureRecord
    const expected = (capture.authorityValidation ?? capture).fixtureSha256
    const source = (await readFile(join(projectRoot, `parity/upstream-defaults/${name}.dsl`), 'utf8')).replace(/\r\n/g, '\n')
    assert.equal(fixtureSha256(source), expected, `${id}: LF`)
    assert.equal(fixtureSha256(Buffer.from(source.replace(/\n/g, '\r\n'))), expected, `${id}: CRLF`)
    assert.notEqual(fixtureSha256(`${source} `), expected, `${id}: changed source`)
  }
})
