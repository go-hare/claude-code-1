import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isDatadogAllowedEvent } from '../datadog.js'

const src = readFileSync(join(import.meta.dir, '../datadog.ts'), 'utf8')
const sinkSrc = readFileSync(join(import.meta.dir, '../sink.ts'), 'utf8')
const gbSrc = readFileSync(join(import.meta.dir, '../growthbook.ts'), 'utf8')
const metricsSrc = readFileSync(
  join(import.meta.dir, '../../api/metricsOptOut.ts'),
  'utf8',
)

describe('densable 2.1.289 Datadog / sink / metrics telemetry wrap', () => {
  test('gold US5 intake + pub token are hardcoded (no DATADOG_* override)', () => {
    expect(src).toContain(
      'https://http-intake.logs.us5.datadoghq.com/api/v2/logs',
    )
    expect(src).toContain('pubea5604404508cdd34afb69e6f42a05bc')
    expect(src).toContain('DD-API-KEY')
    expect(src).not.toContain('process.env.DATADOG_LOGS_ENDPOINT')
    expect(src).not.toContain('process.env.DATADOG_API_KEY')
    expect(src).not.toContain('isByocDatadogEnabled')
    // leftover-none 我要结构也是金标: gold H_t has no NODE_ENV skip
    expect(src).not.toMatch(/trackDatadogEvent[\s\S]*NODE_ENV === 'test'/)
  })

  test('gold allowlist admits 289 events CURRENT previously dropped', () => {
    expect(isDatadogAllowedEvent('tengu_started')).toBe(true)
    expect(isDatadogAllowedEvent('tengu_turn_handoff_carried_writes')).toBe(
      true,
    )
    expect(isDatadogAllowedEvent('tengu_api_fallback_last_resort')).toBe(true)
    expect(isDatadogAllowedEvent('tengu_feature_ok')).toBe(true)
    expect(isDatadogAllowedEvent('tengu_daemon_start')).toBe(true)
    expect(isDatadogAllowedEvent('not_a_gold_event')).toBe(false)
  })

  test('gzip unique English and CLAUDE_CODE_GZIP_DATADOG_LOGS are present', () => {
    expect(src).toContain('Datadog did not take a gzipped log batch (')
    expect(src).toContain('CLAUDE_CODE_GZIP_DATADOG_LOGS')
    expect(src).toContain('Content-Encoding')
  })

  test('sink reentry unique English matches gold', () => {
    expect(sinkSrc).toContain(
      'logEvent reentered while collecting metadata — dropped',
    )
    expect(sinkSrc).toContain(
      'A getEventMetadata dependency (model/betas/auth) called logEvent synchronously; defer it (queueMicrotask) or move it out of the metadata path.',
    )
    expect(sinkSrc).toContain('initializeGrowthBook')
  })

  test('metrics_enabled unique English + BASE_API_URL host', () => {
    expect(metricsSrc).toContain(
      'Auth error: no credential usable for the metrics opt-out check',
    )
    expect(metricsSrc).toContain(
      'metrics_enabled response missing metrics_logging_enabled',
    )
    expect(metricsSrc).toContain('metrics_enabled unavailable:')
    expect(metricsSrc).toContain(
      '/api/claude_code/organizations/metrics_enabled',
    )
    expect(metricsSrc).toContain('getOauthConfig().BASE_API_URL')
    expect(metricsSrc).not.toContain(
      'https://api.anthropic.com/api/claude_code/organizations/metrics_enabled',
    )
  })

  test('gold H_t structure: env external, peerRate, strip, BYOC XXo, gzip Li', () => {
    expect(src).toContain("env: 'external'")
    expect(src).not.toContain('env: process.env.USER_TYPE')
    expect(src).toContain('droppedSinceLastForward')
    expect(src).toContain('tengu_mcp_listen_reopen')
    expect(src).toContain('mcpServerKeyHash')
    expect(src).toContain('CLAUDE_CODE_ENVIRONMENT_KIND')
    expect(src).toContain('CLAUDE_CODE_BYOC_ENABLE_DATADOG')
    expect(src).toContain('datadog_logs_gzip')
    expect(src).toContain('-(?:dev|engine)')
    expect(src).toContain('isFirstPartyAnthropicBaseUrl')
    expect(src).not.toMatch(/if \(!gzip \|\| status === 429\) \{\s*logError/)
  })

  test('gold GB cacheKeyAttributes + User-Agent header', () => {
    expect(gbSrc).toContain("'slackTagConnected'")
    expect(gbSrc).toContain("'atisPin'")
    expect(gbSrc).toContain("'ccrDerivedSurface'")
    expect(gbSrc).toContain("'User-Agent': getClaudeCodeUserAgent()")
  })
})
