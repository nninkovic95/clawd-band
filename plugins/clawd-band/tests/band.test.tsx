import { expect, mock, test } from 'claude-code/testing'

import { CLAUDE_ORANGE } from '../hooks/color'
import { cacheCountdown, countdown, windowLabel } from '../hooks/format'
import { shortModel, withoutEffort } from '../hooks/register'
import { settings } from '../hooks/settings'
import { BAND, core, NOW, replied, usageOf } from './band.fixtures'

test('model names are shortened', async () => {
  expect(shortModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(shortModel('claude-haiku-5-5-20261001')).toBe('Haiku 5.5')
  expect(shortModel('claude-fable-5-2')).toBe('Fable 5.2')
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
  expect([defaults.weeklyColor.text, defaults.fiveHourColor.text, defaults.contextColor.text]).toEqual([
    'autoAccept',
    'suggestion',
    'claude',
  ])
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
  expect(settings({}).cold.text).toBe('blue')
})

test('the effort pill leaves the hint line', async () => {
  expect(withoutEffort('● high · /effort')).toBe('')
  expect(withoutEffort('? for shortcuts · ● xhigh · /effort')).toBe('? for shortcuts')
  expect(withoutEffort('● max · /effort · ? for shortcuts')).toBe('? for shortcuts')
  expect(withoutEffort('esc to interrupt')).toBe(null)
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
    bar_color_weekly: '#00ff00',
    bar_color_five_hour: 'not a colour!',
    bar_color_warning: 'magenta',
    bar_color_empty: 'subtle',
  })
  expect(custom.showModel).toBe(false)
  expect(custom.spriteRgb).toEqual([0x33, 0xaa, 0xff])
  expect(custom.spriteColor).toBe('#33aaff')
  expect([custom.weeklyColor.text, custom.fiveHourColor.text]).toEqual(['#00ff00', 'suggestion'])
  expect(custom.warning.text).toBe('magenta')
  expect(settings({ bar_color_warning: 'red; drop' }).warning.text).toBe('error')
  expect(custom.empty.text).toBe('subtle')
  expect(settings({ sprite_color: 'not a colour' }).spriteRgb).toEqual(CLAUDE_ORANGE)
})

test('the band draws the sprite, both bars and the countdown', async ($, on) => {
  mock.clock(on, { now: NOW })
  replied(on)
  on('ui.render', core)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'clawd' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7d/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
  // No refresh buttons and no row icons: the countdown follows the percent.
  expect(await ui.find({ type: 'Button' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /[↻☀❄]/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: ' --' })).toBeDefined()
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
