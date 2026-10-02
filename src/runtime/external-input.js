// CPU external-input state for the reactive (MIDI/audio) effects.
//
// GAP-003 closing contract: `synth/roll`, `synth/scope` and `synth/spectrum` are
// counted as expected parity cases, so the port needs the external-input state the
// authority pipeline feeds them. This module mirrors the rendering-relevant subset
// of the upstream `MidiState`/`AudioState` (shaders/src/runtime/external-input.js):
// per-channel key velocities and gate, CC/pitch-bend/pressure storage, the 24-PPQ
// clock counter, and the packed 128x16 note-grid texture the `roll` kernel samples.
// It is deliberately deterministic: no Web MIDI ports, no timing — fixtures feed
// raw message bytes through `handleMessage` exactly like the authority harness does.
//
// `parseOBJ`/`packMeshDataForTextures` port the upstream obj-parser (same file
// layout, same fan triangulation with reversed winding, same RGBA texture packing)
// so `render/meshLoader`/`render/meshRender` consume identical mesh-texture data.

const UNROUTED = 0

export class MidiChannelState {
  constructor() {
    this.key = 0
    this.velocity = 0
    this.gate = 0
    this.keys = new Uint8Array(128)
    this.cc = new Uint8Array(128)
    this.pitchBend = 8192
    this.pressure = 0
    this.polyPressure = new Uint8Array(128)
    this.program = 0
  }

  noteOn(key, velocity) {
    this.key = key
    this.velocity = velocity
    this.gate = 1
    this.keys[key] = velocity
  }

  noteOff(key) {
    this.gate = 0
    if (key === undefined) {
      this.keys.fill(0)
      return
    }
    this.keys[key] = 0
    this.polyPressure[key] = 0
  }

  controlChange(controller, value) {
    if (!Number.isInteger(controller) || controller < 0 || controller > 127 ||
        !Number.isInteger(value) || value < 0 || value > 127) return
    this.cc[controller] = value
    if (controller === 120 || controller === 123) {
      this.gate = 0
      this.keys.fill(0)
    } else if (controller === 121) {
      for (let cc = 0; cc < 128; cc++) this.cc[cc] = cc === 11 ? 127 : 0
      this.pitchBend = 8192
      this.pressure = 0
      this.polyPressure.fill(0)
    }
  }

  reset() {
    this.key = 0
    this.velocity = 0
    this.gate = 0
    this.keys.fill(0)
    this.cc.fill(0)
    this.pitchBend = 8192
    this.pressure = 0
    this.polyPressure.fill(0)
    this.program = 0
  }
}

export class MidiState {
  constructor() {
    this.channels = {}
    for (let i = 1; i <= 16; i++) this.channels[i] = new MidiChannelState()
    // MIDI clock pulse count (24 PPQ)
    this.clockCount = 0
    // Note grid texture data: 128 keys x 16 channels x RGBA. Row order matches the
    // upstream upload: row 0 is channel 1, R = velocity (0-1), G = gate, B = A = 0.
    this.noteGrid = new Float32Array(128 * 16 * 4)
  }

