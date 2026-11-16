// Writes docs/preview/transitions.html: written-down turns played at real
// speed through the pose rules of hooks/pose.ts and, beside them, through
// cuts made the moment a pose is asked for, each as the picture and as the
// text Clawd. A developer tool for judging how a change of pose looks: the
// plugin never runs it, and the page it writes loads nothing.
//
// Run from the repository root: node scripts/render-transitions.ts
// Needs node 23.6+ (type stripping).
import { mkdirSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The hooks import each other without an extension, as the mod's loader
// resolves them; node wants one.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.')) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { PICTURE_HEIGHT, PICTURE_WIDTH, CLAUDE_ORANGE, PIXEL_WIDTH, POSES, SCALE, SCENES, lengthOf, picturesIn, textIn, toHex } =
  await import('../hooks/sprite.ts')
const { BETWEEN, RULES, play, start, view, want } = await import('../hooks/pose.ts')

type Pose = keyof typeof POSES
type Scene = keyof typeof SCENES
type Rules = typeof RULES

const FRAME_MS = 400
const GLANCE_MS = 1_000
// Where in a frame's 400 ms the turn starts: the timer runs from the session's start, not the turn's.
const TICK_OFFSET = 250

// What a hook of hooks/register.tsx is called with, and when, in milliseconds.
type Step =
  | [at: number, does: 'start' | 'step' | 'thinking' | 'text']
  | [at: number, does: 'tool' | 'call' | 'done' | 'sub', tool: string]
  | [at: number, does: 'end', reason: 'answer' | 'aborted']

type Turn = { title: string; note: string; lastsMs: number; steps: Step[] }

const TURNS: Turn[] = [
  {
    title: 'A typical turn',
    note: 'A reply that thinks and writes, three tool calls of different kinds close together, a subagent that makes seven tool calls of its own, then the answer.',
    lastsMs: 28_000,
    steps: [
      [0, 'start'],
      [40, 'step'],
      [1_400, 'thinking'],
      [3_600, 'text'],
      [4_100, 'tool', 'Read'],
      [4_300, 'call', 'Read'],
      [4_380, 'done', 'Read'],
      [4_420, 'step'],
      [5_300, 'tool', 'Edit'],
      [5_600, 'call', 'Edit'],
      [5_700, 'done', 'Edit'],
      [5_740, 'step'],
      [6_500, 'tool', 'Bash'],
      [6_700, 'call', 'Bash'],
      [7_900, 'done', 'Bash'],
      [7_940, 'step'],
      [9_000, 'thinking'],
      [10_400, 'text'],
      [10_700, 'tool', 'Agent'],
      [11_000, 'call', 'Agent'],
      [11_900, 'sub', 'Read'],
      [12_300, 'sub', 'Grep'],
      [13_100, 'sub', 'Read'],
      [13_800, 'sub', 'Bash'],
      [15_900, 'sub', 'Edit'],
      [16_300, 'sub', 'Bash'],
      [16_900, 'sub', 'Read'],
      [18_500, 'done', 'Agent'],
      [18_540, 'step'],
      [19_600, 'thinking'],
      [20_800, 'text'],
      [23_500, 'end', 'answer'],
    ],
  },
  {
    title: 'An interrupted turn',
    note: 'Esc while a command runs: the turn ends at once, and the command after it.',
    lastsMs: 9_000,
    steps: [
      [0, 'start'],
      [40, 'step'],
      [1_100, 'thinking'],
      [2_600, 'tool', 'Bash'],
      [2_900, 'call', 'Bash'],
      [4_300, 'end', 'aborted'],
      [4_320, 'done', 'Bash'],
    ],
  },
]

const TOOL_POSES: Record<string, Pose> = {
  Read: 'reading',
  Grep: 'reading',
  Edit: 'writing',
  Bash: 'running',
  Agent: 'delegating',
}
const poseFor = (tool: string): Pose => TOOL_POSES[tool] ?? 'working'

const ENDINGS = { answer: 'finished', aborted: 'interrupted' } as const

const SAYS: Record<Step[1], (detail: string) => string> = {
  start: () => 'the turn starts',
  step: () => 'a reply is asked for',
  thinking: () => 'the reply thinks',
  text: () => 'the reply writes text',
  tool: tool => `the reply names a tool: ${tool}`,
  call: tool => `${tool} runs`,
  done: tool => `${tool} ends`,
  sub: tool => `the subagent calls ${tool}`,
  end: reason => `the turn ends: ${reason}`,
}

// What draws a wanted pose: the rules under test, or the cut they are compared with.
type Screen = {
  want: (pose: Pose, isGlance: boolean) => void
  tick: () => void
  // The pose that plays once is through.
  isPlayedOut: () => boolean
  shown: () => { pose: Scene; roll: number; frame: number; label: string }
}

// A fixed sequence, so the page shows the same variants each time it is written.
const sequence = (seed: number) => () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
  return (seed >>> 16) / 0x8000
}

