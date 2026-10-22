// Test entrypoint wrapper. Without NM_CHANGED_FILES it runs the same full suite
// as before. With NM_CHANGED_FILES (changed repository paths, one per line, set
// by the supervisor) it runs only the test files whose source references those
// paths, so iteration tests stay within the bounded run limit. Exact-source CI
// still runs the full suite because it does not set the variable.
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
  return found
}

if (changed.length === 0) {
  const child = fullSuite()
  child.on('close', (code) => process.exit(code ?? 1))
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
  if (selected.length === 0) {
    console.error('NM_CHANGED_FILES: no test file references the changed paths; nothing to run')
    process.exit(0)
  }
  console.error(`NM_CHANGED_FILES: running ${selected.length} test file(s)`)
  const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...selected], { cwd: projectRoot, stdio: 'inherit' })
  child.on('close', (code) => process.exit(code ?? 1))
}
