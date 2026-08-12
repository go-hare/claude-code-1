/**
 * densable session text helpers (TE / shared truncate).
 * Extracted from sessionHandler to avoid import cycles with sessionFailure / scmConnector.
 */

/** densable `TE` — cap error text for logs / failure report */
export function truncateSessionErrorText(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
