/**
 * densable 2.1.234 #28/#29 — permission preview credential masking.
 * SEA: VKc.redactForDisplay (tAt/zhy/$hy) + Lhy private-key full redact.
 */
import { mock, describe, expect, test } from 'bun:test'
import { growthbookMock } from '../../../../tests/mocks/growthbook'

mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookMock(),
  getFeatureValue_CACHED_MAY_BE_STALE: () => false,
}))

import {
  redactSecrets,
  redactSecretsDeep,
  redactSecretsForDisplay,
  scanForSecrets,
} from '../secretScanner.js'

const { truncateForPreview } = await import('../../mcp/channelPermissions.js')

const GITHUB_PAT = 'ghp_' + 'A'.repeat(36)
// Assembled so the contiguous Slack token is not in the blob (GH push protection).
const SLACK_BOT = [
  'xoxb',
  '1234567890',
  '1234567890123',
  'abcdefghijklmnop',
].join('-')

describe('redactSecretsForDisplay (densable tAt / #28/#29)', () => {
  test('#29: masks provider token directly followed by shell delimiter', () => {
    const cmd = `export TOKEN=${GITHUB_PAT}&& curl https://example.com`
    const out = redactSecretsForDisplay(cmd)
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain(GITHUB_PAT)
    expect(out).toContain('&& curl https://example.com')
  })

  test('#29: masks token before ; | & delimiters', () => {
    expect(redactSecretsForDisplay(`${SLACK_BOT}; echo hi`)).not.toContain(
      SLACK_BOT,
    )
    expect(redactSecretsForDisplay(`${SLACK_BOT}|cat`)).not.toContain(SLACK_BOT)
    expect(redactSecretsForDisplay(`${GITHUB_PAT}&true`)).not.toContain(
      GITHUB_PAT,
    )
  })

  test('#28: does not hide path-like captures via display redact', () => {
    // A path containing / should survive zhy even if somehow matched.
    const pathy = 'deploy /home/user/.ssh/id_rsa to server'
    expect(redactSecretsForDisplay(pathy)).toBe(pathy)
  })

  test('keeps surrounding command text while masking token', () => {
    const out = redactSecretsForDisplay(
      `curl -H "Authorization: ${GITHUB_PAT}" https://api.github.com`,
    )
    expect(out).toContain('curl -H')
    expect(out).toContain('https://api.github.com')
    expect(out).not.toContain(GITHUB_PAT)
  })
})

describe('redactSecrets (densable pp / Lhy #28)', () => {
  test('full-strength redacts oversized private-key PEM blocks', () => {
    const body = 'A'.repeat(80)
    const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
    const out = redactSecrets(`keep-before ${pem} keep-after`)
    expect(out).toBe('keep-before [REDACTED] keep-after')
    expect(out).not.toContain('BEGIN PRIVATE KEY')
  })

  test('scanForSecrets reports private-key via Lhy markers', () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${'B'.repeat(70)}\n-----END RSA PRIVATE KEY-----`
    const hits = scanForSecrets(pem)
    expect(hits.some(h => h.ruleId === 'private-key')).toBe(true)
  })
})

describe('truncateForPreview wires display redact', () => {
  test('channel preview masks token and keeps command shape', () => {
    const preview = truncateForPreview({
      command: `gh auth login --with-token <<< ${GITHUB_PAT}&& echo done`,
    })
    expect(preview).not.toContain(GITHUB_PAT)
    expect(preview).toContain('[REDACTED]')
    expect(preview).toContain('&& echo done')
  })

  test('deep walk redacts string fields with display redactor', () => {
    const out = redactSecretsDeep(
      { cmd: `echo ${GITHUB_PAT}` },
      redactSecretsForDisplay,
    ) as { cmd: string }
    expect(out.cmd).not.toContain(GITHUB_PAT)
    expect(out.cmd).toContain('echo')
  })
})
