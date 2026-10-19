import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { eligibleEffectIds, excludedEffects, sourceEffectIds } from '../src/effects/generated/upstream-snapshot.js'

// export-kit/compat-effects.json is the list the Noisedeck export dialog trusts. It is generated
// (export-kit/README-generation.md), so an upstream sync that forgets to regenerate it silently
// publishes a stale claim. It once listed 205 effects while the snapshot rendered 208. The
// reactive/mesh trees are imported with the catalog, so the compat list covers the
// full 210-effect source inventory.
test('export kit compat list names exactly the effects the snapshot renders', async () => {
  const excluded = new Set(Object.values(excludedEffects).flat())
  const derived = [...eligibleEffectIds].sort()
  assert.deepEqual(derived, sourceEffectIds.filter(id => !excluded.has(id)).sort())
  assert.deepEqual([...excluded], [], 'all source effects are implemented; no active exclusions remain')
  const listed = JSON.parse(await readFile(new URL('../export-kit/compat-effects.json', import.meta.url), 'utf8'))
  assert.deepEqual(listed, derived)
})

test('README-generation states the compat list size', async () => {
  const note = await readFile(new URL('../export-kit/README-generation.md', import.meta.url), 'utf8')
  const listed = JSON.parse(await readFile(new URL('../export-kit/compat-effects.json', import.meta.url), 'utf8'))
  const stated = note.match(/the result is all (\d+) ids/)
  assert.ok(stated, 'README-generation states no list size')
  assert.equal(Number(stated[1]), listed.length)
})

// The Firefox 92 floor check needs playwright-core 1.15.2 and its dependency tree. That
// set is CI-only: it is pinned in .github/firefox-floor and installed into the runner's
// temporary directory. Neither the npm package nor the export kit may ever carry it.
test('the CI-only Firefox floor client is pinned and never reaches the package or the kit', async () => {
  const read = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  const pkg = await read('package.json')
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.ok(!Object.keys(pkg[field] ?? {}).some((name) => name.includes('playwright')), `package.json ${field} names playwright`)
  }
  assert.ok(!pkg.files.some((entry) => entry.startsWith('.github')), 'package files include .github')
  const kit = await read('export-kit/kit.config.json')
  assert.deepEqual(kit.subtrees.map((subtree) => subtree.from), ['src', 'bin/noisemaker-cpu.js'])
  assert.deepEqual(kit.engineBytesFrom, ['engine/'])

  const floor = await read('.github/firefox-floor/package.json')
  assert.equal(floor.private, true)
  assert.deepEqual(floor.dependencies, { 'playwright-core': '1.15.2' })
  const lock = await read('.github/firefox-floor/package-lock.json')
  assert.deepEqual(lock.packages[''].dependencies, floor.dependencies)
  const client = lock.packages['node_modules/playwright-core']
  assert.equal(client.version, '1.15.2')
  assert.equal(client.integrity, 'sha512-bY3eZu27QL62Y/iVsZUTm+RtPZ+0Zj34GoKQ6VtdjhzqoUWj40IoLy0q/GhMpXUNqKZMntHmtxvLYlREFauf8Q==')
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, path)
    assert.match(entry.integrity, /^sha512-/, path)
  }

  const { readdir } = await import('node:fs/promises')
  const sources = []
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(`${dir}/${entry.name}`)
      else if (/\.(m?js)$/.test(entry.name)) sources.push(`${dir}/${entry.name}`)
    }
  }
  await walk('src')
  await walk('bin')
  for (const source of sources) {
    const text = await readFile(new URL(`../${source}`, import.meta.url), 'utf8')
    assert.ok(!text.includes('playwright'), `${source} refers to playwright`)
  }
})
