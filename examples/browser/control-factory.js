/**
 * Maps an effect param spec to a UI widget.
 *
 * `widgetKindForParam` is pure (unit-tested in Node). `createControl` builds the
 * DOM row and is exercised in the browser. Widgets use handfish custom elements
 * when they are registered (`<slider-value>`, `<select-dropdown>`) and the
 * vendored `<toggle-switch>`; where a handfish element is absent it degrades to a
 * native control so the demo keeps working. Colors use a native `<input
 * type="color">` for dependable hex I/O.
 */

export function widgetKindForParam(spec) {
  if (spec.type === 'bool' || spec.type === 'boolean') return 'toggle'
  if (spec.type === 'color') return 'color'
  if (spec.type === 'surface') return 'omit'
  if (spec.type === 'vec2' || spec.type === 'vec3' || spec.type === 'vec4') return 'vector'
  if (spec.choices) return 'dropdown'
  if (spec.type === 'enum' || spec.type === 'member' || spec.type === 'palette') return 'dropdown'
  if (spec.type === 'string') return 'text'
  if (spec.type === 'float' || spec.type === 'int') return 'slider'
  return 'text'
}

const clamp01 = (n) => Math.max(0, Math.min(1, n))
const to255 = (c) => Math.max(0, Math.min(255, Math.round(c * 255)))

export function rgbToHex(arr) {
  const [r, g, b] = arr
  return `#${[r, g, b].map((c) => to255(c).toString(16).padStart(2, '0')).join('')}`
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => clamp01(parseInt(h.slice(i, i + 2), 16) / 255))
}

const displayValue = (kind, value) => {
  if (kind === 'toggle') return value ? 'on' : 'off'
  if (kind === 'color') return rgbToHex(value)
  if (kind === 'vector') return value.join(', ')
  return String(value)
}

const has = (tag) => Boolean(typeof customElements !== 'undefined' && customElements.get(tag))

/**
 * @param {string} name       param name
 * @param {object} spec       param spec ({type, default, min?, max?, choices?})
 * @param {*}      value      current state value
 * @param {(v:*)=>void} onChange called with the new value on every edit
 * @returns {{element: HTMLElement, getValue: ()=>*, setValue: (v:*)=>void}}
 */
export function createControl(name, spec, value, onChange) {
  const kind = widgetKindForParam(spec)

  const row = document.createElement('div')
  row.className = 'control-group'
  const label = document.createElement('span')
  label.className = 'control-label'
  label.textContent = name
  const valueEl = document.createElement('span')
  valueEl.className = 'control-value'

  let getValue = () => value
  let setValue = () => {}

  const commit = (v) => {
    value = v
    valueEl.textContent = displayValue(kind, v)
    onChange(v)
  }

  let widget

  if (kind === 'slider') {
    const isInt = spec.type === 'int'
    const min = spec.min ?? 0
    const max = spec.max ?? (spec.min !== undefined ? spec.min + 1 : 1)
    const step = isInt ? 1 : Math.max((max - min) / 100, 0.001)
    if (has('slider-value')) {
      widget = document.createElement('slider-value')
      widget.setAttribute('min', String(min))
      widget.setAttribute('max', String(max))
      widget.setAttribute('step', String(step))
      widget.setAttribute('value', String(value))
      widget.setAttribute('type', isInt ? 'int' : 'float')
    } else {
      widget = document.createElement('input')
      widget.type = 'range'
      widget.min = String(min)
      widget.max = String(max)
      widget.step = String(step)
      widget.value = String(value)
      widget.className = 'hf-range'
    }
    const read = () => {
      const n = Number(widget.value)
      return isInt ? Math.round(n) : n
    }
    getValue = read
    setValue = (v) => {
      widget.value = String(v)
      valueEl.textContent = displayValue(kind, v)
    }
    widget.addEventListener('input', () => commit(read()))
    widget.addEventListener('change', () => commit(read()))
  } else if (kind === 'dropdown') {
    const keys = Object.keys(spec.choices)
    if (has('select-dropdown')) {
      widget = document.createElement('select-dropdown')
      // Configure after the caller appends it (custom element must be connected
      // for setOptions to reach its internal DOM).
      queueMicrotask(() => {
        if (typeof widget.setOptions === 'function') {
          widget.setOptions(keys.map((k) => ({ value: k, text: k })))
        }
        widget.value = value
      })
    } else {
      widget = document.createElement('select')
      widget.className = 'hf-select'
      for (const k of keys) {
        const opt = document.createElement('option')
        opt.value = k
        opt.textContent = k
        widget.appendChild(opt)
      }
      widget.value = value
    }
    getValue = () => widget.value
    setValue = (v) => {
      widget.value = v
      valueEl.textContent = displayValue(kind, v)
    }
    widget.addEventListener('change', () => commit(widget.value))
  } else if (kind === 'toggle') {
    widget = document.createElement('toggle-switch')
    widget.checked = Boolean(value)
    getValue = () => widget.checked
    setValue = (v) => {
      widget.checked = Boolean(v)
      valueEl.textContent = displayValue(kind, Boolean(v))
    }
    widget.addEventListener('change', () => commit(widget.checked))
  } else if (kind === 'color') {
    widget = document.createElement('input')
    widget.type = 'color'
    widget.className = 'hf-color'
    widget.value = rgbToHex(value)
    getValue = () => hexToRgb(widget.value)
    setValue = (v) => {
      widget.value = rgbToHex(v)
      valueEl.textContent = displayValue(kind, v)
    }
    const read = () => hexToRgb(widget.value)
    widget.addEventListener('input', () => commit(read()))
    widget.addEventListener('change', () => commit(read()))
  } else if (kind === 'vector') {
    const width = Number(spec.type.at(-1))
    widget = document.createElement('div')
    widget.className = 'vector-inputs'
    const inputs = []
    for (let i = 0; i < width; i += 1) {
      const input = document.createElement('input')
      input.type = 'number'
      input.className = 'hf-number'
      input.value = String(value[i] ?? 0)
      input.step = 'any'
      inputs.push(input)
      widget.appendChild(input)
    }
    const read = () => inputs.map((el) => Number(el.value))
    getValue = read
    setValue = (v) => {
      v.forEach((n, i) => { if (inputs[i]) inputs[i].value = String(n) })
      valueEl.textContent = displayValue(kind, v)
    }
    inputs.forEach((el) => el.addEventListener('input', () => commit(read())))
  } else {
    // text (freeform string)
    widget = document.createElement('input')
    widget.type = 'text'
    widget.className = 'hf-input'
    widget.value = String(value ?? '')
    getValue = () => widget.value
    setValue = (v) => {
      widget.value = String(v ?? '')
      valueEl.textContent = displayValue(kind, v)
    }
    widget.addEventListener('input', () => commit(widget.value))
  }

  widget.classList?.add('control-widget')
  valueEl.textContent = displayValue(kind, value)

  row.append(label, widget, valueEl)
  return { element: row, getValue, setValue }
}
