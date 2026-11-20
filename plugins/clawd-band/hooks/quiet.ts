// Fire and forget: a fault in work nobody waits for is swallowed, but told
// under debug so it is not invisible. Never throws and returns nothing.
// The runtime has a console; the types this module is checked against do not name one.
const host = globalThis as unknown as { console?: { debug(...args: unknown[]): void } }

export const quietly = (promise: Promise<unknown>): void => {
  promise.catch((fault: unknown) => {
    try {
      host.console?.debug('clawd-band: background work failed', fault)
    } catch {
      // Nowhere left to tell it.
    }
  })
}
