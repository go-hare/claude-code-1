import { afterEach, describe, expect, test } from 'bun:test'
import {
  connectToPipe,
  createPipeServer,
  type PipeServer,
} from '../pipeTransport.js'

/**
 * LAN TCP shared-secret handshake — go-hare security fix when LAN_PIPES
 * default ON. densable SEA has no separate pipe-auth product string; this
 * is a local hard requirement so open 0.0.0.0 listeners reject strangers.
 */

const servers: PipeServer[] = []

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop()
    if (s) await s.close()
  }
})

describe('pipeTransport TCP auth', () => {
  test('rejects TCP without authToken', async () => {
    const server = await createPipeServer(`tcp-auth-no-tok-${process.pid}`, {
      enableTcp: true,
      tcpPort: 0,
      authToken: 'fixed-test-token-aaaaaaaa',
    })
    servers.push(server)
    expect(server.tcpAddress).not.toBeNull()
    expect(server.authToken).toBe('fixed-test-token-aaaaaaaa')

    await expect(
      connectToPipe(
        server.name,
        'probe',
        2000,
        { host: '127.0.0.1', port: server.tcpAddress!.port },
        // no authToken
      ),
    ).rejects.toThrow(/authToken/)
  })

  test('rejects TCP with wrong authToken', async () => {
    const server = await createPipeServer(`tcp-auth-bad-${process.pid}`, {
      enableTcp: true,
      tcpPort: 0,
      authToken: 'correct-token-bbbbbbbb',
    })
    servers.push(server)

    await expect(
      connectToPipe(
        server.name,
        'probe',
        2000,
        { host: '127.0.0.1', port: server.tcpAddress!.port },
        'wrong-token',
      ),
    ).rejects.toThrow(/auth|reject|unauthor/i)
  })

  test('accepts TCP with correct authToken and pings', async () => {
    const token = 'good-token-cccccccccccccccc'
    const server = await createPipeServer(`tcp-auth-ok-${process.pid}`, {
      enableTcp: true,
      tcpPort: 0,
      authToken: token,
    })
    servers.push(server)

    // Echo pong from server handlers
    server.onMessage((msg, reply) => {
      if (msg.type === 'ping') {
        reply({ type: 'pong' })
      }
    })

    const client = await connectToPipe(
      server.name,
      'probe',
      3000,
      { host: '127.0.0.1', port: server.tcpAddress!.port },
      token,
    )

    const pong = await new Promise<boolean>(resolve => {
      const t = setTimeout(() => resolve(false), 2000)
      client.onMessage(msg => {
        if (msg.type === 'pong') {
          clearTimeout(t)
          resolve(true)
        }
      })
      client.send({ type: 'ping' })
    })
    client.disconnect()
    expect(pong).toBe(true)
  })

  test('UDS path still works without TCP auth', async () => {
    const server = await createPipeServer(`uds-only-${process.pid}`)
    servers.push(server)

    server.onMessage((msg, reply) => {
      if (msg.type === 'ping') reply({ type: 'pong' })
    })

    const client = await connectToPipe(server.name, 'local-probe', 3000)
    const pong = await new Promise<boolean>(resolve => {
      const t = setTimeout(() => resolve(false), 2000)
      client.onMessage(msg => {
        if (msg.type === 'pong') {
          clearTimeout(t)
          resolve(true)
        }
      })
      client.send({ type: 'ping' })
    })
    client.disconnect()
    expect(pong).toBe(true)
  })

  test('pre-auth TCP sockets are not in connectionCount / broadcast set', async () => {
    const net = await import('node:net')
    const token = 'pending-token-dddddddd'
    const server = await createPipeServer(`tcp-preauth-${process.pid}`, {
      enableTcp: true,
      tcpPort: 0,
      authToken: token,
    })
    servers.push(server)

    const baseline = server.connectionCount

    // Raw TCP connect without auth — must not join trusted clients set
    const raw = net.createConnection({
      host: '127.0.0.1',
      port: server.tcpAddress!.port,
    })
    await new Promise<void>((resolve, reject) => {
      raw.once('connect', () => resolve())
      raw.once('error', reject)
    })
    // give framer a tick
    await Bun.sleep(50)
    expect(server.connectionCount).toBe(baseline)

    // Broadcast must not deliver to pre-auth socket
    let gotBroadcast = false
    raw.on('data', () => {
      gotBroadcast = true
    })
    server.broadcast({ type: 'ping', data: 'should-not-reach-pending' })
    await Bun.sleep(50)
    expect(gotBroadcast).toBe(false)

    raw.destroy()
  })

  test('onMessage third arg is the source socket (attach relay)', async () => {
    const server = await createPipeServer(`attach-src-${process.pid}`)
    servers.push(server)

    let seenSocket: unknown
    server.onMessage((msg, _reply, socket) => {
      if (msg.type === 'ping') {
        seenSocket = socket
        _reply({ type: 'pong' })
      }
    })

    const client = await connectToPipe(server.name, 'src-probe', 3000)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 2000)
      client.onMessage(msg => {
        if (msg.type === 'pong') {
          clearTimeout(t)
          resolve()
        }
      })
      client.send({ type: 'ping' })
    })
    client.disconnect()
    expect(seenSocket).toBeDefined()
    expect(typeof (seenSocket as { write?: unknown }).write).toBe('function')
  })

  test('pipeAuthTokensEqual is length-safe', async () => {
    const { pipeAuthTokensEqual } = await import('../pipeTransport.js')
    expect(pipeAuthTokensEqual('abc', 'abc')).toBe(true)
    expect(pipeAuthTokensEqual('abc', 'abd')).toBe(false)
    expect(pipeAuthTokensEqual('abc', 'ab')).toBe(false)
    expect(pipeAuthTokensEqual('', '')).toBe(true)
  })
})