// A pose shows the moment it is asked for, from its first frame, in a variant
// rolled each time; the frame counter is the timer's.
const cutting = (random: () => number): Screen => {
  let pose: Pose = 'idle'
  let roll = 0
  let frame = 0
  return {
    want(next) {
      if (next !== pose || POSES[next].once) {
        frame = 0
        roll = Math.floor(random() * 1_000)
      }
      pose = next
    },
    tick() {
      frame += 1
    },
    isPlayedOut: () => frame >= lengthOf(pose, roll),
    shown: () => ({ pose, roll, frame, label: pose }),
  }
}

const flowing = (seed: number, rules: Rules): Screen => {
  let flow = start(seed)
  return {
    want(next, isGlance) {
      flow = want(flow, next, isGlance, rules)
    },
    tick() {
      flow = play(flow, rules)
    },
    isPlayedOut: () => flow.pose === 'idle',
    shown: () => ({ ...view(flow), label: view(flow) === BETWEEN ? 'between' : flow.pose }),
  }
}

type State = { at: number; key: string; label: string }
type Wanted = { at: number; pose: Pose }

// The hooks of hooks/register.tsx as far as the pose goes, fed a turn's steps
// and the timer's ticks in the order of their times. `isFlow` picks the hooks
// that go with the pose rules; without it they are the ones that go with a
// cut at once: a turn's start and a tool's end ask for `working`, and a glance
// is not held back by an ending.
const playTurn = (turn: Turn, screen: Screen, isFlow: boolean, frames: Frames) => {
  let main: Pose = 'idle'
  let wanted: Pose = 'idle'
  let claim = 0
  let isWorking = false
  const tools: { tool: string; pose: Pose; claim: number }[] = []
  const states: State[] = []
  const wants: Wanted[] = [{ at: 0, pose: 'idle' }]

  const setPose = (next: Pose, isGlance = false): number => {
    claim += 1
    if (!isGlance) main = next
    screen.want(next, isGlance)
    wanted = next
    return claim
  }

  const queue: { at: number; run: () => void }[] = []
  const happen: Record<Step[1], (detail: string, at: number) => void> = {
    start() {
      isWorking = true
      setPose(isFlow ? 'waiting' : 'working')
    },
    step: () => void setPose('waiting'),
    thinking: () => void setPose('thinking'),
    text: () => void setPose('working'),
    tool: tool => void setPose(poseFor(tool)),
    call(tool) {
      const pose = poseFor(tool)
      tools.push({ tool, pose, claim: setPose(pose) })
    },
    done(tool) {
      const at = tools.findIndex(running => running.tool === tool)
      const [ended] = tools.splice(at, 1)
      if (!ended || claim !== ended.claim) return
      const beside = isFlow ? tools.at(-1) : undefined
      const held = setPose(beside?.pose ?? (isFlow ? 'waiting' : 'working'))
      if (beside) beside.claim = held
    },
    sub(tool, at) {
      if (isFlow && POSES[main].once) return
      const held = setPose(poseFor(tool), true)
      queue.push({ at: at + GLANCE_MS, run: () => void (claim === held && setPose(main)) })
    },
    end(reason) {
      setPose(ENDINGS[reason as keyof typeof ENDINGS])
      isWorking = false
    },
  }

  for (const [at, does, detail = ''] of turn.steps) queue.push({ at, run: () => happen[does](detail, at) })
  for (let at = TICK_OFFSET; at < turn.lastsMs; at += FRAME_MS) {
    queue.push({
      at,
      run() {
        screen.tick()
        if (POSES[wanted].once && screen.isPlayedOut()) setPose('idle')
      },
    })
  }

  while (queue.length > 0) {
    const first = queue.reduce((soonest, entry) => (entry.at < soonest.at ? entry : soonest))
    queue.splice(queue.indexOf(first), 1)
    first.run()
    const drawn = screen.shown()
    // Outside a turn a turn's pose is rest, as the band draws it.
    const isShown = isWorking || SCENES[drawn.pose].outsideTurn === true
    const pose = isShown ? drawn.pose : 'idle'
    const key = frames.keyOf(pose, drawn.roll, drawn.frame)
    const label = isShown ? drawn.label : 'idle'
    const last = states.at(-1)
    if (last?.key !== key || last.label !== label) states.push({ at: first.at, key, label })
    if (wants.at(-1)?.pose !== wanted) wants.push({ at: first.at, pose: wanted })
  }
  return { states, wants }
}

