# CRT parity

`filter/crt` is the single failing effect in `npm run parity`. This document records why it fails, why it has been the hardest effect to port at every generation, and what a fix must and must not do. The gate stays red until CRT matches; the tolerance does not change.

## Status

Measured 2026-07-19 with:

```bash
node scripts/parity/run.js --suite defaults --only filter__crt
```

```text
FAIL filter/crt max=80 mean=5.0586 channels>2=89
```

At 8×8, time `0.25`, seed `1`: 89 of 256 RGBA channels exceed the ±2-byte tolerance, mean absolute delta 5.06, worst channel off by 80. The error is localized and large-magnitude rather than uniform drift, consistent with discrete resampling decisions flipping (see below), not accumulated rounding.

The fixture is `parity/upstream-defaults/filter__crt.dsl`: `noise(seed: 1, ridges: true).crt(seed: 1)` compared against `parity/goldens/defaults/filter__crt.golden.png`.

## Lineage

The CRT effect originated in the classic Python Noisemaker and has been ported twice: Python → GLSL (upstream Noisemaker), and GLSL → this CPU backend. It was painful at every step, for the same underlying reason expressed in two domains: the effect amplifies tiny differences into large observable ones, which defeats both visual and numeric verification.

## Why visual verification fails on this effect

The scanline structure sits near the Nyquist frequency of the render. What is visible is not the scanlines themselves but the beat pattern between the scanline frequency and the pixel grid — moiré. Consequences:

- A sub-pixel phase difference relocates the interference pattern globally. Two perceptually equivalent renders can differ at almost every pixel; two meaningfully different renders can look similar.
- Any resampling in the observation channel — screenshot scaling, thumbnails, the preprocessing a computer-vision model applies before looking at an image — manufactures its own moiré. An observed difference cannot be attributed to the render.

Computer-vision-assisted comparison is therefore unusable for this effect, and human inspection is little better. This is one reason the parity harness compares bytes at 8×8 — too small for a beat pattern to form — and never gates on appearance. Do not "verify" CRT changes by looking at output.

## Why byte parity currently fails

The generated kernel (`src/effects/generated/canonical-kernels.js`, `canonicalFactory39`, key `filter/crt:crt`) retains the float-domain hash family from its GLSL/Python lineage, unlike most of the catalog, which uses integer PCG hashing (`floatBitsToUint` → `pcg3d`) and is bit-exact across backends by construction. The sensitive structure:

- `random_scalar(seed)` = `fract(sin(seed) * 43758.546875)` and `simplex_random` = `fract(sin(z*157 + w*113) * 43758.546875)` — seed- and time-derived scalars.
- `hash3`/`value_noise_3d` — `fract(sin(dot(...)) * 43758.546875)` value noise.
- Ashima-style `simplex_noise` with `mod289`/`permute`/`taylor_inv_sqrt` — long dependent float chains including an inverse-sqrt polynomial approximation.

These hashes exist to stretch the low-order bits of sine into full-range noise; the hash output is therefore *defined by* the ULP-level behavior of a particular backend's `sin` and arithmetic ordering. The pinned golden came from the GPU lane, where ANGLE/Metal fast-math contracts and reorders operations (fma fusion, approximate transcendentals and reciprocals). JavaScript with `Math.fround` reproduces IEEE-754 f32 operation-by-operation semantics, which is not the same arithmetic. The golden encodes one driver's approximations, not a backend-neutral frame.

Two amplification stages then convert ULP differences into large byte deltas:

1. Hash amplification: a one-ULP difference in a sine result decorrelates the hash output completely.
2. Resampling amplification: hash/simplex values feed `compute_lens_offsets`, displaced `texelFetch` coordinates (truncated with `|0`), and per-channel scanline sampling for the red/blue aberration taps. A displaced coordinate near an integer boundary flips a whole-texel fetch decision, producing deltas like the observed max of 80 in a single step.

## What has been tried

`src/effects/adapters/crt.js` wraps the generated factory (registered in `src/effects/adapters/index.js` as `filter/crt:crt`) and replaces `sin` with `metalSine`, which emulates Metal's turn-based range reduction: reduce `x/τ` to a fractional turn in f32, then take the sine of the reduced phase. This moved the result closer to the golden but is insufficient — the residual divergence indicates fast-math effects beyond sine range reduction (contraction and approximation elsewhere in the simplex/hash chains).

A turn-based cosine wrap (metalCosine, mirroring metalSine) was also tried and measured as a bit-identical no-op on the fixture: with and without the wrap, `node scripts/parity/run.js --suite defaults --only filter__crt` reports the same `FAIL filter/crt max=80 mean=5.0586 channels>2=89`. The only `cos` site in the kernel (`simplex_random`, evaluated at `angle = time * TAU`) is unaffected by Metal's turn-based range reduction at this fixture's magnitudes, so the wrap was reverted. Sine range reduction plus cosine wrapping together do not close the gap; the remaining divergence is consistent with fma contraction and approximation behavior deeper in the simplex/hash chains.

## Constraints on any fix

- The ±2-byte tolerance and the 8×8/time/seed fixture parameters do not change for this effect. Widening tolerance, shrinking the comparison, or marking CRT expected-fail would convert an honest red gate into a silent quality regression. Parity claims are enforced, not inferred.
- `npm run parity` must remain 166/167 with 117 byte-exact while CRT is being worked on; a CRT fix that regresses any green effect is not a fix.
- Visual comparison is not evidence for this effect, in either direction.

## Paths to green

1. **Finish emulating the golden backend's arithmetic** (the current lane). Locate the remaining divergence sites — candidate order: fma contraction in the simplex `permute`/`mod289` chains, `taylor_inv_sqrt`, reciprocal approximations in lens-offset math — and extend the scalar adapter. Deterministic but open-ended; each step chases undocumented driver behavior.
2. **Re-capture the golden from a backend without fast-math** (or with contraction disabled), making IEEE f32 the reference semantics. This changes a pinned fixture, so it is a golden-provenance policy decision, not a code fix.
3. **Move the upstream shader to integer hashing** (PCG over `floatBitsToUint`, like its catalog siblings), which is portable by construction. This changes CRT's output on GPU as well — an upstream aesthetic decision, out of scope for the port itself.

Option 1 is the only pure-port path; options 2 and 3 change the reference and require an explicit upstream/fixture decision.
