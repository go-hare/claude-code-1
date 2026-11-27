import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from '../../../utils/config.js'
import {
  resetSessionStateForTests,
  setInternalMetadataChangedListener,
} from '../../../utils/sessionState.js'
import { unsetEmptyAwsBearerTokenBedrock } from '../client.js'
import {
  confirmMcpConfigWrite,
  getAnthropicProxyUpstreamUrls,
  getDisabledMcpServers,
  isMcpServerDisabled,
  setMcpServerEnabled,
} from '../config.js'
import {
  classifyMcpAutoProbeFallback,
  clearRememberedLegacyStdio,
  flushRememberedLegacyStdioWritesForTest,
  isRememberedLegacyStdio,
  loadRememberedLegacyStdioFromDisk,
  persistRememberedLegacyStdioToDisk,
  recordRememberedLegacyStdio,
  resetStdioDiscoverVerdictCacheForTest,
} from '../mcpConnectTimeout.js'
import {
  McpSwitchedOffRecord,
  sanitizeDisabledMcpServers,
  setActiveMcpSwitchedOffRecord,
} from '../mcpSwitchedOffRecord.js'
import {
  createManagedMcpSwitchedOffRecord,
  restoreManagedMcpSwitchedOffRecord,
} from '../useManageMCPConnections.js'
import {
  excludeStalePluginClients,
  hashMcpConfig,
  isClientDeclaredUnderPreviousWorkspaceRoot,
} from '../utils.js'

