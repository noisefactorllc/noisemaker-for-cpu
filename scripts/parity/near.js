import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { readPng } from '../../src/node/png.js'
import { compareRgba8 } from './lib.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const authorityRevision = '6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d'
const renderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)'

// One reviewed NEAR policy per case. Each binds the case fixture, the reviewed CPU
// candidate bytes, the pinned authority, the capture protocol, and every retained
// authority surface with its measured differences. The pinned reference capture
// and the candidate capture looked the same side by side at native size.
const POLICIES = new Map([
  ['points/buddhabrot', {
    captureRevision: '2026-10-16-m4-metal-webgl2-gap035-buddhabrot',
    reviewedCandidateRevision: '5e93c23c6cd8c2b3f777bedc40142798be185ba8',
    candidateSha256: '6a61efff531cc10845fb436d51ae96ce97470c3f7c5c316be4e3151ff02f0f99',
    fixtureSha256: '553b7e2cee432e4743404d6b4471b35f503952bd637521210db92158dd3fe61a',
    protocol: {
      size: 8, time: 0.25, seed: 1, tolerance: 2, oneShot: 'initial',
      frames: 60, frameTimeStep: 1 / 600, renderer,
    },
    captures: [
      {
        surface: 'global_o0_read',
        image: 'parity/goldens/defaults/points__buddhabrot.golden.png',
        pngSha256: 'd5f2d4316afeb89d1cc3fc92295ae6b2dc4a9d912f91f1308eb19a90deb130df',
        rawSha256: 'd131524794c127ecedf8f5ae3dd4f88216c7a313db62fc56b3f5b336e61e1e65',
        maxError: 12, meanError: 0.69921875,
        differingChannels: 24, channelsOverTolerance: 24,
        pixels: [8, 23, 24, 31, 48, 55, 56, 63],
      },
      {
        surface: 'global_o0_write',
        image: 'parity/goldens/reviewed/points__buddhabrot.write.png',
        pngSha256: '1e8da1cb4d660bb1c27006ea921a69ce64ed6d673416e908a6fd3438295b25fc',
        rawSha256: 'e87f9dda33599762c275be1f49eb12b7cf6555d5e6e46bf32d24cb8b0e3f2113',
        maxError: 25, meanError: 0.86328125,
        differingChannels: 24, channelsOverTolerance: 24,
        pixels: [8, 23, 24, 31, 48, 55, 56, 63],
      },
    ],
  }],
  // The residual comes from the M4 sine, which is within 2 ULP of the correctly
  // rounded value: the nine nsSplat vortex hashes amplify it. With the measured
  // M4 sine values substituted, the CPU frame is byte-exact.
  ['synth/navierStokes', {
    captureRevision: '2026-10-17-m4-metal-webgl2-gap035-navierstokes',
    reviewedCandidateRevision: '6acab0af38cd49ce75ea9cef4df185b81f751183',
    candidateSha256: 'ecf1c94478b607be4eecca8371ca201a213d53a8a9fdeb54a024360570dd52a4',
    fixtureSha256: '3a6794f151d5257c9d3ee7223bb63b42c35c4a615f325ba69dddb9beb84db6d3',
    protocol: { size: 8, time: 0.25, seed: 1, tolerance: 2, oneShot: 'initial', frames: 1, renderer },
    captures: [
      {
        surface: 'global_o1_write',
        image: 'parity/goldens/defaults/synth__navierStokes.golden.png',
        pngSha256: '9bac02b87364fbca263f6c63f92c9c9f1e995f41b430a17fa841708b77a4e9bc',
        rawSha256: 'ef420c48ef1c6c7470c97cb6819c002e2baa18230cc6b75d8e214ae9d305ffa3',
        maxError: 6, meanError: 0.55078125,
        differingChannels: 75, channelsOverTolerance: 18,
        pixels: [7, 12, 13, 15, 19, 20, 21, 22, 28, 30, 32, 33, 35, 36, 37, 38, 40, 41, 43, 44, 47, 55, 61, 62, 63],
      },
    ],
  }],
  // A particle simulation: all 65,536 agents match the authority within 5e-8 after the
  // first frame. Float rounding at the wrap and at texel edges then moves a few agents,
  // which changes 6 of 64 pixels after 60 frames. A one-iteration run still fails.
  ['points/hydraulic', {
    captureRevision: '2026-10-18-m4-metal-webgl2-gap039-hydraulic-timed60',
    reviewedCandidateRevision: '518dd693293c8d2a57a1b631fef7cb5b616c939b',
    candidateSha256: 'fb9970c5f600e93af53d97a5e1320307f4c5034130fbfaa9635ab234bbbc0a25',
    fixtureSha256: '829684dd36eba52f34a5eb023bf85e3a83b633ac416c900e8153a3fac8312590',
    protocol: {
      size: 8, time: 0.25, seed: 1, tolerance: 2, oneShot: 'initial',
      frames: 60, frameTimeStep: 1 / 600, renderer,
    },
    captures: [
      {
        surface: 'global_o0_read',
        image: 'parity/goldens/defaults/points__hydraulic.golden.png',
        pngSha256: '0b1c6f1283c7efb43e57e7cb6cd16d25640060f711fe1567e3ee3e0409ce09df',
        rawSha256: 'd538fe87a0e1a3c77da39a6b4cdb58f0d1d9ed85c055cec880f52169ba301634',
        maxError: 62, meanError: 2.01171875,
        differingChannels: 16, channelsOverTolerance: 16,
        pixels: [6, 7, 15, 27, 30, 37],
      },
    ],
  }],
])

