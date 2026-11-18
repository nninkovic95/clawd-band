// Renders the README demo: a tour of every pose inside the whole band (Clawd,
// the model line under him, the two usage bars with their reset countdowns,
// the context bar with its cache countdown),
// as one GIF at twice the cell size.
//
// Clawd and the bars are drawn through kitty's graphics protocol, which
// terminal recorders such as asciinema do not capture, so the demo is drawn
// here from the mod's own frame data (hooks/sprite.ts) and the band's layout
// as hooks/band.tsx lays it out, in Claude Code's dark-theme colours.
//
// Run from the repository root: node scripts/render-demo.ts
// Needs node 23.6+ (type stripping), rsvg-convert and ImageMagick (magick).

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { boxPixels } from '../hooks/picture.ts'
import { BOX_COLUMNS, BOX_ROWS, CLAUDE_ORANGE, picturesIn, PIXEL_HEIGHT, POSES } from '../hooks/sprite.ts'

type Pose = keyof typeof POSES

const FRAME_MS = 400
const COLUMNS = 72 // the terminal's body width in the demo

const CELL_W = 12
const CELL_H = 24
const FONT = 'JetBrainsMono Nerd Font Mono, JetBrains Mono, DejaVu Sans Mono, monospace'
const PAD = 16
const ZOOM = 2 // rsvg-convert's zoom: the GIF at twice the drawn size

// Clawd's pictures on a canvas the shape of his box of cells, as the mod draws
// them for cells this shape.
const canvas = boxPixels(BOX_COLUMNS, BOX_ROWS, CELL_H / CELL_W, PIXEL_HEIGHT / BOX_ROWS)
const picture = picturesIn(CLAUDE_ORANGE, canvas.width)

// Layout, as in hooks/band.tsx: a row above Clawd for the words over the
// bars, a cell either side of Clawd, the label, a dim dot in the cell either
// side of the bar, the percentage, the countdown, a free cell at the right edge.
const TOP = 1
const LABEL = 2 // "7d"
const FRAME = 1
const DOT = '·'
const PERCENT = 4 // " 99%"
const RESET = 12 // " 06d-23h-59m"
const BARS = 1 + BOX_COLUMNS + 1
const BAR = COLUMNS - BARS - LABEL - FRAME - FRAME - PERCENT - RESET - 1

// Claude Code's dark theme.
const THEME = {
  background: '#1c1c1f',
  text: 'rgb(255,255,255)',
  dim: 'rgb(140,140,140)',
  note: 'rgb(110,110,118)',
  weekly: 'rgb(175,135,255)', // autoAccept
  fiveHour: 'rgb(177,185,249)', // suggestion
  context: 'rgb(215,119,87)', // claude
  empty: 'rgb(153,153,153)', // inactive
  cold: 'rgb(95,160,230)',
}
const EMPTY_SOLID = 0.4 // the empty part lets the terminal show through

const countdown = (seconds: number, withDays: boolean): string => {
  const total = Math.max(0, seconds)
  const two = (n: number) => String(n).padStart(2, '0')
  const m = Math.floor((total % 3600) / 60)
  if (withDays) return `${two(Math.floor(total / 86400))}d-${two(Math.floor((total % 86400) / 3600))}h-${two(m)}m`
  return `${two(Math.floor(total / 3600))}h-${two(m)}m-${two(total % 60)}s`
}

type Scene = {
  pose: Pose
  title: string
  trigger: string
  sevenDay: number
  fiveHour: number
  context: number
  isCold?: boolean
}

