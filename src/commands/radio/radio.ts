import type { LocalCommandResult } from '../../types/command.js'
import { openBrowser } from '../../utils/browser.js'

/** densable $Oy — open Claude FM lo-fi radio. */
export async function call(): Promise<LocalCommandResult> {
  const url = 'https://clau.de/radio'
  const success = await openBrowser(url)

  if (success) {
    return { type: 'text', value: 'Opening Claude FM in your browser…' }
  }
  return {
    type: 'text',
    value: `Couldn't open the browser. Listen at: ${url}`,
  }
}
