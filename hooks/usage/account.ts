import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionRateLimit } from 'claude-code'

import { merging } from '../merge'
import type { Usage } from '../../types'
import { askKey, mergeUsage, sameUsage, toUsage } from './model'
import { asStoredUsage, field } from '../state'

// Spelled in the module that updates it: the engine's scan reads no atom imported from another.
const usageAtom = atom({ plugin: 'clawd-band', key: 'usage' } as const, null)

const USAGE_WINDOWS = ['five_hour', 'seven_day']

// The account usage endpoint (what /usage reads): `{ five_hour: { utilization,
// resets_at }, seven_day: { ... } }`, utilization in percent, a window null
// while none is open.
export const parseAccountUsage = (text: string): SessionRateLimit[] => {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return []
  }
  return USAGE_WINDOWS.flatMap(kind => {
    const utilization = field(field(body, kind), 'utilization')
    const resetsAt = field(field(body, kind), 'resets_at')
    if (typeof utilization !== 'number') return []
    const reset = typeof resetsAt === 'string' && !Number.isNaN(Date.parse(resetsAt)) ? resetsAt : undefined
    return [{ kind, percentUsed: Math.round(utilization * 10) / 10, resetsAt: reset }]
  })
}

type Answer = { limits: SessionRateLimit[] } | { reason: string; isFinal: boolean }

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

async function fetchAccountUsage($: EngineInterface): Promise<Answer> {
  const auth = await $.session.authorize().catch(() => null)
  if (!auth) return { reason: 'no-sign-in', isFinal: false }
  if (auth.kind !== 'bearer') return { reason: 'api-key', isFinal: true }
  try {
    // The one request the mod makes: GET, to this address only, with the
    // person's own sign-in; it sends nothing from the conversation.
    const res = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    if (res.ok) return { limits: parseAccountUsage(res.text) }
    return { reason: `http ${res.status}`, isFinal: res.status === 429 }
  } catch {
    // Claude Code refuses the request outright where nonessential traffic is
    // switched off; a network failure looks the same from here.
    return { reason: 'refused or no network', isFinal: false }
  }
}

const ASK_TIMEOUT_MS = 10_000
const RESET_FIRST_MS = 5_000 // the account has rolled the window over by then
const RETRY_MS = 60_000
const JITTER_MS = 2_000 // sessions that start together do not ask together
const TRIES = 5
const STALE_MS = 5 * 60_000

// A request that never comes back is given up, so the next try can run.
function answerInTime($: EngineInterface): Promise<Answer> {
  return new Promise(resolve => {
    const timer = $.clock.after(ASK_TIMEOUT_MS, () => resolve({ reason: 'timeout', isFinal: false }))
    void fetchAccountUsage($).then(answer => {
      timer.cancel()
      resolve(answer)
    })
  })
}

// This copy's view of the reading: when it was taken, what the store is known
// to hold, and where the account request for the current key stands.
const sync: {
  readAt: number
  kept: Usage | null
  session: string | null
  isStale: boolean
  key: string | null
  tries: number
  nextAt: number
  isAsking: boolean
  reason: string
} = {
  readAt: 0,
  kept: null,
  session: null,
  isStale: false,
  key: null,
  tries: 0,
  nextAt: 0,
  isAsking: false,
  reason: '',
}

async function keep($: EngineInterface, usage: Usage | null, readAt: number) {
  if (!usage || sameUsage(usage, sync.kept)) return
  sync.kept = usage
  await $.store.set('usage', { ...usage, readAt })
}

// A reading this session just took: into the atom, and into the store for the
// other sessions.
export async function setUsage($: EngineInterface, limits: readonly SessionRateLimit[], now: number) {
  if (limits.length === 0) return
  sync.readAt = now
  sync.isStale = false
  const value = await update($, usageAtom, merging(current => mergeUsage(current, toUsage(limits)), sameUsage).step)
  await keep($, value, now)
}

// A newer reading another session stored, or the stored one where this
// session has none yet.
async function adoptStored($: EngineInterface) {
  const stored = asStoredUsage(await $.store.get('usage'))
  if (!stored) return
  const current = await read($, usageAtom)
  if (current && stored.readAt <= sync.readAt) return
  sync.readAt = Math.max(sync.readAt, stored.readAt)
  sync.kept = stored.usage
  await update($, usageAtom, merging(now => mergeUsage(now, stored.usage), sameUsage).step)
}

// Once per session: what the session already knows fills the windows nothing
// newer has filled, and a reading older than a few minutes is marked stale.
async function loadSessionReading($: EngineInterface, now: number) {
  const session = toUsage((await $.session.usage()).rateLimits)
  if (session) await update($, usageAtom, merging(current => mergeUsage(session, current ?? null), sameUsage).step)
  sync.isStale = now - sync.readAt > STALE_MS
}

async function askAccount($: EngineInterface, now: number) {
  const key = askKey(await read($, usageAtom), sync.isStale, now)
  if (key !== sync.key) {
    sync.key = key
    sync.tries = 0
    // A window that has just run out is asked for a little later; a reading
    // that is missing or stale, at once.
    sync.nextAt = key === 'none' || key === 'stale' ? now : now + RESET_FIRST_MS + Math.random() * JITTER_MS
  }
  if (!key || sync.isAsking || sync.tries >= TRIES || now < sync.nextAt) return
  sync.tries += 1
  sync.isAsking = true
  const answer = await answerInTime($)
  sync.isAsking = false
  const reason = 'limits' in answer ? 'answered' : answer.reason
  if (reason !== sync.reason) $.ui.log(`clawd-band: account usage request: ${reason}`, { to: 'debug' })
  sync.reason = reason
  if ('limits' in answer) {
    // An answer settles the key even when it names no open window: the next
    // reply opens one and reports it.
    sync.tries = TRIES
    sync.isStale = false
    await setUsage($, answer.limits, await $.clock.now())
  } else if (answer.isFinal) {
    sync.tries = TRIES
  } else {
    sync.nextAt = now + RETRY_MS + Math.random() * JITTER_MS
  }
}

// Run once a second: the store first (no network), then the session's own
// reading when the session is new, then the account if the reading is not live.
export async function syncUsage($: EngineInterface, now: number, sessionId: string) {
  await adoptStored($).catch(() => undefined)
  if (sessionId !== sync.session) {
    // Marked first, so a slow pass is not joined by the next second's; a
    // failed one is tried again.
    sync.session = sessionId
    await loadSessionReading($, now).catch(() => {
      sync.session = null
    })
  }
  await askAccount($, now)
}
