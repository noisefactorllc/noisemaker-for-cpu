/**
 * Noisemaker CPU Demo — app wiring.
 *
 * Builds an effect pipeline (one generator + an ordered filter stack) from the
 * engine's own schema registry, renders it on the CPU via renderToCanvasAsync,
 * and mirrors the generated Polymorphic DSL in an editable code view. No
 * animation: renders happen on change; Time is a manual slider.
 *
 * Widget components: handfish (`<slider-value>`, `<select-dropdown>`) load from
 * the CDN; `<effect-select>` and `<toggle-switch>` are vendored locally. If the
 * handfish CDN is unavailable, controls fall back to native equivalents.
 */

import './effect-select.js'
import './toggle-switch.js'

import {
  CpuRenderer,
  createDefaultRegistry,
  kernels,
  kernelFactories,
  renderToCanvasAsync,
} from 'noisemaker-cpu'
import { buildDsl, stateDefault, namespaceOf, funcOf } from './pipeline.js'
import { widgetKindForParam, createControl } from './control-factory.js'

const has = (tag) => typeof customElements !== 'undefined' && Boolean(customElements.get(tag))
const $ = (id) => document.getElementById(id)

const registry = createDefaultRegistry()
const renderer = new CpuRenderer({ registry, kernels, kernelFactories })
const effects = registry.list()
const generators = effects.filter((e) => e.kind === 'generator')
const filterEffects = effects.filter((e) => e.kind === 'filter')

const state = {
  generator: { id: 'synth/noise', values: {} },
  filters: [],
  seed: 11,
  time: 0,
  resolution: 256,
}

let els
let running = false
let queued = false
let rawMode = false

const effectOptions = (list) => list.map((d) => ({ namespace: d.namespace, name: d.func, description: d.description }))
const defOf = (id) => registry.get(namespaceOf(id), funcOf(id))

// ---------- rendering ----------

function setStatus(text, isError = false) {
  els.status.textContent = text
  els.status.classList.toggle('error', isError)
  els.status.style.display = 'block'
}

function showError(message) {
  els.errorBanner.textContent = message
  setStatus(message, true)
}

function clearError() {
  els.errorBanner.textContent = ''
}

function syncCodeView() {
  if (rawMode) return
  els.dslEditor.value = buildDsl(state, registry)
}

function scheduleRender() {
  syncCodeView()
  if (running) {
    queued = true
    return
  }
  running = true
  ;(async () => {
    do {
      queued = false
      await runRender()
    } while (queued)
    running = false
  })()
}

async function runRender() {
  const dsl = rawMode ? els.dslEditor.value : buildDsl(state, registry)
  document.body.classList.add('rendering')
  let tiles = 0
  els.loadingOverlay.textContent = 'rendering…'
  try {
    const result = await renderToCanvasAsync(els.canvas, dsl, {
      renderer,
      width: state.resolution,
      height: state.resolution,
      seed: state.seed,
      time: state.time,
      tileRows: 32,
      scheduler: async () => {
        tiles += 1
        els.loadingOverlay.textContent = `rendering… ${tiles}`
        await new Promise(requestAnimationFrame)
      },
    })
    setStatus(
      `${result.stats.passes} passes · ${result.stats.pixels.toLocaleString()} px · ${result.elapsedMs.toFixed(0)} ms · seed ${state.seed}`,
    )
    clearError()
  } catch (err) {
    showError(String((err && err.message) || err))
  } finally {
    document.body.classList.remove('rendering')
  }
}

/** Any pipeline edit returns to pipeline-driven mode, regenerates the DSL, and re-renders. */
function commitPipeline() {
  rawMode = false
  document.body.classList.remove('raw-dsl')
  els.dslMode.textContent = ''
  scheduleRender()
}

// ---------- controls ----------

