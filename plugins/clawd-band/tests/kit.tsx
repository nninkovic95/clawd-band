import type { Hook, On, SessionContextUsage, SessionRateLimit } from 'claude-code'

// What the tests of the mounted band share.

export const BAND = {
  plugin: 'clawd-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 75,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// The moment every test's clock starts at.
export const NOW = Date.parse('2026-10-11T15:00:00Z')

// A reply on record a minute before the clock's start: the context row has its figure.
export const REPLIED_AT = NOW - 60_000
export const replied = (on: On, at: number = REPLIED_AT) => on('state.get', { key: 'cacheAt' }, () => ({ value: { value: at, version: 1 } }))

// A whole `$.session.usage()` answer: the engine always reports a window.
export const usageOf = (rateLimits: SessionRateLimit[] = [], context: SessionContextUsage = { window: 200_000 }) => ({
  value: { startedAt: 0, context, rateLimits },
})

// The tests' stand-in for the engine's own drawing: an empty box, since a
// stand-in that draws nothing is refused.
export const core: Hook<'ui.render'> = ($, e) => {
  const { Box } = $.ui.resolve(e)
  return <Box />
}

type Found = { props: Record<string, unknown> } | undefined
export type Screen = { find: (query: { key: string }) => Promise<Found> }

// A mounted Image as the band drew it.
export type Drawn = { columns: number; rows: number; alt: string; source: { rgba: string; width: number; height: number } }

export const imageOf = async (ui: Screen, key: string): Promise<Drawn | undefined> =>
  (await ui.find({ key }))?.props as Drawn | undefined

// The pixel at (x, y) of a drawn picture, as [red, green, blue, alpha].
export const pixelOf = ({ source }: Drawn, x: number, y: number): number[] => {
  const at = (y * source.width + x) * 4
  return [...Uint8Array.fromBase64(source.rgba).subarray(at, at + 4)]
}
