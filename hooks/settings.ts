import type { PluginOptions } from 'claude-code'

import type { Rgb, Rgba } from './picture'
import { CLAUDE_ORANGE, toHex } from './sprite'

// A bar's look: what one cell shows at each step from empty to full.
export type BarStyle = {
  steps: readonly [string, string, ...string[]]
  // What the first and the last cell show in place of their step, if anything.
  caps?: readonly [string, string]
  // Drawn as a picture where the terminal draws pictures; the steps are its look in text.
  isPicture?: true
}

// Solid on both sides, told apart by colour alone, so a theme sets both; the ends
// rounded with the powerline half circles of a Nerd Font.
const BLOCKS = { steps: ['█', '█'], caps: ['', ''] } as const

export const BAR_STYLES = {
  // A picture of a pill: an edge, the fill inside it, hairlines between days.
  pill: { ...BLOCKS, isPicture: true },
  blocks: BLOCKS,
  dots: { steps: ['⣀', '⣤', '⣶', '⣿'] },
} as const satisfies Record<string, BarStyle>

type BarStyleName = keyof typeof BAR_STYLES
const BAR_STYLE_NAMES: readonly [BarStyleName, ...BarStyleName[]] = ['pill', 'blocks', 'dots']

// A colour in both forms: what a Text takes (a theme key, a colour name or
// hex) and what a picture is drawn in.
export type Paint = { text: string; rgba: Rgba }

// How Clawd is drawn: a picture where the terminal draws pictures and text
// where it does not, always text, or not at all.
export type SpriteForm = 'picture' | 'text' | 'off'

// The person's userConfig values (plugin.json), checked: a value that is not
// one the option takes falls back to its default.
export type Settings = {
  showModel: boolean
  sprite: SpriteForm
  spriteColor: string
  spriteRgb: Rgb
  // How many times taller than wide one cell of the terminal is.
  cellRatio: number
  animate: boolean
  randomPoses: boolean
  turnEndings: boolean
  barStyle: BarStyle
  showWeekly: boolean
  showFiveHour: boolean
  showContext: boolean
  keepSpinner: boolean
  // Each bar's own colour, at any level.
  weeklyColor: Paint
  fiveHourColor: Paint
  contextColor: Paint
  // The weekly bar's last days when the week is used ahead of time.
  warning: Paint
  empty: Paint
  cold: Paint
  cacheTtlMs: number
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
// A theme key or a colour name, or hex, which may end in two digits of how solid it is.
const COLOR = /^(?:[a-z]+|#([0-9a-f]{6})([0-9a-f]{2})?|#([0-9a-f]{3}))$/i

const toRgb = (hex: string): Rgb | null => {
  const short = HEX.exec(hex.trim())?.[1]
  if (!short) return null
  const digits = short.length === 3 ? [...short].map(d => d + d).join('') : short
  const channel = (at: number) => parseInt(digits.slice(at, at + 2), 16)
  return [channel(0), channel(2), channel(4)]
}

// Fonts' cells run from about 1:1.9 to 1:2.5; outside these bounds a value is a slip.
const RATIO = { least: 1.6, most: 2.8, usual: 2.2 }

// The option is text, so that it holds a fraction; an empty one is no number.
const ratioOf = (value: unknown): number => {
  const ratio = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(ratio) ? Math.max(RATIO.least, Math.min(RATIO.most, ratio)) : RATIO.usual
}

// What a picture is drawn in for a theme key or a colour name: a mod is not
// told a theme's values, so these are the dark theme's.
const DARK = {
  claude: CLAUDE_ORANGE,
  suggestion: [177, 185, 249],
  permission: [177, 185, 249],
  autoAccept: [175, 135, 255],
  inactive: [153, 153, 153],
  error: [255, 107, 128],
  warning: [255, 193, 7],
  success: [78, 186, 101],
  blue: [95, 160, 230],
} as const satisfies Record<string, Readonly<Rgb>>

const isKnown = (key: string): key is keyof typeof DARK => Object.hasOwn(DARK, key)

const SOLID = 255
// A bar's empty part lets the terminal show through: two fifths solid.
const FAINT = 102

// An option's colour, or the theme key it falls back to. Hex paints both
// forms, a text never taking how solid it is; a key or a name the picture
// does not know leaves the picture its default. Hex says how solid the
// picture's colour is, wholly so without its last two digits; any other
// colour is as solid as the option usually is.
const paint = (value: unknown, key: keyof typeof DARK, usual = SOLID): Paint => {
  const [text = key, long, solid, short] = (typeof value === 'string' && COLOR.exec(value.trim())) || []
  const hex = long ?? short
  const rgb = (hex && toRgb(hex)) || [...DARK[isKnown(text) ? text : key]]
  const alpha = solid ? parseInt(solid, 16) : hex ? SOLID : usual
  return { text: hex ? toHex(rgb) : text, rgba: [rgb[0], rgb[1], rgb[2], alpha] }
}

// One of an option's choices by name, the first when it is none of them.
const oneOf = <T extends string>(value: unknown, choices: readonly [T, ...T[]]): T =>
  choices.find(choice => choice === value) ?? choices[0]

// One of the choices by chance, each time the module loads.
const anyOf = <T extends string>(choices: readonly [T, ...T[]], random: () => number): T =>
  choices[Math.floor(random() * choices.length)] ?? choices[0]

export const settings = (options: PluginOptions, random: () => number = Math.random): Settings => {
  const parsed = typeof options.sprite_color === 'string' ? toRgb(options.sprite_color) : null
  const custom = parsed && parsed.join() !== CLAUDE_ORANGE.join() ? parsed : null
  return {
    showModel: options.show_model !== false,
    // A random Clawd is one of the two that draw.
    sprite:
      options.sprite === 'random'
        ? anyOf(['picture', 'text'], random)
        : oneOf(options.sprite, ['picture', 'text', 'off']),
    // Clawd drawn in text: the theme's own Claude colour unless the sprite
    // has one of its own.
    spriteColor: custom ? toHex(custom) : 'claude',
    spriteRgb: custom ?? CLAUDE_ORANGE,
    cellRatio: ratioOf(options.cell_ratio),
    animate: options.animate !== false,
    randomPoses: options.random_poses !== false,
    turnEndings: options.turn_endings !== false,
    barStyle: BAR_STYLES[oneOf(options.bar_style, BAR_STYLE_NAMES)],
    showWeekly: options.show_weekly !== false,
    showFiveHour: options.show_five_hour !== false,
    showContext: options.show_context !== false,
    keepSpinner: options.keep_spinner === true,
    // Not `permission`: some themes draw it the same blue as `suggestion`.
    weeklyColor: paint(options.bar_color_weekly, 'autoAccept'),
    fiveHourColor: paint(options.bar_color_five_hour, 'suggestion'),
    contextColor: paint(options.bar_color_context, 'claude'),
    warning: paint(options.bar_color_warning, 'error'),
    empty: paint(options.bar_color_empty, 'inactive', FAINT),
    cold: paint(options.bar_color_cold, 'blue'),
    // The API keeps a cache entry 5 minutes or an hour; the mod cannot see which.
    cacheTtlMs: options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000,
  }
}
