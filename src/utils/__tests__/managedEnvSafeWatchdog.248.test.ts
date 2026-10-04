/**
 * densable 2.1.248 #42 — LEh set @179035200 adds MCP_CONNECTION_NONBLOCKING
 * + BYTE/STREAM watchdog keys so they skip managed-settings approval.
 *
 * Gold: quoted CLAUDE_ENABLE_STREAM_WATCHDOG 1/0. API_TIMEOUT_MS /
 * CLAUDE_STREAM_IDLE_TIMEOUT_MS already leftover. No startup-mode literal.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isSafeManagedEnv, SAFE_ENV_VARS } from '../managedEnvConstants.js'

const LEH_248 = [
  'MCP_CONNECTION_NONBLOCKING',
  'CLAUDE_ENABLE_BYTE_WATCHDOG',
  'CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK',
  'CLAUDE_ENABLE_STREAM_WATCHDOG',
] as const

const LEFTOVER_TIMEOUTS = [
  'API_TIMEOUT_MS',
  'CLAUDE_STREAM_IDLE_TIMEOUT_MS',
] as const

const STARTUP_MODE_NEEDLES = [
  'startup-mode',
  'startup_mode',
  'MCP_STARTUP_MODE',
  'CLAUDE_CODE_MCP_STARTUP',
] as const

const lehSrc = readFileSync(
  join(import.meta.dir, '../managedEnvConstants.ts'),
  'utf8',
)

describe('densable 2.1.248 #42 managed-env LEh watchdog', () => {
  test('LEh 248 keys are always-safe (quoted STREAM 1/0)', () => {
    for (const key of LEH_248) {
      expect(SAFE_ENV_VARS.has(key)).toBe(true)
      expect(isSafeManagedEnv(key, '1')).toBe(true)
      expect(isSafeManagedEnv(key, '0')).toBe(true)
    }
  })

  test('leftover API_TIMEOUT_MS / CLAUDE_STREAM_IDLE_TIMEOUT_MS stay safe', () => {
    for (const key of LEFTOVER_TIMEOUTS) {
      expect(SAFE_ENV_VARS.has(key)).toBe(true)
      expect(isSafeManagedEnv(key, '5000')).toBe(true)
    }
  })

  test('does not invent MCP startup-mode', () => {
    for (const needle of STARTUP_MODE_NEEDLES) {
      expect(lehSrc).not.toContain(needle)
      expect(SAFE_ENV_VARS.has(needle.toUpperCase())).toBe(false)
    }
  })
})
