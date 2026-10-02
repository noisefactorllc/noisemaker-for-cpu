// Deterministic external-input fixtures for the reactive (MIDI/audio) and mesh
// (OBJ) parity cases. Both sides of a comparison consume exactly these values:
// the authority capture harness feeds the upstream `MidiState`/`AudioState`/
// `parseOBJ`+`packMeshDataForTextures` pipeline, and the CPU gate feeds the port's
// `src/runtime/external-input.js` ports through `renderOptions.externalInputs`.
// Keep the fixture constants byte-identical across both sides.
import { MidiState, AudioState, parseOBJ, packMeshDataForTextures } from '../../src/runtime/external-input.js'

// MIDI: channel 1 C-major triad (60/64/67, velocities 100/80/90), channel 2 low C
// (48, velocity 64), then 24 clock pulses — one beat at 24 PPQ.
export const MIDI_MESSAGES = Object.freeze([
  [0x90, 60, 100], [0x90, 64, 80], [0x90, 67, 90],
  [0x91, 48, 64],
  ...Array.from({ length: 24 }, () => [0xf8]),
])

// Audio: 128-sample normalized waveform and spectrum.
export function waveformValues() {
  const waveform = new Float32Array(128)
  const spectrum = new Float32Array(128)
  for (let i = 0; i < 128; i++) {
    waveform[i] = 0.5 + 0.5 * Math.sin((2 * Math.PI * 3 * i) / 128)
    spectrum[i] = Math.pow(1 - i / 127, 2)
  }
  return { waveform, spectrum }
}

// Mesh: a 12-triangle cube (8 vertices, 6 quad faces with per-face normals).
export const CUBE_OBJ = [
  'v -0.7 -0.7 -0.7', 'v 0.7 -0.7 -0.7', 'v 0.7 0.7 -0.7', 'v -0.7 0.7 -0.7',
  'v -0.7 -0.7 0.7', 'v 0.7 -0.7 0.7', 'v 0.7 0.7 0.7', 'v -0.7 0.7 0.7',
  'vn 0 0 -1', 'vn 0 0 1', 'vn 0 -1 0', 'vn 0 1 0', 'vn -1 0 0', 'vn 1 0 0',
  'f 1//1 2//1 3//1 4//1', 'f 5//2 8//2 7//2 6//2', 'f 1//3 5//3 6//3 2//3',
  'f 2//4 6//4 7//4 3//4', 'f 3//5 7//5 8//5 4//5', 'f 4//6 8//6 5//6 1//6',
  '',
].join('\n')

const MESH_TEX_WIDTH = 256
const MESH_TEX_HEIGHT = 256

export function midiFixture() {
  const midiState = new MidiState()
  for (const message of MIDI_MESSAGES) midiState.handleMessage(Uint8Array.from(message))
  midiState.updateNoteGrid()
  return midiState
}

export function audioFixture() {
  const audioState = new AudioState()
  const { waveform, spectrum } = waveformValues()
  audioState.setWaveform(waveform)
  audioState.setSpectrum(spectrum)
  return audioState
}

export function meshFixture() {
  const parsed = parseOBJ(CUBE_OBJ)
  const packed = packMeshDataForTextures(parsed.positions, parsed.normals, parsed.uvs, MESH_TEX_WIDTH, MESH_TEX_HEIGHT)
  return { ...packed, texWidth: MESH_TEX_WIDTH, texHeight: MESH_TEX_HEIGHT }
}

// External inputs for one parity case id, or undefined when the case needs none.
export function externalInputsForCase(id) {
  const externalInputs = {}
  if (['synth/roll'].includes(id)) externalInputs.midiState = midiFixture()
  if (['synth/scope', 'synth/spectrum'].includes(id)) externalInputs.audioState = audioFixture()
  if (['render/meshLoader', 'render/meshRender'].includes(id)) externalInputs.meshData = meshFixture()
  return Object.keys(externalInputs).length > 0 ? externalInputs : undefined
}