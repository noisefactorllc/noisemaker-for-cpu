search synth, filter, classicNoisedeck

noise(
  octaves: 4,
  scaleX: 18,
  scaleY: 12,
  seed: 11,
  ridges: true,
  colorMode: rgb
)
  .kaleido(sides: 9, loopScale: 3, speed: 2, effectWidth: 0.35)
  .posterize(levels: 9, gamma: 0.85)
  .hs(rotation: 38, hueRange: 115, saturation: 1.35)
  .vignette(brightness: 0.42, alpha: 0.9)
  .write(o0)

render(o0)
