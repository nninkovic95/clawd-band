// Renders the README demos: each pose inside the whole band (sprite, model
// caption, both usage bars, reset countdowns), one GIF per pose plus a tour.
//
// The sprite is drawn through kitty's graphics protocol, which terminal
// recorders such as asciinema do not capture, so the demos are drawn here from
// the mod's own frame data (hooks/sprite.ts) and the band's layout as
// hooks/register.tsx lays it out, in Claude Code's dark-theme colours.
//
// Run from the repository root: node scripts/render-demo.ts
// Needs node 23.6+ (type stripping), rsvg-convert and ImageMagick (magick).

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ART_HEIGHT, ART_WIDTH, FRAMES, PIXEL_WIDTH, SCALE } from '../hooks/sprite.ts'

type Pose = keyof typeof FRAMES

// Layout, as in hooks/register.tsx.
const SPRITE_COLUMNS = 12
const SPRITE_ROWS = 3
const FRAME_MS = 400
const LABEL = 3
const PERCENT = 5
const RESET = 10
const COLUMNS = 72 // the terminal's body width in the demo

// Claude Code's dark theme.
const THEME = {
  background: '#1c1c1f',
  text: 'rgb(255,255,255)',
  dim: 'rgb(140,140,140)',
  inactive: 'rgb(153,153,153)',
  success: 'rgb(78,186,101)',
  warning: 'rgb(255,193,7)',
  error: 'rgb(255,107,128)',
  note: 'rgb(110,110,118)',
}

const CELL_W = 12
const CELL_H = 24
const FONT = 'JetBrainsMono Nerd Font Mono, JetBrains Mono, DejaVu Sans Mono, monospace'
const PAD = 16

const barColor = (percent: number) => (percent >= 85 ? THEME.error : percent >= 60 ? THEME.warning : THEME.success)

