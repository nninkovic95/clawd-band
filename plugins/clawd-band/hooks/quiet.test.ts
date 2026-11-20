import { expect, test } from 'claude-code/testing'

import { quietly } from './quiet'

// The runtime has no unhandled-rejection event (and console.debug is
// read-only), so a rejection counts as handled when someone hands the
// promise a rejection handler, and that handler settles without a fault.
const watched = <T>(settle: (ok: (value: T) => void, fail: (reason: unknown) => void) => void) => {
  const seen = { handlers: 0, faults: 0 }
  class Watched extends Promise<T> {
    override then<A = T, B = never>(
      ok?: ((value: T) => A | PromiseLike<A>) | null,
      fail?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): Promise<A | B> {
      if (!fail) return super.then(ok, fail)
      seen.handlers++
      return super.then(ok, (reason: unknown) => {
        try {
          return fail(reason)
        } catch (fault) {
          seen.faults++
          throw fault
        }
      })
    }
  }
  return { promise: new Watched(settle), seen }
}

// The runtime has timers; the types this module is checked against do not name them.
const host = globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }
const drain = (): Promise<void> => new Promise((done) => host.setTimeout(done, 20))

test('quietly on a rejected promise does not throw and leaves no unhandled rejection', async () => {
  const { promise, seen } = watched<string>((_, fail) => fail(new Error('boom')))
  expect(quietly(promise)).toBe(undefined)
  await drain()
  expect(seen.handlers).toBe(1)
  expect(seen.faults).toBe(0)
})

test('quietly on a resolved promise does nothing', async () => {
  const { promise, seen } = watched<string>((ok) => ok('fine'))
  expect(quietly(promise)).toBe(undefined)
  await drain()
  expect(seen.faults).toBe(0)
})
