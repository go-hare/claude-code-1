import {
  storeCreateToken,
  storeDeleteToken,
  storeGetUserByToken,
} from '../store'

export const TOKEN_TTL_SECONDS = 86400
export const TOKEN_TTL_MS = TOKEN_TTL_SECONDS * 1000

let tokenCounter = 0

/** Generate a random session token and associate it with a user */
export function issueToken(username: string): {
  token: string
  expires_in: number
} {
  // Use crypto.getRandomValues for uniqueness
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  const token = `rct_${tokenCounter++}_${hex}`
  storeCreateToken(username, token)
  return { token, expires_in: TOKEN_TTL_SECONDS }
}

/**
 * Resolve a token to a username. Returns null if invalid or expired beyond
 * `TOKEN_TTL_MS` (86400s), pruning expired tokens from the store (`P1-E5`).
 */
export function resolveToken(
  token: string | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!token) return null
  const entry = storeGetUserByToken(token)
  if (!entry) return null
  if (nowMs - entry.createdAt.getTime() >= TOKEN_TTL_MS) {
    storeDeleteToken(token)
    return null
  }
  return entry.username
}
