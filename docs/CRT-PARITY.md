# CRT parity

`filter/crt` passes the parity gate. This document records how the CPU adapter matches the retained reference capture, what the reference capture is, and the limits that remain.

## Status

Measured 2026-10-17 with:

```bash
./scripts/parity-summary filter/crt
```

```text
STRICT filter/crt max=1 mean=0.0703 channels>2=0 differingChannels=18
```

The fixture is `parity/upstream-defaults/filter__crt.dsl`: `noise(seed: 1, ridges: true).crt(seed: 1)` at 8×8, time `0.25`, seed `1`, compared against `parity/goldens/defaults/filter__crt.golden.png` with the unchanged ±2-byte tolerance. The previous adapter measured `max=80 mean=5.0391 channels>2=88` on the same fixture.

## Reference capture

The golden (SHA-256 `908fe6f6a21e5d9e3606aafae40aaf535e918acec9aef4563a1736b9712183f2`) has no capture record, so its provenance stays `unknown`. Fresh captures of the fixture at upstream pin `6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d` (upstream `CanvasRenderer`, WebGL2, one `render(0.25)`, two identical `readPixels('global_o0_write')` readbacks) measured:

| Capture host | Bytes against the golden |
| --- | --- |
| Apple M2, macOS 14.8.3, ANGLE Metal, HeadlessChrome 143.0.7499.4 through 156.0.8078.4 (seven builds, identical bytes, RGBA SHA-256 `7fc77bf05a97bf7d891f0b6e341676c31fb3deb0f2dc850ebdb662aecfe032db`) | 18 channels differ by 1; none exceeds ±2 |
| Apple M4, macOS 26.5, ANGLE Metal, HeadlessChrome 156.0.8078.4 | max 50, mean 7.55078125, 112 channels over ±2 |

The golden is therefore a Metal capture from the M2/macOS 14 compile of the shader, or from a build very close to it. No available build reproduces it byte for byte, so no capture revision is recorded. The M4/macOS 26.5 compile evaluates the shader differently (different constant folding and sine results), and its output is not the retained reference.

## How the adapter matches Metal

`src/effects/adapters/crt.js` is a direct float32 translation of the pinned `crt.glsl`, registered as `filter/crt:crt`. It replaces the generated kernel, which mixed float64 scalar arithmetic with float32 storage. Each rule below was measured on the M2/macOS 14 host with WebGL2 probes that read float32 results exactly through RGBA32UI render targets:

- Every operation rounds to float32. `a * b + c` is one fused multiply-add (16,384 of 16,384 random probes), `mix(a, b, t)` is `fma(t, b - a, a)` (16,384 of 16,384), `pow(x, 3.0)` is `(x * x) * x` and `pow(x, 5.0)` is `(x²)² * x` (16,384 of 16,384 each), and `a / b` is `a` times the float32 reciprocal of `b` (all 64 `gradient` values of a 64×64 frame).
- `sin` and `cos` reduce the angle to a quadrant `r = 4 * fract(x * f32(1/τ))`; `cos` adds `1/4` to the turns with a fused multiply-add. The hardware result depends only on `r` (no conflict over 524,288 probes) and is symmetric across the four quadrants. It equals `y * P(y)` for the folded quadrant position `y`, where `P` runs slightly below `sin(πy/2)/y`. The exact hardware formula for `P` is unknown, so the adapter fits it. The model is the exact quotient minus a three-term residual in `z = 2y² - 1`. The coefficients come from a linear-program fit to the M2 hardware sine at 270,605 distinct folded positions. Those positions come from a uniform grid of 262,144 angles over one turn and from 262,144 random angles in [90, 140], the range of the CRT hash inputs. No CRT fixture values were used. The fit reproduces 234,624 of the measured values (86.7%) bit-exactly and the rest within 2 ulp.
- The compiler merges the reduction multiply into a preceding constant multiply: `sin(t * TAU)` reduces `t`, `cos(t * TAU)` reduces `t + 1/4`, and `cos(m * PI)` reduces `fma(m, 1/2, 1/4)`. On 4,096 probes per form, every in-context result agreed with the standalone result at the same reduced `r`.
- For the four `random_scalar(seed_base + c)` hashes, the compiler distributes the reduction multiply over the sum: the reduced turns are `fma(seed, f32(73/τ), f32(f32(17 + c)/τ))`. This form reproduced all four measured hash values. Reducing a rounded `seed_base + c` reproduced one.
- `blend_cosine` evaluates its `mix` as `fma(b, w, a * (0.5 + 0.5 * cos))` with `w = (1 - cos) * 0.5`. This form decides the integer `texelFetch` column of the red and blue aberration taps, where the sample lands within an ulp of a texel boundary. Fetch columns inferred from captures, for pixels where the column changes the output, gave:

