/**
 * densable `cL` / `uL` / `ZW`. MCP menu copy status branches on copiedVia.
 * "sign-in URL" is older changelog text and is not in these functions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getClipboardPath, setClipboard } from '@anthropic/ink'
import type { ClipboardPath } from '@anthropic/ink'

export type McpCopiedVia = 'native' | 'tmux-buffer' | 'osc52' | null

const MCP_COPY_DEBOUNCE_MS = 2000
const MCP_COPY_NATIVE_CLEAR_MS = 2000

/**
 * densable ZW — `{copiedVia, copy, reset}` using the existing clipboard
 * path helper (zue / getClipboardPath) and setClipboard (yy).
 */
export function useMcpCopiedVia(): {
  copiedVia: ClipboardPath | null
  copy: (text: string) => void
  reset: () => void
} {
  const [copiedVia, setCopiedVia] = useState<ClipboardPath | null>(null)
  const mountedRef = useRef(true)
  const lastTextRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nativeClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)

  const reset = useCallback(() => {
    generationRef.current += 1
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (nativeClearRef.current !== null) {
      clearTimeout(nativeClearRef.current)
      nativeClearRef.current = null
    }
    lastTextRef.current = null
    setCopiedVia(null)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      reset()
    }
  }, [reset])

  const copy = useCallback((text: string) => {
    if (lastTextRef.current === text) return
    lastTextRef.current = text
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      lastTextRef.current = null
    }, MCP_COPY_DEBOUNCE_MS)
    const via = getClipboardPath()
    const generation = generationRef.current
    void setClipboard(text).then(raw => {
      if (!mountedRef.current || generation !== generationRef.current) return
      if (raw) process.stdout.write(raw)
      if (nativeClearRef.current !== null) {
        clearTimeout(nativeClearRef.current)
        nativeClearRef.current = null
      }
      setCopiedVia(via)
      if (via === 'native') {
        nativeClearRef.current = setTimeout(() => {
          nativeClearRef.current = null
          setCopiedVia(null)
        }, MCP_COPY_NATIVE_CLEAR_MS)
      }
    })
  }, [])

  return { copiedVia, copy, reset }
}

export const MCP_COPIED_NATIVE = '(Copied!)'
export const MCP_COPIED_TMUX =
  '(Copied to tmux buffer · select the URL manually if paste fails)'
export const MCP_COPIED_OSC52 =
  '(Sent via OSC 52 · select the URL manually if paste fails)'

/** densable `cL`: native shows (Copied!); null shows the copy chord. */
export function mcpCopyShortcutKind(
  via: McpCopiedVia,
): 'native' | 'hint' | null {
  if (via === 'native') return 'native'
  if (via === null) return 'hint'
  return null
}

/** densable `uL`: how the URL was copied, when it was not the native clipboard. */
export function mcpCopiedViaDetail(via: McpCopiedVia): string | null {
  if (via === 'tmux-buffer') return MCP_COPIED_TMUX
  if (via === 'osc52') return MCP_COPIED_OSC52
  return null
}
