/**
 * Official 2.1.326 #274 (`$R`, `Xl`, `Pg`, `xjn`, `RD`, `kj`) —
 * Unified CLI status markers on interactive terminals (stdout & stderr both TTY)
 * while keeping legacy plain/prefixed text when output is piped.
 */
import figures from 'figures'

export function isCliInteractiveTty(
  stdoutIsTTY: boolean = process.stdout.isTTY === true,
  stderrIsTTY: boolean = process.stderr.isTTY === true,
): boolean {
  return stdoutIsTTY && stderrIsTTY
}

function isScreenReaderEnabled(): boolean {
  return process.env.CLAUDE_CODE_ACCESSIBILITY === '1'
}

function formatWithMarker(
  marker: string,
  text: string,
  pipedPrefix?: string,
  interactive: boolean = isCliInteractiveTty(),
): string {
  if (
    pipedPrefix === undefined ||
    (interactive && (pipedPrefix === '' || !isScreenReaderEnabled()))
  ) {
    return `${marker} ${text}`
  }
  return pipedPrefix + text
}

/** Official `$R(text, pipedPrefix)` — success marker (`✔`). */
export function formatCliSuccess(
  text: string,
  pipedPrefix?: string,
  interactive?: boolean,
): string {
  return formatWithMarker(figures.tick, text, pipedPrefix, interactive)
}

/** Official `Xl(text, pipedPrefix)` — failure marker (`✗`). */
export function formatCliError(
  text: string,
  pipedPrefix?: string,
  interactive?: boolean,
): string {
  return formatWithMarker(figures.cross, text, pipedPrefix, interactive)
}

/** Official `Pg(text, pipedPrefix)` — warning marker (`⚠`). */
export function formatCliWarning(
  text: string,
  pipedPrefix?: string,
  interactive?: boolean,
): string {
  return formatWithMarker(figures.warning, text, pipedPrefix, interactive)
}

/** Official `xjn(text)` — circle on TTY, cross when piped. */
export function formatCliInactive(
  text: string,
  interactive: boolean = isCliInteractiveTty(),
): string {
  return `${interactive ? figures.circle : figures.cross} ${text}`
}

/** Official `RD(text)` — indented sub-item pointer. */
export function formatCliDetail(
  text: string,
  interactive: boolean = isCliInteractiveTty(),
): string {
  return `  ${interactive ? '\u21b3' : figures.pointer} ${text}`
}

/**
 * Official `kj(text, pipedPrefix)` — trims redundant leading `Successfully `
 * on interactive terminals (`✔ Logged out...`), preserving the original prose
 * when piped (`Successfully logged out...`).
 */
export function formatCliActionSuccess(
  text: string,
  pipedPrefix?: string,
  interactive: boolean = isCliInteractiveTty(),
): string {
  const display = interactive
    ? text.replace(/^Successfully (\p{Ll})/u, (_, ch: string) =>
        ch.toUpperCase(),
      )
    : text
  return formatCliSuccess(display, pipedPrefix, interactive)
}
