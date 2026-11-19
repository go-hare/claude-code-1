import { afterEach, describe, expect, test } from 'bun:test'
import {
  leftoverPolicyLimitsDp,
  POLICY_LIMITS_CATALOG,
} from '../../../cli/leftoverTulip.js'
import {
  clearRemovedMcpServersTracking,
  formatMcpElicitationDeclinedError,
  formatMcpServerRemovedError,
  isClaudeAiProxyCutOffAfterSend,
  isMcpServerRemovedFromSession,
  markMcpServerRemovedFromSession,
  MCP_CALL_OUTCOME_UNKNOWN_NOTE,
  unmarkMcpServerRemovedFromSession,
} from '../client.js'
import {
  formatMcpServerConfigValidationError,
  MANAGED_MCP_ARRIVED_UNREADABLE_MESSAGE,
  MANAGED_MCP_ARRIVED_VALID_MESSAGE,
  resetEnterpriseMcpConfigCache,
} from '../config.js'
import { shouldSkipPersistingMcpNeedsAuthCache } from '../connectionHelpers.js'
import {
  clearMcpElicitationDeclinedState,
  consumeMcpElicitationDeclinedDuringCall,
  recordMcpElicitationDeclinedForServer,
} from '../elicitationHandler.js'
import {
  collectOnDemandLocalMcpPrewaitSkipServers,
  resolveMcpStartupPrewaitBudgetMs,
} from '../mcpConnectTimeout.js'
import {
  coerceMcpToolInputForSchema,
  normalizeMcpRootCombinators,
} from '../mcpToolSchema.js'
import { commandBelongsToServer } from '../utils.js'
import { formatUnavailableMcpOrResourceToolHint } from '../../tools/toolExecution.js'

afterEach(() => {
  clearRemovedMcpServersTracking()
  clearMcpElicitationDeclinedState()
  resetEnterpriseMcpConfigCache()
})

