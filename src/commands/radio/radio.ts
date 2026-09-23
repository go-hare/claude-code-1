import type { LocalCommandResult } from '../../types/command.js'
import { openBrowser } from '../../utils/browser.js'

const RADIO_URL = 'https://clau.de/radio'

/** densable 2.1.251 #56 — `call` only opens Claude FM. No telemetry or provider gate. */
export async function openRadio(
  open: (url: string) => Promise<boolean> = openBrowser,
): Promise<LocalCommandResult> {
  if (await open(RADIO_URL)) {
    return { type: 'text', value: 'Opening Claude FM in your browser…' }
  }
  return {
    type: 'text',
    value: "Couldn't open the browser. Listen at: https://clau.de/radio",
  }
}

export async function call(): Promise<LocalCommandResult> {
  return openRadio()
}
