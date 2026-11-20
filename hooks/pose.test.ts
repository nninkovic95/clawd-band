import { expect, test } from 'claude-code/testing'

import type { Pose } from '../types'
import { BETWEEN, glance, play, poseFor, poser, RULES, start, view, want } from './pose'
import type { Flow } from './pose'
import { lengthOf } from './sprite'

// What is on screen: a pose, or the plain body between two.
const nameOf = (flow: Flow): string => (view(flow) === BETWEEN ? 'between' : view(flow).pose)

// The flow after `ticks` ticks, and what each of them showed.
const run = (from: Flow, ticks: number, rules = RULES): { flow: Flow; shown: string[] } => {
  const shown: string[] = []
  let flow = from
  for (let n = 0; n < ticks; n++) {
    flow = play(flow, rules)
    shown.push(nameOf(flow))
  }
  return { flow, shown }
}

const times = (name: string, count: number): string[] => Array<string>(count).fill(name)

// Clawd at rest, then asked for a pose: it shows at once.
const taking = (pose: Pose, seed = 1): Flow => want(start(seed), pose)

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

test('a Claude Docs tool reads when it reads, query or guide, and writes otherwise', async () => {
  expect(poseFor('mcp__claude_ai_Claude_Docs__read')).toBe('reading')
  expect(poseFor('mcp__claude_ai_Claude_Docs__query')).toBe('reading')
  expect(poseFor('mcp__claude_ai_Claude_Docs__guide')).toBe('reading')
  expect(poseFor('mcp__claude_ai_Claude_Docs__update')).toBe('writing')
})

test('the Docs prefix counts only at the start of a tool name', async () => {
  expect(poseFor('other__mcp__claude_ai_Claude_Docs__read')).toBe('working')
  expect(poseFor('mcp__someone__mcp__claude_ai_Claude_Docs__update')).toBe('working')
})

test('a tool no table names keeps the working pose', async () => {
  expect(poseFor('mcp__claude_ai_Gmail__search')).toBe('working')
  expect(poseFor('read')).toBe('working')
})

test('from rest a pose shows at once, and its first frame stays through the next tick', async () => {
  const flow = taking('waiting')
  expect(view(flow)).toEqual({ pose: 'waiting', roll: flow.roll, frame: 0 })
  const first = play(flow)
  expect(view(first).frame).toBe(0)
  expect(view(play(first)).frame).toBe(1)
})

test('a pose plays its hold before the next shows, with the plain body between', async () => {
  const { flow, shown } = run(want(taking('reading'), 'writing'), RULES.hold + 3)
  expect(shown).toEqual([...times('reading', RULES.hold), 'between', 'writing', 'writing'])
  expect(view(flow).frame).toBe(1)
  // A pose taken up on a tick has the same hold: two of its frames have played here.
  expect(run(want(flow, 'running'), RULES.hold).shown).toEqual([...times('writing', RULES.hold - 2), 'between', 'running'])
})

test('with no bridge in the rules a pose follows the other directly', async () => {
  const rules = { ...RULES, bridge: 0 }
  expect(run(want(taking('reading'), 'writing'), RULES.hold + 1, rules).shown).toEqual([...times('reading', RULES.hold), 'writing'])
})

test('of a burst of poses only the last shows', async () => {
  let flow = taking('reading')
  for (const pose of ['working', 'waiting', 'thinking'] as const) flow = want(flow, pose)
  expect(run(flow, RULES.hold + 2).shown).toEqual([...times('reading', RULES.hold), 'between', 'thinking'])
})

test('a pose wanted and then not wanted before it showed never shows', async () => {
  const glanced = glance(taking('delegating'), 'running')
  expect(glanced.glance).toBe('running')
  const { flow, shown } = run(want(glanced, 'delegating'), 12)
  expect(shown).toEqual(times('delegating', 12))
  // The pose on screen went on: it did not start over.
  expect(view(flow).frame).toBe(11)
})

test('a tool that ended before its pose showed still has its turn, and waiting comes after it', async () => {
  const flow = want(want(taking('thinking'), 'reading'), 'waiting')
  expect(run(flow, 2 * RULES.hold + 3).shown).toEqual([
    ...times('thinking', RULES.hold),
    'between',
    ...times('reading', RULES.hold),
    'between',
    'waiting',
  ])
})

test('waiting takes over only when it has stayed wanted: a pose arriving sooner wins', async () => {
  const reading = run(taking('reading'), RULES.hold + 2).flow
  const waited = want(reading, 'waiting')
  expect(run(waited, RULES.linger + 1).shown).toEqual([...times('reading', RULES.linger - 1), 'between', 'waiting'])
  // The next tool call is of the same kind: the pose never left the screen.
  const again = want(run(waited, RULES.linger - 1).flow, 'reading')
  expect(run(again, 12).shown).toEqual(times('reading', 12))
  // Another kind follows at the next tick, the hold being long over.
  const other = want(run(waited, 2).flow, 'writing')
  expect(run(other, 2).shown).toEqual(['between', 'writing'])
})