// One scene per pose, with the usage climbing as the session goes on. The
// last one has sat idle past the cache lifetime.
const SCENES: Scene[] = [
  { pose: 'idle', title: 'idle', trigger: 'nothing running: a steaming mug, or a doze', sevenDay: 23, fiveHour: 12, context: 8 },
  { pose: 'waiting', title: 'waiting', trigger: 'a request is out and no word is back yet', sevenDay: 23, fiveHour: 14, context: 9 },
  { pose: 'thinking', title: 'thinking', trigger: 'the model is thinking', sevenDay: 23, fiveHour: 18, context: 11 },
  { pose: 'working', title: 'working', trigger: 'replying, or any tool not named below', sevenDay: 24, fiveHour: 27, context: 15 },
  { pose: 'reading', title: 'reading', trigger: 'Read, Grep, Glob, ToolSearch, Claude Docs read/query/guide', sevenDay: 26, fiveHour: 38, context: 22 },
  { pose: 'writing', title: 'writing', trigger: 'Edit, Write, NotebookEdit, Claude Docs edits', sevenDay: 31, fiveHour: 52, context: 30 },
  { pose: 'running', title: 'running', trigger: 'Bash, BashOutput, KillShell, TaskStop', sevenDay: 34, fiveHour: 64, context: 41 },
  { pose: 'searching', title: 'searching', trigger: 'WebFetch, WebSearch', sevenDay: 36, fiveHour: 73, context: 46 },
  { pose: 'delegating', title: 'delegating', trigger: 'Agent, Task, SendMessage, Workflow, Skill', sevenDay: 39, fiveHour: 86, context: 54 },
  { pose: 'questioning', title: 'questioning', trigger: 'AskUserQuestion, while Claude writes the question', sevenDay: 41, fiveHour: 91, context: 60 },
  { pose: 'compacting', title: 'compacting', trigger: 'the conversation is being compacted', sevenDay: 41, fiveHour: 92, context: 66 },
  { pose: 'finished', title: 'finished', trigger: 'the turn ended with an answer', sevenDay: 42, fiveHour: 93, context: 31 },
  { pose: 'interrupted', title: 'interrupted', trigger: 'the turn was stopped with Esc', sevenDay: 42, fiveHour: 94, context: 33 },
  { pose: 'refused', title: 'refused', trigger: 'the turn ended in a refusal', sevenDay: 42, fiveHour: 95, context: 34 },
  { pose: 'failed', title: 'failed', trigger: 'the turn ended in an error', sevenDay: 43, fiveHour: 96, context: 35 },
  { pose: 'idle', title: 'cache cold', trigger: 'an hour since the last reply: no cache left', sevenDay: 43, fiveHour: 96, context: 35, isCold: true },
]

const MODEL = 'Opus 5.5'
const EFFORT = 'high'
const FIVE_HOUR_RESET = 2 * 3600 + 14 * 60 + 9
const SEVEN_DAY_RESET = 4 * 86400 + 7 * 3600 + 31 * 60
const CACHE_LEFT = 59 * 60 + 58
const WINDOW = '1m'
const DAYS = 7

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

// A pill: the line with round ends that spans `from` to `to` across a row,
// drawn in by `inset` all round.
const capsule = (x: number, y: number, from: number, to: number, inset: number, fill: string, solid = 1): string => {
  const height = CELL_H - 2 * inset
  return `<rect x="${x + from + inset}" y="${y + inset}" width="${to - from - 2 * inset}" height="${height}" rx="${height / 2}" fill="${fill}"${solid < 1 ? ` fill-opacity="${solid}"` : ''}/>`
}

// One bar as hooks/pill.ts draws it: the empty part with a line of air round
// it, the fill inside a clear ring, and for the week a clear hairline between
// each two days.
const pill = (col: number, row: number, percent: number, color: string, segments: number): string => {
  const x = col * CELL_W
  const y = row * CELL_H
  const width = BAR * CELL_W
  const line = Math.max(1, Math.round(CELL_H / 12))
  const end = Math.max(CELL_H, (width * Math.min(100, percent)) / 100)
  let out = capsule(x, y, 0, width, line, THEME.empty, EMPTY_SOLID)
  if (percent > 0) out += capsule(x, y, 0, end, 2 * line, THEME.background) + capsule(x, y, 0, end, 3 * line, color)
  for (let day = 1; day < segments; day++) {
    out += `<rect x="${x + (day * width) / segments - line / 2}" y="${y}" width="${line}" height="${CELL_H}" fill="${THEME.background}"/>`
  }
  return out
}

