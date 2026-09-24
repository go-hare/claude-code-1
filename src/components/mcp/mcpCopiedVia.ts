/**
 * densable `cL` / `uL` / `ZW`. MCP menu copy status branches on copiedVia.
 * "sign-in URL" is older changelog text and is not in these functions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getClipboardPath,
  probeLinuxClipboardTool,
  setClipboard,
} from '@anthropic/ink'
import type { ClipboardPath } from '@anthropic/ink'

export type McpCopiedVia = 'native' | 'tmux-buffer' | 'osc52' | null

const MCP_COPY_DEBOUNCE_MS = 2000
const MCP_COPY_NATIVE_CLEAR_MS = 2000

/**
 * densable `xt` — `{setTimeout}` returns a cancel fn, not a timer id.
 * ZW stores `o.current?.()` / `n.current?.()`.
 */
const mcpCopyClock = {
  setTimeout(onFire: () => void, ms: number): () => void {
    const timer = setTimeout(onFire, ms)
    return () => clearTimeout(timer)
  },
}

/**
 * densable ZW(r) — `{copiedVia, copy, reset}`.
 * URL change: reset, then Xht (`probeLinuxClipboardTool`) when r !== null.
 */
export function useMcpCopiedVia(url: string | null): {
  copiedVia: ClipboardPath | null
  copy: (text: string) => void
  reset: () => void
} {
  const s = mcpCopyClock
  const [copiedVia, setCopiedVia] = useState<ClipboardPath | null>(null)
  const nativeClearRef = useRef<(() => void) | null>(null)
  const lastTextRef = useRef<string | null>(null)
  const debounceRef = useRef<(() => void) | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)

  const reset = useCallback(() => {
    generationRef.current += 1
    debounceRef.current?.()
    debounceRef.current = null
    lastTextRef.current = null
    nativeClearRef.current?.()
    nativeClearRef.current = null
    setCopiedVia(null)
  }, [])

  useEffect(() => {
    reset()
    if (url !== null) void probeLinuxClipboardTool()
  }, [url, reset])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      debounceRef.current?.()
      debounceRef.current = null
      lastTextRef.current = null
      nativeClearRef.current?.()
      nativeClearRef.current = null
    }
  }, [])

  const copy = useCallback(
    (text: string) => {
      if (lastTextRef.current === text) return
      lastTextRef.current = text
      debounceRef.current?.()
      debounceRef.current = s.setTimeout(() => {
        debounceRef.current = null
        lastTextRef.current = null
      }, MCP_COPY_DEBOUNCE_MS)
      const via = getClipboardPath()
      const generation = generationRef.current
      void setClipboard(text).then(raw => {
        if (!mountedRef.current || generation !== generationRef.current) {
          return
        }
        if (raw) process.stdout.write(raw)
        nativeClearRef.current?.()
        nativeClearRef.current = null
        setCopiedVia(via)
        if (via === 'native') {
          nativeClearRef.current = s.setTimeout(() => {
            nativeClearRef.current = null
            setCopiedVia(null)
          }, MCP_COPY_NATIVE_CLEAR_MS)
        }
      })
    },
    [s],
  )

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
