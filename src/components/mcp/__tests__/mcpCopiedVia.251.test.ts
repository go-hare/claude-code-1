/**
 * densable 2.1.251 #35 — cL/uL/ZW. copiedVia says how the URL was copied.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MCP_COPIED_NATIVE,
  MCP_COPIED_OSC52,
  MCP_COPIED_TMUX,
  mcpCopiedViaDetail,
  mcpCopyShortcutKind,
} from '../mcpCopiedVia.js'

describe('densable 2.1.251 #35 MCP copiedVia', () => {
  test('native is (Copied!), null is the shortcut, others are neither', () => {
    expect(mcpCopyShortcutKind('native')).toBe('native')
    expect(mcpCopyShortcutKind(null)).toBe('hint')
    expect(mcpCopyShortcutKind('tmux-buffer')).toBeNull()
    expect(mcpCopyShortcutKind('osc52')).toBeNull()
    expect(MCP_COPIED_NATIVE).toBe('(Copied!)')
  })

  test('tmux and osc52 name the copy path', () => {
    expect(mcpCopiedViaDetail('tmux-buffer')).toBe(MCP_COPIED_TMUX)
    expect(mcpCopiedViaDetail('osc52')).toBe(MCP_COPIED_OSC52)
    expect(MCP_COPIED_TMUX).toBe(
      '(Copied to tmux buffer · select the URL manually if paste fails)',
    )
    expect(MCP_COPIED_OSC52).toBe(
      '(Sent via OSC 52 · select the URL manually if paste fails)',
    )
    expect(mcpCopiedViaDetail('native')).toBeNull()
    expect(mcpCopiedViaDetail(null)).toBeNull()
  })

  test('the MCP menu renders copiedVia instead of a boolean (Copied!)', () => {
    const menu = readFileSync(
      join(import.meta.dir, '../MCPRemoteServerMenu.tsx'),
      'utf8',
    )
    expect(menu).toContain('copiedVia')
    expect(menu).toContain('useMcpCopiedVia(copyUrl)')
    expect(menu).toContain('McpUrlCopyDetail')
    expect(menu).not.toContain('urlCopied')
    expect(menu).not.toContain('(Copied!)')
  })

  test('ZW hook uses the existing clipboard path helper', () => {
    const hook = readFileSync(
      join(import.meta.dir, '../mcpCopiedVia.ts'),
      'utf8',
    )
    expect(hook).toContain('export function useMcpCopiedVia')
    expect(hook).toContain('useMcpCopiedVia(url: string | null)')
    expect(hook).toContain('getClipboardPath()')
    expect(hook).toContain('setClipboard(text)')
    expect(hook).toContain('probeLinuxClipboardTool()')
    expect(hook).toContain('if (url !== null)')
    expect(hook).toContain('return { copiedVia, copy, reset }')
  })
})
