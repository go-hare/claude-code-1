/**
 * Terminal dark/light mode detection.
 *
 * Detection is based on the terminal's actual background color (queried via
 * OSC 11) rather than the OS appearance setting.
 *
 * Vendored from src/utils/systemTheme.ts for package independence.
 * COLORFGBG matches gold: bg 0–6 and 8 are dark; 7 and 9–15 are light;
 * unset defaults to dark.
 */

export type SystemTheme = 'dark' | 'light'

let cachedSystemTheme: SystemTheme | undefined
const listeners = new Set<(theme: SystemTheme) => void>()

/**
 * Detect theme from $COLORFGBG environment variable (set by some terminals).
 * rxvt convention: bg 0–6 or 8 are dark; bg 7 and 9–15 are light.
 */
function detectFromColorFgBg(): SystemTheme | undefined {
  const colorFgBg = process.env.COLORFGBG
  if (!colorFgBg) return undefined
  const parts = colorFgBg.split(';')
  const bg = parts[parts.length - 1]
  if (bg === undefined || bg === '') return undefined
  const bgNum = Number(bg)
  if (!Number.isInteger(bgNum) || bgNum < 0 || bgNum > 15) return undefined
  return bgNum <= 6 || bgNum === 8 ? 'dark' : 'light'
}

/**
 * Get the current terminal theme. Cached after first detection.
 */
export function getSystemThemeName(): SystemTheme {
  if (cachedSystemTheme === undefined) {
    cachedSystemTheme = detectFromColorFgBg() ?? 'dark'
  }
  return cachedSystemTheme
}

export function setCachedSystemTheme(theme: SystemTheme): void {
  // densable y0t: if(this.systemTheme===e)return; this.systemTheme=e; emit.
  if (cachedSystemTheme === theme) return
  cachedSystemTheme = theme
  for (const listener of listeners) listener(theme)
}

/** Test-only: drop the COLORFGBG / OSC cache so the next read re-detects. */
export function resetSystemThemeForTests(): void {
  cachedSystemTheme = undefined
}

/** Ink → src cache bridge. `init.ts` registers the src setter. */
export function subscribeSystemTheme(
  listener: (theme: SystemTheme) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Parse an OSC color response data string into a theme.
 * ITU-R BT.709 relative luminance; > 0.5 is light.
 */
export function themeFromOscColor(data: string): SystemTheme | undefined {
  const rgb = parseOscRgb(data)
  if (!rgb) return undefined
  const luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b
  return luminance > 0.5 ? 'light' : 'dark'
}

type Rgb = { r: number; g: number; b: number }

function parseOscRgb(data: string): Rgb | undefined {
  const rgbMatch =
    /^rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(data)
  if (rgbMatch) {
    return {
      r: hexComponent(rgbMatch[1]!),
      g: hexComponent(rgbMatch[2]!),
      b: hexComponent(rgbMatch[3]!),
    }
  }
  const hashMatch = /^#([0-9a-f]+)$/i.exec(data)
  if (hashMatch && hashMatch[1]!.length % 3 === 0) {
    const hex = hashMatch[1]!
    const n = hex.length / 3
    return {
      r: hexComponent(hex.slice(0, n)),
      g: hexComponent(hex.slice(n, 2 * n)),
      b: hexComponent(hex.slice(2 * n)),
    }
  }
  return undefined
}

function hexComponent(hex: string): number {
  const max = 16 ** hex.length - 1
  return parseInt(hex, 16) / max
}
