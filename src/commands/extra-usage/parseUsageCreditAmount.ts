/**
 * Official 2.1.207: `/usage-credits` custom amount parser.
 * Rejects malformed amounts instead of silently stripping non-digits
 * (e.g. "20abc" / "$20" / "20.999" must fail, not become 20).
 */

export type ParseUsageCreditAmountResult =
  | { ok: true; cents: number }
  | { ok: false; error: string }

/**
 * Parse a user-entered currency amount into integer cents.
 * Accepts only optional whole dollars + up to two fractional digits:
 * `20`, `20.5`, `20.50`. No currency symbols, commas, or extra text.
 */
export function parseUsageCreditAmount(
  input: string,
): ParseUsageCreditAmountResult {
  const trimmed = input.trim()
  if (trimmed === '') {
    return { ok: false, error: 'Enter an amount' }
  }
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(trimmed)
  if (!match) {
    return { ok: false, error: 'Enter an amount like 20 or 20.50' }
  }
  const whole = Number(match[1])
  const frac = Number((match[2] ?? '').padEnd(2, '0'))
  const cents = whole * 100 + frac
  if (cents <= 0) {
    return { ok: false, error: 'Enter an amount' }
  }
  return { ok: true, cents }
}

/** Format cents for the custom-amount input field (mirror of official ynr). */
export function formatUsageCreditAmountInput(cents: number): string {
  if (cents % 100 === 0) return String(cents / 100)
  return (cents / 100).toFixed(2)
}
