import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { getTerminalCaps, isGhosttyXtvTerminal } from '../clientAttach.js'
import {
  isBgGatewayMarkEnabled,
  isShellExportedGatewayEnv,
} from '../bgHostManagedEnv.js'
import {
  BgWorker,
  clearExitFiles,
  type DispatchRequest,
  formatExitDetail,
  readExitCause,
  readExitDetail,
  shouldMarkGatewayRouted,
  writeExitCause,
  writeExitDetail,
} from '../bgWorker.js'

describe('Wave 319-321 daemon alignments (#1750, #1782, #1927)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'daemon-319-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('#1750: attacherCaps passes isGhosttyXtv', () => {
    test('detects Ghostty from XTVERSION, TERM_PROGRAM, or xterm-ghostty', () => {
      expect(isGhosttyXtvTerminal({}, 'ghostty 1.1.0')).toBe(true)
      expect(isGhosttyXtvTerminal({ TERM_PROGRAM: 'ghostty' })).toBe(true)
      expect(isGhosttyXtvTerminal({ TERM: 'xterm-ghostty' })).toBe(true)
      expect(
        isGhosttyXtvTerminal({ TERM: 'tmux-256color', TERM_PROGRAM: 'tmux' }),
      ).toBe(false)
    })

    test('getTerminalCaps includes isGhosttyXtv alongside tmux metadata', () => {
      const caps = getTerminalCaps(
        {
          TERM: 'tmux-256color',
          TMUX: '/tmp/tmux-501/default,123,0',
          TERM_PROGRAM: 'tmux',
        },
        'ghostty 1.1.2',
      )
      expect(caps.mux).toBe('tmux')
      expect(caps.isGhosttyXtv).toBe(true)
    })
  })

  describe('#1782: noteHeldOnGateway holds idle gateway-routed sessions during update', () => {
    test('isShellExportedGatewayEnv detects non-first-party gateway and ignores api.anthropic.com', () => {
      expect(
        isShellExportedGatewayEnv({
          ANTHROPIC_BASE_URL: 'https://llm-gateway.internal.example/v1',
        }),
      ).toBe(true)
      expect(
        isShellExportedGatewayEnv({
          ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        }),
      ).toBe(false)
      expect(
        isShellExportedGatewayEnv({
          CLAUDE_CODE_USE_BEDROCK: '1',
          ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock-gw.internal',
        }),
      ).toBe(true)
      expect(isShellExportedGatewayEnv({})).toBe(false)
    })

    test('shouldMarkGatewayRouted marks non-exec gateway dispatches and skips exec/host-managed', () => {
      const baseDispatch: DispatchRequest = {
        short: 'gw123456',
        sessionId: '00000000-0000-4000-8000-000000000001',
        intent: 'test',
        cwd: tempDir,
        respawnFlags: [],
        source: 'cli',
        createdAt: Date.now(),
        env: { ANTHROPIC_BASE_URL: 'https://gw.corp.example' },
        launch: { mode: 'prompt' },
      }
      expect(isBgGatewayMarkEnabled()).toBe(true)
      expect(shouldMarkGatewayRouted(baseDispatch)).toBe(true)
      expect(
        shouldMarkGatewayRouted({
          ...baseDispatch,
          launch: { mode: 'exec', cmd: 'echo' },
        }),
      ).toBe(false)
      expect(
        shouldMarkGatewayRouted({
          ...baseDispatch,
          env: {
            ...baseDispatch.env,
            CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
          },
        }),
      ).toBe(false)
    })

    test('BgWorker.respawnIfIdleStale defers respawn when heldOnGateway is true and strips gatewayRouted in cappedDispatch', async () => {
      const g = globalThis as Record<string, unknown>
      const prevMacro = g.MACRO
      const envKeys = [
        'CLAUDE_CONFIG_DIR',
        'ANTHROPIC_BASE_URL',
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_USE_VERTEX',
        'CLAUDE_CODE_USE_FOUNDRY',
        'ANTHROPIC_FOUNDRY_BASE_URL',
        'ANTHROPIC_BEDROCK_BASE_URL',
        'ANTHROPIC_VERTEX_BASE_URL',
      ] as const
      const prevEnv = new Map<string, string | undefined>()
      for (const k of envKeys) {
        prevEnv.set(k, process.env[k])
        delete process.env[k]
      }
      process.env.CLAUDE_CONFIG_DIR = tempDir
      resetSettingsCache()
      g.MACRO ??= { VERSION: '2.1.325' }
      try {
        const dispatch: DispatchRequest = {
          short: 'gw999999',
          sessionId: '00000000-0000-4000-8000-000000000002',
          intent: 'test',
          cwd: tempDir,
          respawnFlags: [],
          source: 'cli',
          createdAt: Date.now(),
          env: {},
          gatewayRouted: true,
          launch: { mode: 'prompt' },
        }
        const worker = new BgWorker(dispatch, undefined, undefined, 'cli', {
          pid: 4242,
          cliVersion: '0.0.1-old',
        })
        // Simulate running phase with live pty so isTransitioning is false
        worker.transitionTo({ kind: 'running' })
        ;(worker as unknown as { pty: object }).pty = {}
        expect(worker.heldOnGateway).toBe(true)
        const res = await worker.respawnIfIdleStale(undefined, 'sweep')
        expect(res).toEqual({ respawned: false, reason: 'not-stale' })

        const capped = worker.cappedDispatch()
        expect(capped.gatewayRouted).toBeUndefined()
        expect(capped.gatewayMarkUnreadable).toBeUndefined()
      } finally {
        for (const [k, v] of prevEnv) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
        resetSettingsCache()
        if (prevMacro === undefined) {
          delete g.MACRO
        } else {
          g.MACRO = prevMacro
        }
      }
    })
  })

  describe('#1927: CLAUDE_JOB_DIR/exit-detail persistence and beginning-first truncation', () => {
    test('writeExitCause + writeExitDetail round-trip only when cause matches', () => {
      writeExitCause('worktree_chdir:EACCES', tempDir)
      writeExitDetail(
        'worktree_chdir:EACCES',
        'Error: worktree directory /tmp/wt is not accessible (EACCES). Check permissions.',
        tempDir,
      )
      const cause = readExitCause(tempDir)
      expect(cause).toBe('worktree_chdir:EACCES')
      const detail = readExitDetail(tempDir, cause!)
      expect(detail).toContain('Error: worktree directory /tmp/wt')
      // One-shot consume: second read returns undefined
      expect(readExitDetail(tempDir, cause!)).toBeUndefined()
    })

    test('readExitDetail ignores stale detail whose cause line differs', () => {
      writeExitDetail('other_cause', 'stale detail text', tempDir)
      expect(readExitDetail(tempDir, 'worktree_chdir:ENOENT')).toBeUndefined()
    })

    test('clearExitFiles removes stale exit-cause and exit-detail files', () => {
      writeFileSync(join(tempDir, 'exit-cause'), 'stale')
      writeFileSync(join(tempDir, 'exit-detail'), 'stale\ndetail')
      clearExitFiles(tempDir)
      expect(readExitCause(tempDir)).toBeUndefined()
      expect(readExitDetail(tempDir, 'stale')).toBeUndefined()
    })

    test('formatExitDetail preserves the error beginning and middle-truncates long messages', () => {
      const prefix =
        'Error: git worktree add failed: branch already checked out'
      const body = 'x'.repeat(800)
      const suffix = 'fatal: could not create worktree'
      const formatted = formatExitDetail(`${prefix} ${body} ${suffix}`)!
      expect(formatted.startsWith(prefix)).toBe(true)
      expect(formatted).toContain(' … ')
      expect(formatted.endsWith(suffix)).toBe(true)
    })
  })
})
