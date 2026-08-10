import { scatterPointPixel, texelFetchAgent } from './points-deposit.js'

// `filter3d/flow3d:deposit` <- deposit.vert + deposit.frag.
// Agents carry voxel-space xyz positions in stateTex1 and RGB in stateTex2.
// The vertex shader flattens z slices into a volumeSize x volumeSize^2 atlas;
// the fragment shader deposits opaque agent color with additive blending.
export function flow3dDepositAdapter({ pass, uniforms, inputs, destination }) {
  const stateTex1 = inputs.stateTex1
  const stateTex2 = inputs.stateTex2
  const stateWidth = stateTex1.width
  const stateHeight = stateTex1.height
  const capacity = stateWidth * stateHeight
  const maxAgents = Math.trunc(Math.max(stateWidth, stateHeight) * uniforms.density * 0.2)
  const drawCount = pass?.count ?? capacity
  const count = Math.max(0, Math.min(drawCount, capacity, maxAgents))
  const volumeSize = uniforms.volumeSize
  const atlasHeight = volumeSize * volumeSize
  const data = destination.data
  let pixels = 0

  for (let agentIndex = 0; agentIndex < count; agentIndex += 1) {
    const stateX = agentIndex % stateWidth
    const stateY = Math.floor(agentIndex / stateWidth)
    const state1 = texelFetchAgent(stateTex1, stateX, stateY)
    const state2 = texelFetchAgent(stateTex2, stateX, stateY)

    const atlasX = state1[0]
    const atlasY = state1[1] + Math.floor(state1[2]) * volumeSize
    const clipX = (atlasX / volumeSize) * 2 - 1
    const clipY = (atlasY / atlasHeight) * 2 - 1
    const offset = scatterPointPixel(clipX, clipY, 1, destination.width, destination.height)
    if (offset === null) continue

    data[offset] += state2[0]
    data[offset + 1] += state2[1]
    data[offset + 2] += state2[2]
    data[offset + 3] += 1
    pixels += 1
  }

  return { pixels }
}