function buildControls(def, values) {
  const grid = document.createElement('div')
  grid.className = 'controls-grid'
  for (const name of def.paramNames) {
    if (name === 'seed') continue // render-level seed drives all effect seeds
    const spec = def.params[name]
    if (widgetKindForParam(spec) === 'omit') continue // surface inputs -> code view
    const current = name in values ? values[name] : stateDefault(spec)
    const { element } = createControl(name, spec, current, (v) => {
      values[name] = v
      commitPipeline()
    })
    grid.appendChild(element)
  }
  return grid
}

function actionBtn(text, tip, onClick, active = false) {
  const b = document.createElement('button')
  b.className = 'hf-action-btn tooltip'
  if (active) b.classList.add('active')
  b.textContent = text
  b.setAttribute('data-title', tip)
  b.setAttribute('aria-label', tip)
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return b
}

function makePanel(titleText, { skipped = false } = {}) {
  const panel = document.createElement('div')
  panel.className = 'shader-effect hf-panel'
  if (skipped) panel.classList.add('skipped')

  const title = document.createElement('div')
  title.className = 'effect-title'
  const label = document.createElement('span')
  label.className = 'effect-title-text'
  label.textContent = titleText
  const spacer = document.createElement('span')
  spacer.style.flex = '1'
  const actions = document.createElement('span')
  actions.className = 'effect-actions'
  title.append(label, spacer, actions)

  const content = document.createElement('div')
  content.className = 'effect-content'
  panel.append(title, content)

  title.addEventListener('click', (e) => {
    if (e.target.closest('button')) return
    panel.classList.toggle('collapsed')
  })
  return { panel, content, actions }
}

function renderPipeline() {
  els.container.innerHTML = ''

  // Generator panel
  const g = makePanel('generator')
  els.container.appendChild(g.panel)
  const gsel = document.createElement('effect-select')
  g.content.appendChild(gsel) // connect before setEffects
  gsel.setEffects(effectOptions(generators))
  gsel.value = state.generator.id // may self-dispatch change; no listener attached yet
  gsel.addEventListener('change', () => {
    if (!gsel.value || gsel.value === state.generator.id) return
    state.generator = { id: gsel.value, values: {} }
    renderPipeline()
    commitPipeline()
  })
  g.content.appendChild(buildControls(defOf(state.generator.id), state.generator.values))

  // Filter panels
  state.filters.forEach((filter, index) => {
    const f = makePanel(funcOf(filter.id), { skipped: filter.skipped })
    f.actions.append(
      actionBtn('skip', 'Skip this effect', () => {
        filter.skipped = !filter.skipped
        renderPipeline()
        commitPipeline()
      }, filter.skipped),
      actionBtn('↑', 'Move up', () => {
        if (index === 0) return
        ;[state.filters[index - 1], state.filters[index]] = [state.filters[index], state.filters[index - 1]]
        renderPipeline()
        commitPipeline()
      }),
      actionBtn('↓', 'Move down', () => {
        if (index === state.filters.length - 1) return
        ;[state.filters[index + 1], state.filters[index]] = [state.filters[index], state.filters[index + 1]]
        renderPipeline()
        commitPipeline()
      }),
      actionBtn('reset', 'Reset parameters', () => {
        filter.values = {}
        renderPipeline()
        commitPipeline()
      }),
      actionBtn('✕', 'Remove', () => {
        state.filters.splice(index, 1)
        renderPipeline()
        commitPipeline()
      }),
    )
    els.container.appendChild(f.panel)
    f.content.appendChild(buildControls(defOf(filter.id), filter.values))
  })
}

function buildTimeControl() {
  const slot = els.timeControl
  slot.innerHTML = ''
  const valueEl = document.createElement('span')
  valueEl.className = 'control-value'
  let widget
  if (has('slider-value')) {
    widget = document.createElement('slider-value')
    widget.setAttribute('min', '0')
    widget.setAttribute('max', '1')
    widget.setAttribute('step', '0.01')
    widget.setAttribute('value', String(state.time))
    widget.setAttribute('type', 'float')
  } else {
    widget = document.createElement('input')
    widget.type = 'range'
    widget.min = '0'
    widget.max = '1'
    widget.step = '0.01'
    widget.value = String(state.time)
    widget.className = 'hf-range'
  }
  widget.style.flex = '1'
  const onInput = () => {
    state.time = Number(widget.value)
    valueEl.textContent = state.time.toFixed(2)
    commitPipeline()
  }
  widget.addEventListener('input', onInput)
  widget.addEventListener('change', onInput)
  valueEl.textContent = Number(state.time).toFixed(2)
  slot.append(widget, valueEl)
}

