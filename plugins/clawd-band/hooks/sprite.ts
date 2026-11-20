import type { Pose } from '../types'
// Written with their extension: the render scripts run this file in node as it stands.
import { toHex } from './color'
import {
  type Art,
  type Grid,
  type Loop,
  type Rgb,
  COLORS,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  PIXEL_HEIGHT,
  PIXEL_WIDTH,
  SCALE,
  TEXT_COLUMNS,
  TEXT_LEFT,
  TEXT_ROWS,
  TOP,
  X,
  stand,
} from './sprite/core'
import { delegating, spawning, supervising, pressing, archiving } from './sprite/delegate'
import { ticking, flagging, pausing, unplugged, barring, deflecting, warning, bugged } from './sprite/endings'
import { mug, dozing, waiting, pondering, idea, turning, questioning, eitherOr } from './sprite/rest'
import { running, playing, prompting, searching, browsing, fetchingWeb } from './sprite/tools'
import { hammering, laptop, cooking, poring, reading, scrolling, writing, checking } from './sprite/work'
// Types alone from another file: the render scripts run this one in node as
// it stands, which resolves no import written without its extension.
import type { Picture } from './picture'

// The art is drawn in hooks/sprite/: the canvas, palette and body in core.ts,
// and each family of scenes in a file of its own. This file puts the poses
// together and draws their frames.
export type { Loop, Rgb }
export {
  ART_HEIGHT,
  ART_WIDTH,
  BOX_COLUMNS,
  BOX_ROWS,
  PICTURE_HEIGHT,
  PICTURE_ROWS,
  PICTURE_WIDTH,
  PIXEL_HEIGHT,
  PIXEL_WIDTH,
  SCALE,
  TEXT_COLUMNS,
  TEXT_ROWS,
} from './sprite/core'

type PoseArt = {
  // What a screen reader hears, and what a terminal that cannot draw says.
  alt: string
  // The pose's animations: one is picked each time the pose is taken up.
  variants: Loop<Loop<Art>>
  // Played through once; then Clawd rests.
  once?: true
  // Shown whether or not a turn is running; any other pose is a turn's.
  outsideTurn?: true
}

export const POSES: Record<Pose, PoseArt> = {
  idle: { alt: 'Clawd resting', variants: [mug, dozing] },
  waiting: { alt: 'Clawd waiting for the reply', variants: [waiting] },
  thinking: { alt: 'Clawd thinking', variants: [pondering, idea, turning] },
  questioning: { alt: 'Clawd asking', variants: [questioning, eitherOr] },
  working: { alt: 'Clawd working', variants: [hammering, laptop, cooking] },
  reading: { alt: 'Clawd reading', variants: [poring, reading, scrolling] },
  writing: { alt: 'Clawd writing', variants: [writing, checking] },
  running: { alt: 'Clawd running a command', variants: [running, playing, prompting] },
  searching: { alt: 'Clawd searching the web', variants: [searching, browsing, fetchingWeb] },
  delegating: { alt: 'Clawd handing off to a subagent', variants: [delegating, spawning, supervising] },
  compacting: { alt: 'Clawd compacting the conversation', variants: [pressing, archiving], outsideTurn: true },
  finished: { alt: 'Clawd done', variants: [ticking, flagging], once: true, outsideTurn: true },
  interrupted: { alt: 'Clawd interrupted', variants: [pausing, unplugged], once: true, outsideTurn: true },
  refused: { alt: 'Clawd declining', variants: [barring, deflecting], once: true, outsideTurn: true },
  failed: { alt: 'Clawd hit by an error', variants: [warning, bugged], once: true, outsideTurn: true },
}

// What can be drawn: a pose, or the plain body, which is no pose of the
// session's and shows for a frame while one pose gives way to the next.
export type Scene = Pose | 'plain'

export const SCENES: Record<Scene, PoseArt> = {
  ...POSES,
  plain: { alt: 'Clawd', variants: [[stand]], outsideTurn: true },
}

// What a loop shows at tick `n`.
export const frameAt = <T>(frames: Loop<T>, n: number): T => frames[n % frames.length] ?? frames[0]

// `roll` is any whole number: it picks among the scene's variants.
const variantOf = (scene: Scene, roll: number): Loop<Art> => frameAt(SCENES[scene].variants, roll)

// How many ticks the scene's variant takes to play through.
export const lengthOf = (scene: Scene, roll: number): number => variantOf(scene, roll).length

