import type { ConfigRow, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { BAND, core, NOW } from './kit'

test('the mod offers /clawd, once, whichever of its hooks runs first', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const offered: string[] = []
  on('command.register', ($, e) => {
    offered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.render', core)
  on('ui.blit', () => ({ value: {} }))
  // No session.start here: a resumed session loads the mod without one, and draws the band.
  const ui = await $.ui.mount(BAND)
  await clock.advance(3000)
  expect(offered).toEqual(['clawd'])
  await ui.unmount()
})

test('/clawd opens the settings pane and hands it the keyboard', async ($, on) => {
  const opened: unknown[] = []
  on('ui.open', ($, e) => {
    opened.push([e.id, e.title, e.focus, e.closeOnEscape])
    return { value: { isPlaced: true } }
  })
  // The person typed /clawd in a terminal 100 columns wide.
  const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
  const answer = await $.command.run({ command: 'clawd', args: '', ...typed })
  expect(opened).toEqual([['clawd-settings', 'Clawd', true, true]])
  // A panel prints nothing in the transcript.
  expect(answer.text).toBe(undefined)
})

const PANE = {
  plugin: 'clawd-band',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'clawd-settings',
  props: {
    title: 'Clawd',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const MOD = { plugin: 'clawd-band', tier: 'user' } as const

// The settings menu's rows as the engine lists them: its own, this mod's, another mod's.
const ROWS: ConfigRow[] = [
  { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', options: ['dark', 'light'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false },
  { key: 'clawd-band.animate', label: 'Animate Clawd', kind: 'boolean', value: true, provider: MOD, isLocked: false },
  { key: 'clawd-band.keep_spinner', label: 'Keep the spinner line', kind: 'boolean', value: false, provider: MOD, isLocked: false },
  { key: 'clawd-band.bar_style', label: 'Bar style', kind: 'choice', value: 'pill', options: ['pill', 'blocks', 'dots'], provider: MOD, isLocked: false },
  { key: 'clawd-band.cell_ratio', label: 'Cell shape', kind: 'text', value: '2.34', provider: MOD, isLocked: false },
  { key: 'notes.folder', label: 'Folder', kind: 'text', value: '~/notes', provider: { plugin: 'notes', tier: 'user' }, isLocked: false },
]

test("the pane holds one control for each of the mod's settings, showing what it is set to", async ($, on) => {
  on('config.list', () => ({ value: ROWS }))
  const ui = await $.ui.mount(PANE)
  const drawn = async (key: string) => {
    const found = await ui.find({ key })
    return found && [found.type, found.props.label, found.props.value]
  }
  // A toggle says its state in its label; a choice and a text carry theirs as their value.
  expect(await drawn('clawd-band.animate')).toEqual(['Button', 'Animate Clawd: on', undefined])
  expect(await drawn('clawd-band.keep_spinner')).toEqual(['Button', 'Keep the spinner line: off', undefined])
  expect(await drawn('clawd-band.bar_style')).toEqual(['Select', 'Bar style', 'pill'])
  expect((await ui.find({ key: 'clawd-band.bar_style' }))?.props.options).toEqual([{ value: 'pill' }, { value: 'blocks' }, { value: 'dots' }])
  expect(await drawn('clawd-band.cell_ratio')).toEqual(['Input', 'Cell shape', '2.34'])
  // The engine's own rows and another mod's are not this pane's.
  expect([await drawn('theme'), await drawn('notes.folder')]).toEqual([undefined, undefined])
  await ui.unmount()
})

// What the pane asks the settings menu to change, as the engine hears it; the menu takes each
// change unless `deny` says why not.
const changesOf = (on: On, deny?: string) => {
  const changes: unknown[] = []
  on('config.list', () => ({ value: ROWS }))
  on('config.set', ($, e) => {
    changes.push([e.key, e.value])
    return deny === undefined ? { value: e.value } : { deny }
  })
  return changes
}

test('pressing a toggle turns its setting the other way', async ($, on) => {
  const changes = changesOf(on)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'clawd-band.animate' })
  await ui.press({ key: 'clawd-band.keep_spinner' })
  expect(changes).toEqual([
    ['clawd-band.animate', false],
    ['clawd-band.keep_spinner', true],
  ])
  await ui.unmount()
})

test('picking a choice and submitting a text set those settings', async ($, on) => {
  const changes = changesOf(on)
  const ui = await $.ui.mount(PANE)
  await ui.select({ key: 'clawd-band.bar_style', value: 'dots' })
  await ui.input({ key: 'clawd-band.cell_ratio', text: '2.1' })
  expect(changes).toEqual([
    ['clawd-band.bar_style', 'dots'],
    ['clawd-band.cell_ratio', '2.1'],
  ])
  await ui.unmount()
})

test('a change the settings menu refuses is said in a toast', async ($, on) => {
  changesOf(on, 'set by your organization')
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'clawd-band.animate' })
  expect(toasts).toEqual(['Animate Clawd: set by your organization'])
  await ui.unmount()
})

test('a saved bar style the choices no longer hold is drawn, and its row still listed', async ($, on) => {
  // A style an earlier version offered, saved before it was taken out.
  const rows = ROWS.map(row => (row.key === 'clawd-band.bar_style' ? { ...row, value: 'circles' } : row))
  on('config.list', () => ({ value: rows }))
  const ui = await $.ui.mount(PANE)
  const select = await ui.find({ key: 'clawd-band.bar_style' })
  expect([select?.type, select?.props.label]).toEqual(['Select', 'Bar style'])
  expect(select?.props.options).toEqual([{ value: 'pill' }, { value: 'blocks' }, { value: 'dots' }])
  // The rows round it are drawn as ever.
  expect((await ui.find({ key: 'clawd-band.cell_ratio' }))?.props.value).toBe('2.34')
  await ui.unmount()
})