  getChannel(channel) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 16) return null
    return this.channels[channel]
  }

  updateNoteGrid() {
    for (let ch = 0; ch < 16; ch++) {
      const keys = this.channels[ch + 1].keys
      const rowOffset = ch * 128 * 4
      for (let k = 0; k < 128; k++) {
        const v = keys[k]
        const offset = rowOffset + k * 4
        this.noteGrid[offset] = v > 0 ? v / 127 : 0 // R: velocity
        this.noteGrid[offset + 1] = v > 0 ? 1 : 0 // G: gate
        // B and A stay 0
      }
    }
  }

  reset() {
    for (let i = 1; i <= 16; i++) this.channels[i].reset()
    this.clockCount = 0
    this.noteGrid.fill(0)
  }

  /**
   * Process a raw MIDI message: [status, data1, data2]. Mirrors the upstream
   * routing for the message types that reach rendered state; unknown status
   * bytes are ignored (UNROUTED marker only aids debugging).
   * @param {Uint8Array|number[]} data
   * @returns {number} 0 when routed, -1 when the status byte is unhandled
   */
  handleMessage(data) {
    if (!data || data.length < 1) return UNROUTED
    const status = data[0]
    if (status === 0xf8) {
      this.clockCount++
      return 0
    }
    if (status === 0xff) {
      this.reset()
      return 0
    }
    const key = data[1]
    const velocity = data[2]
    const channel = (status & 0x0f) + 1
    const messageType = status & 0xf0
    if (messageType === 0xf0) return -1
    if (!Number.isInteger(key) || key < 0 || key > 127) return -1
    if (messageType !== 0xd0 && (!Number.isInteger(velocity) || velocity < 0 || velocity > 127)) return -1
    const channelState = this.getChannel(channel)
    if (!channelState) return -1
    if (messageType === 0x90 && velocity > 0) {
      channelState.noteOn(key, velocity)
      return 0
    }
    if (messageType === 0x80 || (messageType === 0x90 && velocity === 0)) {
      channelState.noteOff(key)
      return 0
    }
    if (messageType === 0xa0) {
      channelState.polyPressure[key] = velocity
      return 0
    }
    if (messageType === 0xb0) {
      channelState.controlChange(key, velocity)
      return 0
    }
    if (messageType === 0xc0) {
      channelState.program = key
      return 0
    }
    if (messageType === 0xd0) {
      channelState.pressure = key
      return 0
    }
    if (messageType === 0xe0) {
      channelState.pitchBend = key | (velocity << 7)
      return 0
    }
    return -1
  }
}

/**
 * Audio analysis state for the reactive synth effects. Upstream feeds the
 * pipeline 128-float waveform and spectrum arrays normalized to 0-1; fixtures
 * construct this state directly with deterministic arrays.
 */
export class AudioState {
  constructor() {
    this.waveform = new Float32Array(128)
    this.spectrum = new Float32Array(128)
  }

  setWaveform(values) {
    if (values.length !== 128) throw new RangeError('audio waveform requires exactly 128 samples')
    this.waveform.set(values)
  }

  setSpectrum(values) {
    if (values.length !== 128) throw new RangeError('audio spectrum requires exactly 128 bins')
    this.spectrum.set(values)
  }
}

/**
 * Parse Wavefront OBJ text into de-indexed triangle-soup vertex data.
 * Port of the upstream obj-parser `parseOBJ`: fan triangulation for faces with
 * more than three vertices, reversed winding (OBJ CW to GL CCW), per-face normal
 * fallback when a vertex carries no `vn` reference.
 */
export function parseOBJ(objText) {
  const rawPositions = []
  const rawNormals = []
  const rawUVs = []
  const positions = []
  const normals = []
  const uvs = []

  const lines = objText.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const cmd = parts[0]
    if (cmd === 'v') {
      rawPositions.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0])
    } else if (cmd === 'vn') {
      rawNormals.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0])
    } else if (cmd === 'vt') {
      rawUVs.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0])
    } else if (cmd === 'f') {
      const faceVerts = []
      for (let i = 1; i < parts.length; i++) {
        const indices = parts[i].split('/')
        const vIdx = parseInt(indices[0], 10) - 1
        const vtIdx = indices[1] ? parseInt(indices[1], 10) - 1 : -1
        const vnIdx = indices[2] ? parseInt(indices[2], 10) - 1 : -1
        faceVerts.push({ vIdx, vtIdx, vnIdx })
      }
      // Fan triangulation, reversed winding: OBJ CW to OpenGL CCW.
      for (let i = 1; i < faceVerts.length - 1; i++) {
        addVertex(faceVerts[0])
        addVertex(faceVerts[i + 1])
        addVertex(faceVerts[i])
      }
    }
  }

  function addVertex(v) {
    if (v.vIdx >= 0 && v.vIdx < rawPositions.length) positions.push(...rawPositions[v.vIdx])
    else positions.push(0, 0, 0)
    if (v.vnIdx >= 0 && v.vnIdx < rawNormals.length) normals.push(...rawNormals[v.vnIdx])
    else normals.push(0, 0, 1)
    if (v.vtIdx >= 0 && v.vtIdx < rawUVs.length) uvs.push(...rawUVs[v.vtIdx])
    else uvs.push(0, 0)
  }

  // If no normals were provided, compute smooth vertex normals: exact port of the
  // upstream obj-parser computeFaceNormals (per-triangle face normals averaged by
  // position key, rounded to 1e-4 to merge duplicate vertices).
  if (rawNormals.length === 0 && positions.length > 0) computeFaceNormals(positions, normals)

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    vertexCount: positions.length / 3,
  }
}

