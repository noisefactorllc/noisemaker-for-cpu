// CPU triangle-mesh rasterizer for `drawMode: 'triangles'` passes (`render/meshRender`).
//
// The canonical pass executor cannot run these through the per-pixel fragment-kernel
// machinery (they rasterize a variable number of triangles rather than filling every
// destination pixel exactly once), so — like the scatter adapters in `points-deposit.js`
// — this is a hand-ported function dispatched by `src/runtime/renderer.js`, keyed by
// `${effectId}:${pass.program}`. The port follows the upstream draw exactly
// (shaders/src/runtime/backends/webgl2.js triangle-mesh mode):
//   - drawArrays(TRIANGLES) over one texel per vertex of the mesh positions texture,
//     consecutive texel triples forming a de-indexed triangle soup (`parseOBJ` packs
//     exactly that order, so no index buffer exists on either side);
//   - depth test LESS against a per-pass depth buffer cleared to 1.0, back-face
//     culling with CCW = front, blending disabled;
//   - the vertex stage is `render.vert` (mesh texture fetch, scale/offset, Rz*Ry*Rx
//     rotation in degrees, orthographic projection with viewScale and aspect divide,
//     z mapped to [0, 1] over nearZ -10 / farZ 10) and the fragment stage is
//     `render.frag` (Blinn-Phong diffuse/specular, ambient, Fresnel rim, optional
//     wireframe discard via screen-space normal derivatives, gamma 1/2.2).
// Floating point follows GLSL f32 semantics via Math.fround on every elementary op.
// Rasterization samples pixel centers with an inclusive inside test; exact edge
// behavior is implementation-defined on real GPUs, which is why meshRender parity is
// graded rather than byte-exact.

const f32 = Math.fround
const vec3 = (x, y, z) => [f32(x), f32(y), f32(z)]

const adapters = new Map()

export function registerMeshAdapter(key, adapter) {
  if (typeof key !== 'string' || key.length === 0) throw new TypeError('registerMeshAdapter requires a non-empty string key')
  if (typeof adapter !== 'function') throw new TypeError('registerMeshAdapter requires a function adapter')
  adapters.set(key, adapter)
}

export function resolveMeshAdapter(key) {
  return adapters.get(key)
}

// Vertex stage of render.vert for one mesh texel.
function vertexStage(posData, normalData, uniforms) {
  let position = vec3(posData[0], posData[1], posData[2])
  const normal = vec3(normalData[0], normalData[1], normalData[2])
  const meshScale = uniforms.meshScale
  position = vec3(f32(position[0] * meshScale), f32(position[1] * meshScale), f32(position[2] * meshScale))
  position = vec3(f32(position[0] + uniforms.meshOffsetX), f32(position[1] + uniforms.meshOffsetY), f32(position[2] + uniforms.meshOffsetZ))
  const deg2rad = f32(3.14159265 / 180.0)
  const rx = f32(uniforms.rotateX * deg2rad)
  const ry = f32(uniforms.rotateY * deg2rad)
  const rz = f32(uniforms.rotateZ * deg2rad)
  const cx = f32(Math.cos(rx)), sx = f32(Math.sin(rx))
  const cy = f32(Math.cos(ry)), sy = f32(Math.sin(ry))
  const cz = f32(Math.cos(rz)), sz = f32(Math.sin(rz))
  // mat3 rotationZ * rotationY * rotationX (GLSL column-major constructor values inlined).
  const rotX = [1, 0, 0, 0, cx, sx, 0, -sx, cx]
  const rotY = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const rotZ = [cz, -sz, 0, sz, cz, 0, 0, 0, 1]
  const mul = (a, b) => {
    // a * b with column-major mat3 layout: out[col*3+row] = sum a[k*3+row]*b[col*3+k]
    const out = new Array(9)
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        out[col * 3 + row] = f32(f32(a[row] * b[col * 3]) + f32(a[3 + row] * b[col * 3 + 1]) + f32(a[6 + row] * b[col * 3 + 2]))
      }
    }
    return out
  }
  const rotation = mul(mul(rotZ, rotY), rotX)
  const apply = (m, v) => vec3(
    f32(f32(m[0] * v[0]) + f32(m[3] * v[1]) + f32(m[6] * v[2])),
    f32(f32(m[1] * v[0]) + f32(m[4] * v[1]) + f32(m[7] * v[2])),
    f32(f32(m[2] * v[0]) + f32(m[5] * v[1]) + f32(m[8] * v[2])),
  )
  const rotatedPos = apply(rotation, position)
  const rotatedNormal = apply(rotation, normal)
  rotatedPos[0] = f32(rotatedPos[0] + uniforms.posX)
  rotatedPos[1] = f32(rotatedPos[1] + uniforms.posY)
  let clipX = f32(rotatedPos[0] * uniforms.viewScale)
  const clipY = f32(rotatedPos[1] * uniforms.viewScale)
  clipX = f32(clipX / uniforms.aspect)
  const nearZ = -10.0
  const farZ = 10.0
  const ndcZ = f32(f32(rotatedPos[2] - nearZ) / f32(farZ - nearZ))
  return { clipX, clipY, ndcZ, rotatedNormal, rotatedPos }
}

