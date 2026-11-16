import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { BAND, core, NOW, usageOf } from './kit'

// A session with no reading of its own beside a store that holds `stored`;
// answers what the mod then keeps under `missing`.
const notesOf = (on: On, stored: unknown) => {
  const notes: unknown[] = []
  on('store.get', ($, e) => ({ value: e.key === 'usage' ? stored : undefined }))
  on('store.set', ($, e) => {
    if (e.key === 'missing') notes.push(e.value)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf())
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  return notes
}

const FIVE_HOUR = { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' }
const SEVEN_DAY = { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' }

test('a usage row still empty a few seconds into a session leaves a note of what was known', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // Another session stored the five hours alone.
  const notes = notesOf(on, { fiveHour: FIVE_HOUR, readAt: NOW - 1000 })
  const ui = await $.ui.mount(BAND)
  await clock.advance(2000)
  // Not at once: the store and the session are read in the first seconds.
  expect(notes).toEqual([])
  await clock.advance(8000)
  // One note a session, however long the row stays empty: what is missing, what the
  // store held, what the session itself reported, and that the account was not asked
  // (the stored reading is a second old).
  expect(notes.length).toBe(1)
  const { at, ...known } = notes[0] as { at: string }
  expect(known).toEqual({ session: 'one', missing: ['sevenDay'], stored: ['fiveHour'], reported: [], account: 'not asked' })
  // Written on the first tick past five seconds in.
  const after = Date.parse(at) - NOW
  expect(after >= 5000 && after < 6000).toBe(true)
  await ui.unmount()
})

test('a session whose usage rows are filled leaves no note', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const notes = notesOf(on, { fiveHour: FIVE_HOUR, sevenDay: SEVEN_DAY, readAt: NOW - 1000 })
  const ui = await $.ui.mount(BAND)
  await clock.advance(10_000)
  expect(notes).toEqual([])
  await ui.unmount()
})
