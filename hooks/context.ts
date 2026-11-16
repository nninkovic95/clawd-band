import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionContextBreakdown } from 'claude-code'

import type { Pin } from '../types'

// What the session had loaded when it was first read: where Dumb Memory starts
// for the whole session. In $.state, so a module loaded again mid-session
// takes it up.
const pinAtom = atom({ plugin: 'clawd-band', key: 'loaded' } as const, null)

// What this copy keeps of the context by category, as /context breaks it
// down, and the session it was asked of.
const kept: {
  session: string | null
  breakdown: SessionContextBreakdown | null
  // The loaded tokens pinned, and the session they are of.
  pin: Pin | null
  // The window the reading came with; null before one.
  window: number | null
  isAsking: boolean
  isWanted: boolean
  askedAt: number
  // Moved on whenever what was asked of the session no longer holds: a
  // reading asked before it moved is dropped when it answers.
  version: number
  // Compactions under way: none is asked for until they are done.
  compactions: number
  // A compaction the spinner told of, whose end is still to come.
  isToldCompacting: boolean
} = {
  session: null,
  breakdown: null,
  pin: null,
  window: null,
  isAsking: false,
  isWanted: false,
  askedAt: 0,
  version: 0,
  compactions: 0,
  isToldCompacting: false,
}

const AGAIN_MS = 60_000
const GIVE_UP_MS = 10_000

// What `reading` answers, raced against the mod's clock: one that has not
// answered ten seconds on is given up, and what it answers after is dropped.
function inTime<T>($: EngineInterface, reading: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = $.clock.after(GIVE_UP_MS, () => reject(new Error('given up')))
    reading.then(
      value => {
        timer.cancel()
        resolve(value)
      },
      (error: unknown) => {
        timer.cancel()
        reject(error)
      },
    )
  })
}

// The context's estimated tokens, for a session no reply has measured yet;
// null until the session has answered.
export const estimatedTokens = (): number | null => kept.breakdown?.totalTokens ?? null

// The tokens the session held before its conversation, as its first reading
// had them. Null until the session has answered.
export const loadedTokens = (): number | null => (kept.breakdown && kept.pin?.session === kept.session ? kept.pin.tokens : null)

// The pin of `session`: the one kept, the one a module loaded before left, or
// else what `breakdown` has in use but the conversation's own row, written.
// Only its name tells that row apart; were it ever named otherwise, the whole
// of what is in use counts, and the debug log says so.
async function pinOf($: EngineInterface, session: string, breakdown: SessionContextBreakdown): Promise<Pin> {
  if (kept.pin?.session === session) return kept.pin
  const left = await read($, pinAtom)
  if (left?.session === session) return left
  const pin = { session, tokens: breakdown.categories.filter(row => row.kind === 'used' && row.name !== 'Messages').reduce((total, row) => total + row.tokens, 0) }
  await update($, pinAtom, () => pin)
  if (!breakdown.categories.some(row => row.name === 'Messages')) {
    $.ui.log('clawd-band: the context breakdown has no row named Messages: Dumb Memory counts all of it in use as loaded', { to: 'debug' })
  }
  return pin
}

// The rows that take up the window, as /context lists them, in its order.
export const usedRows = (): { name: string; tokens: number; color: string }[] =>
  (kept.breakdown?.categories ?? []).filter(row => row.kind === 'used')

// The tokens at which the conversation is compacted by itself; null where that
// is off, or the session has not answered.
export const compactTokens = (): number | null =>
  kept.breakdown?.isAutoCompactEnabled ? (kept.breakdown.autoCompactThreshold ?? null) : null

// What the session holds has changed: the next pass asks again. Only noted
// here, so whoever says so waits on nothing.
export const wantContext = () => {
  kept.isWanted = true
}

// A compaction starts: what the session holds is about to change, so its
// reading is cleared at once, and one out is dropped when it answers.
export function compactionStarts($: EngineInterface) {
  kept.compactions += 1
  kept.breakdown = null
  kept.version += 1
  $.ui.invalidate('ui.render')
}

// The spinner tells of a compaction. Nothing is cleared: what is kept stays
// drawn until the reading after it.
export const compactionTold = () => {
  kept.isToldCompacting = true
}

// The compaction the spinner told of is over, by its word or by the turn's
// end: the next pass asks anew, once for it.
export const toldCompactionEnds = () => {
  if (!kept.isToldCompacting) return
  kept.isToldCompacting = false
  kept.isWanted = true
}

// A compaction is done: the next pass asks anew.
export const compactionEnds = () => {
  kept.compactions -= 1
  kept.isWanted = true
  // The spinner told of this one too: its end, when told, asks nothing more.
  kept.isToldCompacting = false
}

// Run once a second: a session is asked for its breakdown when it is new,
// when one is wanted again and when its window changed. The summary is estimated where the session runs
// and sends no request.
export async function syncContext($: EngineInterface, now: number, sessionId: string, isDetailed: boolean) {
  // A lookup that failed gives no id: not a new session, once one is known.
  if (sessionId !== kept.session && (sessionId !== '' || kept.session === null)) {
    // Another session's reading is never drawn: cleared at once, its own wanted.
    kept.session = sessionId
    kept.breakdown = null
    kept.window = null
    kept.version += 1
    kept.isWanted = true
    $.ui.invalidate('ui.render')
  }
  // A turn under way adds to the conversation with no word of it: the detail is read again in time.
  const isDue = isDetailed && now - kept.askedAt >= AGAIN_MS
  if (kept.isAsking || kept.compactions > 0) return
  kept.isAsking = true
  const version = kept.version
  let isAsked = false
  try {
    const { context } = await inTime($, $.session.usage())
    // A change of model: the reading was of another window.
    const isOtherWindow = kept.window !== null && context.window !== kept.window
    if (!kept.isWanted && !isDue && !isOtherWindow) return
    isAsked = true
    kept.askedAt = now
    // Taken down before the ask, so one wanted while it is out is asked for after it.
    kept.isWanted = false
    // Without the detail only a session no reply has measured needs the estimate.
    if (!isDetailed && context.percent !== undefined) {
      kept.window = context.window
      return
    }
    const reading = (await inTime($, $.session.usage({ breakdown: 'summary' }))).context
    if (version !== kept.version) return
    // An estimate with no rows pins nothing.
    const pin = reading.breakdown?.categories ? await pinOf($, kept.session ?? sessionId, reading.breakdown) : kept.pin
    if (version !== kept.version) return
    kept.breakdown = reading.breakdown ?? null
    kept.pin = pin
    kept.window = reading.window
    $.ui.invalidate('ui.render')
  } catch {
    // One that failed is wanted still: the next pass asks again.
    if (isAsked) kept.isWanted = true
  } finally {
    kept.isAsking = false
  }
}
