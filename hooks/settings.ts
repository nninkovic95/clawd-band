import type { PluginOptions } from 'claude-code'

import { CLAUDE_ORANGE, toHex } from './sprite'
import type { Rgb } from './sprite'

// A bar's look: what one cell shows at each step from empty to full, so a
// cell of `circles` fills by quarters.
export type BarStyle = {
  steps: readonly [string, string, ...string[]]
  // What the first and the last cell show in place of their step, if anything.
  caps?: readonly [string, string]
}

export const BAR_STYLES = {
  // Solid on both sides, told apart by colour alone, so a theme sets both; the ends
  // rounded with the powerline half circles of a Nerd Font.
  blocks: { steps: ['█', '█'], caps: ['', ''] },
  circles: { steps: ['○', '◔', '◑', '◕', '●'] },
  dots: { steps: ['⣀', '⣤', '⣶', '⣿'] },
  squares: { steps: ['□', '▣', '■'] },
  line: { steps: ['─', '╾', '━'] },
} as const satisfies Record<string, BarStyle>

type BarStyleName = keyof typeof BAR_STYLES
const BAR_STYLE_NAMES: readonly [BarStyleName, ...BarStyleName[]] = ['blocks', 'circles', 'dots', 'squares', 'line']

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
  animate: boolean
  randomPoses: boolean
  turnEndings: boolean
  barStyle: BarStyle
  showWeekly: boolean
  showFiveHour: boolean
  showContext: boolean
  keepSpinner: boolean
  // Each bar's own colour, at any level.
  weeklyColor: string
  fiveHourColor: string
  contextColor: string
  // The weekly bar's last days when the week is used ahead of time.
  warning: string
  empty: string
  cold: string
  cacheTtlMs: number
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const COLOR = /^([a-z]+|#[0-9a-f]{3}|#[0-9a-f]{6})$/i // a theme key, a colour name, or hex

const toRgb = (hex: string): Rgb | null => {
  const short = HEX.exec(hex.trim())?.[1]
  if (!short) return null
  const digits = short.length === 3 ? [...short].map(d => d + d).join('') : short
  const channel = (at: number) => parseInt(digits.slice(at, at + 2), 16)
  return [channel(0), channel(2), channel(4)]
}

const textColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : fallback

// One of an option's choices by name, the first when it is none of them;
// `random` picks among them each time the module loads.
const oneOf = <T extends string>(value: unknown, choices: readonly [T, ...T[]], random: () => number): T => {
  if (value === 'random') return choices[Math.floor(random() * choices.length)] ?? choices[0]
  return choices.find(choice => choice === value) ?? choices[0]
}

export const settings = (options: PluginOptions, random: () => number = Math.random): Settings => {
  const parsed = typeof options.sprite_color === 'string' ? toRgb(options.sprite_color) : null
  const custom = parsed && parsed.join() !== CLAUDE_ORANGE.join() ? parsed : null
  return {
    showModel: options.show_model !== false,
    // A random Clawd is one of the two that draw.
    sprite:
      options.sprite === 'random'
        ? oneOf('random', ['picture', 'text'], random)
        : oneOf(options.sprite, ['picture', 'text', 'off'], random),
    // Clawd drawn in text: the theme's own Claude colour unless the sprite
    // has one of its own.
    spriteColor: custom ? toHex(custom) : 'claude',
    spriteRgb: custom ?? CLAUDE_ORANGE,
    animate: options.animate !== false,
    randomPoses: options.random_poses !== false,
    turnEndings: options.turn_endings !== false,
    barStyle: BAR_STYLES[oneOf(options.bar_style, BAR_STYLE_NAMES, random)],
    showWeekly: options.show_weekly !== false,
    showFiveHour: options.show_five_hour !== false,
    showContext: options.show_context !== false,
    keepSpinner: options.keep_spinner === true,
    // Not `permission`: some themes draw it the same blue as `suggestion`.
    weeklyColor: textColor(options.bar_color_weekly, 'autoAccept'),
    fiveHourColor: textColor(options.bar_color_five_hour, 'suggestion'),
    contextColor: textColor(options.bar_color_context, 'claude'),
    warning: textColor(options.bar_color_warning, 'error'),
    empty: textColor(options.bar_color_empty, 'inactive'),
    cold: textColor(options.bar_color_cold, 'blue'),
    // The API keeps a cache entry 5 minutes or an hour; the mod cannot see which.
    cacheTtlMs: options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000,
  }
}
