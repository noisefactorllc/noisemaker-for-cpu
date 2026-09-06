# {{NM_PROGRAM_NAME}}

This package exports your Noisedeck program to render **on the CPU**. It requires no GPU, WebGL, native addon, or `npm install`. `engine/` contains the whole engine. Node executes the shader code as ordinary JavaScript, one pixel at a time. It fetches nothing at runtime.

This export runs anywhere Node runs: a server, container, CI job, or machine without a display. It is the slowest export. A GPU draws a frame in milliseconds because it colors thousands of pixels at once. This renderer processes them one at a time.

## Run it

You need **Node 22 or newer** and no other dependencies. Unzip this folder. Open a terminal in it. Start with a small image:

```sh
node engine/bin/noisemaker-cpu.js render program.dsl --width 64 --height 64 --output out.png
```

The command writes a 64×64 `out.png` beside your program. This checks that the export works. Then increase the output size:

```sh
node engine/bin/noisemaker-cpu.js render program.dsl --width 512 --height 512 --output art.png
```

Rendering time increases with the pixel count. The amount of increase depends entirely on the program. Increase the size gradually.

Useful options:

- `--seed N` selects the deterministic seed.
- `--time N` sets the normalized time for effects that animate.
- `--input file.png` binds an image for programs that sample one.

`node engine/bin/noisemaker-cpu.js --help` lists the rest.

## What's inside

| Path | What it is |
| --- | --- |
| `program.dsl` | Your program's source, exactly as it was in Noisedeck. |
| `engine/bin/noisemaker-cpu.js` | The port's command line renderer. This is the file you run. |
| `engine/src/` | The engine: DSL parser, effect catalog, and the pixel kernels. |
| `noisedeck-export.json` | The exported content, export time, and engine build. |
| `LICENSES/` | Licenses for everything shipped here. |

`engine/bin/noisemaker-cpu.js` resolves `engine/src/` relative to itself. If you copy the whole `engine/` directory elsewhere, the same command works from that location.

## The engine

The export includes the port and runs offline without changes. It is also a normal package for your own Node or browser code. `import { CpuRenderer } from './engine/src/index.js'` imports the same renderer. <https://github.com/noisefactorllc/noisemaker-for-cpu> documents that API.

Noisedeck exported this program against Noisemaker `{{NM_ENGINE_VERSION}}`. The CPU port is a separate implementation of that engine. Expect small differences from the app output.

## Editing it

Replace `program.dsl` with a Noisemaker program that uses only the supported effects listed below. Run the same command again. To render several variations, call `CpuRenderer` in a loop in your own code. This avoids process startup for each variation.

## Effects used by this program

{{NM_EFFECT_LIST}}

## What this port cannot render

This port cannot render five effects from the upstream catalog:

- `synth/roll`, `synth/scope` and `synth/spectrum` react to live audio.
- `render/meshLoader` and `render/meshRender` need a mesh pipeline.

Everything else in the catalog renders here.
`node engine/bin/noisemaker-cpu.js effects` lists exactly which effects this engine contains.

To check an edited `program.dsl` against a different build of this port:

1. Import the program into Noisedeck.
2. Open the export dialog.
3. Select JavaScript.

Before you export again, the dialog marks any effect the port cannot render.

## License

The Noisemaker engine and the CPU port are MIT licensed. See `LICENSES/`. Your program and the
imagery it renders are yours.