// Fragment stage of render.frag for one covered pixel.
function fragmentStage(vNormal, vPosition, uniforms) {
  const normal = vec3Normalize(vNormal)
  const lightDir = vec3Normalize(vec3(uniforms.lightDirection[0], uniforms.lightDirection[1], uniforms.lightDirection[2]))
  const viewDir = vec3(0, 0, 1)
  const meshColor = vec3(uniforms.meshColor[0], uniforms.meshColor[1], uniforms.meshColor[2])
  const ambient = vec3(f32(uniforms.ambientColor[0] * meshColor[0]), f32(uniforms.ambientColor[1] * meshColor[1]), f32(uniforms.ambientColor[2] * meshColor[2]))
  const diffuseFactor = Math.max(f32(normal[0] * lightDir[0] + normal[1] * lightDir[1] + normal[2] * lightDir[2]), 0)
  const diffuse = vec3(
    f32(f32(uniforms.diffuseColor[0] * diffuseFactor) * meshColor[0] * uniforms.diffuseIntensity),
    f32(f32(uniforms.diffuseColor[1] * diffuseFactor) * meshColor[1] * uniforms.diffuseIntensity),
    f32(f32(uniforms.diffuseColor[2] * diffuseFactor) * meshColor[2] * uniforms.diffuseIntensity),
  )
  const halfDir = vec3Normalize(vec3(f32(lightDir[0] + viewDir[0]), f32(lightDir[1] + viewDir[1]), f32(lightDir[2] + viewDir[2])))
  const specAngle = Math.max(f32(halfDir[0] * normal[0] + halfDir[1] * normal[1] + halfDir[2] * normal[2]), 0)
  const specularFactor = specAngle === 0 && uniforms.shininess === 0 ? 1 : Math.pow(specAngle, uniforms.shininess)
  const specular = vec3(
    f32(f32(uniforms.specularColor[0] * f32(specularFactor)) * uniforms.specularIntensity),
    f32(f32(uniforms.specularColor[1] * f32(specularFactor)) * uniforms.specularIntensity),
    f32(f32(uniforms.specularColor[2] * f32(specularFactor)) * uniforms.specularIntensity),
  )
  const rimBase = f32(1 - Math.max(f32(normal[0] * viewDir[0] + normal[1] * viewDir[1] + normal[2] * viewDir[2]), 0))
  const rim = rimBase === 0 && uniforms.rimPower === 0 ? 1 : Math.pow(rimBase, uniforms.rimPower)
  const rimLight = vec3(f32(rim * uniforms.rimIntensity), f32(rim * uniforms.rimIntensity), f32(rim * uniforms.rimIntensity))
  let color = vec3(
    f32(f32(ambient[0] + diffuse[0]) + f32(specular[0] + rimLight[0])),
    f32(f32(ambient[1] + diffuse[1]) + f32(specular[1] + rimLight[1])),
    f32(f32(ambient[2] + diffuse[2]) + f32(specular[2] + rimLight[2])),
  )
  if (uniforms.wireframe === 1) {
    // dFdx/dFdy of the interpolated normal, evaluated analytically per triangle by
    // the caller (screen-space derivatives are per-triangle-constant here up to the
    // GPU's 2x2 helper-quad mixing at edges). Caller passes them via uniforms.
    const ndx = uniforms._dFdxNormal
    const ndy = uniforms._dFdyNormal
    const normalEdge = f32(f32(Math.hypot(f32(ndx[0]), f32(ndx[1]), f32(ndx[2])) + Math.hypot(f32(ndy[0]), f32(ndy[1]), f32(ndy[2]))))
    if (normalEdge < 0.1) return null // discard: interior pixel
    color = vec3(meshColor[0], meshColor[1], meshColor[2])
  }
  // Gamma correction: pow(color, 1/2.2)
  const gamma = f32(1 / 2.2)
  return vec3(f32(Math.pow(color[0], gamma)), f32(Math.pow(color[1], gamma)), f32(Math.pow(color[2], gamma)))
}

