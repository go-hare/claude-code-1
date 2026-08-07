/**
 * densable 2.1.214 #32 — Pte() = bg && !attacherCaps
 * agent-view attach sets caps → allow MCP/install-github-app;
 * bare no-terminal bg refuses.
 *
 * Note: bun:test leaves feature('BG_SESSIONS') false (compiler intrinsic,
 * not env-driven), so isBgSession() is always false here. Runtime Pte
 * composition is covered as an identity over isBgSession()+caps; full
 * bg=true path is source-contracted against concurrentSessions.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getAttacherCaps, setAttacherCaps } from '../../bootstrap/state.js'
import {
  BG_NO_TERMINAL_INSTALL_GITHUB_APP_MSG,
  BG_NO_TERMINAL_MCP_AUTH_MSG,
  BG_NO_TERMINAL_MCP_SETTINGS_MSG,
  isBgSession,
  isBgSessionWithoutTerminal,
} from '../concurrentSessions.js'

const ROOT = join(import.meta.dir, '../..')

describe('densable Pte source contract #32', () => {
  test('messages match densable literals', () => {
    expect(BG_NO_TERMINAL_MCP_AUTH_MSG).toContain(
      'no terminal is attached to this background session',
    )
    expect(BG_NO_TERMINAL_MCP_SETTINGS_MSG).toContain(
      '`/mcp enable|disable|reconnect <server>`',
    )
    expect(BG_NO_TERMINAL_INSTALL_GITHUB_APP_MSG).toContain(
      '/install-github-app',
    )
  })

  test('Pte body is isBgSession && !getAttacherCaps', () => {
    const src = readFileSync(join(ROOT, 'utils/concurrentSessions.ts'), 'utf8')
    expect(src).toContain('export function isBgSessionWithoutTerminal')
    expect(src).toMatch(
      /isBgSessionWithoutTerminal[\s\S]*?if \(!isBgSession\(\)\) return false[\s\S]*?return !getAttacherCaps\(\)/,
    )
  })

  test('mcp.tsx gates panel but not enable/disable', () => {
    const src = readFileSync(join(ROOT, 'commands/mcp/mcp.tsx'), 'utf8')
    expect(src).toContain('isBgSessionWithoutTerminal')
    // densable 2.1.216 sof/CUt: park via bgCommandNeedsPark (not bare MSG const)
    expect(src).toContain('parkMcpSettingsNeedsInput')
    expect(src).toContain('bgCommandNeedsPark')
    // enable/disable path before the gate
    const enableIdx = src.indexOf("parts[0] === 'enable'")
    const gateIdx = src.indexOf('isBgSessionWithoutTerminal()')
    expect(enableIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(enableIdx)
  })

  test('install-github-app call gates with Pte', () => {
    const src = readFileSync(
      join(ROOT, 'commands/install-github-app/install-github-app.tsx'),
      'utf8',
    )
    expect(src).toContain('isBgSessionWithoutTerminal')
    // densable 2.1.216 CRb/CUt
    expect(src).toContain('parkInstallGithubAppNeedsInput')
    expect(src).toContain('bgCommandNeedsPark')
  })

  test('rendezvous sets attacherCaps from attacher-caps', () => {
    const src = readFileSync(join(ROOT, 'daemon/rendezvousServer.ts'), 'utf8')
    expect(src).toContain("case 'attacher-caps'")
    expect(src).toContain('setAttacherCaps')
  })

  test('MCPRemoteServerMenu auth path checks Pte', () => {
    const src = readFileSync(
      join(ROOT, 'components/mcp/MCPRemoteServerMenu.tsx'),
      'utf8',
    )
    expect(src).toContain('isBgSessionWithoutTerminal')
    expect(src).toContain('BG_NO_TERMINAL_MCP_AUTH_MSG')
  })
})

describe('isBgSessionWithoutTerminal pure', () => {
  const prevKind = process.env.CLAUDE_CODE_SESSION_KIND
  const prevCaps = getAttacherCaps()

  afterEach(() => {
    if (prevKind === undefined) delete process.env.CLAUDE_CODE_SESSION_KIND
    else process.env.CLAUDE_CODE_SESSION_KIND = prevKind
    setAttacherCaps(prevCaps)
  })

  test('non-bg never blocked', () => {
    delete process.env.CLAUDE_CODE_SESSION_KIND
    setAttacherCaps(null)
    expect(isBgSession()).toBe(false)
    expect(isBgSessionWithoutTerminal()).toBe(false)
  })

  test('Pte ≡ isBgSession() && !getAttacherCaps() under any env/caps', () => {
    // bun:test: feature('BG_SESSIONS') is always false → isBgSession() false.
    // Still assert the composition identity holds for caps toggles.
    for (const kind of [undefined, 'bg', 'daemon'] as const) {
      if (kind === undefined) delete process.env.CLAUDE_CODE_SESSION_KIND
      else process.env.CLAUDE_CODE_SESSION_KIND = kind
      for (const caps of [null, { colorLevel: 2 as const }] as const) {
        setAttacherCaps(caps)
        expect(isBgSessionWithoutTerminal()).toBe(
          isBgSession() && !getAttacherCaps(),
        )
      }
    }
  })

  test('attacher caps set/clear round-trip', () => {
    setAttacherCaps(null)
    expect(getAttacherCaps()).toBeNull()
    setAttacherCaps({ colorLevel: 2 })
    expect(getAttacherCaps()).toEqual({ colorLevel: 2 })
    setAttacherCaps(null)
    expect(getAttacherCaps()).toBeNull()
  })
})
