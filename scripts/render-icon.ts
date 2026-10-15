// Renders the plugin directory icon, .claude-plugin/icon.png (1024 x 1024):
// Clawd from the idle frame in hooks/sprite.ts, standing on a usage bar.
//
// Run from the repository root: node scripts/render-icon.ts
// Needs node 23.6+ (type stripping) and rsvg-convert.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ART_HEIGHT, ART_WIDTH, FRAMES, PIXEL_WIDTH, SCALE } from '../hooks/sprite.ts'

const SIZE = 1024
const UNIT = 44 // one art pixel

// Claude Code's dark theme.
const BAR = ['rgb(78,186,101)', 'rgb(255,193,7)', 'rgb(255,107,128)']
const TRACK = 'rgb(58,58,64)'

// The idle frame's art pixels, cropped to Clawd.
const px = Buffer.from(FRAMES.idle[0], 'base64')
const art: { x: number; y: number; fill: string }[] = []
for (let y = 0; y < ART_HEIGHT; y++) {
  for (let x = 0; x < ART_WIDTH; x++) {
    const i = ((y * SCALE + 2) * PIXEL_WIDTH + (x * SCALE + 2)) * 4
    if (px[i + 3] !== 0) art.push({ x, y, fill: `rgb(${px[i]},${px[i + 1]},${px[i + 2]})` })
  }
}
const left = Math.min(...art.map(p => p.x))
const top = Math.min(...art.map(p => p.y))
const width = Math.max(...art.map(p => p.x)) - left + 1
const height = Math.max(...art.map(p => p.y)) - top + 1

const ox = (SIZE - width * UNIT) / 2
const oy = (SIZE - (height + 2.5) * UNIT) / 2 // Clawd, a one-pixel gap and the bar, centred
const clawd = art
  .map(p => `<rect x="${ox + (p.x - left) * UNIT}" y="${oy + (p.y - top) * UNIT}" width="${UNIT}" height="${UNIT}" fill="${p.fill}"/>`)
  .join('')

// A usage bar under the feet, one cell per art pixel, filled to 11 of 16.
const barY = oy + height * UNIT + UNIT
const cells = Array.from({ length: width }, (_, c) => {
  const fill = c < 6 ? BAR[0] : c < 9 ? BAR[1] : c < 11 ? BAR[2] : TRACK
  return `<rect x="${ox + c * UNIT + 3}" y="${barY}" width="${UNIT - 6}" height="${UNIT * 1.5}" rx="4" fill="${fill}"/>`
}).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<defs>
  <radialGradient id="glow" cx="50%" cy="42%" r="55%">
    <stop offset="0%" stop-color="rgb(215,119,87)" stop-opacity="0.30"/>
    <stop offset="100%" stop-color="rgb(215,119,87)" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${SIZE}" height="${SIZE}" fill="#17171a"/>
<rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>
<g shape-rendering="crispEdges">${clawd}</g>
${cells}
</svg>`

const work = mkdtempSync(join(tmpdir(), 'clawd-band-icon-'))
const svgPath = join(work, 'icon.svg')
writeFileSync(svgPath, svg)
execFileSync('rsvg-convert', ['-w', String(SIZE), '-h', String(SIZE), '-o', '.claude-plugin/icon.png', svgPath])
console.log('wrote .claude-plugin/icon.png')
