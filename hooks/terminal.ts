import type { EngineInterface } from 'claude-code'

import { PROBE } from './band'
import type { Picture } from './picture'
import type { TextFrame } from './sprite'

// How the engine words its refusal to swap a picture the terminal cannot draw:
// a background session, or a terminal without kitty graphics.
const NO_PICTURE = 'the Image draws its alt here'
const REFUSALS = 3 // in a row: the first swaps can come before the terminal has answered

// The two things of the engine's screen the band asks of it.
export type Screen = Pick<EngineInterface['ui'], 'blit' | 'invalidate'>

// What a pose is drawn as, in either form.
export type Frames = { picture: () => Picture; text: () => TextFrame }

// What the band knows of the terminal it is drawn in: whether it draws pictures.
export function terminal() {
  let draws = true
  let refusals = 0
  // The form the band last drew Clawd in: it picks what fits its width.
  let form: 'picture' | 'text' | null = null
  // The picture last sent to the band, so an unchanged frame is not sent again.
  let sent: Picture | null = null
  // The text on screen, when the band drew Clawd as text.
  let drawnText: TextFrame | null = null

  return {
    // Whether the terminal draws pictures, as far as the last probes say.
    get draws() {
      return draws
    },

    // Asks the terminal, by a swap of the band's one-cell picture: once a
    // second, and each tick while refusals are being counted. A few refusals in
    // a row and the band draws in text; one swap taken and it draws pictures
    // again, so a terminal that comes back from where it could draw none gets
    // its pictures back.
    async probe(ui: Screen, bandId: string, isNewSecond: boolean) {
      const isCounting = draws && refusals > 0
      if (!isNewSecond && !isCounting) return
      const answer = await ui.blit({ requestId: bandId, key: 'probe', source: PROBE }).catch(() => null)
      // A band taken down between draws refuses too, which says nothing of pictures.
      if (answer === null || (answer.deny !== undefined && !answer.deny.includes(NO_PICTURE))) return
      refusals = answer.deny === undefined ? 0 : refusals + 1
      const now = refusals < REFUSALS
      if (now === draws) return
      draws = now
      // The band is drawn anew in the other form: no picture of the old one counts as sent.
      sent = null
      ui.invalidate('ui.render')
    },

    // The band was drawn in this form, with this text when it is text.
    drew(now: 'picture' | 'text' | null, text: TextFrame | null) {
      form = now
      drawnText = now === 'text' ? text : null
    },

    // The next frame of the pose: a picture swapped in place, or, where Clawd
    // is text, a redraw once the text on screen is no longer the frame to show.
    async showFrame(ui: Screen, bandId: string, frames: Frames) {
      if (form === 'text') {
        if (frames.text() !== drawnText) ui.invalidate('ui.render')
        return
      }
      if (form !== 'picture') return
      const source = frames.picture()
      if (source === sent) return
      // A band taken down between draws refuses too; the next render places it again.
      const answer = await ui.blit({ requestId: bandId, key: 'clawd', source }).catch(() => null)
      // Only a picture the band took counts as sent: one it refused goes again.
      sent = answer !== null && answer.deny === undefined ? source : null
    },
  }
}
