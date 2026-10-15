import type { Pose } from '../types'

// Clawd as the CLI prints it at startup (▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝): a
// quadrant is twice as tall as wide, so each logo pixel is drawn here as one
// column by two rows of square art pixels. The body sits at the bottom of the
// canvas; the rows above it and the columns beside it hold the props.
export const ART_WIDTH = 28
export const ART_HEIGHT = 14
export const SCALE = 5
export const PIXEL_WIDTH = ART_WIDTH * SCALE
export const PIXEL_HEIGHT = ART_HEIGHT * SCALE

const COLORS: Record<string, [number, number, number]> = {
  '#': [215, 119, 87], // Claude orange
  w: [235, 232, 225], // thought dots, speed lines, ink
  y: [240, 190, 60], // pencil, "?"
  k: [70, 60, 55], // pencil tip, glass handle
  b: [240, 236, 226], // book pages
  l: [150, 120, 100], // book spine
  g: [170, 200, 220], // magnifying glass
}

type Grid = string[][]

const blank = (): Grid => Array.from({ length: ART_HEIGHT }, () => Array<string>(ART_WIDTH).fill('.'))

// Paints a pattern at (x, y): a space leaves the pixel, a dot clears it.
const stamp = (g: Grid, pattern: string[], x: number, y: number): Grid => {
  pattern.forEach((row, r) =>
    row.split('').forEach((ch, c) => {
      const gy = y + r
      const gx = x + c
      if (ch === ' ' || gy < 0 || gy >= ART_HEIGHT || gx < 0 || gx >= ART_WIDTH) return
      g[gy][gx] = ch
    }),
  )
  return g
}

const fill = (w: number, h: number, ch = '#'): string[] => Array.from({ length: h }, () => ch.repeat(w))

type Arm = 'out' | 'up' | 'down' | 'none'

type Body = {
  y?: number
  eyes?: 'open' | 'shut' | 'left' | 'right' | 'down'
  left?: Arm
  right?: Arm
  legs?: 'stand' | 'stride' | 'long'
}

const X = 5 // the body's left edge, arms included

const body = ({ y = 4, eyes = 'open', left = 'out', right = 'out', legs = 'stand' }: Body = {}): Grid => {
  const g = blank()
  stamp(g, fill(12, 8), X + 3, y)

  const eyeRows = eyes === 'down' ? [y + 3] : [y + 2, y + 3]
  const shift = eyes === 'left' ? -1 : eyes === 'right' ? 1 : 0
  if (eyes !== 'shut') for (const r of eyeRows) for (const c of [X + 5, X + 12]) g[r][c + shift] = '.'

  const arm = (side: Arm, col: number) => {
    if (side === 'out') stamp(g, fill(2, 2), col, y + 4)
    if (side === 'up') stamp(g, fill(2, 5), col, y - 1)
    if (side === 'down') stamp(g, fill(2, 2), col, y + 6)
  }
  arm(left, X + 1)
  arm(right, X + 15)

  const feet = [X + 4, X + 6, X + 11, X + 13]
  const spread = [X + 3, X + 7, X + 10, X + 14]
  for (const c of feet) stamp(g, ['#'], c, y + 8)
  for (const c of legs === 'stride' ? spread : feet) stamp(g, ['#'], c, y + 9)
  if (legs === 'long') for (const c of spread) stamp(g, ['#'], c, y + 10)
  return g
}

// Idle: stands, blinks now and then.
const stand = body()
const idle = [stand, stand, stand, stand, stand, body({ eyes: 'shut' })]

// Thinking: a hand on the head, scratching, and a thought bubble rising.
const scratch = (handX: number, dots: number): Grid => {
  const g = body({ eyes: 'left', right: 'up' })
  stamp(g, ['###'], handX, 3)
  if (dots >= 1) stamp(g, ['w'], 6, 2)
  if (dots >= 2) stamp(g, ['w'], 4, 1)
  if (dots >= 3) stamp(g, ['ww', 'ww'], 1, 0)
  return g
}
const thinking = [scratch(17, 1), scratch(16, 2), scratch(17, 3), scratch(16, 3)]

// Questioning: a "?" that bobs beside the head.
const QUESTION = [' yyy ', 'y   y', '    y', '   y ', '  y  ', '     ', '  y  ']
const asking = (y: number): Grid => stamp(body({ eyes: 'right' }), QUESTION, 22, y)
const questioning = [asking(0), asking(0), asking(1), asking(1)]

