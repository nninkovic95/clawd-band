import type { Hook, On, SessionContextUsage, SessionRateLimit } from 'claude-code'

// What the band's test files share: the band to mount, the option sets, the clock's start,
// a usage answer, the engine's stand-in drawing and the readers of a drawn node.

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

// The bars as text, whatever the terminal draws: the tests of their cells.
export const TEXT_BARS = { options: { bar_style: 'blocks' } } as const
// Still bars: a row with no reading holds one frame, so a long wait costs no redraw each frame.
export const STILL_BARS = { options: { bar_style: 'blocks', animate: false } } as const

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

// A node of the drawn band: a Text's own string is among its children.
export type Drawn = { props: Record<string, unknown>; children: (Drawn | string)[] }
export const nodes = (node: Drawn) => node.children.filter((child): child is Drawn => typeof child !== 'string')
export const words = (node: Drawn) => node.children.filter(child => typeof child === 'string').join('')

// The band at a given width, Clawd drawn as a picture.
export const narrow = (bodyColumns: number) => ({ ...BAND, props: { ...BAND.props, bodyColumns } })