export const NEAR_CASE_IDS = Object.freeze([...POLICIES.keys()])

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
// The recorded fixture hash is of the committed LF bytes. A checkout that converts
// line endings (Git for Windows' default autocrlf) holds the same program.
const fixtureSha256Of = (source) => sha256(source.replace(/\r\n/g, '\n'))

function expectedReview(policy) {
  return {
    accepted: true,
    policy: policy.captureRevision,
    reviewedCandidateRevision: policy.reviewedCandidateRevision,
    candidateSha256: policy.candidateSha256,
    fixtureSha256: policy.fixtureSha256,
    authorityRevision,
    protocol: { ...policy.protocol },
    visualVerdict: 'indistinguishable at native size',
    surfaces: policy.captures.map(({ differingChannels, channelsOverTolerance, pixels, ...capture }) => ({
      ...capture,
      exact: false, pass: false,
      differingChannels, channelsOverTolerance,
      differingPixels: pixels.length, pixels: [...pixels],
      bounds: {
        maxError: capture.maxError, meanError: capture.meanError,
        differingChannels, channelsOverTolerance,
        differingPixels: pixels.length, pixels: [...pixels],
      },
    })),
  }
}

function matchesProtocol(policy, meta) {
  const { protocol } = policy
  return meta?.size === protocol.size && meta.time === protocol.time &&
    meta.seed === protocol.seed && meta.tolerance === protocol.tolerance &&
    (meta.oneShot ?? 'initial') === protocol.oneShot
}

// Only these reviewed bytes qualify. Any changed candidate or capture needs a new review.
export function validateNearReview(caseId, review, meta) {
  const policy = POLICIES.get(caseId)
  return policy !== undefined && matchesProtocol(policy, meta) && meta.sourceRevision === authorityRevision &&
    isDeepStrictEqual(review, expectedReview(policy))
}

export async function reviewedNearComparison({ id: caseId, actual, source, meta, reference, authorityRevision: authority }) {
  const policy = POLICIES.get(caseId)
  if (!policy || !matchesProtocol(policy, meta) || authority !== authorityRevision ||
      fixtureSha256Of(source) !== policy.fixtureSha256 || sha256(actual) !== policy.candidateSha256 ||
      reference?.sha256 !== policy.captures[0].pngSha256 || reference.captureRevision !== policy.captureRevision ||
      reference.provenance !== 'recorded') return null

  const review = expectedReview(policy)
  for (const capture of review.surfaces) {
    const path = resolve(root, capture.image)
    if (sha256(await readFile(path)) !== capture.pngSha256) return null
    const expected = await readPng(path)
    if (expected.width !== policy.protocol.size || expected.height !== policy.protocol.size ||
        sha256(expected.data) !== capture.rawSha256) return null
    const measured = compareRgba8(actual, expected.data, policy.protocol.tolerance)
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
    if (!isDeepStrictEqual(changedPixels, capture.pixels)) return null
  }
  return review
}
