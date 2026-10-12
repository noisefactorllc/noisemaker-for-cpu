#!/usr/bin/env node

/**
 * Headless browser floor check for the examples/browser demo.
 *
 * Serves a directory root (the repository checkout or an installed
 * `noisemaker-cpu` package root) over local HTTP, opens
 * `examples/browser/index.html` in a Chromium-family browser over the raw
 * DevTools protocol, or in Safari over its built-in WebDriver, waits for the
 * demo's first render to complete, and asserts that the demo initialized,
 * every same-origin module loaded, and the canvas carries a rendered frame.
 *
 * Options:
 *   --root <dir>        Directory to serve (default: repository root)
 *   --url <url>         Check this URL directly instead of serving --root
 *   --browser <name>    chromium (default) or safari
 *   --executable <path> Browser or safaridriver binary (default: discovered)
 *   --timeout <ms>      Render wait budget (default: 120000)
 *
 * Prints one `BROWSER-CHECK {…}` JSON line. Exit 0 on pass, 1 on failure.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { mkdtempSync, statSync } from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, normalize, resolve, sep, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

function parseArgs(argv) {
  const args = { root: repoRoot, timeout: 120000, browser: 'chromium' }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--root') args.root = resolve(argv[++i])
    else if (key === '--url') args.url = argv[++i]
    else if (key === '--executable') args.executable = argv[++i]
    else if (key === '--browser') args.browser = argv[++i]
    else if (key === '--timeout') args.timeout = Number(argv[++i])
    else throw new Error(`unknown argument: ${key}`)
  }
  if (!['chromium', 'safari'].includes(args.browser)) throw new Error(`unsupported browser: ${args.browser}`)
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('timeout must be positive')
  return args
}

export function findExecutable(explicit, browser, { platform = process.platform, env = process.env } = {}) {
  const candidates = explicit ? [explicit] : browser === 'safari'
    ? ['/usr/bin/safaridriver', 'safaridriver']
    : [
      env.CHROME,
      platform === 'win32' && env.ProgramFiles && join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      platform === 'win32' && env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      platform === 'win32' && env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome.exe',
    ].filter(Boolean)
  const pathDirs = (env.PATH || '').split(platform === 'win32' ? ';' : delimiter)
  for (const candidate of candidates) {
    if (isAbsolute(candidate) || win32.isAbsolute(candidate) || /[\\/]/.test(candidate)) {
      try { if (statSync(candidate).isFile()) return resolve(candidate) } catch {}
      continue
    }
    for (const dir of pathDirs) {
      if (!dir) continue
      const full = join(dir, candidate)
      try {
        if (statSync(full).isFile()) return full
      } catch {}
    }
  }
  return null
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const SAFARI_ERROR_RECORDER = `<script>
window.__browserCheckErrors = [];
window.addEventListener('error', event => {
  window.__browserCheckErrors.push(String(event.message || event.error || 'page error').slice(0, 300));
});
window.addEventListener('unhandledrejection', event => {
  window.__browserCheckErrors.push(String(event.reason || 'unhandled rejection').slice(0, 300));
});
</script>`

export function serve(rootDir, { safari = false, requests = [] } = {}) {
  return new Promise((resolveServe, rejectServe) => {
    const server = createServer(async (req, res) => {
      const requestURL = new URL(req.url, 'http://127.0.0.1')
      const finish = (status) => { requests.push({ path: requestURL.pathname, status }) }
      try {
        let pathname = decodeURIComponent(requestURL.pathname)
        if (pathname.endsWith('/')) pathname += 'index.html'
        const resolved = normalize(join(rootDir, pathname))
        if (resolved !== rootDir && !resolved.startsWith(rootDir + sep)) {
          res.writeHead(403).end()
          finish(403)
          return
        }
        let body = await readFile(resolved)
        if (safari && requestURL.pathname === '/examples/browser/index.html') {
          const html = body.toString('utf8')
          if (!html.includes('<script type="module"')) throw new Error('demo module tag missing')
          body = Buffer.from(html.replace('<script type="module"', `${SAFARI_ERROR_RECORDER}\n<script type="module"`))
        }
        res.writeHead(200, { 'content-type': MIME[resolved.slice(resolved.lastIndexOf('.'))] || 'application/octet-stream' })
        res.end(body)
        finish(200)
      } catch {
        res.writeHead(404).end()
        finish(404)
      }
    })
    server.on('error', rejectServe)
    server.listen(0, '127.0.0.1', () => resolveServe(server))
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url, attempts) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch {}
    await sleep(250)
  }
  throw new Error(`no DevTools endpoint at ${url}`)
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.handlers = []
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
        return
      }
      for (const handler of this.handlers) handler(message)
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(payload))
    })
  }

  close() {
    try { this.ws.close() } catch {}
  }
}

const STATUS_PROBE = `(() => {
  const status = (document.getElementById('status') && document.getElementById('status').textContent) || ''
  const canvas = document.getElementById('canvas')
  let canvasStats = null
  if (canvas && canvas.width && canvas.height) {
    try {
      const context = canvas.getContext('2d')
      if (context) {
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        let nonZero = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] || data[i + 1] || data[i + 2] || data[i + 3]) nonZero++
        }
        canvasStats = { width: canvas.width, height: canvas.height, nonZeroPixels: nonZero }
      }
    } catch (error) {
      canvasStats = { error: String(error) }
    }
  }
  const app = document.getElementById('app-container')
  return JSON.stringify({
    rendering: document.body.classList.contains('rendering'),
    status: status.trim(),
    appContainer: !!app && app.offsetParent !== null,
    canvas: canvasStats,
    pageErrors: window.__browserCheckErrors || [],
  })
})()`

async function availablePort() {
  const server = createTcpServer()
  await new Promise((resolvePort, rejectPort) => {
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', resolvePort)
  })
  const port = server.address().port
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function webdriverRequest(port, path, method = 'GET', body, timeout = 15000) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const result = await response.json()
  if (!response.ok || result.value?.error) {
    throw new Error(`WebDriver ${method} ${path}: ${result.value?.message || response.status}`)
  }
  return result.value
}

export async function inspectSafari({ port, targetURL, requests, executable, timeout }) {
  let sessionId
  let primaryError
  try {
    const session = await webdriverRequest(port, '/session', 'POST', {
      capabilities: { alwaysMatch: { browserName: 'safari', pageLoadStrategy: 'eager' } },
    }, 30000)
    sessionId = session.sessionId
    if (!sessionId) throw new Error('safaridriver returned no session id')
    await webdriverRequest(port, `/session/${encodeURIComponent(sessionId)}/url`, 'POST', { url: targetURL }, 30000)

    const deadline = Date.now() + timeout
    let probe = null
    while (Date.now() < deadline) {
      const value = await webdriverRequest(port, `/session/${encodeURIComponent(sessionId)}/execute/sync`, 'POST', {
        script: `return ${STATUS_PROBE};`, args: [],
      })
      probe = JSON.parse(value)
      if (!probe.rendering && /passes/.test(probe.status)) break
      await sleep(500)
    }
    const mainFrameStatus = requests.find((request) => request.path === '/examples/browser/index.html')?.status ?? null
    const moduleFailures = requests.filter((request) => request.status >= 400)
      .map((request) => `${request.status} ${new URL(request.path, targetURL)}`)
    const pageErrors = probe?.pageErrors || []
    const renderCompleted = !!probe && /passes/.test(probe.status)
    const canvas = probe?.canvas || null
    const nonBlank = !!canvas && !canvas.error && canvas.nonZeroPixels > canvas.width * canvas.height * 0.5
    const pass = renderCompleted && nonBlank && probe.appContainer && mainFrameStatus === 200 &&
      moduleFailures.length === 0 && pageErrors.length === 0
    return {
      pass,
      browser: { product: `Safari ${session.capabilities?.browserVersion || 'unknown'}`, executable },
      platform: process.platform,
      url: targetURL,
      httpStatus: mainFrameStatus,
      render: { completed: renderCompleted, statusText: probe ? probe.status.slice(0, 120) : null },
      canvas,
      appContainer: !!probe && probe.appContainer,
      moduleFailures,
      pageErrors,
    }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (sessionId) {
      try {
        await webdriverRequest(port, `/session/${encodeURIComponent(sessionId)}`, 'DELETE', undefined, 10000)
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError
        throw new AggregateError([primaryError, cleanupError], 'Safari check and session cleanup failed')
      }
    }
  }
}

async function runSafari(args, executable, server, targetURL, requests) {
  let driver
  let driverError = ''
  let driverSpawnError = null
  try {
    const port = await availablePort()
    driver = spawn(executable, ['-p', String(port)], { stdio: ['ignore', 'ignore', 'pipe'] })
    driver.stderr.on('data', (data) => { driverError = (driverError + String(data)).slice(-1000) })
    driver.on('error', (error) => { driverSpawnError = error })
    const readyUntil = Date.now() + 30000
    let ready = false
    while (Date.now() < readyUntil) {
      if (driverSpawnError) throw driverSpawnError
      if (driver.exitCode !== null) throw new Error(`safaridriver exited early: ${driverError}`)
      try {
        const status = await webdriverRequest(port, '/status', 'GET', undefined, 1000)
        if (status.ready) { ready = true; break }
      } catch {}
      await sleep(250)
    }
    if (!ready) throw new Error(`safaridriver did not become ready: ${driverError}`)
    const result = await inspectSafari({ port, targetURL, requests, executable, timeout: args.timeout })
    console.log(`BROWSER-CHECK ${JSON.stringify(result)}`)
    process.exitCode = result.pass ? 0 : 1
  } catch (error) {
    console.log(`BROWSER-CHECK ${JSON.stringify({ pass: false, error: String(error).slice(0, 500) })}`)
    process.exitCode = 1
  } finally {
    if (driver) {
      const exited = () => driver.exitCode !== null || driver.signalCode !== null
      if (!exited()) {
        const exit = new Promise((resolveExit) => driver.once('exit', resolveExit))
        driver.kill('SIGTERM')
        await Promise.race([exit, sleep(5000)])
      }
      if (!exited()) driver.kill('SIGKILL')
    }
    await new Promise((resolveClose) => server.close(resolveClose))
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const demoPath = '/examples/browser/index.html'

  if (args.browser === 'safari' && args.url) {
    console.log(`BROWSER-CHECK ${JSON.stringify({ pass: false, error: 'Safari --url cannot capture pre-module page errors; use --root' })}`)
    process.exitCode = 1
    return
  }

  const executable = findExecutable(args.executable, args.browser)
  if (!executable) {
    console.log(`BROWSER-CHECK ${JSON.stringify({ pass: false, error: `no ${args.browser} executable found` })}`)
    process.exitCode = 1
    return
  }

  let server = null
  let baseURL
  const requests = []
  if (args.url) {
    baseURL = args.url
  } else {
    server = await serve(args.root, { safari: args.browser === 'safari', requests })
    const { port } = server.address()
    baseURL = `http://127.0.0.1:${port}`
  }
  const targetURL = args.url || `${baseURL}${demoPath}`

  if (args.browser === 'safari') {
    await runSafari(args, executable, server, targetURL, requests)
    return
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'noisemaker-browser-check-'))
  const browser = spawn(executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  const cleanup = () => {
    try { browser.kill('SIGKILL') } catch {}
    try { if (server) server.close() } catch {}
  }
  process.on('exit', cleanup)

  try {
    const port = await new Promise((resolvePort, rejectPort) => {
      let buffer = ''
      const timer = setTimeout(() => rejectPort(new Error('browser produced no DevTools port')), 30000)
      browser.stderr.on('data', (chunk) => {
        buffer += String(chunk)
        const match = buffer.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)
        if (match) {
          clearTimeout(timer)
          resolvePort(Number(match[1]))
        }
      })
      browser.on('exit', (code) => { clearTimeout(timer); rejectPort(new Error(`browser exited early (code ${code})`)) })
    })

    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`, 20)
    const ws = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolveOpen, rejectOpen) => {
      ws.onopen = resolveOpen
      ws.onerror = () => rejectOpen(new Error('DevTools WebSocket failed'))
    })
    const cdp = new Cdp(ws)

    const failures = []
    const pageErrors = []
    const pendingRequests = new Map()
    let sessionPath = null
    let mainFrameStatus = null

    const onEvent = (message) => {
      if (!message.method) return
      if (sessionPath && message.sessionId !== sessionPath) return
      if (message.method === 'Network.requestWillBeSent') {
        pendingRequests.set(message.params.requestId, message.params.request.url)
      } else if (message.method === 'Network.responseReceived') {
        const { status, url } = message.params.response
        if (message.params.type === 'Document' && url.startsWith(baseURL)) mainFrameStatus = status
        if (url.startsWith(baseURL) && status >= 400) failures.push(`${status} ${url}`)
      } else if (message.method === 'Network.loadingFailed') {
        const url = pendingRequests.get(message.params.requestId) || ''
        if (url.startsWith(baseURL)) failures.push(`failed ${url} :: ${message.params.errorText || 'network error'}`)
      } else if (message.method === 'Runtime.exceptionThrown') {
        pageErrors.push(String(message.params.exceptionDetails.text || message.params.exceptionDetails.exception?.description || 'exception').slice(0, 300))
      }
    }
    cdp.handlers.push(onEvent)

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    sessionPath = sessionId
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Network.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)

    const nav = await cdp.send('Page.navigate', { url: targetURL }, sessionId)
    if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`)

    const deadline = Date.now() + args.timeout
    let probe = null
    while (Date.now() < deadline) {
      const evaluate = await cdp.send('Runtime.evaluate', { expression: STATUS_PROBE, returnByValue: true }, sessionId)
      probe = JSON.parse(evaluate.result.value)
      if (!probe.rendering && /passes/.test(probe.status)) break
      await sleep(500)
    }

    const { product, userAgent } = await cdp.send('Browser.getVersion')
    const renderCompleted = !!probe && /passes/.test(probe.status)
    const canvas = probe?.canvas || null
    const nonBlank = !!canvas && !canvas.error && canvas.nonZeroPixels > canvas.width * canvas.height * 0.5
    const pass = renderCompleted && nonBlank && probe.appContainer && failures.length === 0 && pageErrors.length === 0

    console.log(`BROWSER-CHECK ${JSON.stringify({
      pass,
      browser: { product, userAgent, executable },
      platform: `${process.platform}`,
      url: targetURL,
      httpStatus: mainFrameStatus,
      render: { completed: renderCompleted, statusText: probe ? probe.status.slice(0, 120) : null },
      canvas,
      appContainer: !!probe && probe.appContainer,
      moduleFailures: failures,
      pageErrors,
    })}`)
    process.exitCode = pass ? 0 : 1
  } catch (error) {
    console.log(`BROWSER-CHECK ${JSON.stringify({ pass: false, error: String(error).slice(0, 500) })}`)
    process.exitCode = 1
  } finally {
    cleanup()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run()
