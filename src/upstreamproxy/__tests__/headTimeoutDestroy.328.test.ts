import { afterEach, describe, expect, test } from 'bun:test'
import { createConnection } from 'node:net'
import {
  getActiveDestroyTimerCountForTests,
  getUpstreamProxyRelayStats,
  resetUpstreamProxyRelayStatsForTests,
  startNodeRelay,
  type UpstreamProxyRelay,
} from '../relay.js'

let activeRelay: UpstreamProxyRelay | undefined

afterEach(() => {
  activeRelay?.stop()
  activeRelay = undefined
  resetUpstreamProxyRelayStatsForTests()
})

describe('Round 3 Fix 4: BH3-P1-10 Head-Timeout Sweeper Hard Destroy & Slot Release', () => {
  test('releases connection slot and destroys half-open slowloris socket after 408', async () => {
    resetUpstreamProxyRelayStatsForTests()
    activeRelay = await startNodeRelay(
      'ws://127.0.0.1:1/unused',
      'Basic dGVzdDp0ZXN0',
      'Bearer test',
      1, // maxClientConnections = 1 so any slot leak immediately causes 503
      50, // requestHeadTimeoutMs = 50ms
    )

    // Open a half-open stalled client that NEVER sends data and NEVER sends TCP FIN
    const stalled = createConnection(
      { host: '127.0.0.1', port: activeRelay.port, allowHalfOpen: true },
      () => {},
    )
    stalled.on('error', () => {
      // Expected if server hard-destroys socket while client probes
    })
    let responseText = ''
    stalled.on('data', chunk => {
      responseText += chunk.toString('utf8')
    })

    const halfClosedByServer = new Promise<void>(resolve => {
      stalled.once('end', () => resolve())
    })

    try {
      // Wait for server 408 response + FIN (2 buckets * 50ms)
      await Promise.race([
        halfClosedByServer,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('stalled socket never received 408 FIN')),
            2000,
          ),
        ),
      ])

      // Even while stalled client keeps its half-open write side open (no TCP FIN
      // sent back), the server MUST have released the connection slot immediately
      // and scheduled hard destroy.
      expect(responseText).toContain('408 Request Timeout')
      expect(
        getUpstreamProxyRelayStats().requestHeadTimeouts,
      ).toBeGreaterThanOrEqual(1)
      expect(getUpstreamProxyRelayStats().clientConnections).toBe(0)

      // Wait past HEAD_TIMEOUT_DESTROY_GRACE_MS (250ms) so server destroys its FD
      await new Promise(r => setTimeout(r, 320))

      // Verify slot is NOT leaked: a new connection is accepted (NOT refused with 503)
      const nextClient = createConnection({
        host: '127.0.0.1',
        port: activeRelay.port,
      })
      try {
        await new Promise<void>(resolve => nextClient.once('connect', resolve))
        let nextResp = ''
        nextClient.on('data', c => {
          nextResp += c.toString('utf8')
        })
        await new Promise(r => setTimeout(r, 30))
        expect(nextResp).not.toContain('503')
        expect(getUpstreamProxyRelayStats().clientConnectionsRefused).toBe(0)
      } finally {
        nextClient.destroy()
      }
    } finally {
      stalled.destroy()
    }
  })

  test('E-P2-5: cancels and deletes destroyTimer from destroyTimers Set when 408 or 503 client closes cleanly', async () => {
    resetUpstreamProxyRelayStatsForTests()
    activeRelay = await startNodeRelay(
      'ws://127.0.0.1:1/unused',
      'Basic dGVzdDp0ZXN0',
      'Bearer test',
      1, // maxClientConnections = 1
      50, // requestHeadTimeoutMs = 50ms
    )

    // 1. 408 early clean close: client reads 408 and closes immediately (well before 250ms grace)
    const c408 = createConnection({
      host: '127.0.0.1',
      port: activeRelay.port,
    })
    c408.on('error', () => {})
    let resp408 = ''
    c408.on('data', chunk => {
      resp408 += chunk.toString('utf8')
    })
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('408 client never closed')),
        2000,
      )
      c408.once('close', () => {
        clearTimeout(t)
        resolve()
      })
    })
    // Allow server's 'close' handler to process cleanly
    await new Promise(r => setTimeout(r, 20))
    expect(resp408).toContain('408 Request Timeout')
    expect(getActiveDestroyTimerCountForTests()).toBe(0)

    // 2. 503 early clean close: hold slot 1, open slot 2 which gets 503 and closes cleanly
    const holder = createConnection({
      host: '127.0.0.1',
      port: activeRelay.port,
    })
    holder.on('error', () => {})
    await new Promise<void>(resolve => holder.once('connect', resolve))
    // Give server a tick to accept holder
    await new Promise(r => setTimeout(r, 15))

    const c503 = createConnection({
      host: '127.0.0.1',
      port: activeRelay.port,
    })
    c503.on('error', () => {})
    let resp503 = ''
    c503.on('data', chunk => {
      resp503 += chunk.toString('utf8')
    })
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('503 client never closed')),
        2000,
      )
      c503.once('close', () => {
        clearTimeout(t)
        resolve()
      })
    })
    await new Promise(r => setTimeout(r, 20))
    expect(resp503).toContain('503 Service Unavailable')
    expect(getActiveDestroyTimerCountForTests()).toBe(0)

    holder.destroy()
  })
})
