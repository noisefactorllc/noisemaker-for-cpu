#!/usr/bin/env node
// Regenerates parity/goldens/provenance.json (GAP-008): the committed map from each
// retained golden image to its reference-capture provenance. Run this whenever a
// golden is added or regenerated — the parity gate cross-checks the recorded sha256
// against the file bytes and fails loudly on a mismatch, so a regenerated golden can
// never be silently relabeled with a new capture revision.
//
// Provenance policy: a golden's `captureRevision` may only be filled in from an
// explicit capture record (a documented GPU-session capture, its host revision, and
// the authority backend). The retained goldens were committed in bulk with no capture
// record, so their captureRevision is `null` and their provenance is `unknown`. The
// generated kernel pin (UPSTREAM_REVISION) is the CANDIDATE source revision and must
// never be written into a captureRevision field.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

async function listGoldenPngs(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.golden.png')).map((entry) => join(entry.parentPath ?? entry.path, entry.name))
}

async function introducedIn(path) {
  const { stdout } = await execFileAsync('git', ['log', '--diff-filter=A', '--follow', '--format=%H', '--', relative(projectRoot, path)], { cwd: projectRoot })
  const full = stdout.trim().split('\n').filter(Boolean).pop()
  if (!full) throw new Error(`${relative(projectRoot, path)} has no introducing commit; is this a git checkout?`)
  return full
}

const goldensRoot = join(projectRoot, 'parity', 'goldens')
// Explicit capture records (GAP-008): a documented GPU-session capture maps a golden key
// to its capture revision and a human-readable record (host, backend, session). Only keys
// present here get a non-null captureRevision; everything else stays 'unknown'.
let captureRecords = {}
try {
  captureRecords = JSON.parse(await readFile(join(projectRoot, 'scripts', 'parity', 'capture-records.json'), 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const goldens = {}
for (const path of (await listGoldenPngs(goldensRoot)).sort()) {
  const key = relative(goldensRoot, path).split('\\').join('/')
  const record = captureRecords[key] ?? null
  goldens[key] = {
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
    bytes: (await readFile(path)).length,
    introducedIn: await introducedIn(path),
    captureRevision: record ? record.captureRevision : null,
    captureRecord: record ? record.captureRecord : null,
  }
}

const manifest = {
  format: 1,
  note: 'Reference-image provenance for the retained parity goldens (GAP-008). captureRevision is null and provenance is unknown for every golden committed without an explicit capture record; a capture revision may only be recorded from a documented capture (GPU session, host revision, authority backend) — never from the generated kernel pin, which is the candidate source revision reported as sourceRevision.',
  goldens,
}

const target = join(goldensRoot, 'provenance.json')
await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`wrote ${target} with ${Object.keys(goldens).length} golden entries\n`)
