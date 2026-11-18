import chalk from 'chalk'
import stripAnsi from 'strip-ansi'
import { supportsHyperlinks } from '@anthropic/ink'

// OSC 8 hyperlink escape sequences
// Format: \e]8;;URL\e\\TEXT\e]8;;\e\\
// Using \x07 (BEL) as terminator which is more widely supported
export const OSC8_START = '\x1b]8;;'
export const OSC8_END = '\x07'

/**
 * Official 2.1.295 `Fe` (#373): reset conceal (SGR 28), foreground (SGR 39),
 * and background (SGR 49) before showing a link address so a preceding style
 * cannot hide it.
 */
export const HYPERLINK_STYLE_RESET = '\x1b[28m\x1b[39m\x1b[49m'

type HyperlinkOptions = {
  supportsHyperlinks?: boolean
  shownUrlStart?: string
}

function isEquivalentUrl(url: string, text: string): boolean {
  return text === url || url === `http://${text}` || url === `https://${text}`
}

/**
 * Create a clickable hyperlink using OSC 8 escape sequences.
 * Falls back to plain text if the terminal doesn't support hyperlinks.
 *
 * @param url - The URL to link to
 * @param content - Optional content to display as the link text (only when hyperlinks are supported).
 *                  If provided and hyperlinks are supported, this text is shown as a clickable link.
 *                  If hyperlinks are not supported, content is ignored and only the URL is shown.
 * @param options - Optional overrides for testing (supportsHyperlinks, shownUrlStart)
 */
export function createHyperlink(
  url: string,
  content?: string,
  options?: HyperlinkOptions,
): string {
  const hasSupport = options?.supportsHyperlinks ?? supportsHyperlinks()
  const shownUrlStart = options?.shownUrlStart ?? ''
  if (!hasSupport) {
    if (content !== undefined) {
      const plain = stripAnsi(content)
      if (!isEquivalentUrl(url, plain)) {
        return `${content}${shownUrlStart} (${url})`
      }
    }
    return `${shownUrlStart}${url}`
  }

  // Apply basic ANSI blue color - wrap-ansi preserves this across line breaks
  // RGB colors (like theme colors) are NOT preserved by wrap-ansi with OSC 8
  const displayText = content ?? url
  const coloredText = chalk.blue(displayText)
  const prefix = shownUrlStart ? '\x1b[28m' : ''
  return `${prefix}${OSC8_START}${url}${OSC8_END}${coloredText}${OSC8_START}${OSC8_END}`
}