type Run = { text: string; color: string }
type Drawn = { art: string[]; text: Run[][] }
type Frames = { keyOf: (pose: Scene, roll: number, n: number) => string; drawn: Record<string, Drawn> }

const picture = picturesIn(CLAUDE_ORANGE)
const text = textIn(toHex(CLAUDE_ORANGE))

// One colour per art pixel, read back from the picture; '' where it is clear.
const artOf = (rgba: string): string[] => {
  const px = Buffer.from(rgba, 'base64')
  const art: string[] = []
  for (let y = 0; y < PICTURE_HEIGHT; y++) {
    for (let x = 0; x < PICTURE_WIDTH; x++) {
      const at = (y * SCALE * PIXEL_WIDTH + x * SCALE) * 4
      art.push(px[at + 3] ? toHex([px[at], px[at + 1], px[at + 2]]) : '')
    }
  }
  return art
}

// Each frame that is shown, drawn once in both forms and named by its place in the pose.
const framesShown = (): Frames => {
  const drawn: Record<string, Drawn> = {}
  return {
    drawn,
    keyOf(pose, roll, n) {
      const key = `${pose}.${roll % SCENES[pose].variants.length}.${n % lengthOf(pose, roll)}`
      drawn[key] ??= { art: artOf(picture(pose, roll, n).rgba), text: text(pose, roll, n) }
      return key
    },
  }
}

// The stretches one label stays on screen for.
const stretches = (changes: { at: number; label: string }[], lastsMs: number) => {
  const runs: { label: string; from: number; to: number }[] = []
  for (const { at, label } of changes) {
    const last = runs.at(-1)
    if (last?.label === label) continue
    // A label replaced in the same instant was never seen.
    if (last?.from === at) runs.pop()
    else if (last) last.to = at
    runs.push({ label, from: at, to: lastsMs })
  }
  return runs
}

const frames = framesShown()

const LANES: { name: string; note: string; screen: () => Screen; isFlow: boolean }[] = [
  {
    name: 'Cut at once',
    note: 'The band without pose rules: a pose shows the moment it is asked for.',
    screen: () => cutting(sequence(7)),
    isFlow: false,
  },
  {
    name: 'Pose rules',
    note: `hooks/pose.ts: a pose holds ${RULES.hold} frames; one plain frame between two poses.`,
    screen: () => flowing(7, RULES),
    isFlow: true,
  },
  {
    name: 'Pose rules, no frame between',
    note: 'The same rules with `bridge: 0`: one pose follows the other directly.',
    screen: () => flowing(7, { ...RULES, bridge: 0 }),
    isFlow: true,
  },
]

