import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Socket } from 'net'
import {
  _resetKeepAliveForTesting,
  destroyFreeSocketsForUrl,
  enableClosesAfterServerError,
  isServerErrorClosingStatus,
  KeepAliveErrorClosingAgent,
  shouldCloseAfterServerError,
} from '../../utils/proxy.js'
import { sanitizeSpawnReason } from '../orchestrator.js'
import { parseRootArgs } from '../rootRunner.js'
import {
  createActivityPipeState,
  handleActivityLine,
} from '../sessionActivity.js'
import { buildSessionChildEnv } from '../sessionChild.js'
import { seedPersistedWorkspaceTrust } from '../sessionSeed.js'

describe('Wave 318 Self-Hosted Runner & Proxy Alignment', () => {
  afterEach(() => {
    _resetKeepAliveForTesting()
  })

  test('#1504 & #1561: sessionActivity handles pre-init parked prompt and post-restart idle', () => {
    const events: string[] = []
    const state = createActivityPipeState()
    // Pre-init waiting_on_user=true sets sawPreInitParked and emits awaiting-action
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'session_state_changed',
        waiting_on_user: true,
      }),
      state,
      { onSessionActivity: k => events.push(k) },
    )
    expect(state.sawPreInitParked).toBe(true)
    expect(events).toEqual(['awaiting-action'])

    // Idle before result emits turn-end
    handleActivityLine(
      JSON.stringify({
        type: 'system',
        subtype: 'session_state_changed',
        state: 'idle',
      }),
      state,
      { onSessionActivity: k => events.push(k) },
    )
    expect(events).toEqual(['awaiting-action', 'turn-end'])
  })

  test('#1505: seedPersistedWorkspaceTrust syncs disabledMcpServers and enabledMcpServers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-seed-'))
    try {
      await seedPersistedWorkspaceTrust({
        configDir: dir,
        trustPaths: [dir],
        disabledMcpServers: ['srv-off'],
        enabledMcpServers: ['srv-on'],
        configSuffix: '',
        onDebug: () => {},
      })
      const written = JSON.parse(
        readFileSync(join(dir, '.claude.json'), 'utf8'),
      ) as {
        projects: Record<
          string,
          {
            hasTrustDialogAccepted: boolean
            disabledMcpServers?: string[]
            enabledMcpServers?: string[]
          }
        >
      }
      const entry = Object.values(written.projects)[0]
      expect(entry?.hasTrustDialogAccepted).toBe(true)
      expect(entry?.disabledMcpServers).toEqual(['srv-off'])
      expect(entry?.enabledMcpServers).toEqual(['srv-on'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1600 wiring: seedPersistedWorkspaceTrust merges and sanitizes restoredInternalMetadata.disabled_mcp_servers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-seed-1600-'))
    try {
      await seedPersistedWorkspaceTrust({
        configDir: dir,
        trustPaths: [dir],
        disabledMcpServers: ['host-off', ''],
        restoredInternalMetadata: {
          disabled_mcp_servers: [
            'claude-in-chrome',
            'worker-off',
            'host-off',
            123,
          ],
        },
        configSuffix: '',
        onDebug: () => {},
      })
      const written = JSON.parse(
        readFileSync(join(dir, '.claude.json'), 'utf8'),
      ) as {
        projects: Record<string, { disabledMcpServers?: string[] }>
      }
      const entry = Object.values(written.projects)[0]
      expect(entry?.disabledMcpServers).toEqual(['worker-off', 'host-off'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1588/#1589/#1590: KeepAliveErrorClosingAgent destroys freeSockets on 5xx != 501/529', () => {
    expect(isServerErrorClosingStatus(500)).toBe(true)
    expect(isServerErrorClosingStatus(502)).toBe(true)
    expect(isServerErrorClosingStatus(501)).toBe(false)
    expect(isServerErrorClosingStatus(529)).toBe(false)
    expect(isServerErrorClosingStatus(429)).toBe(false)

    enableClosesAfterServerError()
    expect(shouldCloseAfterServerError()).toBe(true)

    const agent = new KeepAliveErrorClosingAgent({ keepAlive: true })
    let destroyed = false
    const idleSock = {
      destroy: () => {
        destroyed = true
      },
    } as unknown as Socket
    ;(agent.freeSockets as Record<string, Socket[]>)['api.anthropic.com:443:'] =
      [idleSock]

    const activeSock = {
      remotePort: 443,
      _httpMessage: { host: 'api.anthropic.com', res: { statusCode: 503 } },
    } as unknown as Socket
    expect(agent.keepSocketAlive(activeSock)).toBe(false)
    expect(destroyed).toBe(true)

    let destroyedUrl = false
    ;(agent.freeSockets as Record<string, Socket[]>)['api.anthropic.com:443:'] =
      [
        {
          destroy: () => {
            destroyedUrl = true
          },
        } as unknown as Socket,
      ]
    destroyFreeSocketsForUrl(agent, 'https://api.anthropic.com/v1/heartbeat')
    expect(destroyedUrl).toBe(true)
  })

  test('#1599: buildSessionChildEnv injects CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS on epoch > 1', () => {
    const env = buildSessionChildEnv({
      sessionId: 'cse_123',
      sessionToken: 'tok',
      apiBaseUrl: 'https://api.anthropic.com',
      configDir: '/cfg',
      stageFileRoot: '/stage',
      inferenceAccessToken: 'oauth',
      environmentVariables: {},
      workerEpoch: 2,
      resumeInterruptedTurnMaxAgeMs: 120_000,
    })
    expect(env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBe('1')
    expect(env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS).toBe('120000')
    expect(env.CLAUDE_CODE_PARKED_STOP_RETIRES).toBe('1')
  })

  test('#1682: sanitizeSpawnReason allows valid reasons and rejects unsafe ones', () => {
    expect(sanitizeSpawnReason('runner_lost')).toBe('runner_lost')
    expect(sanitizeSpawnReason('bad value\n')).toBeUndefined()
  })

  test('#1683: parseRootArgs warns when --release-idle-session-min has no value or spaces only', () => {
    const warnings: string[] = []
    parseRootArgs(
      ['--api-url', 'https://example.com', '--release-idle-session-min'],
      msg => warnings.push(msg),
    )
    expect(warnings[0]).toContain(
      '--release-idle-session-min is the last argument',
    )

    const spaceWarnings: string[] = []
    parseRootArgs(
      ['--api-url', 'https://example.com', '--release-idle-session-min', '   '],
      msg => spaceWarnings.push(msg),
    )
    expect(spaceWarnings[0]).toContain('has a value of only spaces')
  })
})
