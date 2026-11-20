import { expect, test } from 'claude-code/testing'

import { CLAUDE_ORANGE, lengthOf, picturesIn, PIXEL_WIDTH, POSES, SCALE } from './sprite'

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

test('waiting has the hourglass and the float, and no loading ring', async () => {
  expect(POSES.waiting.variants.length).toBe(2)
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
