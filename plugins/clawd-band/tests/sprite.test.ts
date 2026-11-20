import { expect, test } from 'claude-code/testing'

import { CLAUDE_ORANGE } from '../hooks/color'
import { lengthOf, picturesIn, PIXEL_WIDTH, POSES, SCALE } from '../hooks/sprite'

// The animations as the picture shows them, read back pixel by pixel.
const draw = picturesIn(CLAUDE_ORANGE)

type Rect = { x: number; y: number; width: number; height: number }

const RIVET = [235, 232, 225] // the white that marks a cog's rivet

// Where a cog's first rivet is in a frame, as its angle round the middle, in
// radians, clockwise from straight to the right.
const rivetAt = (roll: number, frame: number, { x, y, width, height }: Rect): number => {
  const bytes = Uint8Array.fromBase64(draw('thinking', roll, frame).rgba)
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) {
      const at = (row * SCALE * PIXEL_WIDTH + col * SCALE) * 4
      if (RIVET.every((value, channel) => bytes[at + channel] === value)) {
        return Math.atan2(row - (y + (height - 1) / 2), col - (x + (width - 1) / 2))
      }
    }
  }
  throw new Error(`no rivet in frame ${frame}`)
}

// The turn from one frame to the next, taken the short way round. A cog with
// `rivets` of them cannot tell which is which, so it is read to a whole of
// its own: a turn of a half is no turn at all for two.
const step = (before: number, after: number, rivets = 1): number => {
  const turn = (after - before) * rivets
  return Math.atan2(Math.sin(turn), Math.cos(turn)) / rivets
}

test('waiting is the hourglass, with no loading ring', async () => {
  expect(POSES.waiting.variants.length).toBe(1)
})

test('the cogs turn on each other: the big one clockwise, the small one the other way', async () => {
  const roll = POSES.thinking.variants.length - 1
  const big: Rect = { x: 21, y: 0, width: 7, height: 7 }
  const small: Rect = { x: 23, y: 7, width: 5, height: 5 }
  const frames = lengthOf('thinking', roll)
  let [bigTurn, smallTurn] = [0, 0]
  for (let frame = 0; frame < frames; frame++) {
    const next = (frame + 1) % frames
    const bigStep = step(rivetAt(roll, frame, big), rivetAt(roll, next, big))
    const smallStep = step(rivetAt(roll, frame, small), rivetAt(roll, next, small), 2)
    // A frame may keep the rivet in its pixel, but it never goes back.
    expect(bigStep).toBeGreaterThanOrEqual(0)
    expect(smallStep).toBeLessThanOrEqual(0)
    bigTurn += bigStep
    smallTurn += smallStep
  }
  // The loop goes right round, and ends where it began: no frame sends a cog back.
  expect(Math.abs(bigTurn - 2 * Math.PI)).toBeLessThan(0.5)
  expect(smallTurn).toBeLessThan(-Math.PI)
})

// Whole pictures, to tell frames and variants apart.
const frameOf = (pose: Parameters<typeof draw>[0], roll: number, frame: number) => draw(pose, roll, frame).rgba

const looks = (pose: Parameters<typeof draw>[0], roll: number): string[] =>
  Array.from({ length: lengthOf(pose, roll) }, (_, frame) => frameOf(pose, roll, frame))

test('how many animations each pose has', () => {
  const counts = Object.fromEntries(Object.entries(POSES).map(([pose, { variants }]) => [pose, variants.length]))
  expect(counts).toMatchObject({ writing: 2, reading: 3, running: 3, failed: 2, refused: 2, interrupted: 2, finished: 2 })
})

test('every animation moves, and no two animations of a pose are alike', () => {
  for (const [pose, { variants }] of Object.entries(POSES)) {
    const shown = variants.map((_, roll) => looks(pose as 'idle', roll))
    for (const frames of shown) expect(new Set(frames).size).toBeGreaterThan(1)
    expect(new Set(shown.map(frames => frames.join())).size).toBe(variants.length)
  }
})

// How many pixels of a colour a frame has in the columns from `from`.
const pixelsOf = (rgba: string, colour: number[], from = 0): number => {
  const bytes = Uint8Array.fromBase64(rgba)
  let found = 0
  for (let at = 0; at < bytes.length; at += 4) {
    const column = ((at / 4) % PIXEL_WIDTH) / SCALE
    if (column >= from && colour.every((value, channel) => bytes[at + channel] === value)) found++
  }
  return found
}
const WATER = [95, 160, 230]

const WHITE = [235, 232, 225]

test('the signal of a fetch reaches out arc by arc, and the answer comes back in white, outer arc first', () => {
  const frames = looks('searching', 2)
  const blue = frames.map(frame => pixelsOf(frame, WATER, 19))
  const white = frames.map(frame => pixelsOf(frame, WHITE, 19))
  // From the dot to the second arc the blue only grows, and nothing is white yet.
  expect(blue[0] ?? 0).toBeLessThan(blue[1] ?? 0)
  expect(blue[1] ?? 0).toBeLessThan(blue[2] ?? 0)
  expect(white.slice(0, 4)).toEqual([0, 0, 0, 0])
  // Then the white arrives, and is spent before the loop starts over.
  const back = white.findIndex(count => count > 0)
  expect(back).toBeGreaterThan(3)
  expect(white.slice(back).filter(count => count > 0).length).toBeGreaterThan(2)
  expect(frames.length).toBeGreaterThan(6)
})

const GREEN = [120, 210, 140]

test('a finished turn draws its tick stroke by stroke, and it is green', () => {
  const frames = looks('finished', 0)
  const green = frames.map(frame => pixelsOf(frame, GREEN))
  expect(green[0] ?? 0).toBeGreaterThan(0)
  expect(green[0] ?? 0).toBeLessThan(green[1] ?? 0)
  expect(green[2] ?? 0).toBeGreaterThan(0)
})
