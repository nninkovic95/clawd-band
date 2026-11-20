import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseAccountUsage } from '../hooks/usage/account'
import { askKey, expiredKey, mergeUsage, resetExpired, sameUsage, toUsage } from '../hooks/usage/model'
import { BAND, core, NOW, STILL_BARS, TEXT_BARS, usageOf } from './band.fixtures'

test('usage windows come from the rate limits', async () => {
  expect(toUsage([])).toBe(null)
  const usage = toUsage([
    { kind: 'five_hour', percentUsed: 72.5, resetsAt: '2026-10-11T18:00:00Z' },
    { kind: 'seven_day', percentUsed: 31 },
  ])
  expect(usage?.fiveHour?.percentUsed).toBe(72.5)
  expect(usage?.sevenDay?.resetsAt).toBe(null)
})

test('a window that has reset reads 0% with no reset time', async () => {
  const now = NOW
  const usage = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T14:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  expect(resetExpired(usage, now)).toEqual({ fiveHour: { percentUsed: 0, resetsAt: null }, sevenDay: usage.sevenDay })
  expect(resetExpired(null, now)).toBe(null)
})

test('a reading missing a window keeps the last one', async () => {
  const current = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  const merged = mergeUsage(current, toUsage([{ kind: 'seven_day', percentUsed: 33, resetsAt: '2026-10-14T00:00:00Z' }]))
  expect(merged?.fiveHour).toEqual(current.fiveHour)
  expect(merged?.sevenDay?.percentUsed).toBe(33)
  expect(mergeUsage(current, toUsage([]))).toEqual(current)
})

test('readings compare by percent and reset time', async () => {
  const usage = {
    fiveHour: { percentUsed: 1, resetsAt: '2026-10-11T14:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  expect(sameUsage(usage, { ...usage })).toBe(true)
  expect(sameUsage(usage, { ...usage, fiveHour: { percentUsed: 1, resetsAt: '2026-10-11T19:00:00Z' } })).toBe(false)
  expect(sameUsage(null, usage)).toBe(false)
  expect(sameUsage(null, undefined)).toBe(true)
})

test('a new reset time at the same percent shows after the turn', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let resetsAt = '2026-10-11T14:00:00Z'
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('session.usage', () => usageOf([{ kind: 'five_hour', percentUsed: 1, resetsAt }]))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: '--h---m---s' })).toBeDefined()
  // The window reset and a request opened a new one, still at 1%: no session.measure.
  resetsAt = '2026-10-11T19:00:00Z'
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: /^03h-59m-5\ds$/ })).toBeDefined()
  await ui.unmount()
})

test('expired windows make the key one fetch on reset answers', async () => {
  const now = NOW
  const usage = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T14:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  expect(expiredKey(usage, now)).toBe('2026-10-11T14:00:00Z')
  expect(expiredKey({ ...usage, fiveHour: { percentUsed: 0, resetsAt: null } }, now)).toBe(null)
  expect(expiredKey(null, now)).toBe(null)
})

const accountUsage = (fiveHour: string | null) =>
  JSON.stringify({
    five_hour: fiveHour ? { utilization: 1, resets_at: fiveHour } : null,
    seven_day: { utilization: 31, resets_at: '2026-10-14T00:00:00Z' },
  })

test('a window that runs out mid-session is fetched again, no reply needed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let next: string | null = '2026-10-11T15:00:10Z'
  let fetches = 0
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf())
  on('session.authorize', () => ({ value: { kind: 'bearer', handle: 'test' } }))
  on('http.fetch', () => {
    fetches += 1
    return { value: { status: 200, ok: true, headers: {}, text: accountUsage(next) } }
  })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(fetches).toBe(1) // the startup fetch
  // The window runs out at 15:00:10; the account has the next one a few seconds later.
  next = '2026-10-11T20:00:10Z'
  await clock.advance(20_000)
  expect(fetches).toBe(2)
  expect(await ui.find({ type: 'Text', text: /^04h-59m-\d\ds$/ })).toBeDefined()
  await ui.unmount()
})

// A signed-in session whose account request is answered by `answer`; resolves
// to how many requests were made.
const account = (on: On, answer: () => { status: number; text: string }) => {
  const count = { fetches: 0 }
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf())
  on('session.authorize', () => ({ value: { kind: 'bearer', handle: 'test' } }))
  on('ui.log', () => ({ value: undefined }))
  on('http.fetch', () => {
    count.fetches += 1
    const { status, text } = answer()
    return { value: { status, ok: status === 200, headers: {}, text } }
  })
  on('ui.render', core)
  return count
}

