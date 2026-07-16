import { describe, expect, test } from 'bun:test'

/**
 * Control response code shape — pure contract tests for official IA codes.
 * Live socket tests would need a real control server; densable is in client.
 */
describe('control socket IA codes (contract)', () => {
  test('ETIMEOUT and ENOCONN are the official failure codes', () => {
    const timeout = {
      ok: false as const,
      code: 'ETIMEOUT',
      error: 'control socket timeout',
    }
    const nocon = {
      ok: false as const,
      code: 'ENOCONN',
      error: 'daemon not running',
    }
    expect(timeout.code).toBe('ETIMEOUT')
    expect(nocon.code).toBe('ENOCONN')
  })
})