/**
 * Pack triangle-soup mesh data into texture-sized RGBA arrays.
 * Port of the upstream obj-parser `packMeshDataForTextures`: one texel per
 * vertex, position w = 1 marks a valid vertex (remaining texels keep w = 0).
 * texWidth/texHeight come from the upstream mesh-texture convention (256x256).
 */
export function packMeshDataForTextures(positions, normals, uvs, texWidth, texHeight) {
  const maxVertices = texWidth * texHeight
  const vertexCount = positions.length / 3
  if (vertexCount > maxVertices) {
    // Upstream truncates with a console warning; parity fixtures stay below the cap.
  }
  const usedVertices = Math.min(vertexCount, maxVertices)
  const pixelCount = texWidth * texHeight
  const positionData = new Float32Array(pixelCount * 4)
  const normalData = new Float32Array(pixelCount * 4)
  const uvData = new Float32Array(pixelCount * 4)
  for (let i = 0; i < usedVertices; i++) {
    const pi = i * 4
    const vi3 = i * 3
    const vi2 = i * 2
    positionData[pi] = positions[vi3]
    positionData[pi + 1] = positions[vi3 + 1]
    positionData[pi + 2] = positions[vi3 + 2]
    positionData[pi + 3] = 1.0
    normalData[pi] = normals[vi3]
    normalData[pi + 1] = normals[vi3 + 1]
    normalData[pi + 2] = normals[vi3 + 2]
    normalData[pi + 3] = 0.0
    uvData[pi] = uvs[vi2]
    uvData[pi + 1] = uvs[vi2 + 1]
    uvData[pi + 2] = 0.0
    uvData[pi + 3] = 0.0
  }
  for (let i = usedVertices; i < pixelCount; i++) positionData[i * 4 + 3] = 0.0
  return { positionData, normalData, uvData, vertexCount: usedVertices }
}

/**
 * Smooth vertex normals for un-normalized OBJ files: exact port of the upstream
 * obj-parser computeFaceNormals (face normals from reversed-winding triangles,
 * averaged per rounded position key, threshold 1e-4).
 */
function computeFaceNormals(positions, normals) {
  const vertexCount = positions.length / 3
  const triangleCount = vertexCount / 3
  const faceNormals = new Float32Array(triangleCount * 3)
  for (let tri = 0; tri < triangleCount; tri++) {
    const i0 = tri * 9
    const i1 = i0 + 3
    const i2 = i0 + 6
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2]
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2]
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 0.0001) {
      nx /= len
      ny /= len
      nz /= len
    } else {
      nx = 0
      ny = 0
      nz = 1
    }
    faceNormals[tri * 3] = nx
    faceNormals[tri * 3 + 1] = ny
    faceNormals[tri * 3 + 2] = nz
  }
  const posToNormal = new Map()
  const round = (v) => Math.round(v * 10000) / 10000
  for (let v = 0; v < vertexCount; v++) {
    const px = positions[v * 3]
    const py = positions[v * 3 + 1]
    const pz = positions[v * 3 + 2]
    const key = `${round(px)},${round(py)},${round(pz)}`
    const triIdx = Math.floor(v / 3)
    if (!posToNormal.has(key)) posToNormal.set(key, { nx: 0, ny: 0, nz: 0, count: 0 })
    const acc = posToNormal.get(key)
    acc.nx += faceNormals[triIdx * 3]
    acc.ny += faceNormals[triIdx * 3 + 1]
    acc.nz += faceNormals[triIdx * 3 + 2]
    acc.count++
  }
  for (const acc of posToNormal.values()) {
    const len = Math.sqrt(acc.nx * acc.nx + acc.ny * acc.ny + acc.nz * acc.nz)
    if (len > 0.0001) {
      acc.nx /= len
      acc.ny /= len
      acc.nz /= len
    } else {
      acc.nx = 0
      acc.ny = 0
      acc.nz = 1
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const px = positions[v * 3]
    const py = positions[v * 3 + 1]
    const pz = positions[v * 3 + 2]
    const key = `${round(px)},${round(py)},${round(pz)}`
    const acc = posToNormal.get(key)
    normals[v * 3] = acc.nx
    normals[v * 3 + 1] = acc.ny
    normals[v * 3 + 2] = acc.nz
  }
}