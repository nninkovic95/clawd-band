import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { shownPose } from '../hooks/register'
import { lengthOf, POSES, SCENES } from '../hooks/sprite'
import type { Pose } from '../types'
import { BAND, core, NOW } from './band.fixtures'

test('outside a turn a pose of the turn shows as rest; a compaction and an ending show', async () => {
  expect(shownPose('working', true)).toBe('working')
  expect(shownPose('working', false)).toBe('idle')
  expect(shownPose('waiting', false)).toBe('idle')
  expect(shownPose('compacting', false)).toBe('compacting')
  expect(shownPose('finished', false)).toBe('finished')
})

test('Clawd keeps moving while a question waits on the person', { options: { random_poses: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  const sent: string[] = []
  on('ui.blit', ($, e) => {
    if ('source' in e && 'rgba' in e.source) sent.push(e.source.rgba)
    return { value: {} }
  })
  // The question stays open until the person answers it.
  let answer = () => {}
  on('tool.call', () => new Promise(resolve => (answer = () => resolve(DONE))))
  // A question comes mid-turn: outside one, a turn's poses show as rest.
  const ui = await $.ui.mount(WORKING_BAND)
  await clock.advance(1)
  const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await clock.advance(1)
  const before = sent.length
  const poses = await posesOver(ui, clock, 8)
  // The picture stays up, the asking pose plays, and its frames go on changing.
  expect(poses.every(pose => pose === 'questioning')).toBe(true)
  expect(new Set(sent.slice(before)).size >= 2).toBe(true)
  answer()
  await asked
  await ui.unmount()
})

// Every pose the mod writes, in order. A write the store turns down for its
// version is made again, and counts once.
const posesWritten = (on: On): unknown[] => {
  const poses: unknown[] = []
  on('state.set', { key: 'pose' }, async ($, e, next) => {
    const result = await next(e)
    if ('value' in result && result.value?.isSet) poses.push(e.value)
    return result
  })
  return poses
}

const TURN_END = { answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const

// The frames of a pose's longest variant: which one plays is rolled.
const longest = (pose: Pose): number => Math.max(...POSES[pose].variants.map(variant => variant.length))

test('a turn sets Clawd waiting for its first reply; its end plays once, then he rests', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.complete(TURN_END)
  expect(poses).toEqual(['waiting', 'finished'])
  await clock.advance(400 * (longest('finished') + 1))
  expect(poses).toEqual(['waiting', 'finished', 'idle'])
})

test('how a turn ended picks its ending', async ($, on) => {
  mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ ...TURN_END, isAborted: true, reason: 'aborted' })
  await $.turn.complete({ ...TURN_END, reason: 'error' })
  await $.turn.complete({ ...TURN_END, reason: 'refusal', refusal: { category: null, explanation: null } })
  expect(poses).toEqual(['interrupted', 'failed', 'refused'])
})

test('a subagent turn changes nothing; its tool gets a glance, then the pose goes back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.turn.start({ text: 'hello', turnId: 't1' })
  await $.turn.start({ text: 'look', turnId: 't2', agentId: 'agent-1' })
  await $.turn.complete({ ...TURN_END, turnId: 't2', agentId: 'agent-1' })
  expect(poses).toEqual(['waiting'])
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'agent-1' })
  expect(poses).toEqual(['waiting', 'running'])
  await clock.advance(1100)
  expect(poses).toEqual(['waiting', 'running', 'waiting'])
})

test('a glance at a subagent does not undo a newer pose', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'agent-1' })
  await $.turn.complete(TURN_END)
  await clock.advance(1100)
  expect(poses).toEqual(['running', 'finished'])
})

test('a tool that ends after the turn leaves the ending be', async ($, on) => {
  mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', async () => {
    await $.turn.complete({ ...TURN_END, isAborted: true, reason: 'aborted' })
    return { result: { stdout: '', stderr: '', interrupted: true } }
  })
  await $.tool.call({ tool: 'Bash', command: 'sleep 60' })
  expect(poses).toEqual(['running', 'interrupted'])
})

const SPINNER = {
  plugin: 'clawd-band',
  surface: 'terminal',
  component: 'Spinner',
  props: { word: 'Working', message: null, suffix: '', mode: 'requesting' },
} as const

test('the spinner saying it compacts sets the pose, and its end takes it back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  const poses = posesWritten(on)
  // The engine counts a compaction as work under way.
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true } })
  const plain = await $.ui.mount(SPINNER)
  await plain.unmount()
  await clock.advance(1)
  expect(poses).toEqual([])
  const busy = await $.ui.mount({ ...SPINNER, props: { ...SPINNER.props, message: 'Compacting conversation' } })
  await busy.unmount()
  await clock.advance(1)
  expect(poses).toEqual(['compacting'])
  const after = await $.ui.mount(SPINNER)
  await after.unmount()
  await clock.advance(1)
  expect(poses).toEqual(['compacting', 'waiting'])
  await band.unmount()
})

test('the reply stream: waiting, then thinking, working and the tool pose', async ($, on) => {
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
  expect(poses).toEqual(['waiting', 'thinking', 'working', 'reading'])
})

