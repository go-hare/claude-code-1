/**
 * densable 2.1.289 `xY` @180270597 is raw SGR 7.
 * DualInk leftover DualInkGs: DualInk intern of SGR 7 on light/custom
 * theme `text` is a solid black block. Official DualInk caret is gray.
 * Analog extra is explicit gray bg + black fg, not chalk (level 0 strips it).
 * `Xt`/`Yt` stay identity. Do not export minify `xY`.
 */
import chalk from 'chalk'

/**
 * Cursor cell. DualInk analog extra: gray bg, black fg. Below truecolor
 * (tmux clamps to 256, NO_COLOR / FORCE_COLOR=0) the 24-bit bg would be
 * dropped or mis-mapped, so fall back to the official raw SGR 7.
 */
export function leftoverXy(text: string): string {
  if (chalk.level < 3) return `\x1b[7m${text}\x1b[27m`
  return `\x1b[48;2;160;160;160m\x1b[30m${text}\x1b[39m\x1b[49m`
}

/** densable `Xt` / `Yt`. */
export function leftoverXt(text: string): string {
  return text
}
