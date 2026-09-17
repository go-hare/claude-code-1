/**
 * Reconnect inert needs-auth / failed must detach the live memo.
 * Identity-move already does; discoveryAuthFailure + catch used to skip.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('reconnect inert detach live memo', () => {
  test('discoveryAuthFailure and catch detach before returning inert', () => {
    const src = readFileSync(join(import.meta.dir, '../client.ts'), 'utf8')
    const discovery = src.indexOf('if (client.discoveryAuthFailure)')
    const discoveryReturn = src.indexOf(
      "type: 'needs-auth' as const",
      discovery,
    )
    const discoveryDetach = src.indexOf(
      'await detachAndCloseConnection(client)',
      discovery,
    )
    expect(discovery).toBeGreaterThan(-1)
    expect(discoveryDetach).toBeGreaterThan(discovery)
    expect(discoveryDetach).toBeLessThan(discoveryReturn)

    const catchIdx = src.indexOf('Error during reconnection:')
    const catchDetach = src.indexOf(
      'await detachAndCloseConnection(live)',
      catchIdx,
    )
    const catchFailed = src.indexOf("type: 'failed' as const", catchIdx)
    expect(catchIdx).toBeGreaterThan(-1)
    expect(catchDetach).toBeGreaterThan(catchIdx)
    expect(catchDetach).toBeLessThan(catchFailed)

    // peekSettled === connected stays the apply gate (do not rewrite ZA).
    const headless = readFileSync(
      join(import.meta.dir, '../headlessMcpReconnect.ts'),
      'utf8',
    )
    expect(headless).toContain(
      '(await module.peekSettledConnection(name, config)) === connected',
    )
  })
})
