#!/usr/bin/env node

/**
 * Headless browser floor check for the examples/browser demo.
 *
 * Serves a directory root (the repository checkout or an installed
 * `noisemaker-cpu` package root) over local HTTP, opens
 * `examples/browser/index.html` in a headless Chromium-family browser over the
 * raw DevTools protocol (no browser-automation dependency), waits for the
 * demo's first render to complete, and asserts that the demo initialized,
 * every same-origin module loaded, and the canvas carries a rendered frame.
 *
 * Options:
 *   --root <dir>        Directory to serve (default: repository root)
 *   --url <url>         Check this URL directly instead of serving --root
 *   --executable <path> Chromium-family binary (default: discovered on PATH)
 *   --timeout <ms>      Render wait budget (default: 120000)
 *
 * Prints one `BROWSER-CHECK {…}` JSON line. Exit 0 on pass, 1 on failure.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

function parseArgs(argv) {
  const args = { root: repoRoot, timeout: 120000 }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--root') args.root = resolve(argv[++i])
    else if (key === '--url') args.url = argv[++i]
    else if (key === '--executable') args.executable = argv[++i]
    else if (key === '--timeout') args.timeout = Number(argv[++i])
    else throw new Error(`unknown argument: ${key}`)
  }
  return args
}

function findChromiumExecutable(explicit) {
  const candidates = explicit ? [explicit] : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']
  const pathDirs = (process.env.PATH || '').split(':')
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (existsSync(candidate)) return resolve(candidate)
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

function serve(rootDir) {
  return new Promise((resolveServe, rejectServe) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        let pathname = decodeURIComponent(url.pathname)
        if (pathname.endsWith('/')) pathname += 'index.html'
        const resolved = normalize(join(rootDir, pathname))
        if (resolved !== rootDir && !resolved.startsWith(rootDir + sep)) {
          res.writeHead(403).end()
          return
        }
        const body = await readFile(resolved)
        res.writeHead(200, { 'content-type': MIME[resolved.slice(resolved.lastIndexOf('.'))] || 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(404).end()
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
  })
})()`

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const demoPath = '/examples/browser/index.html'

  let server = null
  let baseURL
  if (args.url) {
    baseURL = args.url
  } else {
    server = await serve(args.root)
    const { port } = server.address()
    baseURL = `http://127.0.0.1:${port}`
  }
  const targetURL = args.url || `${baseURL}${demoPath}`

  const executable = findChromiumExecutable(args.executable)
  if (!executable) {
    console.log(`BROWSER-CHECK ${JSON.stringify({ pass: false, error: 'no chromium-family executable found' })}`)
    process.exitCode = 1
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

await run()