test('an ending cuts in mid-loop, plays once, then Clawd rests', async () => {
  const midLoop = want(run(taking('reading'), 2).flow, 'writing')
  const ending = want(midLoop, 'interrupted')
  expect(view(ending)).toEqual({ pose: 'interrupted', roll: ending.roll, frame: 0 })
  const length = lengthOf('interrupted', ending.roll)
  // The first frame stays through the first tick, so the ending takes one tick more than its frames.
  const { flow, shown } = run(ending, length + 2)
  expect(shown).toEqual([...times('interrupted', length), 'idle', 'idle'])
  // The pose that was waiting its turn went with the turn.
  expect(flow.owed).toBe(null)
})

test('a question and rest cut in at once too', async () => {
  const reading = taking('reading')
  expect(view(want(reading, 'questioning')).pose).toBe('questioning')
  expect(view(want(reading, 'idle')).pose).toBe('idle')
  // Asked for again while it shows, the question goes on.
  const asking = run(want(reading, 'questioning'), 3).flow
  expect(view(want(asking, 'questioning')).frame).toBe(2)
})

test("a glance gives way to the conversation's own pose, and leaves an ending be", async () => {
  // The glance was still waiting its turn when the conversation went on to wait.
  const flow = want(glance(taking('thinking'), 'running'), 'waiting')
  expect(run(flow, RULES.linger + 1).shown.includes('running')).toBe(false)
  const ending = taking('finished')
  expect(glance(ending, 'running')).toBe(ending)
  // A new turn does take the ending's place, at once.
  expect(view(want(ending, 'waiting')).pose).toBe('waiting')
})

test("the conversation's pose has its turn before a glance, and comes back when the glance is over", async () => {
  // Wanted while thinking still had the screen, then a subagent's tool right after.
  const flow = glance(want(taking('thinking'), 'delegating'), 'reading')
  const glanced = run(flow, 2 * RULES.hold + 3)
  expect(glanced.shown).toEqual([
    ...times('thinking', RULES.hold),
    'between',
    ...times('delegating', RULES.hold),
    'between',
    'reading',
  ])
  // While the glance is not handed back it stays; handed back, the conversation's pose returns.
  expect(run(glanced.flow, 8).shown).toEqual(times('reading', 8))
  const back = run(want(glanced.flow, 'delegating'), RULES.hold + 1)
  expect(back.shown).toEqual([...times('reading', RULES.hold - 1), 'between', 'delegating'])
})

test('a change of mind during the plain body does not blink back to the pose that left', async () => {
  const delegating = run(taking('delegating'), RULES.hold + 1).flow
  // The glance is handed back while the body is plain: it shows all the same, then gives way.
  const leaving = play(glance(delegating, 'running'))
  expect(nameOf(leaving)).toBe('between')
  expect(run(want(leaving, 'delegating'), RULES.hold + 2).shown).toEqual([...times('running', RULES.hold), 'between', 'delegating'])
  // A newer pose wanted meanwhile shows instead of the one the body was plain for.
  expect(run(want(leaving, 'thinking'), 1).shown).toEqual(['thinking'])
  // Waiting alone is not worth the detour: the pose comes back.
  const reading = run(taking('reading'), RULES.hold + 1).flow
  const waited = run(want(reading, 'waiting'), RULES.linger).flow
  expect(nameOf(waited)).toBe('between')
  expect(run(want(waited, 'reading'), 1).shown).toEqual(['reading'])
})

test('a pose come back to within a moment keeps its variant; later it is rolled again', async () => {
  const away = (ticks: number, seed: number): [number, number] => {
    const working = taking('working', seed)
    const reading = run(want(working, 'reading'), RULES.hold + 2 + ticks).flow
    const back = run(want(reading, 'working'), RULES.hold + 2).flow
    expect(view(back).pose).toBe('working')
    return [working.roll % 2, back.roll % 2]
  }
  const seeds = Array.from({ length: 16 }, (_, seed) => seed + 1)
  expect(seeds.every(seed => away(0, seed)[0] === away(0, seed)[1])).toBe(true)
  expect(seeds.some(seed => away(RULES.keep, seed)[0] !== away(RULES.keep, seed)[1])).toBe(true)
})

test('a compaction waits its turn, and waiting follows it like any activity', async () => {
  const compacting = want(taking('thinking'), 'compacting')
  const { flow, shown } = run(compacting, 2 * RULES.hold + 2)
  expect(shown).toEqual([...times('thinking', RULES.hold), 'between', ...times('compacting', RULES.hold + 1)])
  expect(run(want(flow, 'waiting'), RULES.linger + 1).shown).toEqual([
    ...times('compacting', RULES.linger - 1),
    'between',
    'waiting',
  ])
  // Outside a turn its end is rest, at once.
  expect(view(want(flow, 'idle')).pose).toBe('idle')
})

