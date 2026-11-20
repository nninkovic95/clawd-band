// Fire and forget: a fault in work nobody waits for is swallowed, but told
// under debug so it is not invisible. Never throws and returns nothing.
export const quietly = (promise: Promise<unknown>): void => {
  promise.catch((fault: unknown) => {
    try {
      console.debug('clawd-band: background work failed', fault)
    } catch {
      // Nowhere left to tell it.
    }
  })
}
