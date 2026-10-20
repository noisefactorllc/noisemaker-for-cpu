import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { readPng } from '../../src/node/png.js'
import { compareRgba8 } from './lib.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const authorityRevision = 'f6b196dc42568576dfc40794040675fde42d2dc1'
const renderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)'

// Particle simulations are chaotic, so a reviewed visual match passes for them
// (operator, 2026-10-17): "for particle effects, we're letting visual matches
// pass. our goal is passable ports, not perfect ports." Such a policy also records
// a 128x128 review capture of the same program on both sides, by SHA-256, with its
// measured difference.
const PARTICLE_VISUAL_MATCH = 'particle visual match (operator 2026-10-17: passable ports, not perfect ports)'

// One reviewed NEAR policy per case. Each binds the case fixture, the reviewed CPU
// candidate bytes, the pinned authority, the capture protocol, and every retained
// authority surface with its measured differences. The pinned reference capture
// and the candidate capture were reviewed side by side at native size; a
// visual-match policy states its verdict and its review capture.
const POLICIES = new Map([
  ['points/buddhabrot', {
    authorityCapture: {
      "sourceRevision": "f6b196dc42568576dfc40794040675fde42d2dc1",
      "fixtureSha256": "553b7e2cee432e4743404d6b4471b35f503952bd637521210db92158dd3fe61a",
      "startedAt": "2026-10-20T17:27:38.069Z",
      "completedAt": "2026-10-20T17:27:39.564Z",
      "sourceFilesVerified": 1597,
      "independentRenderers": 2,
      "readsPerRenderer": 2,
      "programStateApplied": true,
      "readbacks": [
        {
          "surface": "global_o0_read",
          "sha256": "d131524794c127ecedf8f5ae3dd4f88216c7a313db62fc56b3f5b336e61e1e65",
          "repeatSha256": "d131524794c127ecedf8f5ae3dd4f88216c7a313db62fc56b3f5b336e61e1e65",
          "independentSha256": "d131524794c127ecedf8f5ae3dd4f88216c7a313db62fc56b3f5b336e61e1e65",
          "independentRepeatSha256": "d131524794c127ecedf8f5ae3dd4f88216c7a313db62fc56b3f5b336e61e1e65"
        },
        {
          "surface": "global_o0_write",
          "sha256": "e87f9dda33599762c275be1f49eb12b7cf6555d5e6e46bf32d24cb8b0e3f2113",
          "repeatSha256": "e87f9dda33599762c275be1f49eb12b7cf6555d5e6e46bf32d24cb8b0e3f2113",
          "independentSha256": "e87f9dda33599762c275be1f49eb12b7cf6555d5e6e46bf32d24cb8b0e3f2113",
          "independentRepeatSha256": "e87f9dda33599762c275be1f49eb12b7cf6555d5e6e46bf32d24cb8b0e3f2113"
        }
      ]
    },
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
    authorityCapture: {
      "sourceRevision": "f6b196dc42568576dfc40794040675fde42d2dc1",
      "fixtureSha256": "3a6794f151d5257c9d3ee7223bb63b42c35c4a615f325ba69dddb9beb84db6d3",
      "startedAt": "2026-10-20T17:27:39.668Z",
      "completedAt": "2026-10-20T17:27:40.926Z",
      "sourceFilesVerified": 1597,
      "independentRenderers": 2,
      "readsPerRenderer": 2,
      "programStateApplied": true,
      "readbacks": [
        {
          "surface": "global_o1_write",
          "sha256": "ef420c48ef1c6c7470c97cb6819c002e2baa18230cc6b75d8e214ae9d305ffa3",
          "repeatSha256": "ef420c48ef1c6c7470c97cb6819c002e2baa18230cc6b75d8e214ae9d305ffa3",
          "independentSha256": "ef420c48ef1c6c7470c97cb6819c002e2baa18230cc6b75d8e214ae9d305ffa3",
          "independentRepeatSha256": "ef420c48ef1c6c7470c97cb6819c002e2baa18230cc6b75d8e214ae9d305ffa3"
        }
      ]
    },
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
    authorityCapture: {
      "sourceRevision": "f6b196dc42568576dfc40794040675fde42d2dc1",
      "fixtureSha256": "829684dd36eba52f34a5eb023bf85e3a83b633ac416c900e8153a3fac8312590",
      "startedAt": "2026-10-20T17:27:41.021Z",
      "completedAt": "2026-10-20T17:27:42.341Z",
      "sourceFilesVerified": 1597,
      "independentRenderers": 2,
      "readsPerRenderer": 2,
      "programStateApplied": true,
      "readbacks": [
        {
          "surface": "global_o0_read",
          "sha256": "d538fe87a0e1a3c77da39a6b4cdb58f0d1d9ed85c055cec880f52169ba301634",
          "repeatSha256": "d538fe87a0e1a3c77da39a6b4cdb58f0d1d9ed85c055cec880f52169ba301634",
          "independentSha256": "d538fe87a0e1a3c77da39a6b4cdb58f0d1d9ed85c055cec880f52169ba301634",
          "independentRepeatSha256": "d538fe87a0e1a3c77da39a6b4cdb58f0d1d9ed85c055cec880f52169ba301634"
        }
      ]
    },
    captureRevision: '2026-10-18-m4-metal-webgl2-gap039-hydraulic-timed60',
    reviewedCandidateRevision: '518dd693293c8d2a57a1b631fef7cb5b616c939b',
    candidateSha256: 'fb9970c5f600e93af53d97a5e1320307f4c5034130fbfaa9635ab234bbbc0a25',
    fixtureSha256: '829684dd36eba52f34a5eb023bf85e3a83b633ac416c900e8153a3fac8312590',
    protocol: {
      size: 8, time: 0.25, seed: 1, tolerance: 2, oneShot: 'initial',
      frames: 60, frameTimeStep: 1 / 600, renderer,
    },
    visualVerdict: 'same at the 128x128 review size: the same eroded channel structure, palette and coverage; mean difference 0.143677',
    mechanism: PARTICLE_VISUAL_MATCH,
    review: {
      authorityCapture: {
        "sourceRevision": "f6b196dc42568576dfc40794040675fde42d2dc1",
        "fixtureSha256": "829684dd36eba52f34a5eb023bf85e3a83b633ac416c900e8153a3fac8312590",
        "startedAt": "2026-10-20T17:27:42.436Z",
        "completedAt": "2026-10-20T17:27:44.368Z",
        "sourceFilesVerified": 1597,
        "independentRenderers": 2,
        "readsPerRenderer": 2,
        "programStateApplied": true,
        "readbacks": [
          {
            "surface": "global_o0_read",
            "sha256": "2d644aed39848ea47058377c894497d666778fffe44f0a2a4960fafcb81d5930",
            "repeatSha256": "2d644aed39848ea47058377c894497d666778fffe44f0a2a4960fafcb81d5930",
            "independentSha256": "2d644aed39848ea47058377c894497d666778fffe44f0a2a4960fafcb81d5930",
            "independentRepeatSha256": "2d644aed39848ea47058377c894497d666778fffe44f0a2a4960fafcb81d5930"
          }
        ]
      },
      size: 128, frames: 60,
      authority: { surface: 'global_o0_read', rawSha256: '2d644aed39848ea47058377c894497d666778fffe44f0a2a4960fafcb81d5930', pngSha256: '68cf31260eb6db16a17903f2095df912791b5988883cd287968e854dea1a9387' },
      candidate: { rawSha256: '2705d8e399e5eca9e9330fdbdbfd0d8bf4da2cc0b914fd3e634c8f4416aa7e5e' },
      candidateCapture: {
        "sourceRevision": "bd970bd115491222c7c293e95f734e77d36d9fdb",
        "independentRenderers": 2,
        "readsPerRenderer": 2,
        "captures": [
          {
            "instance": 0,
            "startedAt": "2026-10-20T17:35:04.610Z",
            "finishedAt": "2026-10-20T17:35:41.188Z",
            "readSha256": [
              "2705d8e399e5eca9e9330fdbdbfd0d8bf4da2cc0b914fd3e634c8f4416aa7e5e",
              "2705d8e399e5eca9e9330fdbdbfd0d8bf4da2cc0b914fd3e634c8f4416aa7e5e"
            ]
          },
          {
            "instance": 1,
            "startedAt": "2026-10-20T17:35:41.189Z",
            "finishedAt": "2026-10-20T17:36:16.459Z",
            "readSha256": [
              "2705d8e399e5eca9e9330fdbdbfd0d8bf4da2cc0b914fd3e634c8f4416aa7e5e",
              "2705d8e399e5eca9e9330fdbdbfd0d8bf4da2cc0b914fd3e634c8f4416aa7e5e"
            ]
          }
        ]
      },
      sheetSha256: 'ae2e668b0b481a99cabbe4a9b0df91b08aaca200b8ae0255e85efe77c3ac0f7a',
      maxError: 201, meanError: 0.1436767578125, channelsOverTolerance: 269,
      bounds: { maxError: 201, meanError: 0.1511993408203125, channelsOverTolerance: 297 },
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
  // Particle visual match: at 8x8 two pixels differ (max 40) after 60 frames.
  ['points/dla', {
    authorityCapture: {
      "sourceRevision": "f6b196dc42568576dfc40794040675fde42d2dc1",
      "fixtureSha256": "c220c71e3750e8122cbcc20322a901ff3eb54f8a258f06bdb807fa7ab2a8558a",
      "startedAt": "2026-10-20T17:27:44.841Z",
      "completedAt": "2026-10-20T17:27:46.053Z",
      "sourceFilesVerified": 1597,
      "independentRenderers": 2,
      "readsPerRenderer": 2,
      "programStateApplied": true,
      "readbacks": [
        {
          "surface": "global_o0_read",
          "sha256": "77b4078d8211c349eb44435f6376b72aa06725c4944745c1edf5e91404a5eaf1",
          "repeatSha256": "77b4078d8211c349eb44435f6376b72aa06725c4944745c1edf5e91404a5eaf1",
          "independentSha256": "77b4078d8211c349eb44435f6376b72aa06725c4944745c1edf5e91404a5eaf1",
          "independentRepeatSha256": "77b4078d8211c349eb44435f6376b72aa06725c4944745c1edf5e91404a5eaf1"
        }
      ]
    },
    captureRevision: '2026-10-18-m4-metal-webgl2-gap039-dla-timed60',
    reviewedCandidateRevision: 'fc746e13a4b317b9edf459e9eb04e9b8e97aa8f0',
    candidateSha256: 'e6f72ed48a555e9d707770e2c360b4c3ca90c96c92a6efb5bd973d6c9efad222',
    fixtureSha256: 'c220c71e3750e8122cbcc20322a901ff3eb54f8a258f06bdb807fa7ab2a8558a',
    protocol: {
      size: 8, time: 0.25, seed: 1, tolerance: 2, oneShot: 'initial',
      frames: 60, frameTimeStep: 1 / 600, renderer,
    },
    visualVerdict: 'same character at the 128x128 review size: sparse multicolored deposits with the same regional palette, density and coverage; a few particle positions differ',
    mechanism: PARTICLE_VISUAL_MATCH,
    review: {
      authorityCapture: {
        "sourceRevision": "f6b196dc42568576dfc40794040675fde42d2dc1",
        "fixtureSha256": "c220c71e3750e8122cbcc20322a901ff3eb54f8a258f06bdb807fa7ab2a8558a",
        "startedAt": "2026-10-20T17:27:46.142Z",
        "completedAt": "2026-10-20T17:27:47.671Z",
        "sourceFilesVerified": 1597,
        "independentRenderers": 2,
        "readsPerRenderer": 2,
        "programStateApplied": true,
        "readbacks": [
          {
            "surface": "global_o0_read",
            "sha256": "63046bdbfe0a431f5b48c290c43c1f8f4ec3b4b14a52b4271f2dc1e4678f45fd",
            "repeatSha256": "63046bdbfe0a431f5b48c290c43c1f8f4ec3b4b14a52b4271f2dc1e4678f45fd",
            "independentSha256": "63046bdbfe0a431f5b48c290c43c1f8f4ec3b4b14a52b4271f2dc1e4678f45fd",
            "independentRepeatSha256": "63046bdbfe0a431f5b48c290c43c1f8f4ec3b4b14a52b4271f2dc1e4678f45fd"
          }
        ]
      },
      size: 128, frames: 60,
      authority: { surface: 'global_o0_read', rawSha256: '63046bdbfe0a431f5b48c290c43c1f8f4ec3b4b14a52b4271f2dc1e4678f45fd', pngSha256: '61454eaf5053c8083be3feaedda9415297f5d137d3252f3233cbdd206c408693' },
      candidate: { rawSha256: 'b641469776c5d8037abdb90ec7d1a9da474ec016a595d80819137a7d33b3f88c' },
      sheetSha256: '1179f46bef24aedf78bd17dcdadd97c7dafe83f39c9aaec478ec715e1ae91480',
      maxError: 243, meanError: 0.719085693359375, channelsOverTolerance: 1582,
    },
    captures: [
      {
        surface: 'global_o0_read',
        image: 'parity/goldens/defaults/points__dla.golden.png',
        pngSha256: '7ab91c13ee526db34321aef75c38756043899eb804f0c464f19cb161d81fe129',
        rawSha256: '77b4078d8211c349eb44435f6376b72aa06725c4944745c1edf5e91404a5eaf1',
        maxError: 40, meanError: 0.37890625,
        differingChannels: 4, channelsOverTolerance: 4,
        pixels: [0, 62],
      },
    ],
  }],
  // Particle visual match: boid positions diverge chaotically over 60 frames, so 52 of
  // 64 pixels differ at 8x8 while the 128x128 review frames have the same character.
  ['points/flock', {
    authorityCapture: {
      "sourceRevision": "f6b196dc42568576dfc40794040675fde42d2dc1",
      "fixtureSha256": "486d9d82c79a7872778bdb13d5e89cf92a48405f8c0d952643fd683eab2fd024",
      "startedAt": "2026-10-20T17:27:48.105Z",
      "completedAt": "2026-10-20T17:27:49.277Z",
      "sourceFilesVerified": 1597,
      "independentRenderers": 2,
      "readsPerRenderer": 2,
      "programStateApplied": true,
      "readbacks": [
        {
          "surface": "global_o0_read",
          "sha256": "d2b3d755a1f4a5ded5beb2f7d7a39c72fed54c6a4d954f9c4181d2bc4d80b84d",
          "repeatSha256": "d2b3d755a1f4a5ded5beb2f7d7a39c72fed54c6a4d954f9c4181d2bc4d80b84d",
          "independentSha256": "d2b3d755a1f4a5ded5beb2f7d7a39c72fed54c6a4d954f9c4181d2bc4d80b84d",
          "independentRepeatSha256": "d2b3d755a1f4a5ded5beb2f7d7a39c72fed54c6a4d954f9c4181d2bc4d80b84d"
        }
      ]
    },
    captureRevision: '2026-10-18-m4-metal-webgl2-gap039-flock-timed60',
    reviewedCandidateRevision: 'fc746e13a4b317b9edf459e9eb04e9b8e97aa8f0',
    candidateSha256: '8339c3884c17cce21363ad1cc9ba0af560f89e82ec3b074bb3eeb1c344156121',
    fixtureSha256: '486d9d82c79a7872778bdb13d5e89cf92a48405f8c0d952643fd683eab2fd024',
    protocol: {
      size: 8, time: 0.25, seed: 1, tolerance: 2, oneShot: 'initial',
      frames: 60, frameTimeStep: 1 / 600, renderer,
    },
    visualVerdict: 'same character at the 128x128 review size: curved dotted boid trails with the same palette, density and coverage; particle positions differ',
    mechanism: PARTICLE_VISUAL_MATCH,
    review: {
      authorityCapture: {
        "sourceRevision": "f6b196dc42568576dfc40794040675fde42d2dc1",
        "fixtureSha256": "486d9d82c79a7872778bdb13d5e89cf92a48405f8c0d952643fd683eab2fd024",
        "startedAt": "2026-10-20T17:27:49.368Z",
        "completedAt": "2026-10-20T17:27:50.914Z",
        "sourceFilesVerified": 1597,
        "independentRenderers": 2,
        "readsPerRenderer": 2,
        "programStateApplied": true,
        "readbacks": [
          {
            "surface": "global_o0_read",
            "sha256": "661ddeabac1c8da1e199bd03cce3a5863b1db4794813a075dbf2bebbe6ae213d",
            "repeatSha256": "661ddeabac1c8da1e199bd03cce3a5863b1db4794813a075dbf2bebbe6ae213d",
            "independentSha256": "661ddeabac1c8da1e199bd03cce3a5863b1db4794813a075dbf2bebbe6ae213d",
            "independentRepeatSha256": "661ddeabac1c8da1e199bd03cce3a5863b1db4794813a075dbf2bebbe6ae213d"
          }
        ]
      },
      size: 128, frames: 60,
      authority: { surface: 'global_o0_read', rawSha256: '661ddeabac1c8da1e199bd03cce3a5863b1db4794813a075dbf2bebbe6ae213d', pngSha256: 'abf4dfbb6ae33dc28b9a25ae93d502f982194b008d6a2edcdba3a38df2f87a66' },
      candidate: { rawSha256: '51d0cc431c78b9dae7367384009d992561f67158f2440cb89f4228e406d91c23' },
      sheetSha256: '57f038b878bb7c481719265368fd2c90aa79608cff36678670a92292ae892ce4',
      maxError: 245, meanError: 1.861053466796875, channelsOverTolerance: 3126,
    },
    captures: [
      {
        surface: 'global_o0_read',
        image: 'parity/goldens/defaults/points__flock.golden.png',
        pngSha256: 'f675b6088cf64e87eb6bfdc3624a71fb49c7fa09f5bd355bac35bbe1064158bc',
        rawSha256: 'd2b3d755a1f4a5ded5beb2f7d7a39c72fed54c6a4d954f9c4181d2bc4d80b84d',
        maxError: 203, meanError: 39.046875,
        differingChannels: 134, channelsOverTolerance: 133,
        pixels: [1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 42, 43, 44, 46, 47, 48, 50, 52, 53, 54, 55, 56, 57, 59, 60, 61, 63],
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
    authorityCapture: structuredClone(policy.authorityCapture),
    protocol: { ...policy.protocol },
    visualVerdict: policy.visualVerdict ?? 'indistinguishable at native size',
    ...(policy.mechanism ? { mechanism: policy.mechanism } : {}),
    ...(policy.review ? { review: structuredClone(policy.review) } : {}),
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
  return policy.authorityCapture.sourceRevision === authorityRevision && meta?.size === protocol.size && meta.time === protocol.time &&
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