test('a tool call holds its pose while it runs, then Clawd waits for the next reply', async ($, on) => {
  mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  let during: unknown[] = []
  on('tool.call', () => {
    during = [...poses]
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(during).toEqual(['running'])
  expect(poses).toEqual(['running', 'waiting'])
})

const DONE = { result: { stdout: '', stderr: '', interrupted: false } }

test('a tool that ends beside one still running hands the pose to it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash') await clock.sleep(1000)
    return DONE
  })
  const long = $.tool.call({ tool: 'Bash', command: 'sleep 1' })
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: 'x' })
  expect(poses).toEqual(['running', 'reading', 'running'])
  await clock.advance(1000)
  await long
  expect(poses).toEqual(['running', 'reading', 'running', 'waiting'])
})

test("a subagent's tool call leaves the turn's ending be", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const poses = posesWritten(on)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => DONE)
  await $.turn.complete(TURN_END)
  await $.tool.call({ tool: 'Bash', command: 'true', agentId: 'agent-1' })
  await clock.advance(1100)
  expect(poses).toEqual(['finished'])
})

// The band of a turn under way: a turn's poses show only then.
const WORKING_BAND = { ...BAND, props: { ...BAND.props, isWorking: true } }

// The pose on screen after each of the next ticks, read from the alt text of
// Clawd's picture: a picture goes out only when it changes, so the pictures
// sent do not count the ticks. `first` is how far off the first tick is.
const ALT_POSES = new Map(Object.entries(SCENES).map(([scene, { alt }]) => [alt, scene]))
type Screen = { find: (query: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }
const posesOver = async (ui: Screen, clock: { advance: (ms: number) => Promise<unknown> }, ticks: number, first = 400) => {
  const poses: (string | undefined)[] = []
  for (let tick = 0; tick < ticks; tick++) {
    await clock.advance(tick === 0 ? first : 400)
    poses.push(ALT_POSES.get(String((await ui.find({ key: 'clawd' }))?.props.alt)))
  }
  return poses
}

// One reply that thinks, writes a line and calls Read, all within one tick.
const replyOf = (on: On) =>
  on('turn.step', async function* ($, e) {
    yield { kind: 'thinking', index: 0, text: '' }
    yield { kind: 'text', index: 1, text: '' }
    yield { kind: 'tool', index: 2, id: 'tool-1', name: 'Read' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }
  })

test('a burst of poses within a tick reaches the screen as one change, after the hold', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.render', core)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', () => DONE)
  replyOf(on)
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(WORKING_BAND)
  await $.turn.start({ text: 'hello', turnId: 't1' })
  for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
    expect(chunk.kind).toBeDefined()
  }
  await $.tool.call({ tool: 'Read', file_path: 'x' })
  // Eleven ticks: the first comes with the timer's start.
  const shown = await posesOver(ui, clock, 11, 1)
  const four = (name: string) => [name, name, name, name]
  // Neither thinking nor working showed; waiting came back only after the tool's pose had its turn.
  expect(shown).toEqual([...four('waiting'), 'plain', ...four('reading'), 'plain', 'waiting'])
  await ui.unmount()
})

// Without the roll, the ending and the rest after it are each pose's first variant.
const FIRST_VARIANTS = { options: { random_poses: false } }

test('an ending cuts in on the screen mid-loop and plays through to rest', FIRST_VARIANTS, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(WORKING_BAND)
  await $.turn.start({ text: 'hello', turnId: 't1' })
  const seen = await posesOver(ui, clock, 3, 1)
  await $.turn.complete({ ...TURN_END, isAborted: true, reason: 'aborted' })
  // Drawn at once, before any tick.
  const drawn = await ui.find({ key: 'clawd' })
  expect(drawn?.props.alt).toBe(POSES.interrupted.alt)
  const length = lengthOf('interrupted', 0)
  seen.push(...(await posesOver(ui, clock, length + 1)))
  expect(seen).toEqual(['waiting', 'waiting', 'waiting', ...Array(length).fill('interrupted'), 'idle'])
  await ui.unmount()
})

test('a compaction shows after the hold, and waiting follows its end', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', core)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('ui.blit', () => ({ value: {} }))
  const ui = await $.ui.mount(WORKING_BAND)
  await $.turn.start({ text: 'hello', turnId: 't1' })
  const busy = await $.ui.mount({ ...SPINNER, props: { ...SPINNER.props, message: 'Compacting conversation' } })
  await busy.unmount()
  expect(await posesOver(ui, clock, 7, 1)).toEqual([
    'waiting',
    'waiting',
    'waiting',
    'waiting',
    'plain',
    'compacting',
    'compacting',
  ])
  const after = await $.ui.mount(SPINNER)
  await after.unmount()
  // The pose lingers while waiting is new, then gives way to it.
  expect(await posesOver(ui, clock, 6)).toEqual(['compacting', 'compacting', 'compacting', 'compacting', 'plain', 'waiting'])
  await ui.unmount()
})
