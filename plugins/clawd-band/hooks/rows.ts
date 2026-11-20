import type { SessionContextUsage } from 'claude-code'

import type { Usage, Window } from '../types'
import { cacheCountdown, countdown, tokensText, windowLabel } from './format'
import type { Paint, Settings } from './settings'

const WEEK = 7 // days in the weekly bar

// One row of the band: a label, a bar, its percentage and a countdown.
export type Row = {
  label: string
  percent: number | null | undefined
  timer: string
  // A countdown that is running reads bold; one with nothing to count, dim.
  isLive: boolean
  // No reading yet: the bar is slashes and the dashes spin.
  isLoading?: true
  // The fill's own colour, at any level.
  own: Paint
  // Paints the fill and the countdown in place of `own` (a cold cache).
  color?: Paint
  segments?: number
  // How many of the last segments warn.
  warned?: number
  // One line of what the row's figures stand for: what the band shows for the row under
  // the pointer.
  detail?: string
}

const DAY_MS = 86_400_000
const WARNED_DAYS = 2

// A pace warning: the weekly bar's last segments warn once its fill is inside them
// and the segments left, at a day's even share each, are fewer than the days to
// its reset. How near the reset is does not gate it.
const isAhead = (window: Window | null | undefined, now: number): boolean => {
  if (window?.percentUsed == null || !window.resetsAt) return false
  const daysLeft = (WEEK * (100 - window.percentUsed)) / 100
  const untilReset = (Date.parse(window.resetsAt) - now) / DAY_MS
  return daysLeft <= WARNED_DAYS && daysLeft < untilReset
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

// A usage window in a line: how much of it is used and when it ends, by the person's own
// clock. The week also says how long what is left lasts at the pace so far.
const windowDetail = (name: string, window: Window | null | undefined, now: number, withDays: boolean): string | undefined => {
  if (window?.percentUsed == null || !window.resetsAt) return undefined
  const end = new Date(window.resetsAt)
  const two = (n: number) => String(n).padStart(2, '0')
  const day = withDays ? `${DAYS[end.getDay()]} ` : ''
  const parts = [`${name} ${Math.min(99, Math.round(window.percentUsed))}%`, `resets ${day}${two(end.getHours())}:${two(end.getMinutes())}`]
  if (withDays && window.percentUsed > 0) {
    const untilReset = (end.getTime() - now) / DAY_MS
    const lasts = ((100 - window.percentUsed) * (WEEK - untilReset)) / window.percentUsed
    parts.push(lasts >= untilReset ? 'enough to the reset' : `${lasts.toFixed(1)} days left at this pace`)
  }
  return parts.join(' · ')
}

export type Reading = {
  usage: Usage | null | undefined
  context: SessionContextUsage | null | undefined
  cacheAt: number | null | undefined
  now: number
}

// The rows the person asked for, top to bottom: the week, the five hours, and
// the context window with the prompt cache's countdown.
export const rowsOf = ({ usage, context, cacheAt, now }: Reading, settings: Settings): Row[] => {
  const windowRow = (label: string, window: Window | null | undefined, own: Paint, withDays = false): Row => {
    const detail = windowDetail(withDays ? 'week' : 'five hours', window, now, withDays)
    return {
      label,
      percent: window?.percentUsed,
      own,
      // At 0% with nothing to count to, the window has run out, or has not begun: the
      // next request opens it. Dashes are for a window nothing is known of.
      timer: window?.percentUsed === 0 && !window.resetsAt ? 'reset' : countdown(window?.resetsAt, now, withDays),
      isLive: !!window?.resetsAt,
      ...(window?.percentUsed == null ? { isLoading: true as const } : {}),
      // The weekly bar is cut into its seven days.
      segments: withDays ? WEEK : 1,
      ...(withDays && isAhead(window, now) ? { warned: WARNED_DAYS } : {}),
      ...(detail ? { detail } : {}),
    }
  }
  const cacheTimer = cacheCountdown(cacheAt, settings.cacheTtlMs, now)
  const isCold = cacheTimer === 'cold'
  const rows: Row[] = []
  if (settings.showWeekly) rows.push(windowRow('7d', usage?.sevenDay, settings.weeklyColor, true))
  if (settings.showFiveHour) rows.push(windowRow('5h', usage?.fiveHour, settings.fiveHourColor))
  if (settings.showContext) {
    // Until the session's first reply the row is loading whole: neither the engine's
    // figure nor an estimate is shown, and the pointer finds no line under it.
    const isLoading = cacheAt == null
    const tokens = context?.tokens
    const detail = !isLoading && context && tokens != null ? `${tokensText(tokens)} of ${tokensText(context.window)}` : undefined
    rows.push({
      ...(detail ? { detail } : {}),
      ...(isLoading ? { isLoading: true as const } : {}),
      label: windowLabel(context?.window),
      percent: isLoading ? undefined : context?.percent,
      own: settings.contextColor,
      timer: cacheTimer,
      isLive: cacheAt != null && !isCold,
      color: isCold ? settings.cold : undefined,
    })
  }
  return rows
}
