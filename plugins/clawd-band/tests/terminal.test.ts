import { expect, test } from 'claude-code/testing'

import { terminal } from '../hooks/terminal'
import type { TextFrame } from '../hooks/sprite'
import type { Screen } from '../hooks/terminal'

const NO_PICTURES = { deny: 'the Image draws its alt here: no pictures in a test' }

// The engine's screen as the terminal answers: each swap of the probe's picture
// is taken or refused as `answers` says, and each redraw asked for is counted.
const answering = (answers: () => { deny?: string }) => {
  const seen = { swaps: 0, redraws: 0 }
  const ui = {
    blit: async () => {
      seen.swaps++
      return answers()
    },
    invalidate: () => {
      seen.redraws++
    },
  } as unknown as Screen
  return { seen, ui }
}

test('a few refusals in a row say the terminal draws no pictures, and one swap taken says it does again', async () => {
  let refuse = true
  const { seen, ui } = answering(() => (refuse ? NO_PICTURES : {}))
  const screen = terminal()
  expect(screen.draws).toBe(true)
  // Refusals are counted on every tick, not once a second; the third is the one that tells.
  await screen.probe(ui, 'band', true)
  await screen.probe(ui, 'band', false)
  expect([screen.draws, seen.redraws]).toEqual([true, 0])
  await screen.probe(ui, 'band', false)
  expect([screen.draws, seen.redraws]).toEqual([false, 1])
  // The terminal comes back: the next second's swap is taken, and the band is drawn again.
  refuse = false
  await screen.probe(ui, 'band', true)
  expect([screen.draws, seen.redraws]).toEqual([true, 2])
})

// The sprite hands back the same picture for the same frame, so frames are told apart by identity.
const pictures = [1, 2, 3].map(tag => ({ rgba: String(tag), width: 1, height: 1 }))
const frame = (tag: number) => pictures[tag - 1]

test('a picture frame is swapped in once; an unchanged one is not sent again, and one the band refused goes again', async () => {
  let refuse = false
  const { seen, ui } = answering(() => (refuse ? { deny: 'band is gone' } : {}))
  const screen = terminal()
  screen.drew('picture', null)
  const show = (tag: number) => screen.showFrame(ui, 'band', { picture: () => frame(tag), text: () => [] })
  await show(1)
  await show(1)
  expect(seen.swaps).toBe(1)
  await show(2)
  expect(seen.swaps).toBe(2)
  // A band taken down between draws refuses: the same frame is sent again at the next tick.
  refuse = true
  await show(3)
  refuse = false
  await show(3)
  expect(seen.swaps).toBe(4)
})

test('where Clawd is text, the band is redrawn once the text on screen is no longer the frame to show', async () => {
  const { seen, ui } = answering(() => ({}))
  const screen = terminal()
  const first: TextFrame = [[{ text: 'a' }]] as unknown as TextFrame
  const next: TextFrame = [[{ text: 'b' }]] as unknown as TextFrame
  screen.drew('text', first)
  const show = (text: TextFrame) => screen.showFrame(ui, 'band', { picture: () => frame(1), text: () => text })
  await show(first)
  expect(seen.redraws).toBe(0)
  await show(next)
  expect([seen.redraws, seen.swaps]).toEqual([1, 0])
})

test('when the terminal changes what it draws, no picture of the old form counts as sent', async () => {
  let refuse = false
  const { seen, ui } = answering(() => (refuse ? NO_PICTURES : {}))
  const screen = terminal()
  screen.drew('picture', null)
  const show = () => screen.showFrame(ui, 'band', { picture: () => frame(1), text: () => [] })
  await show()
  refuse = true
  for (let n = 0; n < 3; n++) await screen.probe(ui, 'band', true)
  refuse = false
  await screen.probe(ui, 'band', true)
  const before = seen.swaps
  await show()
  expect(seen.swaps).toBe(before + 1)
})
