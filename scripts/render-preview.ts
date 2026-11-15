// Writes docs/preview/poses.html: every pose of hooks/sprite.ts, each variant
// animated as the picture and as the text Clawd, side by side. A developer
// tool: the plugin never runs it, and the page it writes loads nothing.
//
// Run from the repository root: node scripts/render-preview.ts [path to sprite.ts] [page to write]
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = resolve(process.argv[2] ?? 'hooks/sprite.ts')
const out = process.argv[3] ?? 'docs/preview/poses.html'
const sprite = await import(pathToFileURL(source).href)
const { PICTURE_HEIGHT, PICTURE_WIDTH, CLAUDE_ORANGE, PIXEL_WIDTH, POSES, SCALE, lengthOf, picturesIn, textIn, toHex } = sprite

type Run = { text: string; color: string }
type Shown = { name: string; alt: string; notes: string[]; frames: { art: string[]; text: Run[][] }[] }

const BODY = toHex(CLAUDE_ORANGE)
const picture = picturesIn(CLAUDE_ORANGE)
const text = textIn(BODY)

// One colour per art pixel, read back from the picture; '' where it is clear.
const artOf = (rgba: string): string[] => {
  const px = Buffer.from(rgba, 'base64')
  const art: string[] = []
  for (let y = 0; y < PICTURE_HEIGHT; y++) {
    for (let x = 0; x < PICTURE_WIDTH; x++) {
      const at = (y * SCALE * PIXEL_WIDTH + x * SCALE) * 4
      art.push(px[at + 3] ? toHex([px[at], px[at + 1], px[at + 2]]) : '')
    }
  }
  return art
}

const shown: Shown[] = Object.entries(POSES as Record<string, { alt: string; variants: unknown[]; once?: true; outsideTurn?: true }>).flatMap(
  ([pose, art]) =>
    art.variants.map((_, roll) => ({
      name: art.variants.length > 1 ? `${pose} ${roll + 1}/${art.variants.length}` : pose,
      alt: art.alt,
      notes: [art.once ? 'plays once' : 'loops', ...(art.outsideTurn ? ['shows outside a turn'] : [])],
      frames: Array.from({ length: lengthOf(pose, roll) }, (_, n) => ({
        art: artOf(picture(pose, roll, n)),
        text: text(pose, roll, n),
      })),
    })),
)

const page = `<!doctype html>
<meta charset="utf-8">
<title>clawd-band poses</title>
<style>
  body { background: #1b1b1f; color: #d8d8d8; font: 14px/1.4 system-ui, sans-serif; margin: 24px; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }
  section { background: #24242a; border-radius: 8px; padding: 12px 14px; }
  h2 { font-size: 15px; margin: 0; }
  p { margin: 2px 0 10px; color: #9a9aa2; font-size: 12px; }
  .forms { display: flex; align-items: center; gap: 18px; }
  canvas { image-rendering: pixelated; width: 168px; height: 84px; background: #1b1b1f; border-radius: 4px; }
  pre { font: 20px/1 "JetBrains Mono", "DejaVu Sans Mono", monospace; margin: 0; background: #1b1b1f; padding: 6px 4px; border-radius: 4px; }
</style>
<h1>clawd-band poses</h1>
<p>Left: the picture (kitty graphics). Right: the text Clawd (background sessions, other terminals). 400 ms a frame; a pose that plays once rests a moment before it starts over here.</p>
<main id="poses"></main>
<script>
const WIDTH = ${PICTURE_WIDTH}, HEIGHT = ${PICTURE_HEIGHT}, REST = 4
const POSES = ${JSON.stringify(shown)}
const draws = POSES.map(pose => {
  const section = document.createElement('section')
  section.innerHTML = '<h2></h2><p></p><div class="forms"><canvas width="' + WIDTH + '" height="' + HEIGHT + '"></canvas><pre></pre></div>'
  section.querySelector('h2').textContent = pose.name
  section.querySelector('p').textContent = pose.alt + ' · ' + pose.notes.join(' · ')
  document.getElementById('poses').append(section)
  const canvas = section.querySelector('canvas').getContext('2d')
  const pre = section.querySelector('pre')
  // A pose that plays once holds its last frame for a few ticks, as rest would follow it.
  const length = pose.frames.length + (pose.notes.includes('plays once') ? REST : 0)
  return tick => {
    const frame = pose.frames[Math.min(tick % length, pose.frames.length - 1)]
    canvas.clearRect(0, 0, WIDTH, HEIGHT)
    frame.art.forEach((color, at) => {
      if (!color) return
      canvas.fillStyle = color
      canvas.fillRect(at % WIDTH, Math.floor(at / WIDTH), 1, 1)
    })
    pre.replaceChildren(...frame.text.flatMap(runs => [
      ...runs.map(run => Object.assign(document.createElement('span'), { textContent: run.text, style: 'color:' + run.color })),
      document.createTextNode('\\n'),
    ]))
  }
})
let tick = 0
const step = () => { for (const draw of draws) draw(tick); tick += 1 }
step()
setInterval(step, 400)
</script>
`

writeFileSync(out, page)
console.log(`${out}: ${shown.length} animations, ${shown.reduce((n, pose) => n + pose.frames.length, 0)} frames`)
