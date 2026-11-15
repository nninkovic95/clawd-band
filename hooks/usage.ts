import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionRateLimit } from 'claude-code'

import type { Usage, Window } from '../types'

const usageAtom = atom({ plugin: 'clawd-band', key: 'usage' } as const, null)

const toWindow = (limits: readonly SessionRateLimit[], kind: string): Window | null => {
  const found = limits.find(l => l.kind === kind)
  return found ? { percentUsed: found.percentUsed, resetsAt: found.resetsAt ?? null } : null
}

export const toUsage = (limits: readonly SessionRateLimit[]): Usage | null =>
  limits.length === 0 ? null : { fiveHour: toWindow(limits, 'five_hour'), sevenDay: toWindow(limits, 'seven_day') }

// A window whose reset has passed is empty: 0% until the next request starts a
// new one and a response reports its reset.
export const resetExpired = (usage: Usage | null, now: number): Usage | null => {
  if (!usage) return null
  const live = (w: Window | null) =>
    w?.resetsAt && Date.parse(w.resetsAt) <= now ? { percentUsed: 0, resetsAt: null } : w
  return { fiveHour: live(usage.fiveHour), sevenDay: live(usage.sevenDay) }
}

// A reading names only the windows it has; one it leaves out keeps its last value.
export const mergeUsage = (current: Usage | null | undefined, fresh: Usage | null): Usage | null => {
  if (!fresh) return current ?? null
  return { fiveHour: fresh.fiveHour ?? current?.fiveHour ?? null, sevenDay: fresh.sevenDay ?? current?.sevenDay ?? null }
}

const sameWindow = (a: Window | null | undefined, b: Window | null | undefined) =>
  (a?.percentUsed ?? null) === (b?.percentUsed ?? null) && (a?.resetsAt ?? null) === (b?.resetsAt ?? null)

export const sameUsage = (a: Usage | null | undefined, b: Usage | null | undefined): boolean =>
  sameWindow(a?.fiveHour, b?.fiveHour) && sameWindow(a?.sevenDay, b?.sevenDay)

// What the store holds: a reading and when it was taken. Every session of the
// account shares the one store, so the newest reading reaches them all.
export type StoredUsage = { usage: Usage; readAt: number }

export const field = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined

const asWindow = (value: unknown): Window | null => {
  const percentUsed = field(value, 'percentUsed')
  const resetsAt = field(value, 'resetsAt')
  if (typeof percentUsed !== 'number') return null
  return { percentUsed, resetsAt: typeof resetsAt === 'string' ? resetsAt : null }
}

// A stored value, checked. One written before readings carried their time
// counts as the oldest there is.
export const asStoredUsage = (value: unknown): StoredUsage | null => {
  const usage = { fiveHour: asWindow(field(value, 'fiveHour')), sevenDay: asWindow(field(value, 'sevenDay')) }
  if (!usage.fiveHour && !usage.sevenDay) return null
  const readAt = field(value, 'readAt')
  return { usage, readAt: typeof readAt === 'number' ? readAt : 0 }
}

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

// The reset times of the windows that have run out, joined. Null while every
// window still has time left.
export const expiredKey = (usage: Usage | null | undefined, now: number): string | null => {
  const gone = [usage?.fiveHour?.resetsAt, usage?.sevenDay?.resetsAt].filter(
    (r): r is string => !!r && Date.parse(r) <= now,
  )
  return gone.length > 0 ? gone.join() : null
}

// What an account request would settle, as one word; null while the reading is
// live. `isStale` is a reading that was already old when the session loaded.
export const askKey = (usage: Usage | null | undefined, isStale: boolean, now: number): string | null =>
  !usage ? 'none' : (expiredKey(usage, now) ?? (isStale ? 'stale' : null))

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
} = { readAt: 0, kept: null, session: null, isStale: false, key: null, tries: 0, nextAt: 0, isAsking: false, reason: '' }

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
  const usage = await update($, usageAtom, (current: Usage | null | undefined) => {
    const merged = mergeUsage(current, toUsage(limits))
    return sameUsage(current, merged) ? (current ?? null) : merged
  })
  await keep($, usage, now)
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
  await update($, usageAtom, (now: Usage | null | undefined) => {
    const merged = mergeUsage(now, stored.usage)
    return sameUsage(now, merged) ? (now ?? null) : merged
  })
}

// Once per session: what the session already knows fills the windows nothing
// newer has filled, and a reading older than a few minutes is marked stale.
async function loadSessionReading($: EngineInterface, now: number) {
  const session = toUsage((await $.session.usage()).rateLimits)
  if (session) {
    await update($, usageAtom, (current: Usage | null | undefined) => {
      const merged = mergeUsage(session, current ?? null)
      return sameUsage(current, merged) ? (current ?? null) : merged
    })
  }
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
