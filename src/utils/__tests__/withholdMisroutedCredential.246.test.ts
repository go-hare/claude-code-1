/**
 * densable 2.1.246 #44 — official `ky` / `zP` / `jP` / `Hd`.
 *
 * Gateway `ANTHROPIC_BASE_URL` API keys must not go to Anthropic telemetry.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { withholdMisroutedCredential } from '../http.js'

const exporterSrc = readFileSync(
  join(import.meta.dir, '../telemetry/bigqueryExporter.ts'),
  'utf8',
)
const eventLoggingSrc = readFileSync(
  join(
    import.meta.dir,
    '../../services/analytics/firstPartyEventLoggingExporter.ts',
  ),
  'utf8',
)

const METRICS = 'https://api.anthropic.com/api/claude_code/metrics'
const GATEWAY = 'https://gateway.example.com/v1'

describe('densable 2.1.246 #44 withholdMisroutedCredential', () => {
  const prevBase = process.env.ANTHROPIC_BASE_URL

  afterEach(() => {
    if (prevBase === undefined) {
      delete process.env.ANTHROPIC_BASE_URL
    } else {
      process.env.ANTHROPIC_BASE_URL = prevBase
    }
  })

  test('first-party API key belongs to api.anthropic.com metrics', () => {
    delete process.env.ANTHROPIC_BASE_URL
    const auth = { headers: { 'x-api-key': 'sk-ant-test' } }
    expect(withholdMisroutedCredential(auth, METRICS)).toEqual(auth)
  })

  test('gateway ANTHROPIC_BASE_URL key is withheld from 1P metrics', () => {
    process.env.ANTHROPIC_BASE_URL = GATEWAY
    const auth = { headers: { 'x-api-key': 'sk-gateway' } }
    const out = withholdMisroutedCredential(auth, METRICS)
    expect(out.reasonCode).toBe('misrouted_credential')
    expect(out.headers).toEqual({})
    expect(out.error).toBe(
      'credential withheld: this telemetry endpoint is not the host it belongs to',
    )
  })

  test('OAuth bearer belongs to BASE_API_URL host', () => {
    delete process.env.ANTHROPIC_BASE_URL
    const auth = { headers: { Authorization: 'Bearer oauth' } }
    expect(withholdMisroutedCredential(auth, METRICS)).toEqual(auth)
  })

  test('exporter skips misrouted credentials with official sentence', () => {
    expect(exporterSrc).toContain('withholdMisroutedCredential')
    expect(exporterSrc).toContain(
      'credential does not belong to the metrics endpoint host, skipping',
    )
    expect(exporterSrc).not.toContain('this.dispatchHostMatchesEndpoint')
  })

  test('1P event logging withholds misrouted credentials', () => {
    expect(eventLoggingSrc).toContain('withholdMisroutedCredential')
    expect(eventLoggingSrc).toContain(
      'credential does not belong to the event logging endpoint host, withholding',
    )
    expect(eventLoggingSrc).toContain('/api/event_logging/v2/batch')
    expect(eventLoggingSrc).not.toContain("'/api/event_logging/batch'")
  })
})