// Clawd's picture scaled into his box, each row of the canvas as runs of one colour.
const sprite = ({ rgba, width, height }: { rgba: string; width: number; height: number }, col: number, row: number): string => {
  const px = Buffer.from(rgba, 'base64')
  const w = (BOX_COLUMNS * CELL_W) / width
  const h = (BOX_ROWS * CELL_H) / height
  const colorAt = (x: number, y: number): string | null => {
    const i = (y * width + x) * 4
    return x < width && px[i + 3] !== 0 ? `rgb(${px[i]},${px[i + 1]},${px[i + 2]})` : null
  }
  // Whole pixels, no smoothing: the rows meet without a seam.
  let out = '<g shape-rendering="crispEdges">'
  for (let y = 0; y < height; y++) {
    let from = 0
    for (let x = 1; x <= width; x++) {
      if (colorAt(x, y) === colorAt(from, y)) continue
      const fill = colorAt(from, y)
      if (fill) {
        out += `<rect x="${(col * CELL_W + from * w).toFixed(2)}" y="${(row * CELL_H + y * h).toFixed(2)}" width="${((x - from) * w + 0.05).toFixed(2)}" height="${(h + 0.05).toFixed(2)}" fill="${fill}"/>`
      }
      from = x
    }
  }
  return `${out}</g>`
}

const band = (scene: Scene, frame: number, elapsedMs: number, note?: string): string => {
  const caption = `${MODEL} · ${EFFORT}`
  const elapsed = Math.floor(elapsedMs / 1000)

  const barCol = BARS + LABEL + FRAME
  const bar = (at: number, label: string, percent: number, timer: string, color: string, timerColor = THEME.text) => {
    const row = TOP + at
    const drawn = pill(barCol, row, percent, color, label === '7d' ? DAYS : 1)
    return (
      runs(BARS, row, [
        { text: label.padEnd(LABEL), color: THEME.dim },
        { text: DOT, color: THEME.dim },
      ]) +
      drawn +
      runs(barCol + BAR, row, [
        { text: DOT, color: THEME.dim },
        { text: `${Math.round(percent)}%`.padStart(PERCENT), color: THEME.text },
        { text: ` ${timer.padStart(RESET - 1)}`, color: timerColor, bold: true },
      ])
    )
  }

  // The top row, three rows of Clawd and bars, the model line under him, and for the tour a note below.
  const rows = TOP + (note ? 6 : 4)
  const width = COLUMNS * CELL_W + PAD * 2
  const height = rows * CELL_H + PAD * 2
  const body =
    sprite(picture(scene.pose, 0, frame), 1, TOP) +
    runs(1 + Math.floor((BOX_COLUMNS - caption.length) / 2), TOP + 3, [
      { text: MODEL, color: THEME.text, bold: true },
      { text: ` · ${EFFORT}`, color: THEME.dim },
    ]) +
    bar(0, '7d', scene.sevenDay, countdown(SEVEN_DAY_RESET - elapsed, true), THEME.weekly) +
    bar(1, '5h', scene.fiveHour, countdown(FIVE_HOUR_RESET - elapsed, false), THEME.fiveHour) +
    (scene.isCold
      ? bar(2, WINDOW, scene.context, 'cold', THEME.cold, THEME.cold)
      : bar(2, WINDOW, scene.context, countdown(CACHE_LEFT - elapsed, false), THEME.context)) +
    (note ? runs(0, TOP + 5, [{ text: note, color: THEME.note }]) : '')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" rx="10" fill="${THEME.background}"/>
<g transform="translate(${PAD},${PAD})" font-family="${FONT}" font-size="20">${body}</g>
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
    execFileSync('rsvg-convert', ['-z', String(ZOOM), '-o', pngPath, svgPath])
    return pngPath
  })
  // Frames are held FRAME_MS each; GIF delays are in hundredths of a second.
  execFileSync('magick', ['-delay', String(FRAME_MS / 10), '-loop', '0', ...pngs, '-layers', 'Optimize', join(OUT, `${name}.gif`)])
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
console.log(`wrote ${OUT}/tour.gif`)
