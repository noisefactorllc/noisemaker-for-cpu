# CRT parity

`filter/crt` is the single failing effect in `npm run parity`. This document records why it fails, why it has been the hardest effect to port at every generation, and what a fix must and must not do. The gate stays red until CRT matches; the tolerance does not change.

## Status

Measured 2026-07-19 (and re-measured at every subsequent audit, most recently 2026-09-26 at `c2a1d18`) with:

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

The generated kernel (`src/effects/generated/canonical-kernels.js`, `canonicalFactory42`, key `filter/crt:crt`) retains the float-domain hash family from its GLSL/Python lineage, unlike most of the catalog, which uses integer PCG hashing (`floatBitsToUint` → `pcg3d`) and is bit-exact across backends by construction. The sensitive structure:

- `random_scalar(seed)` = `fract(sin(seed) * 43758.546875)` and `simplex_random` = `fract(sin(z*157 + w*113) * 43758.546875)` — seed- and time-derived scalars.
- `hash3`/`value_noise_3d` — `fract(sin(dot(...)) * 43758.546875)` value noise.
- Ashima-style `simplex_noise` with `mod289`/`permute`/`taylor_inv_sqrt` — long dependent float chains including an inverse-sqrt polynomial approximation.

These hashes exist to stretch the low-order bits of sine into full-range noise; the hash output is therefore *defined by* the ULP-level behavior of a particular backend's `sin` and arithmetic ordering. The pinned golden came from the GPU lane, where ANGLE/Metal fast-math contracts and reorders operations (fma fusion, approximate transcendentals and reciprocals). JavaScript with `Math.fround` reproduces IEEE-754 f32 operation-by-operation semantics, which is not the same arithmetic. The golden encodes one driver's approximations, not a backend-neutral frame.

Two amplification stages then convert ULP differences into large byte deltas:

1. Hash amplification: a one-ULP difference in a sine result decorrelates the hash output completely.
2. Resampling amplification: hash/simplex values feed `compute_lens_offsets`, displaced `texelFetch` coordinates (truncated with `|0`), and per-channel scanline sampling for the red/blue aberration taps. A displaced coordinate near an integer boundary flips a whole-texel fetch decision, producing deltas like the observed max of 80 in a single step.

## What has been tried

`src/effects/adapters/crt.js` wraps the generated factory (registered in `src/effects/adapters/index.js` as `filter/crt:crt`) and replaces `sin` with `metalSine`, which emulates Metal's turn-based range reduction: reduce `x/τ` to a fractional turn in f32, then take the sine of the reduced phase. This moved the result closer to the golden but is insufficient — the residual divergence indicates fast-math effects beyond sine range reduction (contraction and approximation elsewhere in the simplex/hash chains).

A turn-based cosine wrap (metalCosine, mirroring metalSine) was also tried (reverted commit `8debec5`). The kernel calls `cos` at four sites (`simplex_random` — not executed for this fixture — plus `animated_simplex_value`, `compute_lens_offsets`, and `blend_cosine`, which run per pixel). Measured against the retained golden on top of the retained metalSine adapter (isolating the cosine variable), the wrap changes output bytes and moves every metric away from the golden: `FAIL filter/crt max=105 mean=5.8633 channels>2=94` with the wrap versus `max=80 mean=5.0586 channels>2=89` without it. The wrap was therefore reverted because it worsens parity; the committed characterization test in `test/cpu-special-effects.test.js` pins both sides of this isolated measurement, and the same A/B numbers were reproduced by an independent out-of-repo probe. The residual divergence remains consistent with fast-math approximation behavior in the transcendental hash chains.

