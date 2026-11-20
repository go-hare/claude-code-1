import { afterEach, describe, expect, test } from 'bun:test'
import {
  emitClaudeAppsGatewayStartupWarnings,
  validateClaudeAppsGatewayStartupConfig,
  validateGatewayManagedPolicyEffortLevels,
} from '../../../cli/handlers/claudeAppsGateway.js'
import {
  clearCloudSessionRepoStripWarnsForTests,
  isAnthropicHostedCloudSession,
  stripProjectScopeBlockedEnv,
} from '../../managedEnvConstants.js'
import {
  getProviderBoundRouteSnapshot,
  resetProviderBoundCachesIfMoved,
} from '../../model/modelStrings.js'
import { isTelemetryDisabledInEnv } from '../../privacyLevel.js'
import {
  getCompletedBareProxyRepairUrl,
  preserveRepairedProxyIfBare,
  repairBareHostPortProxyValue,
  repairBareProxySchemeAtStartup,
  resetBareProxyRepairStateForTests,
} from '../../proxy.js'
import {
  shouldDropOAuthScopesForChild,
  stripOAuthScopesIfTokenRemoved,
} from '../../subprocessEnv.js'
import {
  parseOtelResourceAttributes,
  parseOtelResourceAttributesDetailed,
} from '../../telemetryAttributes.js'