const countdown = (seconds: number): string => {
  const total = Math.max(0, seconds)
  const days = Math.floor(total / 86400)
  if (days > 0) return `${days}d ${Math.floor((total % 86400) / 3600)}h`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

type Scene = { pose: Pose; title: string; trigger: string; sevenDay: number; fiveHour: number }

// One scene per pose; the usage figures vary so the bar colours show too.
const SCENES: Scene[] = [
  { pose: 'idle', title: 'idle', trigger: 'nothing running: stands, blinks now and then', sevenDay: 23, fiveHour: 12 },
  { pose: 'thinking', title: 'thinking', trigger: 'the model is thinking: scratches its head', sevenDay: 23, fiveHour: 18 },
  { pose: 'working', title: 'working', trigger: 'replying, or any other tool call: arms pumping', sevenDay: 24, fiveHour: 27 },
  { pose: 'reading', title: 'reading', trigger: 'Read, Grep, Glob, ToolSearch, Claude Docs read/query/guide', sevenDay: 26, fiveHour: 38 },
  { pose: 'writing', title: 'writing', trigger: 'Edit, Write, NotebookEdit, Claude Docs edits', sevenDay: 31, fiveHour: 52 },
  { pose: 'running', title: 'running', trigger: 'Bash, BashOutput, KillShell, TaskStop', sevenDay: 34, fiveHour: 64 },
  { pose: 'searching', title: 'searching', trigger: 'WebFetch, WebSearch', sevenDay: 36, fiveHour: 73 },
  { pose: 'delegating', title: 'delegating', trigger: 'Agent, Task, SendMessage, Workflow, Skill', sevenDay: 39, fiveHour: 86 },
  { pose: 'questioning', title: 'questioning', trigger: 'AskUserQuestion: a "?" bobs beside it', sevenDay: 41, fiveHour: 91 },
]

const MODEL = 'Opus 5.5'
const EFFORT = 'high'
const FIVE_HOUR_RESET = 2 * 3600 + 14 * 60 + 9
const SEVEN_DAY_RESET = 4 * 86400 + 7 * 3600 + 31 * 60

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Run = { text: string; color: string; bold?: boolean }

// Each character on its own cell, as a terminal grid lays it.
const runs = (col: number, row: number, parts: Run[]): string => {
  let out = ''
  let c = col
  for (const p of parts) {
    for (const ch of p.text) {
      if (ch !== ' ') {
        const y = row * CELL_H + Math.round(CELL_H * 0.76)
        out += `<text x="${c * CELL_W}" y="${y}" fill="${p.color}"${p.bold ? ' font-weight="bold"' : ''}>${esc(ch)}</text>`
      }
      c += 1
    }
  }
  return out
}

// Block characters drawn as cells, so the bars meet edge to edge as in kitty.
const cells = (col: number, row: number, count: number, color: string, shade = false): string => {
  if (count <= 0) return ''
  const x = col * CELL_W
  const y = row * CELL_H
  if (!shade) return `<rect x="${x}" y="${y + 2}" width="${count * CELL_W}" height="${CELL_H - 4}" fill="${color}"/>`
  return `<rect x="${x}" y="${y + 2}" width="${count * CELL_W}" height="${CELL_H - 4}" fill="${color}" fill-opacity="0.28"/>`
}

const sprite = (rgbaBase64: string, col: number, row: number): string => {
  const px = Buffer.from(rgbaBase64, 'base64')
  const w = (SPRITE_COLUMNS * CELL_W) / ART_WIDTH
  const h = (SPRITE_ROWS * CELL_H) / ART_HEIGHT
  let out = ''
  for (let y = 0; y < ART_HEIGHT; y++) {
    for (let x = 0; x < ART_WIDTH; x++) {
      const i = ((y * SCALE + 2) * PIXEL_WIDTH + (x * SCALE + 2)) * 4
      if (px[i + 3] === 0) continue
      const fill = `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`
      out += `<rect x="${(col * CELL_W + x * w).toFixed(2)}" y="${(row * CELL_H + y * h).toFixed(2)}" width="${(w + 0.05).toFixed(2)}" height="${(h + 0.05).toFixed(2)}" fill="${fill}"/>`
    }
  }
  return out
}

const band = (scene: Scene, frame: number, elapsedMs: number, note?: string): string => {
  const caption = `${MODEL} ${EFFORT}`
  const left = Math.max(SPRITE_COLUMNS + 1, caption.length)
  const barWidth = Math.max(4, COLUMNS - left - 1 - LABEL - PERCENT - RESET)
  const elapsed = Math.floor(elapsedMs / 1000)
  const frames = FRAMES[scene.pose]

  const bar = (row: number, label: string, percent: number, resetIn: number) => {
    const col = left + 1
    const filled = Math.min(barWidth, Math.round((percent / 100) * barWidth))
    return (
      runs(col, row, [{ text: `${label} `, color: THEME.dim }]) +
      cells(col + LABEL, row, filled, barColor(percent)) +
      cells(col + LABEL + filled, row, barWidth - filled, THEME.inactive, true) +
      runs(col + LABEL + barWidth, row, [
        { text: ` ${String(Math.round(percent)).padStart(3)}%`, color: THEME.text },
        { text: ' ↻ ', color: THEME.dim },
        { text: countdown(resetIn - elapsed).padStart(RESET - 3), color: THEME.text, bold: true },
      ])
    )
  }

  const rows = note ? 6 : 4
  const width = COLUMNS * CELL_W + PAD * 2
  const height = rows * CELL_H + PAD * 2
  const captionCol = Math.floor((left - caption.length) / 2)
  const body =
    sprite(frames[frame % frames.length], Math.floor((left - SPRITE_COLUMNS) / 2), 0) +
    runs(captionCol, 3, [
      { text: MODEL, color: THEME.text, bold: true },
      { text: ` ${EFFORT}`, color: THEME.dim },
    ]) +
    bar(1, '7d', scene.sevenDay, SEVEN_DAY_RESET) +
    bar(2, '5h', scene.fiveHour, FIVE_HOUR_RESET) +
    (note ? runs(0, 5, [{ text: note, color: THEME.note }]) : '')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" rx="10" fill="${THEME.background}"/>
<g transform="translate(${PAD},${PAD})" font-family="${FONT}" font-size="20" shape-rendering="crispEdges">${body}</g>
</svg>`
}

const OUT = 'docs/demo'
mkdirSync(OUT, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'clawd-band-demo-'))

const gif = (name: string, svgs: string[]) => {
  const pngs = svgs.map((svg, i) => {
    const svgPath = join(work, `${name}-${String(i).padStart(3, '0')}.svg`)
    const pngPath = svgPath.replace(/\.svg$/, '.png')
    writeFileSync(svgPath, svg)
    execFileSync('rsvg-convert', ['-o', pngPath, svgPath])
    return pngPath
  })
  // Frames are held FRAME_MS each; GIF delays are in hundredths of a second.
  execFileSync('magick', ['-delay', String(FRAME_MS / 10), '-loop', '0', ...pngs, '-layers', 'Optimize', join(OUT, `${name}.gif`)])
}

// One GIF per pose: 12 frames (4.8 s) is a whole number of loops for every pose.
const FRAMES_PER_POSE = 12
for (const scene of SCENES) {
  gif(
    scene.pose,
    Array.from({ length: FRAMES_PER_POSE }, (_, f) => band(scene, f, f * FRAME_MS)),
  )
}

// The tour: every pose in turn, with a note under the band naming what raises it.
const TOUR_FRAMES = 6
const tour: string[] = []
SCENES.forEach((scene, s) => {
  for (let f = 0; f < TOUR_FRAMES; f++) {
    const t = (s * TOUR_FRAMES + f) * FRAME_MS
    tour.push(band(scene, f, t, `${scene.title.padEnd(12)} ${scene.trigger}`))
  }
})
gif('tour', tour)

rmSync(work, { recursive: true, force: true })
console.log(`wrote ${SCENES.length + 1} GIFs to ${OUT}/`)