// Something that draws a scene's frame at tick `n`.
export type Draw<T> = (scene: Scene, roll: number, n: number) => T

// A frame is drawn when it is first shown, and a grid that comes up twice is
// drawn once: two equal frames are one value.
const drawing = <T>(form: keyof Art, draw: (grid: Grid) => T): Draw<T> => {
  const drawn = new Map<Grid, T>()
  return (scene, roll, n) => {
    const grid = frameAt(variantOf(scene, roll), n)[form]
    const made = drawn.get(grid) ?? draw(grid)
    drawn.set(grid, made)
    return made
  }
}

// Where the art starts on a canvas `width` pixels wide: his body, standing,
// on the canvas's middle, as far as the art stays whole.
const BODY_LEFT = (X + 1 - TEXT_LEFT) * SCALE
const BODY_WIDTH = 16 * SCALE
const artLeft = (width: number): number =>
  Math.max(0, Math.min(width - PIXEL_WIDTH, Math.round((width - BODY_WIDTH) / 2) - BODY_LEFT))

const toBase64 = (grid: Grid, colors: Record<string, Rgb>, width: number): string => {
  const px = new Uint8Array(width * PIXEL_HEIGHT * 4)
  const left = artLeft(width)
  // Each art pixel is a square of SCALE by SCALE picture pixels; the rows
  // under the art stay clear.
  for (let ay = 0; ay < PICTURE_HEIGHT; ay++) {
    for (let ax = 0; ax < PICTURE_WIDTH; ax++) {
      const rgb = colors[grid[TOP - 4 + ay]?.[TEXT_LEFT + ax] ?? '.']
      if (!rgb) continue
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          px.set([...rgb, 255], ((ay * SCALE + dy) * width + left + ax * SCALE + dx) * 4)
        }
      }
    }
  }
  return px.toBase64()
}

// Clawd as pictures: each frame a whole RGBA image, PIXEL_HEIGHT high and
// `width` wide, which is the art's own width or more.
export const picturesIn = (body: Rgb, width = PIXEL_WIDTH): Draw<Picture> => {
  const colors = { ...COLORS, '#': body }
  const canvas = Math.max(width, PIXEL_WIDTH)
  return drawing('picture', grid => ({ rgba: toBase64(grid, colors, canvas), width: canvas, height: PIXEL_HEIGHT }))
}

// Clawd as text, for where the terminal draws no picture. A cell of text holds
// two art columns by four art rows, one quadrant each, and the three rows are
// the CLI logo's own: the head, the arms, the feet.
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█' // by the quadrants lit: 1 top left, 2 top right, 4 and 8 under them

// A stretch of one row in one colour.
export type TextRun = { text: string; color: string }

export type TextFrame = readonly (readonly TextRun[])[]

const toText = (grid: Grid, colors: Record<string, string>, bodyColor: string): TextFrame =>
  Array.from({ length: TEXT_ROWS }, (_, row) => {
    const runs: TextRun[] = []
    for (let cell = 0; cell < TEXT_COLUMNS; cell++) {
      let lit = 0
      const props: Record<string, number> = {}
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const x = TEXT_LEFT + cell * 2 + (quadrant % 2)
        const y = TOP + row * 4 + (quadrant >> 1) * 2
        for (const key of [grid[y]?.[x], grid[y + 1]?.[x]]) {
          if (key === undefined || key === '.') continue
          lit |= 1 << quadrant
          if (key !== '#') props[key] = (props[key] ?? 0) + 1
        }
      }
      // A cell has one colour: its commonest prop's, over the body's, so a
      // thin prop shows.
      const prop = Object.entries(props).sort((a, b) => b[1] - a[1])[0]?.[0]
      const color = (prop && colors[prop]) || bodyColor
      const last = runs.at(-1)
      if (last && (lit === 0 || last.color === color)) last.text += QUADRANTS[lit]
      else runs.push({ text: QUADRANTS[lit] ?? ' ', color })
    }
    return runs
  })

const TEXT_COLORS = Object.fromEntries(Object.entries(COLORS).map(([key, rgb]) => [key, toHex(rgb)]))

// `bodyColor` is anything a Text takes as a colour: a theme key or a hex.
export const textIn = (bodyColor: string): Draw<TextFrame> =>
  drawing('text', grid => toText(grid, TEXT_COLORS, bodyColor))
