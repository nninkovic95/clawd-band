import type { SessionRateLimit } from 'claude-code'

import type { Usage, Window } from '../../types'

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
