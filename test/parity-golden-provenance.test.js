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

test('provenance entries never borrow the generated kernel pin as a capture revision', async () => {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'parity/goldens/provenance.json'), 'utf8'))
  const { UPSTREAM_REVISION } = await import(join(projectRoot, 'src/effects/generated/upstream-snapshot.js'))
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
