/**
 * densable 2.1.251 #67 — Tn/Cn + zNe for ANTHROPIC_CUSTOM_HEADERS.
 * Rn header-name token, $Kt value reject, Cn sensitive-name, bare CR.
 */
import { describe, expect, test } from 'bun:test'
import {
  extractDangerousSettings,
  hasDangerousSettings,
} from '../../components/ManagedSettingsSecurityDialog/utils.js'
import type { SettingsJson } from '../settings/types.js'
import {
  customHeadersRequireApproval,
  HEADER_NAME_TOKEN_RE,
  inspectCustomHeaderValue,
  isSafeManagedEnv,
  SAFE_ENV_VARS,
} from '../managedEnvConstants.js'

describe('densable 2.1.251 #67 custom header approval', () => {
  test('ANTHROPIC_CUSTOM_HEADERS is not always-safe', () => {
    expect(SAFE_ENV_VARS.has('ANTHROPIC_CUSTOM_HEADERS')).toBe(false)
  })

  test('Cn names require approval; a benign name does not', () => {
    for (const block of [
      'Authorization: Bearer x',
      'X-Api-Key: abc',
      'X-Token: t',
      'Host: example.test',
      'X-Url: https://example.test',
      'X-Proxy: 1',
      'X-Route: a',
      'anthropic-beta: b',
      'anthropic-version: 1',
    ]) {
      expect(customHeadersRequireApproval(block)).toBe(true)
      expect(isSafeManagedEnv('ANTHROPIC_CUSTOM_HEADERS', block)).toBe(false)
    }
    const benign = 'X-Request-Id: abc'
    expect(customHeadersRequireApproval(benign)).toBe(false)
    expect(isSafeManagedEnv('ANTHROPIC_CUSTOM_HEADERS', benign)).toBe(true)
  })

  test('Rn rejects a name that is not a header token', () => {
    expect(HEADER_NAME_TOKEN_RE.test('X-Request-Id')).toBe(true)
    expect(HEADER_NAME_TOKEN_RE.test('X Request-Id')).toBe(false)
    expect(customHeadersRequireApproval('X Request-Id: abc')).toBe(true)
    expect(
      isSafeManagedEnv('ANTHROPIC_CUSTOM_HEADERS', 'X Request-Id: abc'),
    ).toBe(false)
  })

  test('$Kt rejects line break, NUL, and non-ASCII values', () => {
    expect(inspectCustomHeaderValue('abc')).toBeNull()
    expect(inspectCustomHeaderValue('  abc  ')).toBeNull()
    expect(inspectCustomHeaderValue('abc\ndef')).toEqual({
      kind: 'line_break',
      index: 3,
    })
    expect(inspectCustomHeaderValue('abc\0def')).toEqual({
      kind: 'nul',
      index: 3,
    })
    expect(inspectCustomHeaderValue('abc€')).toEqual({
      kind: 'non_ascii',
      index: 3,
      codePoint: '€'.codePointAt(0)!,
    })
    expect(customHeadersRequireApproval('X-Request-Id: abc\0def')).toBe(true)
    expect(customHeadersRequireApproval('X-Request-Id: abc€')).toBe(true)
  })

  test('bare CR is sensitive; a line without a colon is not', () => {
    expect(customHeadersRequireApproval('X-Request-Id: abc\r')).toBe(true)
    expect(customHeadersRequireApproval('not a header')).toBe(false)
    expect(
      customHeadersRequireApproval('X-Request-Id: abc\r\nX-Trace: 1'),
    ).toBe(false)
  })

  test('managed settings project the sensitive block into envVars', () => {
    const sensitive = extractDangerousSettings({
      env: { ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer x' },
    } as SettingsJson)
    expect(hasDangerousSettings(sensitive)).toBe(true)
    expect(sensitive.envVars.ANTHROPIC_CUSTOM_HEADERS).toContain(
      'Authorization',
    )

    const safe = extractDangerousSettings({
      env: { ANTHROPIC_CUSTOM_HEADERS: 'X-Request-Id: abc' },
    } as SettingsJson)
    expect(hasDangerousSettings(safe)).toBe(false)
    expect(safe.envVars.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  })
})
