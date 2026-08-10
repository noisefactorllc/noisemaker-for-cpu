search synth

noise(seed: 1, 
  type: hermite,
  ridges: true,
  speed: 30,
  colorMode: mono
)
  .write(o0)

navierStokes(seed: 1, 
  tex: read(o0),
  dyeDecay: 98,
  inputForce: 0.5,
  inputIntensity: 10
)
  .write(o1)

render(o1)