describe('Wave 326 Group 3 — MCP & Chrome Policy (#3, #17, #77–#83, #87, #154, #247, #255, #259, #292)', () => {
  test('#3 & #292: managed-mcp arrival messages match official wording', () => {
    expect(MANAGED_MCP_ARRIVED_VALID_MESSAGE).toContain(
      'Your organization now manages MCP servers on this computer',
    )
    expect(MANAGED_MCP_ARRIVED_UNREADABLE_MESSAGE).toContain(
      "the file it sent can't be read",
    )
  })

  test('#17: failed/untrusted headersHelper without refresh token skips sticky needs-auth cache', () => {
    const httpServer = {
      type: 'http' as const,
      url: 'https://mcp.example.com',
      headersHelper: './auth.sh',
      scope: 'project' as const,
    }
    expect(
      shouldSkipPersistingMcpNeedsAuthCache({
        name: 'corp',
        serverRef: httpServer,
        transportType: 'http',
        lacksHelperHeaders: true,
        hasStoredRefreshToken: false,
      }),
    ).toBe(true)
    expect(
      shouldSkipPersistingMcpNeedsAuthCache({
        name: 'corp',
        serverRef: httpServer,
        transportType: 'http',
        lacksHelperHeaders: true,
        hasStoredRefreshToken: true,
      }),
    ).toBe(false)
    expect(
      shouldSkipPersistingMcpNeedsAuthCache({
        name: 'corp',
        serverRef: httpServer,
        transportType: 'http',
        lacksHelperHeaders: false,
        hasStoredRefreshToken: false,
      }),
    ).toBe(false)
  })

  test('#79: commandBelongsToServer matches exact mcpInfo.serverName when normalized names collide', () => {
    const cmdA = {
      name: 'mcp__my_server__greet',
      mcpInfo: { serverName: 'my-server' },
    } as unknown as Parameters<typeof commandBelongsToServer>[0]
    const cmdB = {
      name: 'mcp__my_server__greet',
      mcpInfo: { serverName: 'my_server' },
    } as unknown as Parameters<typeof commandBelongsToServer>[0]
    expect(commandBelongsToServer(cmdA, 'my-server')).toBe(true)
    expect(commandBelongsToServer(cmdA, 'my_server')).toBe(false)
    expect(commandBelongsToServer(cmdB, 'my_server')).toBe(true)
  })

  test('#80: removed MCP server is tracked and refused without reconnecting', () => {
    const oldCfg = { type: 'http', url: 'https://a.example.com' }
    const newCfg = { type: 'http', url: 'https://a.example.com' }
    markMcpServerRemovedFromSession('alpha', oldCfg)
    expect(isMcpServerRemovedFromSession('alpha', oldCfg)).toBe(true)
    expect(formatMcpServerRemovedError('alpha')).toContain(
      'was removed from this session',
    )
    // Old config stays blocked even if server name is re-added with a new config
    unmarkMcpServerRemovedFromSession('alpha', newCfg)
    expect(isMcpServerRemovedFromSession('alpha', oldCfg)).toBe(true)
    expect(isMcpServerRemovedFromSession('alpha', newCfg)).toBe(false)
  })

  test('#81: declined remote elicitation annotates subsequent tool failure', () => {
    const start = Date.now()
    recordMcpElicitationDeclinedForServer('remote-srv', start + 10)
    expect(consumeMcpElicitationDeclinedDuringCall('remote-srv', start)).toBe(
      true,
    )
    expect(consumeMcpElicitationDeclinedDuringCall('remote-srv', start)).toBe(
      false,
    )
    expect(formatMcpElicitationDeclinedError('permission denied')).toContain(
      'The server replied: "permission denied". That reply came after a question that the server asked about this call was declined, and the decline still stands.',
    )
    expect(formatMcpElicitationDeclinedError('')).toContain(
      'This call failed. That came after a question',
    )
  })

  test('#82: root anyOf/oneOf merges all distinct property branches and coerces numeric strings', () => {
    const out = normalizeMcpRootCombinators({
      oneOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string' },
            common: { type: 'string' },
          },
          required: ['id', 'common'],
        },
        {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            common: { type: 'string' },
          },
          required: ['common'],
        },
      ],
    })
    expect(out.outcome).toBe('normalized')
    if (out.outcome !== 'normalized') return
    expect(out.schema.required).toEqual(['common'])
    expect(out.schema.additionalProperties).toBe(true)
    const props = out.schema.properties as Record<string, unknown>
    expect(props.id).toEqual({
      anyOf: [{ type: 'string' }, { type: 'integer' }],
    })
    const coerced = coerceMcpToolInputForSchema(
      { id: '42', common: 'abc' },
      out.schema,
    )
    expect(coerced).toEqual({ id: 42, common: 'abc' })
  })

  test('#83: unavailable approved MCP resource tool surfaces clear explanation', () => {
    expect(
      formatUnavailableMcpOrResourceToolHint('ReadMcpResourceTool', []),
    ).toContain('not among the tools available here')
    expect(
      formatUnavailableMcpOrResourceToolHint('ReadMcpResourceTool', [
        {
          name: 'docs',
          type: 'pending',
          config: { type: 'http', url: 'https://x' },
        } as never,
      ]),
    ).toContain('still connecting')
  })

  test('#87: add-json validation errors explain per-transport fixes', () => {
    expect(formatMcpServerConfigValidationError('bad')).toContain(
      'not a JSON object',
    )
    expect(
      formatMcpServerConfigValidationError({ mcpServers: { a: {} } }),
    ).toContain('leave out the "mcpServers" wrapper')
    expect(
      formatMcpServerConfigValidationError({ url: 'https://x.test' }),
    ).toContain('has a "url" but no "type"')
    expect(
      formatMcpServerConfigValidationError({ type: 'ftp', url: 'ftp://x' }),
    ).toContain('unknown "type" "ftp"')
    expect(formatMcpServerConfigValidationError({ type: 'http' })).toContain(
      'url:',
    )
  })

  test('#154: allow_claude_browser_extension sets denialNamesNoRemedy and omits admin remedy', () => {
    expect(
      POLICY_LIMITS_CATALOG.allow_claude_browser_extension?.denialNamesNoRemedy,
    ).toBe(true)
    const msg = leftoverPolicyLimitsDp(
      'allow_claude_browser_extension',
      'Claude in Chrome',
      'is',
    )
    if (msg !== null) {
      expect(msg).not.toContain('Contact your organization admin')
    }
  })

  test('#247: skips up-to-500ms first-turn prewait for on-demand local stdio MCP servers', () => {
    const clients = [
      { name: 'local-tool', type: 'pending', config: { type: 'stdio' } },
    ]
    const skipped = collectOnDemandLocalMcpPrewaitSkipServers({
      clients,
      entrypoint: 'claude-desktop',
      toolSearchEnabled: true,
    })
    expect(skipped.has('local-tool')).toBe(true)
    expect(
      resolveMcpStartupPrewaitBudgetMs({
        configuredWaitMs: 500,
        hasPendingRequiredServers: false,
        pendingClients: clients,
        entrypoint: 'claude-desktop',
        toolSearchEnabled: true,
      }),
    ).toBe(0)
  })

  test('#255: claudeai-proxy disconnect after send flags outcome unknown', () => {
    const err = new Error('Connection closed')
    expect(isClaudeAiProxyCutOffAfterSend(err, 'claudeai-proxy', false)).toBe(
      true,
    )
    expect(isClaudeAiProxyCutOffAfterSend(err, 'stdio', false)).toBe(false)
    expect(isClaudeAiProxyCutOffAfterSend(err, 'claudeai-proxy', true)).toBe(
      false,
    )
    expect(MCP_CALL_OUTCOME_UNKNOWN_NOTE).toContain('The outcome is unknown')
  })

  test('#80 review fix: unmarkMcpServerRemovedFromSession runs after all three stale-settlement guards', async () => {
    const src = await Bun.file(
      new URL('../useManageMCPConnections.ts', import.meta.url),
    ).text()
    const epochGuardIdx = src.indexOf('attemptEpoch !== getMcpIdentityEpoch()')
    const managedPolicyGuardIdx = src.indexOf(
      "if (blockReason === 'managed-policy')",
    )
    const stalePluginGuardIdx = src.indexOf(
      'removedStalePluginServersRef.current.has(client.name)',
    )
    const unmarkIdx = src.indexOf(
      'unmarkMcpServerRemovedFromSession(client.name, client.config)',
    )
    const updateServerIdx = src.indexOf(
      'updateServer({ ...client, tools, commands, resources })',
    )
    expect(epochGuardIdx).toBeGreaterThan(-1)
    expect(managedPolicyGuardIdx).toBeGreaterThan(epochGuardIdx)
    expect(stalePluginGuardIdx).toBeGreaterThan(managedPolicyGuardIdx)
    expect(unmarkIdx).toBeGreaterThan(stalePluginGuardIdx)
    expect(updateServerIdx).toBeGreaterThan(unmarkIdx)
    expect(src).toContain(
      '// Official $Qr: drop late connection settlements superseded by an account\n      // switch (sign-in / org change) so org-managed / previous-account servers\n      // are never relisted under the new session.',
    )
  })
})
