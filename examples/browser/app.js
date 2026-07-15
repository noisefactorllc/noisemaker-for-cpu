import { renderToCanvasAsync } from '../../src/index.js'

const source = document.querySelector('#source')
const canvas = document.querySelector('#canvas')
const renderButton = document.querySelector('#render')
const seedButton = document.querySelector('#seed')
const sizeSelect = document.querySelector('#size')
const status = document.querySelector('#status')
const timing = document.querySelector('#timing')
const stage = document.querySelector('#stage')

let seed = 11
source.value = `search synth, filter, classicNoisedeck

noise(octaves: 4, scaleX: 18, scaleY: 12, ridges: true, colorMode: rgb)
  .kaleido(sides: 9, loopScale: 3, speed: 2, effectWidth: 0.35)
  .posterize(levels: 9, gamma: 0.85)
  .hs(rotation: 38, hueRange: 115, saturation: 1.35)
  .vignette(brightness: 0.42, alpha: 0.9)
  .write(o0)

render(o0)`

async function render() {
  const size = Number(sizeSelect.value)
  let tiles = 0
  const expectedTiles = Math.ceil(size / 32) * 5
  renderButton.disabled = true
  status.classList.remove('fault')
  status.textContent = `Rasterizing seed ${seed}`
  timing.textContent = 'CPU / working'
  stage.style.setProperty('--scan', '0%')
  try {
    const result = await renderToCanvasAsync(canvas, source.value, {
      width: size,
      height: size,
      seed,
      tileRows: 32,
      scheduler: async () => {
        tiles += 1
        stage.style.setProperty('--scan', `${Math.min(100, tiles / expectedTiles * 100)}%`)
        await new Promise(requestAnimationFrame)
      },
    })
    stage.style.setProperty('--scan', '100%')
    status.textContent = `${result.stats.passes} passes / ${result.stats.pixels.toLocaleString()} pixel calls`
    timing.textContent = `CPU / ${result.elapsedMs.toFixed(1)} ms`
  } catch (error) {
    status.textContent = error.message
    status.classList.add('fault')
    timing.textContent = 'CPU / stopped'
  } finally {
    renderButton.disabled = false
  }
}

renderButton.addEventListener('click', render)
seedButton.addEventListener('click', () => {
  seed = Math.floor(Math.random() * 1000) + 1
  seedButton.textContent = `Seed ${seed}`
})

render()