// ---------- global wiring ----------

function wireControls() {
  els.resolution.value = String(state.resolution)
  els.resolution.addEventListener('change', () => {
    state.resolution = Number(els.resolution.value)
    commitPipeline()
  })

  els.seed.value = String(state.seed)
  els.seed.addEventListener('input', () => {
    state.seed = Number(els.seed.value) || 0
    commitPipeline()
  })
  els.seedRandomize.addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * 1000) + 1
    els.seed.value = String(state.seed)
    commitPipeline()
  })

  els.codeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    els.codeEffect.classList.toggle('collapsed')
  })
  els.pipelineTitle.addEventListener('click', (e) => {
    if (e.target.closest('button')) return
    els.pipelineEffect.classList.toggle('collapsed')
  })
  els.codeTitle.addEventListener('click', (e) => {
    if (e.target.closest('button')) return
    els.codeEffect.classList.toggle('collapsed')
  })

  els.dslRun.addEventListener('click', () => {
    rawMode = true
    document.body.classList.add('raw-dsl')
    els.dslMode.textContent = 'raw dsl'
    scheduleRender()
  })
  els.dslRevert.addEventListener('click', () => commitPipeline())

  els.addEffect.setEffects(effectOptions(filterEffects))
  els.addEffect.addEventListener('change', () => {
    const id = els.addEffect.value
    if (!id) return
    state.filters.push({ id, values: {}, skipped: false })
    els.addEffect.value = '' // reset so the same filter can be added again
    renderPipeline()
    commitPipeline()
  })

  wireMobileDivider()
}

function wireMobileDivider() {
  const divider = els.mobileDivider
  if (!divider) return
  let dragging = false
  const setFraction = (clientY) => {
    const f = Math.max(0.15, Math.min(0.85, clientY / window.innerHeight))
    document.documentElement.style.setProperty('--mobile-canvas-fraction', String(f))
  }
  divider.addEventListener('pointerdown', (e) => {
    dragging = true
    divider.setPointerCapture(e.pointerId)
  })
  divider.addEventListener('pointermove', (e) => {
    if (dragging) setFraction(e.clientY)
  })
  divider.addEventListener('pointerup', (e) => {
    dragging = false
    if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId)
  })
}

// ---------- init ----------

async function init() {
  try {
    await import('https://handfish.noisefactor.io/0.9.0/handfish.esm.js')
  } catch (err) {
    console.warn('[demo] handfish CDN unavailable; using native fallbacks', err)
  }

  els = {
    loading: $('loading'),
    app: $('app-container'),
    container: $('effect-controls-container'),
    addEffect: $('add-effect'),
    pipelineEffect: $('pipeline-effect'),
    pipelineTitle: $('pipeline-title'),
    codeEffect: $('code-effect'),
    codeTitle: $('code-title'),
    codeBtn: $('code-btn'),
    dslEditor: $('dsl-editor'),
    dslRun: $('dsl-run'),
    dslRevert: $('dsl-revert'),
    dslMode: $('dsl-mode'),
    resolution: $('resolution'),
    seed: $('seed'),
    seedRandomize: $('seed-randomize'),
    timeControl: $('time-control'),
    canvas: $('canvas'),
    loadingOverlay: $('loadingOverlay'),
    errorBanner: $('errorBanner'),
    status: $('status'),
    mobileDivider: $('mobile-divider'),
  }

  buildTimeControl()
  wireControls()
  renderPipeline()

  els.loading.style.display = 'none'
  els.app.style.display = ''

  scheduleRender()
}

init()
