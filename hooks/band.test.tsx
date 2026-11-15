import type { Hook, On, SessionContextUsage, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  barColor,
  barRuns,
  cacheCountdown,
  countdown,
  poseFor,
  settings,
  shortModel,
  windowLabel,
  withoutEffort,
} from './register'
import { ART_HEIGHT, ART_WIDTH, CLAUDE_ORANGE, FRAMES, framesFor, PIXEL_HEIGHT, PIXEL_WIDTH, SCALE } from './sprite'
import {
  askKey,
  asStoredUsage,
  expiredKey,
  mergeUsage,
  parseAccountUsage,
  resetExpired,
  sameUsage,
  toUsage,
} from './usage'

const BAND = {
  plugin: 'clawd-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 75,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// The moment every test's clock starts at.
const NOW = Date.parse('2026-10-11T15:00:00Z')

// A whole `$.session.usage()` answer: the engine always reports a window.
const usageOf = (rateLimits: SessionRateLimit[] = [], context: SessionContextUsage = { window: 200_000 }) => ({
  value: { startedAt: 0, context, rateLimits },
})

// The tests' stand-in for the engine's own drawing: an empty box, since a
// stand-in that draws nothing is refused.
const core: Hook<'ui.render'> = ($, e) => {
  const { Box } = $.ui.resolve(e)
  return <Box />
}

test('tool names pick the pose', async () => {
  expect(poseFor('AskUserQuestion')).toBe('questioning')
  expect(poseFor('mcp__claude_ai_Claude_Docs__read')).toBe('reading')
  expect(poseFor('mcp__claude_ai_Claude_Docs__update')).toBe('writing')
  expect(poseFor('Grep')).toBe('reading')
  expect(poseFor('Edit')).toBe('writing')
  expect(poseFor('Bash')).toBe('running')
  expect(poseFor('WebSearch')).toBe('searching')
  expect(poseFor('Agent')).toBe('delegating')
  expect(poseFor('TodoWrite')).toBe('working')
})

test('usage windows come from the rate limits', async () => {
  expect(toUsage([])).toBe(null)
  const usage = toUsage([
    { kind: 'five_hour', percentUsed: 72.5, resetsAt: '2026-10-11T18:00:00Z' },
    { kind: 'seven_day', percentUsed: 31 },
  ])
  expect(usage?.fiveHour?.percentUsed).toBe(72.5)
  expect(usage?.sevenDay?.resetsAt).toBe(null)
})

test('model names are shortened', async () => {
  expect(shortModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(shortModel('claude-haiku-5-5-20261001')).toBe('Haiku 5.5')
  expect(shortModel('claude-fable-5-1')).toBe('Fable 5.1')
  expect(shortModel('Opus 5.5')).toBe('Opus 5.5')
})

test('countdown and colours', async () => {
  const now = NOW
  expect(countdown('2026-10-11T18:04:05Z', now)).toBe('03h-04m-05s')
  expect(countdown('2026-10-11T14:00:00Z', now)).toBe('00h-00m-00s')
  expect(countdown(null, now)).toBe('--h---m---s')
  expect(countdown(null, now, true)).toBe('--d---h---m')
  expect(countdown('2026-10-14T19:30:00Z', now, true)).toBe('03d-04h-30m')
  expect(countdown('2026-10-14T19:30:00Z', now, true).length).toBe(countdown('2026-10-11T18:04:05Z', now).length)
  const defaults = settings({})
  expect(barColor(10, defaults)).toBe('success')
  expect(barColor(60, defaults)).toBe('warning')
  expect(barColor(85, defaults)).toBe('error')
})

test('the context row: window label and cache countdown', async () => {
  expect(windowLabel(1_000_000)).toBe('1m')
  expect(windowLabel(200_000)).toBe('200k')
  expect(windowLabel(undefined)).toBe('cx')
  const now = NOW
  const hour = settings({}).cacheTtlMs
  expect(hour).toBe(3_600_000)
  expect(settings({ cache_ttl: '5m' }).cacheTtlMs).toBe(300_000)
  expect(cacheCountdown(null, hour, now)).toBe('--h---m---s')
  expect(cacheCountdown(now - 48_000, hour, now)).toBe('00h-59m-12s')
  expect(cacheCountdown(now - hour, hour, now)).toBe('cold')
  expect(settings({}).cold).toBe('blue')
})

test('the effort pill leaves the hint line', async () => {
  expect(withoutEffort('● high · /effort')).toBe('')
  expect(withoutEffort('? for shortcuts · ● xhigh · /effort')).toBe('? for shortcuts')
  expect(withoutEffort('● max · /effort · ? for shortcuts')).toBe('? for shortcuts')
  expect(withoutEffort('esc to interrupt')).toBe(null)
})

test('the weekly bar is cut into seven days', async () => {
  const runs = barRuns(35, 12, 7)
  const cells = runs.map(r => r.text).join('')
  expect(cells.length).toBe(35)
  expect([...cells].filter(c => c === '▉').length + runs.filter(r => r.part === 'mark').length).toBe(6)
  expect(runs[0]).toEqual({ text: '█████▉████▉█', part: 'filled' })
  expect(runs[2]).toEqual({ text: '│', part: 'mark' })
  expect(barRuns(10, 3)).toEqual([
    { text: '███', part: 'filled' },
    { text: '░░░░░░░', part: 'empty' },
  ])
})

test('a cold cache turns the context row blue', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.usage', () => usageOf([], { window: 1_000_000, tokens: 120_000, percent: 12 }))
  on('ui.render', core)
  on('state.get', { key: 'cacheAt' }, () => ({ value: { value: Date.parse('2026-10-11T13:00:00Z'), version: 1 } }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: /^1m/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /cold$/ }))?.props.color).toBe('blue')
  await ui.unmount()
})