describe('Wave 327-328 Settings, Proxy, ManagedEnv, SubprocessEnv, Telemetry & Gateway', () => {
  afterEach(() => {
    resetBareProxyRepairStateForTests()
    clearCloudSessionRepoStripWarnsForTests()
  })

  describe('#389 strip CLAUDE_CODE_OAUTH_SCOPES when session OAuth token is not passed', () => {
    test('removes CLAUDE_CODE_OAUTH_SCOPES when parent had token and child dropped it', () => {
      const parentEnv = {
        CLAUDE_CODE_OAUTH_TOKEN: 'tok_parent',
        CLAUDE_CODE_OAUTH_SCOPES: 'org:inference',
      }
      const childEnv: Record<string, string | undefined> = {
        CLAUDE_CODE_OAUTH_SCOPES: 'org:inference',
        PATH: '/usr/bin',
      }
      expect(shouldDropOAuthScopesForChild(parentEnv, childEnv)).toBe(true)
      stripOAuthScopesIfTokenRemoved(parentEnv, childEnv)
      expect(childEnv.CLAUDE_CODE_OAUTH_SCOPES).toBeUndefined()
      expect(childEnv.PATH).toBe('/usr/bin')
    })

    test('preserves CLAUDE_CODE_OAUTH_SCOPES when child keeps OAuth token or refresh token', () => {
      const parentEnv = { CLAUDE_CODE_OAUTH_TOKEN: 'tok_parent' }
      const childWithToken: Record<string, string | undefined> = {
        CLAUDE_CODE_OAUTH_TOKEN: 'tok_child',
        CLAUDE_CODE_OAUTH_SCOPES: 'org:inference',
      }
      stripOAuthScopesIfTokenRemoved(parentEnv, childWithToken)
      expect(childWithToken.CLAUDE_CODE_OAUTH_SCOPES).toBe('org:inference')

      const childWithRefresh: Record<string, string | undefined> = {
        CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'rt_child',
        CLAUDE_CODE_OAUTH_SCOPES: 'org:inference',
      }
      stripOAuthScopesIfTokenRemoved(parentEnv, childWithRefresh)
      expect(childWithRefresh.CLAUDE_CODE_OAUTH_SCOPES).toBe('org:inference')
    })
  })

  describe('#400 bare host:port HTTPS_PROXY repair in non-TTY environments', () => {
    test('repairs bare host:port and IPv6 host:port values only', () => {
      expect(repairBareHostPortProxyValue('proxy.corp.local:8080')).toBe(
        'http://proxy.corp.local:8080',
      )
      expect(repairBareHostPortProxyValue('[::1]:3128')).toBe(
        'http://[::1]:3128',
      )
      expect(
        repairBareHostPortProxyValue('https://proxy.corp.local:8080'),
      ).toBe('https://proxy.corp.local:8080')
      expect(repairBareHostPortProxyValue('not a valid proxy')).toBe(
        'not a valid proxy',
      )
    })

    test('repairs HTTPS_PROXY when neither stdin nor stdout is a TTY, and skips TTY or --bg', () => {
      const env: Record<string, string | undefined> = {
        HTTPS_PROXY: 'proxy.internal:8080',
        https_proxy: 'proxy.internal:8080',
      }
      const res = repairBareProxySchemeAtStartup({
        env,
        stdinIsTTY: false,
        stdoutIsTTY: false,
        argv: ['-p', 'hello'],
      })
      expect(res.repaired).toBe(true)
      expect(env.HTTPS_PROXY).toBe('http://proxy.internal:8080')
      expect(env.https_proxy).toBe('http://proxy.internal:8080')
      expect(getCompletedBareProxyRepairUrl()).toBe(
        'http://proxy.internal:8080',
      )

      // Settings attempting to re-set bare proxy keeps repaired startup URL
      expect(preserveRepairedProxyIfBare('HTTPS_PROXY', 'other:9090')).toBe(
        'http://proxy.internal:8080',
      )
      expect(
        preserveRepairedProxyIfBare('HTTPS_PROXY', 'https://valid:443'),
      ).toBe('https://valid:443')

      // Skips when stdout is a TTY
      resetBareProxyRepairStateForTests()
      const ttyEnv: Record<string, string | undefined> = {
        HTTPS_PROXY: 'proxy.internal:8080',
      }
      expect(
        repairBareProxySchemeAtStartup({
          env: ttyEnv,
          stdinIsTTY: false,
          stdoutIsTTY: true,
          argv: [],
        }).repaired,
      ).toBe(false)
      expect(ttyEnv.HTTPS_PROXY).toBe('proxy.internal:8080')

      // Skips when --bg flag is passed
      const bgEnv: Record<string, string | undefined> = {
        HTTPS_PROXY: 'proxy.internal:8080',
      }
      expect(
        repairBareProxySchemeAtStartup({
          env: bgEnv,
          stdinIsTTY: false,
          stdoutIsTTY: false,
          argv: ['--bg'],
        }).repaired,
      ).toBe(false)
    })
  })

  describe('#436 provider-bound cache invalidation when ANTHROPIC_BASE_URL moves', () => {
    test('detects ANTHROPIC_BASE_URL change and resets provider-bound caches', () => {
      const before = getProviderBoundRouteSnapshot({})
      const moved = resetProviderBoundCachesIfMoved(before, {
        ANTHROPIC_BASE_URL: 'https://llm-gateway.example.com',
      })
      expect(moved).toBe(true)

      const same = resetProviderBoundCachesIfMoved(before, {})
      expect(same).toBe(false)
    })
  })

  describe('#530 Anthropic-hosted cloud sessions repo env restrictions', () => {
    test('identifies Anthropic-hosted cloud sessions vs BYOC runners', () => {
      expect(isAnthropicHostedCloudSession({ CLAUDE_CODE_REMOTE: '1' })).toBe(
        true,
      )
      expect(
        isAnthropicHostedCloudSession({
          CLAUDE_CODE_REMOTE: '1',
          CLAUDE_CODE_ENVIRONMENT_KIND: 'byoc',
        }),
      ).toBe(false)
      expect(isAnthropicHostedCloudSession({})).toBe(false)
    })

    test('strips repo flag/plugin delivery env vars and downgrades CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC to DISABLE_TELEMETRY', () => {
      expect(isTelemetryDisabledInEnv({ DISABLE_TELEMETRY: '1' })).toBe(true)
      expect(isTelemetryDisabledInEnv({ DO_NOT_TRACK: '0' })).toBe(false)

      const filtered = stripProjectScopeBlockedEnv(
        {
          CLAUDE_CODE_DISABLE_FEATURE_FLAGS: '1',
          DISABLE_GROWTHBOOK: '1',
          CLAUDE_CODE_SYNC_PLUGIN_INSTALL: '0',
          CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS: '1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DO_NOT_TRACK: '0',
          SAFE_USER_VAR: 'keep',
        },
        'projectSettings',
        { cloudSession: true, warnedKeys: new Set() },
      )

      expect(filtered.CLAUDE_CODE_DISABLE_FEATURE_FLAGS).toBeUndefined()
      expect(filtered.DISABLE_GROWTHBOOK).toBeUndefined()
      expect(filtered.CLAUDE_CODE_SYNC_PLUGIN_INSTALL).toBeUndefined()
      expect(filtered.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS).toBeUndefined()
      expect(filtered.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBeUndefined()
      expect(filtered.DO_NOT_TRACK).toBeUndefined()
      expect(filtered.DISABLE_TELEMETRY).toBe('1')
      expect(filtered.SAFE_USER_VAR).toBe('keep')
    })

    test('does not downgrade CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC outside Anthropic-hosted cloud sessions', () => {
      const filtered = stripProjectScopeBlockedEnv(
        {
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          SAFE_USER_VAR: 'keep',
        },
        'projectSettings',
        { cloudSession: false, warnedKeys: new Set() },
      )
      expect(filtered.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
      expect(filtered.DISABLE_TELEMETRY).toBeUndefined()
    })
  })

  describe('#547 claude-apps-gateway startup warning for invalid maxEffortLevel', () => {
    test('warns on invalid top-level and per-model maxEffortLevel, accepts valid levels', () => {
      const warnings = validateGatewayManagedPolicyEffortLevels([
        {
          payload: {
            settings: {
              maxEffortLevel: 'turbo',
              modelSettings: {
                'claude-opus-4-6': { maxEffortLevel: 'xhigh' },
                'claude-sonnet-4-6': { maxEffortLevel: 'ultra' },
              },
            },
          },
        },
      ])

      expect(warnings).toHaveLength(2)
      expect(warnings[0]).toBe(
        'managed policy 0 maxEffortLevel is not one of low, medium, high, xhigh, max, so Claude Code ignores it. Fix the value, or upgrade the gateway if the level was added in a newer Claude Code.',
      )
      expect(warnings[1]).toBe(
        'managed policy 0 modelSettings.claude-sonnet-4-6.maxEffortLevel is not one of low, medium, high, xhigh, max, so Claude Code ignores it. Fix the value, or upgrade the gateway if the level was added in a newer Claude Code.',
      )

      const emitted: string[] = []
      const res = emitClaudeAppsGatewayStartupWarnings(
        {
          managedPolicies: [
            {
              payload: {
                settings: { maxEffortLevel: 'high' },
              },
            },
          ],
        },
        msg => emitted.push(msg),
      )
      expect(res).toEqual([])
      expect(emitted).toEqual([])
      expect(
        validateClaudeAppsGatewayStartupConfig({ managedPolicies: [] })
          .warnings,
      ).toEqual([])
    })
  })

  describe('#624 OTEL_RESOURCE_ATTRIBUTES drops only malformed entry, keeps other labels', () => {
    test('preserves valid attributes alongside a malformed entry', () => {
      const parsed = parseOtelResourceAttributes(
        'team=platform,bad entry=has space,env=prod,noequals,bad_pct=%ZZ,service.tier=gold',
      )
      expect(parsed).toEqual({
        team: 'platform',
        env: 'prod',
        'service.tier': 'gold',
      })
    })

    test('emits per-entry left-off notice rather than dropping all attributes', () => {
      const detailed = parseOtelResourceAttributesDetailed(
        'team=platform,foo=bad space,env=prod',
        true,
        { logWarnings: false },
      )
      expect(detailed.attributes).toEqual({
        team: 'platform',
        foo: 'bad space',
        env: 'prod',
      })
      expect(
        detailed.notices.some(n =>
          n.includes(
            'Entry 2 of 3 (counting every part between commas) was left off metric points, events, and spans.',
          ),
        ),
      ).toBe(true)
    })
  })
})
