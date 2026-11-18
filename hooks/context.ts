import type { EngineInterface } from 'claude-code'

// What this copy keeps of the context's estimate, as /context would make it,
// and the session it was asked of. Only a session the engine gives no figure
// for is asked.
const kept: {
  session: string | null
  // The estimate's tokens; null before one.
  tokens: number | null
  isAsking: boolean
  // True until the estimate is asked of a session with no figure; the
  // engine's figure arriving wants one again, should it go missing.
  isWanted: boolean
  // Moved on with each new session: an estimate asked before it moved is
  // dropped when it answers.
  version: number
} = {
  session: null,
  tokens: null,
  isAsking: false,
  isWanted: false,
  version: 0,
}

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

// The context's estimated tokens, for a session the engine gives no figure
// for; null until the session has answered.
export const estimatedTokens = (): number | null => kept.tokens

// Run once a second: a session the engine gives no figure for is asked once
// for its estimate. The summary is estimated where the session runs and sends
// no request.
export async function syncContext($: EngineInterface, sessionId: string) {
  // A lookup that failed gives no id: not a new session, once one is known.
  if (sessionId !== kept.session && (sessionId !== '' || kept.session === null)) {
    // Another session's estimate is never drawn: cleared at once, its own wanted.
    kept.session = sessionId
    kept.tokens = null
    kept.version += 1
    kept.isWanted = true
    $.ui.invalidate('ui.render')
  }
  if (kept.isAsking) return
  kept.isAsking = true
  const version = kept.version
  let isAsked = false
  try {
    const { context } = await inTime($, $.session.usage())
    if (context.percent !== undefined) {
      // The engine's figure is drawn: the estimate is dropped, and wanted
      // again should the figure go missing.
      kept.tokens = null
      kept.isWanted = true
      return
    }
    if (!kept.isWanted) return
    isAsked = true
    kept.isWanted = false
    const reading = (await inTime($, $.session.usage({ breakdown: 'summary' }))).context
    if (version !== kept.version) return
    kept.tokens = reading.breakdown?.totalTokens ?? null
    $.ui.invalidate('ui.render')
  } catch {
    // One that failed is wanted still: the next pass asks again.
    if (isAsked) kept.isWanted = true
  } finally {
    kept.isAsking = false
  }
}
