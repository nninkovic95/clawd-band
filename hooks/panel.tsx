import type { ConfigRow, ConfigValue, EngineInterface, On } from 'claude-code'

import { tokensText, zoneStart } from './band'
import { compactTokens, loadedTokens, usedRows } from './context'
import type { Settings } from './settings'

const MOD = 'clawd-band'
const COMMAND = 'clawd'
const PANE = 'clawd-settings'

// Offers /clawd. A command lasts as long as the process, and a resumed
// session loads the module without a session.start, so the first hook to run
// offers it. A declaration, as the engine follows `$` past an import into
// nothing else.
export function offerCommand($: EngineInterface) {
  return $.command.register({ name: COMMAND, description: "Clawd's settings: the band's options in a panel" })
}

const ZONE_PANE = 'clawd-context'

// Opens the pane that says what Dumb Memory is: what a press on its name in
// the band does.
export function openZonePane($: EngineInterface) {
  return $.ui.open({ id: ZONE_PANE, title: 'Dumb Memory', focus: true, closeOnEscape: true })
}

// Sets a row as the person would in the settings menu, and says why where
// the menu refuses.
async function change($: EngineInterface, row: ConfigRow, value: ConfigValue) {
  const { deny } = await $.config.set({ key: row.key, value })
  if (deny !== undefined) await $.ui.toast(`${row.label}: ${deny}`)
  // The pane shows the new value even where the change reloads nothing.
  else $.ui.invalidate('ui.render')
}

// A toggle is turned from what it holds when pressed, not from what it held
// when the pane was drawn: two presses before a redraw are two turns.
async function toggle($: EngineInterface, row: ConfigRow) {
  const held = (await $.config.list()).find(now => now.key === row.key) ?? row
  await change($, row, held.value !== true)
}

// The mod's settings in a pane of its own: what /clawd opens. It draws the
// rows the settings menu holds for this mod, so an option added to the
// manifest is here with no word of it in this file.
export const settingsPanel = (on: On) => {
  on('command.run', { command: COMMAND }, async $ => {
    await $.ui.open({ id: PANE, title: 'Clawd', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Select } = $.ui.resolve(e)
    const rows = (await $.config.list()).filter(row => row.provider.plugin === MOD)
    const control = (row: ConfigRow) => {
      if (row.kind === 'boolean') {
        return <Button key={row.key} label={`${row.label}: ${row.value === true ? 'on' : 'off'}`} onPress={() => toggle($, row)} />
      }
      if (row.kind === 'choice' && row.options) {
        return (
          <Select
            key={row.key}
            label={row.label}
            options={row.options.map(value => ({ value }))}
            value={String(row.value)}
            onSelect={value => change($, row, value)}
          />
        )
      }
      return <Input key={row.key} label={row.label} value={String(row.value)} onSubmit={value => change($, row, value)} />
    }
    return <Box flexDirection="column">{rows.map(control)}</Box>
  })
}

// The pane a press on the zone's name opens: the context by category as
// /context lists it, then where the zone starts for this session and the way
// out of it. Drawn from what the band already holds; it asks for no breakdown.
export const zonePanel = (on: On, settings: Settings, nameOf: (model: string) => string) => {
  on('ui.render', { component: 'Pane', requestId: ZONE_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // A row is a square, a blank, the name, the tokens in 6 cells and the share in 6, a
    // blank before each: the name takes what a narrow pane leaves, so no row wraps.
    const nameCells = Math.max(8, Math.min(24, e.props.bodyColumns - 17))
    const context = (await $.session.usage().catch(() => null))?.context
    const model = await $.session.model().catch(() => null)
    const window = context?.window ?? 0
    const tokens = context?.tokens ?? 0
    const loaded = loadedTokens()
    const compactAt = compactTokens()
    const start = loaded === null || window <= 0 ? null : zoneStart(window, loaded, settings.dumbZone)
    const share = (part: number) => (window > 0 ? `${((part / window) * 100).toFixed(1)}%` : '')
    return (
      <Box flexDirection="column">
        <Text bold>{`Context${model ? ` · ${nameOf(model)}` : ''}`}</Text>
        <Text>{` ${tokensText(tokens)} of ${tokensText(window)} tokens (${context?.percent ?? 0}%)`}</Text>
        <Text> </Text>
        {usedRows().map(row => (
          <Box flexDirection="row">
            <Text color={row.color}>■</Text>
            <Text>{` ${row.name.slice(0, nameCells).padEnd(nameCells)} ${tokensText(row.tokens).padStart(6)} ${share(row.tokens).padStart(6)}`}</Text>
          </Box>
        ))}
        <Text> </Text>
        {start === null || loaded === null ? (
          <Text dimColor>The session has not said yet what it holds.</Text>
        ) : (
          <Box flexDirection="column">
            <Text>{`Dumb Memory starts at ${tokensText(start)} (loaded ${tokensText(loaded)} + ${settings.dumbZone}% of the room left):`}</Text>
            <Text>a rule of thumb for where answers get worse.</Text>
            <Text>
              {tokens > start
                ? `This session is ${tokensText(tokens - start)} inside it: /compact or /new.`
                : `This session is ${tokensText(start - tokens)} short of it. Past it: /compact or /new.`}
            </Text>
          </Box>
        )}
        <Text>{compactAt === null ? 'Auto-compaction is off.' : `Auto-compaction runs at ${tokensText(compactAt)} (the grey pill).`}</Text>
        <Text> </Text>
        {/* What to do about it is /usage's to say: its recommendations are worked out from
            the person's usage, which a mod is not handed. */}
        <Button key="usage" label="See /usage's recommendations" onPress={() => void $.command.run({ command: 'usage' }).catch(() => undefined)} />
      </Box>
    )
  })
}