// Working: both arms pumping.
const working = [body({ left: 'up', right: 'up' }), stand, body({ left: 'down', right: 'down' }), stand]

// Reading: a book held up, the eyes running along the line, then a page turns.
const BOOK = fill(5, 4, 'b').map(r => `${r}ll${r}`)
const reader = (eyes: Body['eyes'], turning = false): Grid => {
  const g = stamp(body({ eyes }), BOOK, X + 3, 8)
  if (turning) stamp(g, ['  bbbb', ' bbbb'], X + 10, 6)
  return g
}
const reading = [reader('left'), reader('open'), reader('right'), reader('down', true)]

// Writing: a pencil in the right hand, leaving a line of ink as it moves.
const PENCIL = ['y   ', ' y  ', '  y ', '   k']
const writer = (step: number): Grid => {
  const g = body({ eyes: 'down' })
  const px = 21 + step
  stamp(g, ['#'.repeat(step + 1)], 21, 8)
  stamp(g, PENCIL, px, 9)
  stamp(g, ['w'.repeat(px + 3 - 21)], 21, 13)
  return g
}
const writing = [writer(0), writer(1), writer(2), writer(2)]

// Running: a stride, then a bounce with the legs out, speed lines behind.
const runA = stamp(stamp(body({ legs: 'stride', left: 'up', right: 'down' }), ['www'], 0, 6), ['ww'], 1, 10)
const runB = stamp(stamp(body({ y: 3, legs: 'long', left: 'down', right: 'up' }), ['ww'], 1, 5), ['www'], 0, 9)
const running = [runA, runB]

// Searching: a magnifying glass held up on one side, then the other.
const GLASS = [' ggg ', 'g   g', 'g   g', 'g   g', ' ggg ']
const glassRight = stamp(stamp(body({ eyes: 'right', right: 'none' }), GLASS, 22, 0), ['k', '#', '##'], 22, 5)
const glassLeft = stamp(stamp(body({ eyes: 'left', left: 'none' }), GLASS, 1, 0), [' k', ' #', '##'], 4, 5)
const searching = [glassRight, glassRight, glassLeft, glassLeft]

// Delegating: waving a small Clawd off on its errand.
const MINI = ['.###.', '#####', '.###.', '.#.#.']
const waver = (handX: number, miniX: number, miniY: number): Grid => {
  const g = body({ left: 'up', eyes: 'right' })
  stamp(g, ['##'], handX, 2)
  return stamp(g, MINI, miniX, miniY)
}
const delegating = [waver(5, 22, 10), waver(4, 23, 9)]

const ART: Record<Pose, Grid[]> = {
  idle,
  thinking,
  questioning,
  working,
  reading,
  writing,
  running,
  searching,
  delegating,
}

const toBase64 = (art: Grid): string => {
  const px = new Uint8Array(PIXEL_WIDTH * PIXEL_HEIGHT * 4)
  for (let y = 0; y < PIXEL_HEIGHT; y++) {
    const row = art[Math.floor(y / SCALE)]
    for (let x = 0; x < PIXEL_WIDTH; x++) {
      const rgb = COLORS[row[Math.floor(x / SCALE)]]
      if (!rgb) continue
      const i = (y * PIXEL_WIDTH + x) * 4
      px[i] = rgb[0]
      px[i + 1] = rgb[1]
      px[i + 2] = rgb[2]
      px[i + 3] = 255
    }
  }
  return px.toBase64()
}

// Every frame encoded once at load, so a tick only swaps a string.
export const FRAMES: Record<Pose, string[]> = {
  idle: ART.idle.map(toBase64),
  thinking: ART.thinking.map(toBase64),
  questioning: ART.questioning.map(toBase64),
  working: ART.working.map(toBase64),
  reading: ART.reading.map(toBase64),
  writing: ART.writing.map(toBase64),
  running: ART.running.map(toBase64),
  searching: ART.searching.map(toBase64),
  delegating: ART.delegating.map(toBase64),
}

export const ALT: Record<Pose, string> = {
  idle: 'Clawd resting',
  thinking: 'Clawd thinking',
  questioning: 'Clawd asking',
  working: 'Clawd working',
  reading: 'Clawd reading',
  writing: 'Clawd writing',
  running: 'Clawd running a command',
  searching: 'Clawd searching the web',
  delegating: 'Clawd handing off to a subagent',
}
