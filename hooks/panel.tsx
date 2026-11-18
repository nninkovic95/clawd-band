import type { ConfigRow, ConfigValue, EngineInterface, On } from 'claude-code'

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