test('options are checked, a bad colour falls back to its default', async () => {
  const defaults = settings({})
  expect(defaults.showModel).toBe(true)
  expect(defaults.spriteColor).toBe('claude')
  expect(settings({ sprite_color: '#d77757' }).spriteColor).toBe('claude')
  const custom = settings({
    show_model: false,
    sprite_color: '3af',
    bar_color_low: '#00ff00',
    bar_color_mid: 'magenta',
    bar_color_high: 'red; drop',
    bar_color_empty: 'subtle',
  })
  expect(custom.showModel).toBe(false)
  expect(custom.spriteRgb).toEqual([0x33, 0xaa, 0xff])
  expect(custom.spriteColor).toBe('#33aaff')
  expect(custom.low).toBe('#00ff00')
  expect(custom.mid).toBe('magenta')
  expect(custom.high).toBe('error')
  expect(custom.empty).toBe('subtle')
  expect(settings({ sprite_color: 'not a colour' }).spriteRgb).toEqual(CLAUDE_ORANGE)
})

test('a sprite colour repaints the body only', async () => {
  const blue = framesFor([0, 0, 255])
  const px = Uint8Array.fromBase64(blue.idle[0])
  const orange = Uint8Array.fromBase64(FRAMES.idle[0])
  expect(px.length).toBe(orange.length)
  let body = 0
  for (let i = 0; i < px.length; i += 4) {
    if (orange[i] === 215 && orange[i + 1] === 119 && orange[i + 2] === 87) {
      expect([px[i], px[i + 1], px[i + 2]]).toEqual([0, 0, 255])
      body += 1
    }
  }
  expect(body > 0).toBe(true)
})

test('every frame is a whole RGBA picture', async () => {
  const bytes = PIXEL_WIDTH * PIXEL_HEIGHT * 4
  expect(PIXEL_WIDTH).toBe(ART_WIDTH * SCALE)
  expect(PIXEL_HEIGHT).toBe(ART_HEIGHT * SCALE)
  for (const frames of Object.values(FRAMES)) {
    for (const f of frames) expect(Uint8Array.fromBase64(f).length).toBe(bytes)
  }
})

test('the band draws the sprite, both bars and the countdown', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7d/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
  // No refresh buttons and no row icons: the countdown follows the percent.
  expect(await ui.find({ type: 'Button' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /[↻☀❄]/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '--' })).toBeDefined()
  expect(await ui.find({ key: 'model' })).toBeDefined()
  await ui.unmount()
})

test('show_model off drops the model line', { options: { show_model: false } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ key: 'model' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^7d/ })).toBeDefined()
  await ui.unmount()
})

