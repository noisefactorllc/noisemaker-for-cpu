import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { readPng } from '../../src/node/png.js'
import { compareRgba8 } from './lib.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const id = 'points/buddhabrot'
const captureRevision = '2026-10-16-m4-metal-webgl2-gap035-buddhabrot'
const candidateSha256 = '6a61efff531cc10845fb436d51ae96ce97470c3f7c5c316be4e3151ff02f0f99'
const fixtureSha256 = '553b7e2cee432e4743404d6b4471b35f503952bd637521210db92158dd3fe61a'
const authorityRevision = '6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d'
const protocol = {
  size: 8, time: 0.25, seed: 1, tolerance: 2, oneShot: 'initial',
  frames: 60, frameTimeStep: 1 / 600,
  renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)',
}
const pixels = [8, 23, 24, 31, 48, 55, 56, 63]
const captures = [
  {
    surface: 'global_o0_read',
    image: 'parity/goldens/defaults/points__buddhabrot.golden.png',
    pngSha256: 'd5f2d4316afeb89d1cc3fc92295ae6b2dc4a9d912f91f1308eb19a90deb130df',
    rawSha256: 'd131524794c127ecedf8f5ae3dd4f88216c7a313db62fc56b3f5b336e61e1e65',
    maxError: 12, meanError: 0.69921875,
  },
  {
    surface: 'global_o0_write',
    image: 'parity/goldens/reviewed/points__buddhabrot.write.png',
    pngSha256: '1e8da1cb4d660bb1c27006ea921a69ce64ed6d673416e908a6fd3438295b25fc',
    rawSha256: 'e87f9dda33599762c275be1f49eb12b7cf6555d5e6e46bf32d24cb8b0e3f2113',
    maxError: 25, meanError: 0.86328125,
  },
]
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function expectedReview() {
  return {
    accepted: true,
    policy: captureRevision,
    reviewedCandidateRevision: '5e93c23c6cd8c2b3f777bedc40142798be185ba8',
    candidateSha256, fixtureSha256, authorityRevision,
    protocol: { ...protocol },
    visualVerdict: 'indistinguishable at native size',
    surfaces: captures.map((capture) => ({
      ...capture,
      exact: false, pass: false,
      differingChannels: 24, channelsOverTolerance: 24,
      differingPixels: 8, pixels: [...pixels],
      bounds: {
        maxError: capture.maxError, meanError: capture.meanError,
        differingChannels: 24, channelsOverTolerance: 24,
        differingPixels: 8, pixels: [...pixels],
      },
    })),
  }
}

function matchesProtocol(meta) {
  return meta?.size === protocol.size && meta.time === protocol.time &&
    meta.seed === protocol.seed && meta.tolerance === protocol.tolerance &&
    (meta.oneShot ?? 'initial') === protocol.oneShot
}

// Only these reviewed bytes qualify. Any changed candidate or capture needs a new review.
export function validateNearReview(caseId, review, meta) {
  return caseId === id && matchesProtocol(meta) && meta.sourceRevision === authorityRevision &&
    isDeepStrictEqual(review, expectedReview())
}

export async function reviewedNearComparison({ id: caseId, actual, source, meta, reference, authorityRevision: authority }) {
  if (caseId !== id || !matchesProtocol(meta) || authority !== authorityRevision ||
      sha256(source) !== fixtureSha256 || sha256(actual) !== candidateSha256 ||
      reference?.sha256 !== captures[0].pngSha256 || reference.captureRevision !== captureRevision ||
      reference.provenance !== 'recorded') return null

  const review = expectedReview()
  for (const capture of review.surfaces) {
    const path = resolve(root, capture.image)
    if (sha256(await readFile(path)) !== capture.pngSha256) return null
    const expected = await readPng(path)
    if (expected.width !== protocol.size || expected.height !== protocol.size ||
        sha256(expected.data) !== capture.rawSha256) return null
    const measured = compareRgba8(actual, expected.data, protocol.tolerance)
    for (const key of ['exact', 'pass', 'maxError', 'meanError', 'differingChannels', 'channelsOverTolerance']) {
      if (measured[key] !== capture[key]) return null
    }
    const changedPixels = []
    for (let pixel = 0; pixel < actual.length / 4; pixel += 1) {
      if (actual[pixel * 4 + 3] !== expected.data[pixel * 4 + 3]) return null
      if ([0, 1, 2].some((channel) => actual[pixel * 4 + channel] !== expected.data[pixel * 4 + channel])) {
        changedPixels.push(pixel)
      }
    }
    if (!isDeepStrictEqual(changedPixels, pixels)) return null
  }
  return review
}
