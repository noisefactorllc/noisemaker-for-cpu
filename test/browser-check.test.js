import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, get as httpGet } from 'node:http'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findExecutable, inspectSafari, listenWithFallback, serve } from '../scripts/browser-check.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function listen(server) {
  await listenWithFallback(server)
  return server.address().port
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

async function runFakeSafari(mode) {
  const requests = []
  const web = await serve(root, { safari: true, requests })
  const targetURL = `http://127.0.0.1:${web.address().port}/examples/browser/index.html`
  let deleted = false
  const driver = createServer(async (req, res) => {
    const reply = (value, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ value }))
    }
    const fetchText = (target) => new Promise((resolveText, rejectText) => {
      httpGet(target, { agent: false }, (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => resolveText(Buffer.concat(chunks).toString('utf8')))
      }).on('error', rejectText)
    })
    const path = req.url
    if (path === '/status') return reply({ ready: true })
    if (path === '/session' && req.method === 'POST') {
      return reply({ sessionId: 'fake-session', capabilities: { browserName: 'safari', browserVersion: '26.5', platformName: 'mac' } })
    }
    if (path === '/session/fake-session/url' && req.method === 'POST') {
      let input = ''
      for await (const chunk of req) input += chunk
      const url = JSON.parse(input).url
      const html = await fetchText(url)
      const recorder = html.indexOf('__browserCheckErrors')
      const module = html.indexOf('<script type="module"')
      if (recorder < 0 || recorder > module) {
        return reply({ error: 'javascript error', message: 'error recorder was not installed before modules' }, 500)
      }
      await fetchText(new URL('/examples/browser/demo.js', url))
      if (mode === 'missing-module') await fetchText(new URL('/examples/browser/missing-module.mjs', url))
      return reply(null)
    }
    if (path === '/session/fake-session/execute/sync' && req.method === 'POST') {
      let input = ''
      for await (const chunk of req) input += chunk
      const script = JSON.parse(input).script
      if (!script.includes('__browserCheckErrors') || !script.includes('canvas')) {
        return reply({ error: 'javascript error', message: 'status probe omitted diagnostics or canvas' }, 500)
      }
      if (mode === 'execute-error') return reply({ error: 'javascript error', message: 'probe failed' }, 500)
      return reply(JSON.stringify({ rendering: false, status: '20 passes', appContainer: true,
        canvas: { width: 10, height: 10, nonZeroPixels: 100 },
        pageErrors: mode === 'page-error' ? ['early module exception'] : [] }))
    }
    if (path === '/session/fake-session' && req.method === 'DELETE') {
      if (mode === 'delete-error') return reply({ error: 'unknown error', message: 'delete failed' }, 500)
      deleted = true
      return reply(null)
    }
    reply({ error: 'unknown command', message: path }, 404)
  })
  const port = await listen(driver)
  try {
    try {
      const result = await inspectSafari({ port, targetURL, requests, executable: 'safaridriver', timeout: 3000 })
      return { result, deleted }
    } catch (error) {
      return { error, deleted }
    }
  } finally {
    await close(driver)
    await close(web)
  }
}

test('Safari WebDriver checks rendered canvas and closes its own session', async () => {
  const { result, deleted } = await runFakeSafari('pass')
  assert.equal(result.pass, true)
  assert.equal(result.browser.product, 'Safari 26.5')
  assert.equal(result.httpStatus, 200)
  assert.deepEqual(result.moduleFailures, [])
  assert.deepEqual(result.pageErrors, [])
  assert.equal(deleted, true)
})

test('Safari WebDriver rejects an early page error even when canvas rendered', async () => {
  const { result, deleted } = await runFakeSafari('page-error')
  assert.equal(result.pass, false)
  assert.deepEqual(result.pageErrors, ['early module exception'])
  assert.equal(deleted, true)
})

test('Safari WebDriver rejects a failed same-origin module request', async () => {
  const { result, deleted } = await runFakeSafari('missing-module')
  assert.equal(result.pass, false)
  assert.match(result.moduleFailures.join(' '), /404.*missing-module\.mjs/)
  assert.equal(deleted, true)
})

test('Windows discovery accepts Chrome under Program Files without PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cpu-windows-chrome-'))
  try {
    const chrome = join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe')
    mkdirSync(dirname(chrome), { recursive: true })
    writeFileSync(chrome, 'binary')
    assert.equal(findExecutable(null, 'chromium', { platform: 'win32', env: { ProgramFiles: dir, PATH: '' } }), chrome)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Safari WebDriver closes its session after a probe command error', async () => {
  const { error, deleted } = await runFakeSafari('execute-error')
  assert.match(String(error), /probe failed/)
  assert.equal(deleted, true)
})

test('Safari WebDriver reports failure to close its session', async () => {
  const { error, deleted } = await runFakeSafari('delete-error')
  assert.match(String(error), /delete failed/)
  assert.equal(deleted, false)
})

test('missing Safari driver fails promptly without opening a test server', () => {
  const missing = join(tmpdir(), 'cpu-no-such-safaridriver')
  const result = spawnSync(process.execPath, ['scripts/browser-check.mjs', '--browser', 'safari', '--executable', missing],
    { cwd: root, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /BROWSER-CHECK .*no safari executable found/)
})