FMA-contraction emulation was then tested directly in the generated kernel (`canonicalFactory42`: `permute`, `mod289_vec3/vec4`, `taylor_inv_sqrt`, and the `z * 157 + w * 113` site in `simplex_random`, each rewritten as single-rounding `fround(a * b + c)` fused multiplies). Measured bit-identical on the fixture. For the `permute`/`mod289` chains this follows from the arithmetic: every intermediate is exactly representable in f32 for this fixture's value ranges, so fused and separately rounded ops agree. For the `taylor_inv_sqrt` and `simplex_random` sites the equality was measured rather than derived (separate f32 ops do double-round in general; these particular values happen to round identically). The same run confirmed the factory is on the executed path (forcing `random_scalar` to return the constant `0.5` shifts the result to `max=108 mean=6.2148 channels>2=99`, while one-ULP constant perturbations vanish under f32 rounding). Conclusion: the residual divergence is Metal's approximate transcendentals and reciprocal paths (their internal ULP patterns), which cannot be recovered by reassociation of IEEE ops; closing it requires either the driver's approximation formulas (not documented) or re-pinning the golden from a non-fast-math backend (path 2 above). These experiments were run as local working-tree patches and are not reproducible from the committed tree; the committed, independently runnable evidence is the characterization test above plus the parity/probe artifacts.

Further localization (2026-09-26) narrowed the divergence to the `fract(sin(x) * 43758.546875)` hash sites — 16 distinct scalar inputs (the 4 `random_scalar` call sites' seeds and the 12 distinct `value_noise_3d` corner-hash `dot_value`s that produce the two scanline base values). `dot` rounding variants (per-op f32, fma-chain, f64 accumulation) and `permute`/`mod289` algebraic reorderings (`x²·34 + x` per-op and fused) are all bit-identical no-ops because every intermediate in those chains is exactly representable in f32 for this fixture. Sine implementations tried at the hash sites: plain f32 `Math.sin` (max=105), f32 Taylor degree-7 (max=103), ARM optimized-routines-style `sinf` with f32 argument reduction (max=55, mean=5.67), and f64-accurate reduction plus `Math.sin` (mean 4.50, max 55) — none passes, and a greedy ±4-ULP-per-input search over all 16 distinct hash-site inputs (best: 91 over-tolerance channels, max 104) does not collapse toward the golden. The turn-based reduction already in the adapter remains the closest measured implementation (89 over-tolerance channels, max 80). Matching the retained golden therefore requires the capture backend's exact transcendental implementation, whose provenance is unidentified (GAP-008); with no GPU in this environment, GAP-001 is recorded as blocked in [COMPLETION_GAPS.md](COMPLETION_GAPS.md) pending one of the resolution paths above.

## Constraints on any fix

- The ±2-byte tolerance and the 8×8/time/seed fixture parameters do not change for this effect. Widening tolerance, shrinking the comparison, or marking CRT expected-fail would convert an honest red gate into a silent quality regression. Parity claims are enforced, not inferred.
- `npm run parity` must keep every non-CRT compared effect green while CRT is being worked on; a CRT fix that regresses any green effect is not a fix. At the 2026-09-26 catalog (164 compared, 41 skipped) the current non-CRT result is 163/164 with 114 byte-exact; the historical 166/167-with-117-byte-exact figures refer to the earlier, smaller catalog denominator.
- Visual comparison is not evidence for this effect, in either direction.

## Paths to green

1. **Finish emulating the golden backend's arithmetic** (the current lane). Locate the remaining divergence sites — candidate order: fma contraction in the simplex `permute`/`mod289` chains, `taylor_inv_sqrt`, reciprocal approximations in lens-offset math — and extend the scalar adapter. Deterministic but open-ended; each step chases undocumented driver behavior.
2. **Re-capture the golden from a backend without fast-math** (or with contraction disabled), making IEEE f32 the reference semantics. This changes a pinned fixture, so it is a golden-provenance policy decision, not a code fix.
3. **Move the upstream shader to integer hashing** (PCG over `floatBitsToUint`, like its catalog siblings), which is portable by construction. This changes CRT's output on GPU as well — an upstream aesthetic decision, out of scope for the port itself.

Option 1 is the only pure-port path; options 2 and 3 change the reference and require an explicit upstream/fixture decision.
