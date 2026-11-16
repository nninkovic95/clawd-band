import type { EngineInterface, SessionContextBreakdown } from 'claude-code'

// What this copy keeps of the context by category, as /context breaks it
// down, and the session it was asked of.
const kept: {
  session: string | null
  breakdown: SessionContextBreakdown | null
  isAsking: boolean
  isWanted: boolean
  askedAt: number
} = {
  session: null,
  breakdown: null,
  isAsking: false,
  isWanted: false,
  askedAt: 0,
}

const AGAIN_MS = 60_000

// The context's estimated tokens, for a session no reply has measured yet;
// null until the session has answered.
export const estimatedTokens = (): number | null => kept.breakdown?.totalTokens ?? null

// The tokens the session held before its conversation: every row in use but
// the conversation's own. Only its name tells that row apart; were it ever
// named otherwise, the whole of what is in use counts. Null until the session
// has answered with its rows.
export const loadedTokens = (): number | null => {
  const rows = kept.breakdown?.categories
  if (!rows) return null
  return rows.filter(row => row.kind === 'used' && row.name !== 'Messages').reduce((total, row) => total + row.tokens, 0)
}

// The tokens at which the conversation is compacted by itself; null where that
// is off, or the session has not answered.
export const compactTokens = (): number | null =>
  kept.breakdown?.isAutoCompactEnabled ? (kept.breakdown.autoCompactThreshold ?? null) : null

// What the session holds has changed: the next pass asks again. Only noted
// here, so whoever says so waits on nothing.
export const wantContext = () => {
  kept.isWanted = true
}

// Run once a second: a session is asked for its breakdown when it is new and
// when one is wanted again. The summary is estimated where the session runs
// and sends no request.
export async function syncContext($: EngineInterface, now: number, sessionId: string, isDetailed: boolean) {
  // A lookup that failed gives no id: not a new session, once one is known.
  const isNew = sessionId !== kept.session && (sessionId !== '' || kept.session === null)
  // A turn under way adds to the conversation with no word of it: the detail is read again in time.
  const isDue = isDetailed && now - kept.askedAt >= AGAIN_MS
  if (kept.isAsking || (!isNew && !kept.isWanted && !isDue)) return
  kept.isAsking = true
  kept.askedAt = now
  // Taken down before the ask, so one wanted while it is out is asked for after it.
  kept.isWanted = false
  try {
    // Without the detail only a session no reply has measured needs the estimate.
    if (!isDetailed && (await $.session.usage()).context.percent !== undefined) return
    if (isNew) {
      kept.session = sessionId
      kept.breakdown = null
    }
    kept.breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown ?? null
    $.ui.invalidate('ui.render')
  } catch {
    // One that failed is wanted still: the next pass asks again.
    kept.isWanted = true
  } finally {
    kept.isAsking = false
  }
}
