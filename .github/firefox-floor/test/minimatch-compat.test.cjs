const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createRequire } = require('node:module')
const matcher = require('minimatch')

test('preserves the browser client matcher APIs and packaging patterns', () => {
  assert.equal(typeof matcher, 'function')
  assert.equal(matcher('browser.js', '*.js'), true)
  assert.equal(matcher.minimatch('browser.js', '*.json'), false)
  assert.deepEqual(matcher.match(['browser.js', 'package.json'], '*.js'), ['browser.js'])
  assert.deepEqual(['browser.js', 'package.json'].filter(matcher.filter('*.js')), ['browser.js'])
  assert.equal(matcher.defaults({ nocase: true })('BROWSER.JS', '*.js'), true)
  assert.equal(new matcher.Minimatch('*.js').match('browser.js'), true)
  assert.equal(matcher('nested/browser.js', '*.js', { matchBase: true }), true)
  assert.equal(matcher('.hidden.js', '*.js', { dot: true }), true)
})

test('bounds the upstream globparts amplification attack', () => {
  const parsed = new matcher.Minimatch('a/**/../b/**/../c/**/../d/**/../e/**/../f', {
    optimizationLevel: 2,
    braceExpandMax: 4,
  })
  assert.ok(parsed.globParts.length <= 4)
})

test('the pinned browser client and its actual legacy glob cleanup remain compatible', async t => {
  const clientRequire = createRequire(require.resolve('playwright-core'))
  assert.equal(clientRequire('./package.json').version, '1.15.2')
  clientRequire('./lib/utils/browserFetcher.js')
  const cleanupRequire = createRequire(clientRequire.resolve('rimraf'))
  const globRequire = createRequire(cleanupRequire.resolve('glob'))
  const actualMatcher = globRequire('minimatch')
  assert.equal(typeof actualMatcher, 'function')
  assert.ok(new actualMatcher.Minimatch('a/**/../b/**/../c/**/../d/**/../e/**/../f', {
    optimizationLevel: 2, braceExpandMax: 4,
  }).globParts.length <= 4)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'firefox-client-glob-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'nested'))
  await fs.writeFile(path.join(root, 'nested', 'browser.js'), 'payload')
  await fs.writeFile(path.join(root, '.hidden.js'), 'hidden')
  assert.deepEqual(cleanupRequire('glob').sync('**/*.js', { cwd: root }), ['nested/browser.js'])
  clientRequire('rimraf').sync(path.join(root, 'nested'))
  assert.equal(await fs.stat(path.join(root, '.hidden.js')).then(() => true), true)
  await assert.rejects(fs.stat(path.join(root, 'nested')), { code: 'ENOENT' })
})

test('native ESM consumers retain the named matcher API', async () => {
  const { minimatch, Minimatch } = await import('minimatch')
  assert.equal(minimatch('browser.js', '*.js'), true)
  assert.equal(new Minimatch('*.js').match('browser.js'), true)
})
