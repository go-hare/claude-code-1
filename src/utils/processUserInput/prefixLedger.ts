/**
 * densable 2.1.289 prefix-ledger. Gold `gZn(){return"off"}`, `Uwt` empty,
 * `Bwt` early-returns on off / retryCause. Call sites are no-ops.
 * Never export densable ids. Do not invent a live ledger.
 */

export type PrefixLedgerMode = 'off' | 'tell' | 'shadow'

/** densable `gZn`. */
export function getPrefixLedgerMode(): PrefixLedgerMode {
  return 'off'
}

/** densable `Uwt` — empty body. */
export function announcePrefixLedger(
  _messages?: unknown,
  _meta?: unknown,
  _opts?: unknown,
): { tools?: unknown; system?: unknown; messages?: unknown } | undefined {
  return undefined
}

/** densable `Bwt` — gated off. */
export function prefixLedgerNotice(
  _messages?: unknown,
  _meta?: unknown,
  opts?: { retryCause?: unknown; querySource?: string; promptEpoch?: number },
): string | undefined {
  const mode = getPrefixLedgerMode()
  if (mode === 'off' || opts?.retryCause !== undefined) return undefined
  return undefined
}
