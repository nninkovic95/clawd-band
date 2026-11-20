// Written with its extension: the render scripts run this file in node as it stands.
import { CLAUDE_ORANGE } from '../color'
// Types alone from another file: node resolves no import written without its extension.
import type { Rgb } from '../picture'

export type { Rgb }

// What every scene is drawn with: the canvas, the palette, Clawd's body and
// the helpers that put props on it. The scene families import from here only.

// Clawd as the CLI prints it at startup (▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝), drawn
// as a picture: a quadrant is twice as tall as wide, so each logo pixel is one
// column by two rows of square art pixels. The body sits at the bottom of the
// canvas; the rows above it and the columns beside it hold the props.
export const ART_WIDTH = 28
export const ART_HEIGHT = 14
export const SCALE = 5

// Both forms show the same cells, so Clawd is one size in either: 14 columns
// of two art columns each, from the text's first art column, and the text's
// three rows of four art rows from the head down. The picture has one row of
// cells more, above the head, for the props the text cannot show.
export const TEXT_COLUMNS = 14
export const TEXT_ROWS = 3
export const PICTURE_ROWS = TEXT_ROWS + 1
// The picture's box of cells: as tall as the text Clawd, so that either form
// stands level with three bars, and wider than his art, so that the art,
// drawn with square pixels, is as tall as the box on fonts with cells up to
// 1:3. An even width centres the 14-cell text Clawd on the picture's middle.
export const BOX_COLUMNS = 16
export const BOX_ROWS = TEXT_ROWS
export const TEXT_LEFT = 1 // the art column the first cell starts at: the arms end on a cell's edge
export const PICTURE_WIDTH = TEXT_COLUMNS * 2
export const PICTURE_HEIGHT = PICTURE_ROWS * 4
export const PIXEL_WIDTH = PICTURE_WIDTH * SCALE
export const PIXEL_HEIGHT = PICTURE_HEIGHT * SCALE

export const COLORS: Record<string, Rgb> = {
  '#': CLAUDE_ORANGE, // the body, replaced by the sprite_color option
  w: [235, 232, 225], // the thought cloud, speed lines, text on a screen, a chef's hat
  y: [240, 190, 60], // pencil, "?", "!", sparks, sand, a lit bulb, a padlock
  k: [70, 60, 55], // ink on paper, dots in the cloud, glasses, a spinner's track: nearly lost on a dark terminal
  m: [150, 155, 165], // metal: the hammer, the press, a screen's case, the hourglass's ends, steam
  b: [240, 236, 226], // pages, a mug
  l: [150, 120, 100], // wood and card: a spine, a handle, a rod, a box, a browned pancake
  g: [170, 200, 220], // glass, an unlit bulb, the shine on an anvil, a keyboard
  r: [220, 80, 70], // "no" and "stop": a cross, a sign, a float, an eraser
  d: [34, 36, 46], // a screen in dark mode
  c: [120, 210, 140], // code, a tick, the green of "go", land
  u: [95, 160, 230], // water, the sea of a globe, a signal in the air, a mark in a margin
}

export type Grid = string[][]

// Things shown in turn, over and over; never empty.
export type Loop<T> = readonly [T, ...T[]]

export const blank = (): Grid => Array.from({ length: ART_HEIGHT }, () => Array<string>(ART_WIDTH).fill('.'))

// Paints a pattern at (x, y): a space leaves the pixel, a dot clears it.
export const stamp = (g: Grid, pattern: string[], x: number, y: number): Grid => {
  pattern.forEach((row, r) =>
    row.split('').forEach((ch, c) => {
      const line = g[y + r]
      const gx = x + c
      if (ch === ' ' || !line || gx < 0 || gx >= ART_WIDTH) return
      line[gx] = ch
    }),
  )
  return g
}

export const fill = (w: number, h: number, ch = '#'): string[] => Array.from({ length: h }, () => ch.repeat(w))

// A pattern at the text Clawd's grain: each of its rows is two art rows, the
// height of one quadrant.
export const tall = (pattern: string[]): string[] => pattern.flatMap(row => [row, row])

export type Spots = [number, number][]

// Single pixels of one colour, for the picture.
export const dots = (g: Grid, at: Spots, ch: string): Grid => {
  for (const [x, y] of at) stamp(g, [ch], x, y)
  return g
}

// The same for the text: each one quadrant.
export const marks = (g: Grid, at: Spots, ch: string): Grid => {
  for (const [x, y] of at) stamp(g, tall([ch]), x, y)
  return g
}

export type Arm = 'out' | 'up' | 'down' | 'none'

export type Body = {
  x?: number
  y?: number
  eyes?: 'open' | 'shut' | 'left' | 'right' | 'wide'
  left?: Arm
  right?: Arm
  legs?: 'stand' | 'stride'
}

export const X = 5 // the body's left edge, arms included
export const TOP = 4 // the head's first row, standing
export const SIDE = 23 // where the text's prop beside the body starts: on the edge of a text cell

// `x` is how far he stands from his usual place; whole text cells are two columns.
export const body = ({ x = 0, y = TOP, eyes = 'open', left = 'out', right = 'out', legs = 'stand' }: Body = {}): Grid => {
  const g = blank()
  const edge = X + x
  stamp(g, fill(12, 8), edge + 3, y)

  const shift = eyes === 'left' ? -1 : eyes === 'right' ? 1 : 0
  const eyeCols = eyes === 'wide' ? [5, 6, 11, 12] : [5 + shift, 12 + shift]
  if (eyes !== 'shut') for (const r of [y + 2, y + 3]) for (const c of eyeCols) stamp(g, ['.'], edge + c, r)

  const arm = (side: Arm, col: number) => {
    if (side === 'out') stamp(g, fill(2, 2), col, y + 4)
    if (side === 'up') stamp(g, fill(2, 5), col, y - 1)
    if (side === 'down') stamp(g, fill(2, 2), col, y + 6)
  }
  arm(left, edge + 1)
  arm(right, edge + 15)

  const feet = [4, 6, 11, 13]
  const spread = [3, 7, 10, 14]
  for (const c of feet) stamp(g, ['#'], edge + c, y + 8)
  for (const c of legs === 'stride' ? spread : feet) stamp(g, ['#'], edge + c, y + 9)
  return g
}

export type Place = [x: number, y: number]

// Something drawn at a place: a pattern and where its top left corner goes.
export type Layer = [pattern: string[], ...at: Place]

// Clawd in a pose with things drawn over him, the first undermost.
export const scene = (pose: Body, ...layers: Layer[]): Grid =>
  layers.reduce((g, [pattern, x, y]) => stamp(g, pattern, x, y), body(pose))

// One frame, as each form of Clawd shows it. The picture has rows over the
// head and a fine grain. The text Clawd starts at the head and has half the
// grain down the page, so a prop is drawn a second time for it where the
// picture's would not come through: beside the body, `tall`.
export type Art = { picture: Grid; text: Grid }

export const art = (picture: Grid, text: Grid = picture): Art => ({ picture, text })

export const HOP = TOP - 2 // off the ground by one quadrant, so the text shows the jump too

// The plain body: Clawd as the CLI prints him, nothing in hand.
export const stand = art(body())

// A "z" drifting up from a sleeper, small then big: Clawd asleep, or dozing
// while the small Clawd works.
export const SMALL_Z = ['ww ', ' w ', ' ww']
export const BIG_Z = ['wwww', '   w', '  w ', ' w  ', 'wwww']
