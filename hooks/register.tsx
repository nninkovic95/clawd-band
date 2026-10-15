import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Model, Pose, Usage, Window } from '../types'
import { ALT, FRAMES, PIXEL_HEIGHT, PIXEL_WIDTH } from './sprite'

const poseAtom = atom({ plugin: 'clawd-band', key: 'pose' } as const, 'idle')
const usageAtom = atom({ plugin: 'clawd-band', key: 'usage' } as const, null)
const modelAtom = atom({ plugin: 'clawd-band', key: 'model' } as const, { name: null, effort: null })

const SPRITE_COLUMNS = 12
const SPRITE_ROWS = 3
const FRAME_MS = 400 // stop-motion: a few frames, each held
const LABEL = 3 // "7d "
const PERCENT = 5 // " 100%"
const RESET = 10 // " ↻ 4:59:59" or " ↻  6d 23h"
const DOCS_PREFIX = 'mcp__claude_ai_Claude_Docs__'

const READING = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch']
const WRITING = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const RUNNING = ['Bash', 'BashOutput', 'KillShell', 'TaskStop']
const SEARCHING = ['WebFetch', 'WebSearch']
const DELEGATING = ['Agent', 'Task', 'SendMessage', 'Workflow', 'Skill']
const DOCS_READING = ['read', 'query', 'guide']

export const poseFor = (tool: string): Pose => {
  if (tool === 'AskUserQuestion') return 'questioning'
  if (tool.startsWith(DOCS_PREFIX)) return DOCS_READING.includes(tool.slice(DOCS_PREFIX.length)) ? 'reading' : 'writing'
  if (READING.includes(tool)) return 'reading'
  if (WRITING.includes(tool)) return 'writing'
  if (RUNNING.includes(tool)) return 'running'
  if (SEARCHING.includes(tool)) return 'searching'
  if (DELEGATING.includes(tool)) return 'delegating'
  return 'working'
}

const toWindow = (limits: readonly SessionRateLimit[], kind: string): Window | null => {
  const found = limits.find(l => l.kind === kind)
  return found ? { percentUsed: found.percentUsed, resetsAt: found.resetsAt ?? null } : null
}

export const toUsage = (limits: readonly SessionRateLimit[]): Usage | null =>
  limits.length === 0 ? null : { fiveHour: toWindow(limits, 'five_hour'), sevenDay: toWindow(limits, 'seven_day') }

export const countdown = (resetsAt: string | null | undefined, now: number): string => {
  if (!resetsAt) return '-:--:--'
  const total = Math.max(0, Math.floor((Date.parse(resetsAt) - now) / 1000))
  const days = Math.floor(total / 86400)
  if (days > 0) return `${days}d ${Math.floor((total % 86400) / 3600)}h`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// "claude-opus-5-5" -> "Opus 5.5"; a name already shown as words is kept.
export const shortModel = (model: string): string => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model)
  if (!m) return model
  return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

async function setModel($: EngineInterface, next: Partial<Model>) {
  let changed: Model | null = null
  await update($, modelAtom, (current: Model | undefined) => {
    const base = current ?? { name: null, effort: null }
    const merged = { name: next.name ?? base.name, effort: next.effort ?? base.effort }
    if (merged.name === base.name && merged.effort === base.effort) return base
    changed = merged
    return merged
  })
  if (changed) await $.store.set('model', changed)
}

// A window whose reset has passed is empty: 0% until the next request starts a
// new one and a response reports its reset.
export const resetExpired = (usage: Usage | null, now: number): Usage | null => {
  if (!usage) return null
  const live = (w: Window | null) =>
    w?.resetsAt && Date.parse(w.resetsAt) <= now ? { percentUsed: 0, resetsAt: null } : w
  return { fiveHour: live(usage.fiveHour), sevenDay: live(usage.sevenDay) }
}

// A reading names only the windows it has; one it leaves out keeps its last value.
export const mergeUsage = (current: Usage | null | undefined, limits: readonly SessionRateLimit[]): Usage | null => {
  const fresh = toUsage(limits)
  if (!fresh) return current ?? null
  return { fiveHour: fresh.fiveHour ?? current?.fiveHour ?? null, sevenDay: fresh.sevenDay ?? current?.sevenDay ?? null }
}

