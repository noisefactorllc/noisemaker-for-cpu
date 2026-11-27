import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Check a fresh C++ sweep against the starting CPU revision's exact output.
// Supply the SHA-256 of the ledger used to authenticate the candidate CPU export.
const [reports, authorityLedgerSha256, ...extra] = process.argv.slice(2)
if (!reports || !/^[0-9a-f]{64}$/.test(authorityLedgerSha256 ?? '') || extra.length) {
  throw new Error('Usage: node bench/verify-authority.js PARITY_DIRECTORY AUTHORITY_LEDGER_SHA256')
}
const reference = JSON.parse(await readFile(new URL('./authority-pixels.json', import.meta.url), 'utf8'))
const suites = {}
const optionFields = ['kind', 'effect_id', 'chain_effects', 'width', 'height', 'time', 'seed']

for (const [suite, baseline] of Object.entries(reference.suites)) {
  const directory = join(reports, suite)
  const manifest = JSON.parse(await readFile(join(directory, 'run-manifest.json'), 'utf8'))
  if (manifest.authority_ledger.sha256 !== authorityLedgerSha256) {
    throw new Error(`${suite}: authority ledger does not match the candidate`)
  }
  const harness = manifest.harness.map(({ sha256 }) => sha256)
  const inputs = JSON.stringify({ jobs: manifest.jobs, selection: manifest.selection, harness })
  const inputSha256 = createHash('sha256').update(inputs).digest('hex')
  if (manifest.schema !== 'noisemaker-cpp.parity-sweep-inputs.v1' || inputSha256 !== baseline.inputSha256) {
    throw new Error(`${suite}: input fingerprint differs from the baseline`)
  }

  const lines = (await readFile(join(directory, 'results.jsonl'), 'utf8')).trim().split('\n')
  if (lines.length !== manifest.jobs.length) throw new Error(`${suite}: result count differs from the baseline`)
  const jobs = new Map(manifest.jobs.map((job) => [job.case_id, job]))
  const seen = new Set()
  for (const line of lines) {
    const row = JSON.parse(line)
    const id = row.case_id
    if (seen.has(id)) throw new Error(`${suite}: duplicate case ${id}`)
    seen.add(id)
    const job = jobs.get(id)
    if (!job || !Object.hasOwn(baseline.rgba8, id)) throw new Error(`${suite}: unexpected case ${id}`)
    if (optionFields.some((key) => JSON.stringify(row[key]) !== JSON.stringify(job[key]))) {
      throw new Error(`${suite}: result options differ for ${id}`)
    }
    if (row.classification !== 'byte_exact' || !row.float32_ok || row.js_returncode !== 0 || row.cpp_returncode !== 0) {
      throw new Error(`${suite}: ${id} has no byte-exact result`)
    }
    if (row.rgba8_sha256 !== baseline.rgba8[id]) throw new Error(`${suite}: RGBA8 hash mismatch for ${id}`)
  }
  suites[suite] = seen.size
}
const exact = Object.values(suites).reduce((total, count) => total + count, 0)
if (exact !== reference.expected) throw new Error('Total case count differs from the baseline')
console.log(JSON.stringify({ expected: reference.expected, exact, authorityLedgerSha256, suites }))
