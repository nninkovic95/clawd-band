import { expect, mock, test } from 'claude-code/testing'

import { barColor, countdown, mergeUsage, parseAccountUsage, poseFor, resetExpired, shortModel, toUsage } from './register'
import { ART_HEIGHT, ART_WIDTH, FRAMES, PIXEL_HEIGHT, PIXEL_WIDTH, SCALE } from './sprite'

const BAND = {
  plugin: 'clawd-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 75, scroll: { offset: 0, bodyRows: 10 } },
} as const

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
  const now = Date.parse('2026-10-11T15:00:00Z')
  expect(countdown('2026-10-11T18:04:05Z', now)).toBe('3:04:05')
  expect(countdown('2026-10-11T14:00:00Z', now)).toBe('0:00:00')
  expect(countdown(null, now)).toBe('-:--:--')
  expect(countdown('2026-10-14T19:30:00Z', now)).toBe('3d 4h')
  expect(barColor(10)).toBe('success')
  expect(barColor(60)).toBe('warning')
  expect(barColor(85)).toBe('error')
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
  mock.clock(on, { now: Date.parse('2026-10-11T15:00:00Z') })
  on('ui.render', () => null)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7d/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' ↻ ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '--' })).toBeDefined()
  await ui.unmount()
})

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
  const now = Date.parse('2026-10-11T15:00:00Z')
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
  const merged = mergeUsage(current, [{ kind: 'seven_day', percentUsed: 33, resetsAt: '2026-10-14T00:00:00Z' }])
  expect(merged?.fiveHour).toEqual(current.fiveHour)
  expect(merged?.sevenDay?.percentUsed).toBe(33)
  expect(mergeUsage(current, [])).toEqual(current)
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
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T15:00:00Z') })
  mock.store(on)
  let id = 'before-clear'
  on('session.id', () => ({ value: id }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ deny: 'no account in a test' }))
  on('session.usage', () => ({
    value: {
      rateLimits:
        id === 'before-clear' ? [] : [{ kind: 'seven_day', percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' }],
    },
  }))
  on('ui.render', () => null)
  const ui = await $.ui.mount(BAND)
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: '  31%' })).toBe(undefined)
  id = 'after-clear'
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: '  31%' })).toBeDefined()
  await ui.unmount()
})

test('at startup a cached 5h window that has reset shows 0%, not --', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T15:00:00Z') })
  mock.store(on, {
    usage: {
      fiveHour: { percentUsed: 40, resetsAt: '2026-10-11T14:00:00Z' },
      sevenDay: { percentUsed: 31, resetsAt: '2026-10-14T00:00:00Z' },
    },
  })
  on('ui.render', () => null)
  const first = await $.ui.mount(BAND)
  await clock.advance(1)
  await first.unmount()
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: '  31%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '   0%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '   --' })).toBe(undefined)
  await ui.unmount()
})
