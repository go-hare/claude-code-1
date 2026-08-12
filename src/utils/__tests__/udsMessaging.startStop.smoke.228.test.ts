import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Smoke: with UDS_INBOX product default ON, start/stop messaging must not hang
 * and must export CLAUDE_CODE_MESSAGING_TOKEN (densable 228 #4 surface).
 */
describe('udsMessaging start/stop smoke (UDS default ON)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    try {
      const { stopUdsMessaging } = await import('../udsMessaging.js')
      await stopUdsMessaging()
    } catch {
      // already stopped
    }
    while (dirs.length) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  test('start then stop within 5s; token exported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uds-smoke-'))
    dirs.push(dir)
    const sock = join(dir, 'smoke.sock')

    const { startUdsMessaging, stopUdsMessaging } = await import(
      '../udsMessaging.js'
    )

    const started = Date.now()
    await startUdsMessaging(sock, { isExplicit: true })
    expect(Date.now() - started).toBeLessThan(5000)

    expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBe(sock)
    expect(typeof process.env.CLAUDE_CODE_MESSAGING_TOKEN).toBe('string')
    expect(
      (process.env.CLAUDE_CODE_MESSAGING_TOKEN ?? '').length,
    ).toBeGreaterThan(8)

    await stopUdsMessaging()
    expect(process.env.CLAUDE_CODE_MESSAGING_SOCKET).toBeUndefined()
    expect(process.env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined()
  })
})
