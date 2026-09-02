/**
 * densable 2.1.239 Ink winsize guards.
 * Gold: `dCi` / `pCi` @308641488; `cCi=8192` / `_Sf=2048`; `ySf=cCi`.
 */

export const MAX_TERMINAL_COLUMNS = 8192
export const MAX_TERMINAL_ROWS = 2048

export type WinsizeAbsurdMode = 'clamp' | 'fallback'

/**
 * densable `dCi(raw, fallback, max, mode, onWarn)`.
 * `undefined` / `0` → fallback, no warn. Other non-finite / <1 → warn +
 * fallback. Above max → clamp or fallback per `mode`.
 */
export function sanitizeTerminalDimension(
  raw: unknown,
  fallback: number,
  max: number,
  mode: WinsizeAbsurdMode,
  onWarn?: (message: string) => void,
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
    if (raw !== undefined && raw !== 0) {
      onWarn?.(
        `terminal winsize read returned a garbage dimension: ${String(raw)} — falling back to ${fallback}`,
      )
    }
    return fallback
  }
  const floored = Math.floor(raw)
  if (floored > max) {
    onWarn?.(
      `terminal winsize read returned an absurd dimension: ${String(raw)} — ${
        mode === 'clamp' ? `clamping to ${max}` : `falling back to ${fallback}`
      }`,
    )
    return mode === 'clamp' ? max : fallback
  }
  return floored
}

/** densable `pCi(stdout, onWarn)` — constructor / viewport probe (clamp). */
export function readStdoutSize(
  stdout: { columns?: number; rows?: number },
  onWarn?: (message: string) => void,
): { cols: number; rows: number } {
  return {
    cols: sanitizeTerminalDimension(
      stdout.columns,
      80,
      MAX_TERMINAL_COLUMNS,
      'clamp',
      onWarn,
    ),
    rows: sanitizeTerminalDimension(
      stdout.rows,
      24,
      MAX_TERMINAL_ROWS,
      'clamp',
      onWarn,
    ),
  }
}