| Frame | `fma(b, w, a * (0.5 + 0.5 * cos))` | `fma(w, b - a, a)` |
| --- | ---: | ---: |
| 8×8 gate fixture | 78 of 78 | 77 of 78 |
| 16×16 | 396 of 396 | 392 of 396 |
| 24×12 | 428 of 430 | 426 of 430 |
| 64×64 | 6,663 of 6,732 | 6,673 of 6,732 |

  The adapter keeps the first form because it decides every column of the gate fixture correctly.

`test/cpu-special-effects.test.js` pins the result. It checks the fused multiply-add against exact rational rounding, including double-rounding cases. It also checks that five 8×8 programs reproduce the M2 capture bytes exactly, and that the gate fixture stays within one byte of the golden.

## Measured result

CPU output against the M2/macOS 14 captures at the pin (channels over ±2, maximum error):

| Program | Size, time | Previous adapter | Current adapter |
| --- | --- | --- | --- |
| `noise(seed: 1, ridges: true).crt(seed: 1)` | 8×8, 0.25 | 89, max 80 | byte-exact |
| `noise(seed: 1, ridges: true).crt(seed: 2)` | 8×8, 0.25 | 11, max 72 | byte-exact |
| `noise(seed: 3, ridges: true).crt(seed: 37)` | 8×8, 0.25 | 163, max 99 | 0, max 1 |
| `noise(seed: 1, ridges: true).crt(seed: 1)` | 8×8, 0.6 | 84, max 75 | byte-exact |
| `noise(seed: 1, ridges: true).crt(seed: 5, speed: 2.5)` | 8×8, 0.4 | 151, max 113 | byte-exact |
| `noise(seed: 2).crt(seed: 9, alpha: 1)` | 8×8, 0.25 | 8, max 104 | byte-exact |
| `noise(seed: 1, ridges: true).crt(seed: 1)` | 16×16, 0.25 | 374, max 83 | 8, max 83 |
| `noise(seed: 4).crt(seed: 3)` | 24×12, 0.3 | 730, max 128 | 9, max 60 |
| `noise(seed: 1, scaleX: 50, scaleY: 50).crt()` | 64×64, 0.25 | 3,908, max 77 | 102, max 61 |

## Remaining limits

- Larger frames still choose a different aberration texel at a few boundary pixels (the 16×16, 24×12 and 64×64 rows above). No measured `mix` form decides every column of those frames.
- The sine residual is a fit, not the hardware formula: 13.3% of the measured values differ by 1 or 2 ulp.
- The adapter follows the M2/macOS 14 compile that matches the retained golden. It does not follow the M4/macOS 26.5 compile.

## Why visual verification fails on this effect

The scanline structure sits near the Nyquist frequency of the render, so what is visible is the beat pattern between the scanlines and the pixel grid. A sub-pixel phase difference moves that moiré across the whole frame, and any resampling of a screenshot makes its own moiré. The harness compares bytes at 8×8, where no beat pattern forms. Verify CRT changes with byte comparisons, not by looking at output.

## Constraints on any change

- The upstream shader, its hash family, the retained golden, the 8×8 fixture and the ±2-byte tolerance do not change.
- An adapter change must keep the capture-byte regression test passing, or replace it with new measured captures and record why.

## History

From the first CPU port until 2026-10-17, `filter/crt` failed the gate (most recently `max=80 mean=5.0391 channels>2=88`). The earlier adapter replaced only `sin` with a turn-based reduction on float64 inputs. On 2026-09-29 the operator accepted that result as a scoped approximation: “we can not change the upstream implementation, we can not break people's existing effects. just get it as close as you can with a note for future implementors.” The analysis at that time measured only an Apple M4 host and concluded that no available backend reproduced the golden. The M2/macOS 14 captures above supersede that conclusion. The current adapter changes no upstream source, golden, fixture or tolerance. It changes the CPU port's CRT output for every input, moving it toward the GPU result.
