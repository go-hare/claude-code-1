import { useState, useCallback } from 'react'
import { getUuid, isCorruptedUuid, setActiveApiToken } from '../api/client'

export interface TokenEntry {
  id: string
  token: string
  label: string
}

export const TOKENS_KEY = 'rcs_tokens'
export const ACTIVE_TOKEN_KEY = 'rcs_active_token_id'
export const DEFAULT_TOKEN_ID = '__default__'

function generateId(): string {
  return `tk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Ensure the browser's valid rcs_uuid is present and synced as the default token entry */
export function ensureDefault(tokens: TokenEntry[]): TokenEntry[] {
  let uuid: string | null = null
  try {
    uuid = getUuid()
  } catch {
    return tokens
  }
  if (!uuid || isCorruptedUuid(uuid)) return tokens

  const existingDefault = tokens.find(t => t.id === DEFAULT_TOKEN_ID)
  if (existingDefault) {
    if (existingDefault.token === uuid) return tokens
    return tokens.map(t =>
      t.id === DEFAULT_TOKEN_ID ? { ...t, token: uuid! } : t,
    )
  }
  return [{ id: DEFAULT_TOKEN_ID, token: uuid, label: 'Default' }, ...tokens]
}

export function loadTokens(): TokenEntry[] {
  let tokens: TokenEntry[] = []
  try {
    const raw = localStorage.getItem(TOKENS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) tokens = parsed
    }
  } catch {
    // ignore
  }
  return ensureDefault(tokens)
}

export function loadActiveTokenId(tokens: TokenEntry[]): string {
  // Try saved active token ID (stored separately from rcs_uuid)
  try {
    const saved = localStorage.getItem(ACTIVE_TOKEN_KEY)
    if (saved && tokens.some(t => t.id === saved)) return saved
  } catch {
    // ignore
  }
  // Fall back to default (rcs_uuid) entry
  const defaultEntry = tokens.find(t => t.id === DEFAULT_TOKEN_ID)
  if (defaultEntry) return defaultEntry.id
  // Fall back to first entry
  return tokens[0]?.id ?? DEFAULT_TOKEN_ID
}

/**
 * Resolve the Bearer Authorization token for API/WS calls.
 * In default (browser UUID) mode, return null so requests authenticate via
 * X-UUID only instead of sending a bogus `Authorization: Bearer <browser-uuid>`.
 */
export function resolveActiveApiToken(
  tokens: TokenEntry[],
  activeTokenId: string,
): string | null {
  const activeToken =
    tokens.find(t => t.id === activeTokenId) ?? tokens[0] ?? null
  if (!activeToken || activeToken.id === DEFAULT_TOKEN_ID) {
    return null
  }
  return activeToken.token || null
}

export function useTokens() {
  const [tokens, setTokens] = useState<TokenEntry[]>(loadTokens)
  const [activeTokenId, setActiveTokenIdState] = useState<string>(() => {
    const id = loadActiveTokenId(tokens)
    setActiveApiToken(resolveActiveApiToken(tokens, id))
    return id
  })

  const persistTokens = useCallback((next: TokenEntry[]) => {
    setTokens(next)
    try {
      localStorage.setItem(TOKENS_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }, [])

  const syncDefaultUuid = useCallback(() => {
    setTokens(prev => {
      const next = ensureDefault(prev)
      try {
        localStorage.setItem(TOKENS_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const setActiveTokenId = useCallback(
    (id: string) => {
      setActiveTokenIdState(id)
      setActiveApiToken(resolveActiveApiToken(tokens, id))
      try {
        localStorage.setItem(ACTIVE_TOKEN_KEY, id)
        location.reload() // Reload to ensure api client picks up new token from localStorage
      } catch {
        // ignore
      }
    },
    [tokens],
  )

  const addToken = useCallback(
    (token: string, label: string): string | null => {
      const trimmed = token.trim()
      if (!trimmed) return 'Token is required'
      const entry: TokenEntry = {
        id: generateId(),
        token: trimmed,
        label: label.trim() || trimmed.slice(0, 8),
      }
      const next = [...tokens, entry]
      persistTokens(next)
      return null
    },
    [tokens, persistTokens],
  )

  const removeToken = useCallback(
    (id: string) => {
      if (id === DEFAULT_TOKEN_ID) return // Cannot remove default
      const next = tokens.filter(t => t.id !== id)
      persistTokens(next)
      if (activeTokenId === id) {
        setActiveTokenId(DEFAULT_TOKEN_ID)
      }
    },
    [tokens, persistTokens, activeTokenId, setActiveTokenId],
  )

  const updateToken = useCallback(
    (id: string, label: string) => {
      const next = tokens.map(t => (t.id === id ? { ...t, label } : t))
      persistTokens(next)
    },
    [tokens, persistTokens],
  )

  const activeToken =
    tokens.find(t => t.id === activeTokenId) ?? tokens[0] ?? null
  const activeLabel = activeToken?.label ?? 'Default'
  const activeTokenValue = resolveActiveApiToken(tokens, activeTokenId)

  return {
    tokens,
    activeTokenId,
    activeToken,
    activeLabel,
    activeTokenValue,
    setActiveTokenId,
    addToken,
    removeToken,
    updateToken,
    syncDefaultUuid,
  }
}