test(
  'the bars take the configured colours',
  { options: { bar_color_low: '#00ff00', bar_color_empty: 'gray' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, {
      usage: {
        fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' },
        sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
      },
    })
    on('ui.render', core)
    const first = await $.ui.mount(BAND)
    await clock.advance(1)
    await first.unmount()
    const ui = await $.ui.mount(BAND)
    expect((await ui.find({ type: 'Text', text: '█' }))?.props.color).toBe('#00ff00')
    expect((await ui.find({ type: 'Text', text: '░' }))?.props.color).toBe('gray')
    await ui.unmount()
  },
)

test('the band yields to a survey', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text>
  })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'survey' })).toBeDefined()
  await ui.unmount()
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

test('an answer with no open window is not asked for again', async ($, on) => {
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

test('a request that fails is tried again, five times at most', async ($, on) => {
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
  expect(await ui.find({ type: 'Text', text: '  31%' })).toBe(undefined)
  status = 200
  await clock.advance(65_000)
  expect(count.fetches).toBe(2)
  expect(await ui.find({ type: 'Text', text: '  31%' })).toBeDefined()
  await ui.unmount()
})

test('a 429 ends the tries', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const count = account(on, () => ({ status: 429, text: '' }))
  const ui = await $.ui.mount(BAND)
  await clock.advance(30 * 60_000)
  expect(count.fetches).toBe(1)
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
  expect(await ui.find({ type: 'Text', text: '  40%' })).toBeDefined()
  // Another session stores what its reply reported.
  stored = reading(42, NOW + 2000)
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: '  42%' })).toBeDefined()
  await ui.unmount()
})

test('a stored reading is checked, and one without a time is the oldest', async () => {
  const usage = {
    fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T18:00:00Z' },
    sevenDay: { percentUsed: 31, resetsAt: null },
  }
  expect(asStoredUsage({ ...usage, readAt: 7 })).toEqual({ usage, readAt: 7 })
  expect(asStoredUsage(usage)).toEqual({ usage, readAt: 0 })
  expect(asStoredUsage({ fiveHour: 'full', sevenDay: null })).toBe(null)
  expect(asStoredUsage('nonsense')).toBe(null)
  expect(asStoredUsage(undefined)).toBe(null)
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

test('a terminal that refuses the picture gets the text Clawd', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('ui.blit', () => ({ value: { deny: 'the Image draws its alt here: no pictures in a test' } }))
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  await clock.advance(2000)
  expect(await ui.find({ key: 'clawd' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: '▝▜█████▛▘' })).toBeDefined()
  await ui.unmount()
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
  expect(await ui.find({ type: 'Text', text: '  31%' })).toBe(undefined)
  id = 'after-clear'
  await clock.advance(1500)
  expect(await ui.find({ type: 'Text', text: '  31%' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: '  31%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '   0%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '   --' })).toBe(undefined)
  await ui.unmount()
})

// Every pose the mod writes, in order.
const posesWritten = (on: On): unknown[] => {
  const poses: unknown[] = []
  on('state.set', { key: 'pose' }, ($, e, next) => {
    poses.push(e.value)
    return next(e)
  })
  return poses
}

const TURN_END = { answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('a turn sets Clawd working and its end sets him resting', async ($, on) => {
  mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.complete(TURN_END)
  expect(poses).toEqual(['working', 'idle'])
})

test('the reply stream picks thinking, working and the tool pose', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on) // the step also stores the model it names
  const poses = posesWritten(on)
  on('turn.step', async function* ($, e) {
    yield { kind: 'thinking', index: 0, text: '' }
    yield { kind: 'text', index: 1, text: '' }
    yield { kind: 'tool', index: 2, id: 'tool-1', name: 'Grep' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const chunk of stream) expect(chunk.kind).toBeDefined()
  expect(poses).toEqual(['thinking', 'working', 'reading'])
})

test('a tool call holds its pose while it runs, then goes back to working', async ($, on) => {
  mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  let during: unknown[] = []
  on('tool.call', () => {
    during = [...poses]
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(during).toEqual(['running'])
  expect(poses).toEqual(['running', 'working'])
})