describe('Wave 318 MCP Alignment', () => {
  afterEach(() => {
    resetStdioDiscoverVerdictCacheForTest()
    setActiveMcpSwitchedOffRecord(null)
    resetSessionStateForTests()
  })

  test('#1537: hashMcpConfig ignores provenance metadata and preserves project/local clients', () => {
    const a = {
      type: 'stdio' as const,
      command: 'node',
      args: ['srv.js'],
      scope: 'project' as const,
      declaredIn: '/repo/a',
    }
    const b = {
      type: 'stdio' as const,
      command: 'node',
      args: ['srv.js'],
      scope: 'local' as const,
      declaredIn: '/repo/a',
      readFrom: '/repo/a/.mcp.json',
    }
    expect(hashMcpConfig(a as never)).toBe(hashMcpConfig(b as never))
    expect(
      isClientDeclaredUnderPreviousWorkspaceRoot(
        a as never,
        '/repo/b',
        '/repo/a',
      ),
    ).toBe(false)
    expect(
      isClientDeclaredUnderPreviousWorkspaceRoot(
        a as never,
        '/repo/b',
        '/repo/b',
      ),
    ).toBe(true)

    const { stale } = excludeStalePluginClients(
      {
        clients: [{ name: 'srv', type: 'connected', config: a } as never],
        tools: [],
        commands: [],
        resources: {},
      },
      { srv: b as never },
    )
    expect(stale).toHaveLength(0)
  })

  test('#1564: unsetEmptyAwsBearerTokenBedrock deletes empty AWS_BEARER_TOKEN_BEDROCK', () => {
    const env1: Record<string, string> = {
      AWS_BEARER_TOKEN_BEDROCK: '',
      OTHER: 'keep',
    }
    unsetEmptyAwsBearerTokenBedrock(env1)
    expect('AWS_BEARER_TOKEN_BEDROCK' in env1).toBe(false)
    expect(env1.OTHER).toBe('keep')

    const env2: Record<string, string> = {
      AWS_BEARER_TOKEN_BEDROCK: 'tok-123',
    }
    unsetEmptyAwsBearerTokenBedrock(env2)
    expect(env2.AWS_BEARER_TOKEN_BEDROCK).toBe('tok-123')
  })

  test('#1625: confirmMcpConfigWrite confirms concurrent write or throws lock-wait error', async () => {
    let calls = 0
    await confirmMcpConfigWrite('srv', 'user', 'add', async () => {
      calls++
      if (calls === 1) throw new Error('EBUSY')
      return { mcpServers: { srv: { command: 'x' } } }
    })
    expect(calls).toBe(2)

    await expect(
      confirmMcpConfigWrite('srv', 'user', 'add', async () => ({
        mcpServers: {},
      })),
    ).rejects.toThrow('CLAUDE_CODE_CONFIG_LOCK_WAIT_MS=60000')
  })

  test('#1628: classifyMcpAutoProbeFallback catches <3s stdio close and persists 7d legacy cache', async () => {
    const decision = classifyMcpAutoProbeFallback(
      { mode: 'auto', probe: { timeoutMs: 3000 } },
      { code: -32000, message: 'Connection closed' },
      { transportType: 'stdio', canRecreateTransport: true, elapsedMs: 120 },
    )
    expect(decision).toEqual({ shouldFallback: true, reason: 'closed' })

    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const dir = mkdtempSync(join(tmpdir(), 'mcp-verdict-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      const cfg = { type: 'stdio', command: 'fast-exit', args: ['--v'] }
      const now = Date.now()
      recordRememberedLegacyStdio(cfg, now)
      await persistRememberedLegacyStdioToDisk(now)
      resetStdioDiscoverVerdictCacheForTest()
      expect(isRememberedLegacyStdio(cfg, {}, now + 1000)).toBe(false)
      await loadRememberedLegacyStdioFromDisk(now + 1000)
      expect(isRememberedLegacyStdio(cfg, {}, now + 1000)).toBe(true)
      clearRememberedLegacyStdio(cfg)
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1675: getAnthropicProxyUpstreamUrls extracts mcp_url from CCR/Anthropic proxy URLs', () => {
    const urls = getAnthropicProxyUpstreamUrls(
      'https://api.anthropic.com/v2/ccr-sessions/cse_1/mcp?mcp_url=https%3A%2F%2Fmcp.slack.com%2Fmcp',
    )
    expect(urls).toEqual(['https://mcp.slack.com/mcp'])
  })

  test('#1600: McpSwitchedOffRecord handles restore, unread_at_boot, foundLate & switchedOnWhileUnread', async () => {
    expect(
      sanitizeDisabledMcpServers(['a', '', 'claude-in-chrome', 'b', 'a']),
    ).toEqual(['b', 'a'])

    const metadataWrites: Array<{ disabled_mcp_servers: string[] | null }> = []
    let disabledList: string[] = ['local-off']
    const rec = new McpSwitchedOffRecord(
      {
        restoredWorkerState: Promise.resolve({ readFailed: true }),
        rereadWorkerState: async () => ({
          readFailed: false,
          internal: { disabled_mcp_servers: ['late-off', 're-enabled'] },
        }),
        sessionState: {
          notifyInternalMetadataChanged: patch => metadataWrites.push(patch),
        },
      },
      { getDisabledServers: () => disabledList },
    )
    await rec.restore({
      saveDisabledServers: () => {},
      getDisabledServers: () => disabledList,
      getClients: () => [],
      closeClient: async () => {},
    })
    expect(rec.isUnread).toBe(true)

    rec.switchSaved('re-enabled', true)
    await rec.readThenWrite()
    expect(rec.foundLate.has('late-off')).toBe(true)
    expect(rec.foundLate.has('re-enabled')).toBe(false)
    expect(metadataWrites.at(-1)?.disabled_mcp_servers).toEqual([
      'late-off',
      'local-off',
    ])
  })

  test('#1628 wiring: recordRememberedLegacyStdio auto-persists and client.ts lazily loads once', async () => {
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const dir = mkdtempSync(join(tmpdir(), 'mcp-verdict-wired-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      const cfg = { type: 'stdio', command: 'auto-persist-srv', args: ['--s'] }
      const now = Date.now()
      // Production write path: recordRememberedLegacyStdio triggers persistRememberedLegacyStdioToDisk
      recordRememberedLegacyStdio(cfg, now)
      await flushRememberedLegacyStdioWritesForTest()

      const diskPath = join(dir, 'state', 'mcp-discover-verdicts.json')
      const diskPayload = JSON.parse(readFileSync(diskPath, 'utf8')) as Record<
        string,
        { observedAt: number }
      >
      expect(Object.keys(diskPayload).length).toBe(1)

      // Simulate restart: clear memory cache, then lazy-load with { once: true } (same as client.ts)
      resetStdioDiscoverVerdictCacheForTest()
      expect(isRememberedLegacyStdio(cfg, {}, now + 1000)).toBe(false)
      await loadRememberedLegacyStdioFromDisk(now + 1000, { once: true })
      expect(isRememberedLegacyStdio(cfg, {}, now + 1000)).toBe(true)

      // Clearing also persists removal to disk
      clearRememberedLegacyStdio(cfg)
      await flushRememberedLegacyStdioWritesForTest()
      const afterClear = JSON.parse(readFileSync(diskPath, 'utf8')) as Record<
        string,
        unknown
      >
      expect(Object.keys(afterClear)).toHaveLength(0)

      // Verify client.ts calls loadRememberedLegacyStdioFromDisk before isRememberedLegacyStdio
      const clientDir = join(process.cwd(), 'src/services/mcp/client')
      const clientSrc = [
        readFileSync(join(process.cwd(), 'src/services/mcp/client.ts'), 'utf8'),
        ...readdirSync(clientDir)
          .filter(f => f.endsWith('.ts'))
          .sort()
          .map(f => readFileSync(join(clientDir, f), 'utf8')),
      ].join('\n')
      const loadIdx = clientSrc.indexOf(
        'await loadRememberedLegacyStdioFromDisk(undefined, { once: true })',
      )
      const checkIdx = clientSrc.indexOf('isRememberedLegacyStdio(')
      expect(loadIdx).toBeGreaterThan(-1)
      expect(checkIdx).toBeGreaterThan(loadIdx)
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1600 wiring: restoreManagedMcpSwitchedOffRecord + setMcpServerEnabled sync internal_metadata.disabled_mcp_servers', async () => {
    const prevDisabled = getCurrentProjectConfig().disabledMcpServers
    const metadataWrites: Array<Record<string, unknown>> = []
    setInternalMetadataChangedListener(meta => metadataWrites.push(meta))

    try {
      saveCurrentProjectConfig(curr => ({ ...curr, disabledMcpServers: [] }))

      const closed: string[] = []
      const markedDisabled: string[] = []
      const clients = [
        {
          name: 'srv-restored',
          type: 'connected' as const,
          config: { type: 'stdio' as const, command: 'node', args: [] },
        },
        {
          name: 'srv-active',
          type: 'connected' as const,
          config: { type: 'stdio' as const, command: 'node', args: [] },
        },
      ]

      const record = createManagedMcpSwitchedOffRecord({
        isKept: true,
        restoredWorkerState: Promise.resolve({
          readFailed: false,
          internal: {
            disabled_mcp_servers: ['srv-restored', 'claude-in-chrome'],
          },
        }),
      })
      setActiveMcpSwitchedOffRecord(record)

      await restoreManagedMcpSwitchedOffRecord(record, {
        getClients: () => clients as never,
        closeConnection: async name => {
          closed.push(name)
          const idx = clients.findIndex(c => c.name === name)
          if (idx >= 0) {
            clients[idx] = {
              ...clients[idx]!,
              type: 'disabled' as never,
            }
          }
        },
        markDisabled: name => {
          markedDisabled.push(name)
        },
      })

      expect(closed).toEqual(['srv-restored'])
      expect(markedDisabled).toEqual(['srv-restored'])
      expect(isMcpServerDisabled('srv-restored')).toBe(true)
      expect(getDisabledMcpServers()).toEqual(['srv-restored'])

      // Production toggle path: setMcpServerEnabled notifies active McpSwitchedOffRecord
      setMcpServerEnabled('srv-toggled', false)
      expect(metadataWrites.at(-1)).toEqual({
        disabled_mcp_servers: ['srv-restored', 'srv-toggled'],
      })

      setMcpServerEnabled('srv-toggled', true)
      expect(metadataWrites.at(-1)).toEqual({
        disabled_mcp_servers: ['srv-restored'],
      })
    } finally {
      saveCurrentProjectConfig(curr => ({
        ...curr,
        disabledMcpServers: prevDisabled,
      }))
    }
  })
})