test('an answer with no open window is not asked for again', TEXT_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let next: string | null = '2026-10-11T15:00:10Z'
  const count = account(on, () => ({ status: 200, text: accountUsage(next) }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  // Nothing is sent after the reset, so the account has no five-hour window.
  next = null
  await clock.advance(30 * 60_000)
  expect(count.fetches).toBe(1 + 1)
  await ui.unmount()
})

test('a request that fails is tried again, five times at most', STILL_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const count = account(on, () => ({ status: 500, text: '' }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(30 * 60_000)
  expect(count.fetches).toBe(5)
  await ui.unmount()
})

test('a first request that fails and then works fills the bars without a reply', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let status = 500
  const count = account(on, () => ({ status, text: accountUsage('2026-10-11T18:00:00Z') }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: '31%' })).toBe(undefined)
  status = 200
  await clock.advance(65_000)
  expect(count.fetches).toBe(2)
  expect(await ui.find({ type: 'Text', text: '31%' })).toBeDefined()
  await ui.unmount()
})

test('a 429 ends the tries', STILL_BARS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const count = account(on, () => ({ status: 429, text: '' }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(30 * 60_000)
  expect(count.fetches).toBe(1)
  await ui.unmount()
})

// No reply, no request, no write: only the clock moves, and the band with it.
test('a countdown moves on each second with nothing else happening', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, {
    usage: {
      fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' },
      sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
    },
  })
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf())
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: '02h-59m-59s' })).toBeDefined()
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: '02h-59m-58s' })).toBeDefined()
  await ui.unmount()
})

// The session's figure comes with no word of its change: the next second shows it.
test('a context that fills with no reply shows on the next second', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let percent = 10
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf([], { window: 200_000, percent }))
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: /^ *10%$/ })).toBeDefined()
  percent = 40
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /^ *40%$/ })).toBeDefined()
  await ui.unmount()
})

test("another session's newer reading shows without a reply or a request", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const reading = (percentUsed: number, readAt: number) => ({
    fiveHour: { percentUsed, resetsAt: '2026-10-11T18:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
    readAt,
  })
  let stored = reading(40, NOW - 1000)
  on('store.get', ($, e) => ({ value: e.key === 'usage' ? stored : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'one' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => usageOf())
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
  // Another session stores what its reply reported.
  stored = reading(42, NOW + 2000)
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
  await ui.unmount()
})

test('the account is asked only while the reading is not live', async () => {
  const usage = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T14:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
  }
  expect(askKey(null, false, NOW)).toBe('none')
  expect(askKey(usage, false, NOW)).toBe('2026-10-11T14:00:00Z')
  const live = { ...usage, fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' } }
  expect(askKey(live, false, NOW)).toBe(null)
  expect(askKey(live, true, NOW)).toBe('stale')
})

test('the account usage response gives both windows', async () => {
  const limits = parseAccountUsage(
    JSON.stringify({
      five_hour: { utilization: 2.04, resets_at: '2026-10-15T22:10:00.412345+00:00' },
      seven_day: { utilization: 30, resets_at: '2026-10-18T03:00:00+00:00' },
      seven_day_opus: null,
    }),
  )
  expect(limits).toEqual([
    { kind: 'five_hour', percentUsed: 2, resetsAt: '2026-10-15T22:10:00.412345+00:00' },
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-18T03:00:00+00:00' },
  ])
  expect(parseAccountUsage(JSON.stringify({ five_hour: null, seven_day: { utilization: 5 } }))).toEqual([
    { kind: 'seven_day', percentUsed: 5, resetsAt: undefined },
  ])
  expect(parseAccountUsage('not json')).toEqual([])
})

test('a new session id (a /clear) loads the usage again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let id = 'before-clear'
  on('session.id', () => ({ value: id }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('session.usage', () =>
    usageOf(id === 'before-clear' ? [] : [{ kind: 'seven_day', percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' }]),
  )
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: '31%' })).toBe(undefined)
  id = 'after-clear'
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: '31%' })).toBeDefined()
  await ui.unmount()
})

test('at startup a cached 5h window that has reset shows 0%, not --', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, {
    usage: {
      fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T14:00:00Z' },
      sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
    },
  })
  // A context reading too, so no row of the band reads `--`.
  on('session.usage', () => usageOf([], { window: 1_000_000, tokens: 50_000, percent: 5 }))
  on('ui.render', core)
  const first = await $.ui.mount(BAND)
  await clock.advance(1)
  await first.unmount()
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: '31%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '00%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' --' })).toBe(undefined)
  await ui.unmount()
})
