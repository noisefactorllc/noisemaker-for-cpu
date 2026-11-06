// Test entrypoint wrapper. Without NM_CHANGED_FILES it runs the same full suite
// as before. With NM_CHANGED_FILES (changed repository paths, one per line, set
// by the supervisor) it runs only the test files whose source references those
// paths, so iteration tests stay within the bounded run limit. Exact-source CI
// still runs the full suite because it does not set the variable.
//
// With NM_SHARD_COUNT and NM_SHARD_INDEX set (0-based; .nm-test-shards at the
// repository root declares the count) the selection — full suite or
// changed-path selection — is reduced to that shard: every file whose index in
// the sorted list satisfies index % count == index. Together the shards run
// every selected test exactly once, and each invocation stays within the
// 5-minute run limit. Without those variables the behavior is unchanged.
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const changed = (process.env.NM_CHANGED_FILES ?? '')
  .split('\n').map((line) => line.trim()).filter((line) => line.length > 0)

const fullSuite = () => spawn(process.execPath, ['--test', '--test-concurrency=2'], {
  cwd: projectRoot, stdio: 'inherit',
})

// Every *.test.* file under test/, including nested directories, so a changed
// path referenced only from a nested test file still selects its tests.
function collectTestFiles() {
  const found = []
  const walk = (relative) => {
    for (const entry of readdirSync(join(projectRoot, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (/\.test\.[cm]?js$/.test(entry.name)) found.push(child)
    }
  }
  walk('test')
  return found.sort()
}

const shardCount = Number.parseInt(process.env.NM_SHARD_COUNT ?? '', 10)
const shardIndex = Number.parseInt(process.env.NM_SHARD_INDEX ?? '', 10)
const sharded = Number.isInteger(shardCount) && shardCount > 0
  && Number.isInteger(shardIndex) && shardIndex >= 0 && shardIndex < shardCount

// Keeps shard identity stable: a file's shard follows its index in the sorted
// full test list, so shard N holds the same files in full-suite and
// changed-path runs.
const allTestFiles = collectTestFiles()
const shardOf = (files) => (sharded
  ? files.filter((file) => allTestFiles.indexOf(file) % shardCount === shardIndex)
  : files)

if (changed.length === 0) {
  if (!sharded) {
    const child = fullSuite()
    child.on('close', (code) => process.exit(code ?? 1))
  } else {
    const files = shardOf(allTestFiles)
    console.error(`NM_SHARD_INDEX=${shardIndex}/${shardCount}: running ${files.length} test file(s)`)
    const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...files], {
      cwd: projectRoot, stdio: 'inherit',
    })
    child.on('close', (code) => process.exit(code ?? 1))
  }
} else {
  const needles = new Set()
  for (const path of changed) {
    const normalized = path.replaceAll('\\', '/')
    needles.add(normalized)
    needles.add(normalized.replace(/\.[cm]?js$/, ''))
    needles.add(normalized.split('/').pop())
    if (normalized.startsWith('src/')) needles.add(normalized.slice('src/'.length))
  }
  const selected = []
  for (const path of collectTestFiles()) {
    if (needles.has(path) || needles.has(path.replace(/\.[cm]?js$/, '')) || needles.has(path.split('/').pop()) ||
        [...needles].some((needle) => readFileSync(join(projectRoot, path), 'utf8').includes(needle))) {
      selected.push(path)
    }
  }
  const files = shardOf(selected)
  if (files.length === 0) {
    console.error('NM_CHANGED_FILES: no test file references the changed paths; nothing to run')
    process.exit(0)
  }
  console.error(sharded
    ? `NM_CHANGED_FILES: running shard ${shardIndex}/${shardCount}: ${files.length} test file(s)`
    : `NM_CHANGED_FILES: running ${files.length} test file(s)`)
  const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...files], { cwd: projectRoot, stdio: 'inherit' })
  child.on('close', (code) => process.exit(code ?? 1))
}
