search mixer, synth

solid(color: #000000)
.write(o0)

noise(seed: 1)
.cellSplit(seed: 1, invert: sourceB)
.write(o1)