async function setUsage($: EngineInterface, limits: readonly SessionRateLimit[]) {
  if (limits.length === 0) return
  let merged: Usage | null = null
  await update($, usageAtom, (current: Usage | null | undefined) => (merged = mergeUsage(current, limits)))
  if (merged) await $.store.set('usage', merged)
}

export const barColor = (percent: number) => (percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success')

// The timer reads these between draws; a reload starts them over.
const live: {
  pose: Pose
  isWorking: boolean
  frame: number
  bandId: string | null
  isStarted: boolean
  isAsking: boolean
  sessionId: string | null
} = {
  pose: 'idle',
  isWorking: false,
  frame: 0,
  bandId: null,
  isStarted: false,
  isAsking: false,
  sessionId: null,
}

const shown = (): Pose => (live.isWorking ? live.pose : 'idle')

async function setPose($: EngineInterface, next: Pose) {
  if (next === live.pose) return
  live.pose = next
  live.frame = 0
  await update($, poseAtom, () => next)
}

function tick($: EngineInterface) {
  live.frame += 1
  // Frozen while a question dialog is open: frame swaps kept it from showing as a menu.
  if (!live.bandId || live.isAsking) return
  const frames = FRAMES[shown()]
  const rgba = frames[live.frame % frames.length]
  $.ui
    .blit({ requestId: live.bandId, key: 'clawd', source: { rgba, width: PIXEL_WIDTH, height: PIXEL_HEIGHT } })
    .catch(() => undefined)
}

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const USAGE_WINDOWS = ['five_hour', 'seven_day']

// The account usage endpoint (what /usage reads): `{ five_hour: { utilization,
// resets_at }, seven_day: { ... } }`, utilization in percent, a window null
// while none is open.
export const parseAccountUsage = (text: string): SessionRateLimit[] => {
  let body: Record<string, { utilization?: unknown; resets_at?: unknown } | null>
  try {
    body = JSON.parse(text)
  } catch {
    return []
  }
  if (!body || typeof body !== 'object') return []
  return USAGE_WINDOWS.flatMap(kind => {
    const w = body[kind]
    if (!w || typeof w.utilization !== 'number') return []
    const reset = typeof w.resets_at === 'string' && !Number.isNaN(Date.parse(w.resets_at)) ? w.resets_at : undefined
    return [{ kind, percentUsed: Math.round(w.utilization * 10) / 10, resetsAt: reset }]
  })
}

async function fetchAccountUsage($: EngineInterface): Promise<SessionRateLimit[]> {
  const auth = await $.session.authorize()
  if (auth?.kind !== 'bearer') return []
  const res = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
  return res.ok ? parseAccountUsage(res.text) : []
}

// Rate limits come from response headers and effort from the turn, so a fresh
// session has neither until its first reply: start from the last ones seen,
// then ask the account for both windows as they stand now.
async function loadUsage($: EngineInterface) {
  const cached = resetExpired(((await $.store.get('usage')) as Usage | undefined) ?? null, await $.clock.now())
  if (cached) await update($, usageAtom, (current: Usage | null | undefined) => current ?? cached)
  const { rateLimits } = await $.session.usage()
  if (rateLimits.length > 0) return setUsage($, rateLimits)
  await setUsage($, await fetchAccountUsage($).catch(() => []))
}

async function loadModel($: EngineInterface) {
  const name = await $.session.model()
  const cached = (await $.store.get('model')) as Model | undefined
  // The stored effort belongs to the stored model; another model may differ.
  const effort = cached && cached.name === name ? cached.effort : null
  await setModel($, { name, effort: effort ?? undefined })
}

// A /clear goes on in the same process under a new session id, with empty
// $.state and no session.start: a changed id loads usage and model again.
async function loadSession($: EngineInterface) {
  // An id that cannot be read still loads once.
  const id = await $.session.id().catch(() => '')
  if (id === live.sessionId) return
  live.sessionId = id
  await Promise.all([loadUsage($).catch(() => undefined), loadModel($).catch(() => undefined)])
}

// Started by whichever hook runs first: a resumed session can load the module
// without raising session.start, which left the band undrawn until a reload.
function ensureStarted($: EngineInterface) {
  if (live.isStarted) return
  live.isStarted = true
  $.clock.every(FRAME_MS, () => tick($))
  $.clock.every(1000, () => {
    loadSession($).catch(() => undefined)
    if (!live.isAsking) $.ui.invalidate('ui.render')
  })
  $.clock.after(0, () => {
    loadSession($).catch(() => undefined)
  })
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    ensureStarted($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    ensureStarted($)
    if (e.changed.includes('rateLimits')) await setUsage($, e.rateLimits)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    ensureStarted($)
    await setPose($, 'working')
    return next(e)
  })

  // The main thread's stream says when the model is thinking, writing, or
  // starting a tool call; subagents' streams are passed through untouched.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    if (e.agentId) return yield* stream
    await setModel($, { name: e.model, effort: e.effort === undefined ? undefined : String(e.effort) })
    for await (const chunk of stream) {
      if (chunk.kind === 'thinking') await setPose($, 'thinking')
      else if (chunk.kind === 'text') await setPose($, 'working')
      else if (chunk.kind === 'tool') await setPose($, poseFor(chunk.name))
      yield chunk
    }
    return stream.result
  })

  // Hold the pose while the tool runs (an AskUserQuestion waits on the person).
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    await setPose($, poseFor(tool))
    // The band holds still while the question dialog is open (one redraw for
    // the pose, then no frame swaps or countdown ticks until it closes).
    const isQuestion = tool === 'AskUserQuestion'
    if (isQuestion) {
      live.isAsking = true
      $.ui.invalidate('ui.render')
    }
    try {
      return await next(e)
    } finally {
      if (isQuestion) {
        live.isAsking = false
        $.ui.invalidate('ui.render')
      }
      await setPose($, 'working')
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await setPose($, 'idle')
    return next(e)
  })

  // The sprite is the only thing moving: the native spinner draws empty.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    ensureStarted($)
    if (e.surface !== 'terminal') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    ensureStarted($)
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      live.bandId = null
      return next(e)
    }

    live.bandId = e.requestId
    live.isWorking = e.props.isWorking
    live.pose = await read($, poseAtom)
    const now = await $.clock.now()
    // A window that resets mid-session drops to 0% on the next tick, not the next reply.
    const usage = resetExpired(await read($, usageAtom), now)
    const model = await read($, modelAtom)
    const { Box, Text, Image } = $.ui.resolve(e)

    const current = shown()
    const frames = FRAMES[current]
    const modelName = model.name ? shortModel(model.name) : '--'
    const caption = model.effort ? `${modelName} ${model.effort}` : modelName
    const left = Math.max(SPRITE_COLUMNS + 1, caption.length)
    const barWidth = Math.max(4, e.props.bodyColumns - left - 1 - LABEL - PERCENT - RESET)

    const bar = (label: string, window: Window | null | undefined) => {
      const percent = window?.percentUsed ?? 0
      const filled = Math.min(barWidth, Math.round((percent / 100) * barWidth))
      return (
        <Box flexDirection="row">
          <Text dimColor>{label} </Text>
          <Text color={barColor(percent)}>{'█'.repeat(filled)}</Text>
          <Text color="inactive">{'░'.repeat(barWidth - filled)}</Text>
          <Text dimColor={!window}>{window ? ` ${String(Math.round(percent)).padStart(3)}%` : '   --'}</Text>
          <Text dimColor> ↻ </Text>
          <Text bold={!!window?.resetsAt}>{countdown(window?.resetsAt, now).padStart(RESET - 3)}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" alignItems="center">
        <Box flexDirection="column" width={left} alignItems="center">
          {live.isAsking ? (
            // A kitty image sits on a layer above the text and covered the
            // question menu; while it is open, Clawd is the CLI's text logo.
            <Box flexDirection="column">
              <Text color="claude"> ▐▛███▜▌ </Text>
              <Text color="claude">▝▜█████▛▘</Text>
              <Text color="claude">  ▘▘ ▝▝  </Text>
            </Box>
          ) : (
            <Image
              key="clawd"
              source={{ rgba: frames[live.frame % frames.length], width: PIXEL_WIDTH, height: PIXEL_HEIGHT }}
              columns={SPRITE_COLUMNS}
              rows={SPRITE_ROWS}
              alt={ALT[current]}
            />
          )}
          <Box flexDirection="row">
            <Text bold>{modelName}</Text>
            {model.effort ? <Text dimColor> {model.effort}</Text> : null}
          </Box>
        </Box>
        <Box flexDirection="column" marginLeft={1}>
          {bar('7d', usage?.sevenDay)}
          {bar('5h', usage?.fiveHour)}
        </Box>
      </Box>
    )
  })
}