function vec3Normalize(v) {
  const lenSq = f32(f32(f32(v[0] * v[0]) + f32(v[1] * v[1])) + f32(v[2] * v[2]))
  if (lenSq === 0) return vec3(0, 0, 0)
  const invLen = f32(1 / Math.sqrt(lenSq))
  return vec3(f32(v[0] * invLen), f32(v[1] * invLen), f32(v[2] * invLen))
}

registerMeshAdapter('render/meshRender:render', meshRenderTrianglesAdapter)

export function meshRenderTrianglesAdapter({ pass, uniforms, bindings, inputs, destination, params, externalInputs }) {
  const meshData = externalInputs?.meshData
  if (!meshData) throw new Error('render/meshRender requires external mesh data (externalInputs.meshData)')
  const positions = meshData.positions ?? meshData.positionData
  const normals = meshData.normalData
  const texWidth = meshData.texWidth
  const texHeight = meshData.texHeight
  const width = destination.width
  const height = destination.height
  const data = destination.data
  const aspect = bindings.fullResolution ? f32(bindings.fullResolution[0] / bindings.fullResolution[1]) : f32(width / height)
  const resolvedUniforms = { ...uniforms, aspect, wireframe: uniforms.wireframe ?? 0 }
  // Per-pixel depth buffer cleared to 1.0 (gl.clear(DEPTH_BUFFER_BIT) each pass).
  const depth = new Float32Array(width * height).fill(1)
  let covered = 0
  const vertexCount = texWidth * texHeight
  const triangleCount = Math.floor(vertexCount / 3)
  for (let tri = 0; tri < triangleCount; tri++) {
    const verts = []
    let allInvalid = true
    for (let v = 0; v < 3; v++) {
      const texel = tri * 3 + v
      const x = texel % texWidth
      const y = Math.floor(texel / texWidth)
      const pi = (y * texWidth + x) * 4
      const posData = [positions[pi], positions[pi + 1], positions[pi + 2], positions[pi + 3]]
      const normalData = [normals[pi], normals[pi + 1], normals[pi + 2], normals[pi + 3]]
      if (posData[3] !== 0) allInvalid = false
      const stage = vertexStage(posData, normalData, resolvedUniforms)
      // Window coordinates, GL bottom-up: px = (ndcX + 1) / 2 * width.
      const px = f32(f32(f32(stage.clipX + 1) * 0.5) * width)
      const py = f32(f32(f32(stage.clipY + 1) * 0.5) * height)
      verts.push({ px, py, z: stage.ndcZ, normal: stage.rotatedNormal, position: stage.rotatedPos })
    }
    if (allInvalid) continue
    const [v0, v1, v2] = verts
    // Signed area in GL window space (y-up); CCW = front face.
    const area = f32(f32(f32(v1.px - v0.px) * f32(v2.py - v0.py)) - f32(f32(v2.px - v0.px) * f32(v1.py - v0.py)))
    if (!(area > 0)) continue // back face or degenerate: culled
    // Analytic screen-space derivatives of the interpolated normal (wireframe).
    const det = f32(f32(f32(v0.px * f32(v1.py - v2.py)) + f32(v1.px * f32(v2.py - v0.py))) + f32(v2.px * f32(v0.py - v1.py)))
    let dFdxNormal = [0, 0, 0]
    let dFdyNormal = [0, 0, 0]
    if (resolvedUniforms.wireframe === 1 && det !== 0) {
      // dFdx(vNormal) and dFdy(vNormal): standard barycentric-gradient numerators
      // with the full determinant dividing the SUM (the det division applies to
      // the complete edge-function numerator, not just its last term).
      const dNdx = (comp) => f32((f32(f32(v0.normal[comp] * f32(v1.py - v2.py)) + f32(v1.normal[comp] * f32(v2.py - v0.py))) + f32(v2.normal[comp] * f32(v0.py - v1.py))) / det)
      const dNdy = (comp) => f32((f32(f32(v0.normal[comp] * f32(v2.px - v1.px)) + f32(v1.normal[comp] * f32(v0.px - v2.px))) + f32(v2.normal[comp] * f32(v1.px - v0.px))) / det)
      dFdxNormal = [dNdx(0), dNdx(1), dNdx(2)]
      dFdyNormal = [dNdy(0), dNdy(1), dNdy(2)]
    }
    const fragUniforms = resolvedUniforms.wireframe === 1
      ? { ...resolvedUniforms, _dFdxNormal: dFdxNormal, _dFdyNormal: dFdyNormal }
      : resolvedUniforms
    // Bounding box of the triangle, clamped to the viewport.
    const minX = Math.max(0, Math.floor(Math.min(v0.px, v1.px, v2.px) - 0.5))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(v0.px, v1.px, v2.px) - 0.5))
    const minYGl = Math.max(0, Math.floor(Math.min(v0.py, v1.py, v2.py) - 0.5))
    const maxYGl = Math.min(height - 1, Math.ceil(Math.max(v0.py, v1.py, v2.py) - 0.5))
    for (let pyGl = minYGl; pyGl <= maxYGl; pyGl++) {
      // Surface rows are top-down; GL window y is bottom-up.
      const row = height - 1 - pyGl
      const cy = f32(pyGl + 0.5)
      for (let pxGl = minX; pxGl <= maxX; pxGl++) {
        const cx = f32(pxGl + 0.5)
        // Barycentric coordinates via edge functions (CCW, positive area).
        const b0 = f32(f32(f32(v1.px - v0.px) * f32(cy - v0.py)) - f32(f32(v1.py - v0.py) * f32(cx - v0.px))) / area
        const b1 = f32(f32(f32(v2.px - v1.px) * f32(cy - v1.py)) - f32(f32(v2.py - v1.py) * f32(cx - v1.px))) / area
        const b2 = 1 - f32(b0 + b1)
        if (!(b0 >= 0 && b1 >= 0 && b2 >= 0)) continue
        const z = f32(f32(f32(b0 * v0.z) + f32(b1 * v1.z)) + f32(b2 * v2.z))
        const depthIndex = row * width + pxGl
        if (!(z < depth[depthIndex])) continue // depthFunc LESS
        depth[depthIndex] = z
        const vNormal = [
          f32(f32(f32(b0 * v0.normal[0]) + f32(b1 * v1.normal[0])) + f32(b2 * v2.normal[0])),
          f32(f32(f32(b0 * v0.normal[1]) + f32(b1 * v1.normal[1])) + f32(b2 * v2.normal[1])),
          f32(f32(f32(b0 * v0.normal[2]) + f32(b1 * v1.normal[2])) + f32(b2 * v2.normal[2])),
        ]
        const vPosition = [
          f32(f32(f32(b0 * v0.position[0]) + f32(b1 * v1.position[0])) + f32(b2 * v2.position[0])),
          f32(f32(f32(b0 * v0.position[1]) + f32(b1 * v1.position[1])) + f32(b2 * v2.position[1])),
          f32(f32(f32(b0 * v0.position[2]) + f32(b1 * v1.position[2])) + f32(b2 * v2.position[2])),
        ]
        const color = fragmentStage(vNormal, vPosition, fragUniforms)
        if (!color) continue // wireframe discard
        const outIndex = depthIndex * 4
        data[outIndex] = color[0]
        data[outIndex + 1] = color[1]
        data[outIndex + 2] = color[2]
        data[outIndex + 3] = 1
        covered += 1
      }
    }
  }
  return { pixels: covered }
}