const turns = TURNS.map(turn => {
  const lanes = LANES.map(lane => {
    const { states, wants } = playTurn(turn, lane.screen(), lane.isFlow, frames)
    return { name: lane.name, note: lane.note, states, wants, runs: stretches(states, turn.lastsMs) }
  })
  return {
    title: turn.title,
    note: turn.note,
    lastsMs: turn.lastsMs,
    steps: turn.steps.map(([at, does, detail = '']) => ({ at, says: SAYS[does](detail) })),
    // What the session is doing, as the hooks that go with the pose rules say it.
    session: stretches(
      (lanes[1]?.wants ?? []).map(({ at, pose }) => ({ at, label: pose })),
      turn.lastsMs,
    ),
    lanes: lanes.map(({ name, note, states, runs }) => ({ name, note, states, runs })),
  }
})

const page = `<!doctype html>
<meta charset="utf-8">
<title>clawd-band transitions</title>
<style>
  body { background: #1b1b1f; color: #d8d8d8; font: 14px/1.4 system-ui, sans-serif; margin: 24px; }
  h1 { font-size: 20px; }
  h2 { font-size: 16px; margin: 0; }
  h3 { font-size: 14px; margin: 0; }
  p { margin: 2px 0 10px; color: #9a9aa2; font-size: 12px; }
  section { background: #24242a; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; }
  button { background: #33333c; color: #d8d8d8; border: 0; border-radius: 4px; padding: 4px 10px; font: inherit; cursor: pointer; }
  .head { display: flex; align-items: baseline; gap: 12px; }
  .head .clock { margin-left: auto; font-variant-numeric: tabular-nums; color: #9a9aa2; }
  .lanes { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 12px; margin: 10px 0 14px; }
  .lane { background: #1f1f24; border-radius: 6px; padding: 10px 12px; }
  .lane h3 + p { min-height: 2.8em; }
  .forms { display: flex; align-items: center; gap: 18px; }
  canvas { image-rendering: pixelated; width: 168px; height: 84px; background: #1b1b1f; border-radius: 4px; }
  pre { font: 20px/1 "JetBrains Mono", "DejaVu Sans Mono", monospace; margin: 0; background: #1b1b1f; padding: 6px 4px; border-radius: 4px; }
  .pose { margin-top: 8px; font-size: 13px; }
  .pose b { font-variant-numeric: tabular-nums; }
  .count { color: #9a9aa2; font-size: 12px; margin: 4px 0 0; }
  .now { font-size: 13px; margin: 0 0 8px; color: #d8d8d8; }
  .now span { color: #9a9aa2; }
  .strips { display: grid; grid-template-columns: max-content 1fr; gap: 6px 10px; align-items: center; font-size: 12px; color: #9a9aa2; }
  .track { position: relative; height: 22px; }
  .track.axis { height: 14px; }
  .run { position: absolute; top: 0; bottom: 0; box-sizing: border-box; min-width: 2px; background: #3a3a44; border-radius: 3px; color: #d8d8d8; font-size: 11px; line-height: 22px; padding: 0 4px; overflow: hidden; white-space: nowrap; }
  .run.between { background: #2c2c33; padding: 0; }
  .run.narrow { padding: 0; color: transparent; }
  .mark { position: absolute; top: 3px; bottom: 3px; width: 6px; margin-left: -3px; }
  .mark::after { content: ''; position: absolute; left: 2px; top: 0; bottom: 0; width: 2px; background: #9a9aa2; border-radius: 1px; }
  .tick { position: absolute; top: 0; transform: translateX(-50%); font-variant-numeric: tabular-nums; }
  .head-line { position: absolute; top: 0; bottom: 0; width: 1px; background: #d8d8d8; pointer-events: none; }
  #tip { position: fixed; display: none; background: #0f0f12; color: #d8d8d8; border: 1px solid #3a3a44; border-radius: 4px; padding: 4px 8px; font-size: 12px; pointer-events: none; z-index: 1; }
  details { margin-top: 12px; font-size: 12px; color: #9a9aa2; }
  table { border-collapse: collapse; margin-top: 6px; }
  td, th { text-align: left; padding: 1px 14px 1px 0; font-variant-numeric: tabular-nums; vertical-align: top; }
</style>
<h1>clawd-band: from one animation to the next</h1>
<p>Each turn below is a written list of what the session does and when. It plays at real speed, 400 ms a frame, through each way of choosing what Clawd shows, as the picture (kitty graphics) and as the text Clawd (background sessions, other terminals). The strips under the animations are the same playback laid out along time: one block for each stretch a pose stays on screen.</p>
<main id="turns"></main>
<div id="tip"></div>
<script>
const WIDTH = ${PICTURE_WIDTH}, HEIGHT = ${PICTURE_HEIGHT}, REST_MS = 1500
const FRAMES = ${JSON.stringify(frames.drawn)}
const TURNS = ${JSON.stringify(turns)}

const make = (tag, className, textContent) => Object.assign(document.createElement(tag), className ? { className } : {}, textContent === undefined ? {} : { textContent })
const seconds = ms => (ms / 1000).toFixed(1) + ' s'
const tip = document.getElementById('tip')
document.addEventListener('mousemove', event => {
  const told = event.target.closest ? event.target.closest('[data-tip]') : null
  tip.style.display = told ? 'block' : 'none'
  if (!told) return
  tip.textContent = told.dataset.tip
  tip.style.left = Math.min(event.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'
  tip.style.top = event.clientY + 16 + 'px'
})

const drawFrame = (canvas, pre, frame) => {
  canvas.clearRect(0, 0, WIDTH, HEIGHT)
  frame.art.forEach((color, at) => {
    if (!color) return
    canvas.fillStyle = color
    canvas.fillRect(at % WIDTH, Math.floor(at / WIDTH), 1, 1)
  })
  pre.replaceChildren(...frame.text.flatMap(runs => [
    ...runs.map(run => Object.assign(document.createElement('span'), { textContent: run.text, style: 'color:' + run.color })),
    document.createTextNode('\\n'),
  ]))
}

// The last entry at or before a time.
const lastAt = (entries, ms) => {
  let found = entries[0]
  for (const entry of entries) {
    if (entry.at > ms) break
    found = entry
  }
  return found
}

const strip = (grid, name, lastsMs, fill) => {
  grid.append(make('div', '', name))
  const track = grid.appendChild(make('div', 'track'))
  fill(track)
  return track.appendChild(make('div', 'head-line'))
}

const blocks = (track, runs, lastsMs) => {
  for (const run of runs) {
    const block = track.appendChild(make('div', 'run' + (run.label === 'between' ? ' between' : ''), run.label === 'between' ? '' : run.label))
    const width = (run.to - run.from) / lastsMs
    if (width < 0.03) block.classList.add('narrow')
    block.style.left = 'calc(' + (run.from / lastsMs) * 100 + '% + 1px)'
    block.style.width = 'calc(' + width * 100 + '% - 2px)'
    block.dataset.tip = (run.label === 'between' ? 'the plain body between two poses' : run.label) + ': ' + seconds(run.from) + ' to ' + seconds(run.to) + ', ' + (run.to - run.from) + ' ms'
  }
}

const players = TURNS.map(turn => {
  const section = document.getElementById('turns').appendChild(make('section'))
  const head = section.appendChild(make('div', 'head'))
  head.append(make('h2', '', turn.title))
  const restart = head.appendChild(make('button', '', 'Restart'))
  const pause = head.appendChild(make('button', '', 'Pause'))
  const clock = head.appendChild(make('span', 'clock'))
  section.append(make('p', '', turn.note))

  const lanes = section.appendChild(make('div', 'lanes'))
  const draws = turn.lanes.map(lane => {
    const box = lanes.appendChild(make('div', 'lane'))
    box.append(make('h3', '', lane.name), make('p', '', lane.note))
    const forms = box.appendChild(make('div', 'forms'))
    const canvas = forms.appendChild(Object.assign(make('canvas'), { width: WIDTH, height: HEIGHT })).getContext('2d')
    const pre = forms.appendChild(make('pre'))
    const pose = box.appendChild(make('div', 'pose'))
    pose.append('shows ', make('b'))
    const poses = lane.runs.filter(run => run.label !== 'between')
    const shortest = Math.min(...poses.slice(0, -1).map(run => run.to - run.from))
    box.append(make('p', 'count', poses.length + ' stretches of a pose; the shortest stays ' + shortest + ' ms'))
    let drawn = null
    return ms => {
      const state = lastAt(lane.states, ms)
      if (state === drawn) return
      drawn = state
      drawFrame(canvas, pre, FRAMES[state.key])
      pose.querySelector('b').textContent = state.label === 'between' ? 'the plain body, between two poses' : state.label
    }
  })

  const now = section.appendChild(make('p', 'now'))
  const grid = section.appendChild(make('div', 'strips'))
  const heads = [
    strip(grid, 'events', turn.lastsMs, track => {
      for (const step of turn.steps) {
        const mark = track.appendChild(make('div', 'mark'))
        mark.style.left = (step.at / turn.lastsMs) * 100 + '%'
        mark.dataset.tip = seconds(step.at) + ': ' + step.says
      }
    }),
    strip(grid, 'session', turn.lastsMs, track => blocks(track, turn.session, turn.lastsMs)),
    ...turn.lanes.map(lane => strip(grid, lane.name, turn.lastsMs, track => blocks(track, lane.runs, turn.lastsMs))),
  ]
  grid.append(make('div'))
  const axis = grid.appendChild(make('div', 'track axis'))
  for (let ms = 0; ms <= turn.lastsMs; ms += 2000) {
    axis.appendChild(make('div', 'tick', String(ms / 1000))).style.left = (ms / turn.lastsMs) * 100 + '%'
  }

  const table = section.appendChild(make('details'))
  table.append(make('summary', '', 'The same as a table'))
  const rows = table.appendChild(make('table'))
  rows.append(make('tr'))
  rows.lastChild.append(make('th', '', 'session'), ...turn.lanes.map(lane => make('th', '', lane.name)))
  rows.append(make('tr'))
  for (const runs of [turn.session, ...turn.lanes.map(lane => lane.runs)]) {
    rows.lastChild.append(make('td', '', runs.map(run => seconds(run.from) + '  ' + run.label).join('\\n')))
    rows.lastChild.lastChild.style.whiteSpace = 'pre'
  }

  let startedAt = performance.now()
  let pausedAt = null
  restart.onclick = () => {
    startedAt = performance.now()
    if (pausedAt !== null) pausedAt = startedAt
  }
  pause.onclick = () => {
    if (pausedAt === null) pausedAt = performance.now()
    else {
      startedAt += performance.now() - pausedAt
      pausedAt = null
    }
    pause.textContent = pausedAt === null ? 'Pause' : 'Play'
  }
  return time => {
    const ms = Math.min(((pausedAt ?? time) - startedAt) % (turn.lastsMs + REST_MS), turn.lastsMs - 1)
    for (const draw of draws) draw(ms)
    for (const line of heads) line.style.left = (ms / turn.lastsMs) * 100 + '%'
    clock.textContent = seconds(ms)
    const step = lastAt(turn.steps, ms)
    now.replaceChildren('session: ' + lastAt(turn.session.map(run => ({ at: run.from, label: run.label })), ms).label + ' ', make('span', '', '(last event, at ' + seconds(step.at) + ': ' + step.says + ')'))
  }
})

const frame = time => {
  for (const player of players) player(time)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
</script>
`

const out = fileURLToPath(new URL('../docs/preview/transitions.html', import.meta.url))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, page)
const shown = turns.map(turn => `${turn.title}: ${turn.lanes.map(lane => `${lane.runs.filter(run => run.label !== 'between').length}`).join(' / ')}`)
console.log(`docs/preview/transitions.html: ${Object.keys(frames.drawn).length} frames; stretches of a pose per lane: ${shown.join('; ')}`)