test('with animation off a pose holds its first frame, and an ending still ends on time', async () => {
  const still = { ...RULES, animate: false }
  let flow = want(start(1), 'finished', still)
  const frames: number[] = []
  for (let n = 0; n < lengthOf('finished', flow.roll) + 1; n++) {
    flow = play(flow, still)
    frames.push(view(flow, still).frame)
  }
  expect(frames.every(frame => frame === 0)).toBe(true)
  expect(view(flow, still).pose).toBe('idle')
})

test('with variants off every pose plays its first', async () => {
  const plain = { ...RULES, vary: false }
  const seeds = [1, 2, 3, 4, 5]
  expect(seeds.map(seed => want(start(seed), 'working', plain).roll)).toEqual([0, 0, 0, 0, 0])
  expect(seeds.some(seed => want(start(seed), 'working').roll !== 0)).toBe(true)
})

// The poser: what the session asks for, who still holds the pose, and what the
// screen shows, with no engine around it.

test('a tool that ends after a newer pose was asked for leaves the newer pose be', async () => {
  const clawd = poser(RULES, 1)
  const release = clawd.hold('reading')
  expect(clawd.wanted).toBe('reading')
  clawd.want('thinking')
  release()
  expect(clawd.wanted).toBe('thinking')
})

test('a tool that ends hands the pose to the wait for the next reply', async () => {
  const clawd = poser(RULES, 1)
  clawd.hold('reading')()
  expect(clawd.wanted).toBe('waiting')
})

test('of two tools running together, the one that ends first leaves the pose with the other', async () => {
  const clawd = poser(RULES, 1)
  const first = clawd.hold('reading')
  const second = clawd.hold('writing')
  first()
  expect(clawd.wanted).toBe('writing')
  second()
  expect(clawd.wanted).toBe('waiting')
})

test('a tool beside the one that held the pose takes it over, and holds it from then on', async () => {
  const clawd = poser(RULES, 1)
  const first = clawd.hold('reading')
  const second = clawd.hold('writing')
  second()
  expect(clawd.wanted).toBe('reading')
  first()
  expect(clawd.wanted).toBe('waiting')
})

test('a glance is handed back to the conversation, unless that has moved on', async () => {
  const clawd = poser(RULES, 1)
  clawd.want('working')
  const back = clawd.glance('reading')
  expect(clawd.wanted).toBe('reading')
  back()
  expect(clawd.wanted).toBe('working')
  const late = clawd.glance('running')
  clawd.want('thinking')
  late()
  expect(clawd.wanted).toBe('thinking')
})

test('a glance leaves an ending to play through, and hands nothing back', async () => {
  const clawd = poser(RULES, 1)
  clawd.want('finished')
  const back = clawd.glance('reading')
  expect(clawd.wanted).toBe('finished')
  back()
  expect(clawd.wanted).toBe('finished')
  expect(clawd.main).toBe('finished')
})

test('an ending that has played leaves the session at rest', async () => {
  const clawd = poser(RULES, 1)
  clawd.want('finished')
  for (let n = 0; n < lengthOf('finished', clawd.shown.roll) + 2; n++) clawd.tick()
  expect(clawd.shown.pose).toBe('idle')
  expect(clawd.wanted).toBe('idle')
  expect(clawd.main).toBe('idle')
})

test('a module loaded again takes up the pose the last one left, until a pose is asked for', async () => {
  const clawd = poser(RULES, 1)
  clawd.seed('reading')
  expect(clawd.wanted).toBe('reading')
  expect(clawd.shown.pose).toBe('reading')
  clawd.want('writing')
  clawd.seed('running')
  expect(clawd.wanted).toBe('writing')
})

test('it says what changed since it was last asked, once: the screen, and the pose wanted', async () => {
  const clawd = poser(RULES, 1)
  expect(clawd.takeChange()).toEqual({ screen: false, wanted: null })
  clawd.want('waiting')
  expect(clawd.takeChange()).toEqual({ screen: true, wanted: 'waiting' })
  expect(clawd.takeChange()).toEqual({ screen: false, wanted: null })
  // A frame of the same pose is no change of the screen.
  clawd.tick()
  clawd.tick()
  expect(clawd.takeChange()).toEqual({ screen: false, wanted: null })
})

test('a glance is a pose wanted too, and so is the rest an ending leaves', async () => {
  const clawd = poser(RULES, 1)
  clawd.want('working')
  clawd.takeChange()
  clawd.glance('reading')
  expect(clawd.takeChange().wanted).toBe('reading')
  clawd.want('finished')
  clawd.takeChange()
  for (let n = 0; n < lengthOf('finished', clawd.shown.roll) + 2; n++) clawd.tick()
  expect(clawd.takeChange().wanted).toBe('idle')
})

test('a seed is no change to tell of: the pose it takes up is already known', async () => {
  const clawd = poser(RULES, 1)
  clawd.seed('reading', 7)
  expect(clawd.takeChange().wanted).toBeNull()
  expect(clawd.wanted).toBe('reading')
})
