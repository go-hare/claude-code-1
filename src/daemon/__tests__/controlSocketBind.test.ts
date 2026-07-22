import { describe, expect, test } from 'bun:test'
import { CONTROL_SOCKET_BIND_RETRY_MS } from '../controlSocket.js'

/**
 * densable aAp control bind — structural + constant parity.
 * Live dual-bind tests need OS-specific AF_UNIX/named-pipe isolation.
 */
describe('startControlSocket densable aAp bind', () => {
  test('GZs bind retry budget is 10s', () => {
    expect(CONTROL_SOCKET_BIND_RETRY_MS).toBe(10_000)
  })

  test('source: EADDRINUSE retry loop + unix live probe product', async () => {
    const src = await Bun.file(
      new URL('../controlSocket.ts', import.meta.url).pathname,
    ).text()
    expect(src).toContain('CONTROL_SOCKET_BIND_RETRY_MS = 10_000')
    expect(src).toMatch(/code !== 'EADDRINUSE'/)
    expect(src).toMatch(/setTimeout\(r,\s*100\)/)
    // densable aAp: windows has no unlink; local keeps platform gate
    expect(src).toMatch(/process\.platform !== 'win32'/)
    // Product fortify (not densable): refuse if peer still connects
    expect(src).toContain('probeControlSocketLive')
    // densable does NOT probe on windows — we also skip probe on win32
    expect(src).toMatch(
      /if \(process\.platform !== 'win32'\) \{[\s\S]*?probeControlSocketLive/,
    )
  })
})
