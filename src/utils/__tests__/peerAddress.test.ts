import { describe, test, expect } from 'bun:test'
import { parseAddress, parseTcpTarget } from '../peerAddress.js'

describe('parseAddress', () => {
  test('uds: scheme', () => {
    expect(parseAddress('uds:/tmp/test.sock')).toEqual({
      scheme: 'uds',
      target: '/tmp/test.sock',
    })
  })

  test('bridge: scheme', () => {
    expect(parseAddress('bridge:session-123')).toEqual({
      scheme: 'bridge',
      target: 'session-123',
    })
  })

  test('tcp: scheme', () => {
    expect(parseAddress('tcp:192.168.1.20:7100')).toEqual({
      scheme: 'tcp',
      target: '192.168.1.20:7100',
    })
  })

  test('bare .sock path routes to uds (densable iYb)', () => {
    expect(parseAddress('/var/run/test.sock')).toEqual({
      scheme: 'uds',
      target: '/var/run/test.sock',
    })
  })

  test('slash title is other, not uds (densable 2.1.239 xD / #40)', () => {
    expect(parseAddress('/fix-login')).toEqual({
      scheme: 'other',
      target: '/fix-login',
    })
    expect(parseAddress('/slash-title')).toEqual({
      scheme: 'other',
      target: '/slash-title',
    })
  })

  test('windows named pipe is uds (densable sYb)', () => {
    expect(parseAddress('\\\\.\\pipe\\claude-code-demo')).toEqual({
      scheme: 'uds',
      target: '\\\\.\\pipe\\claude-code-demo',
    })
    expect(parseAddress('//./pipe/claude-code-demo')).toEqual({
      scheme: 'uds',
      target: '//./pipe/claude-code-demo',
    })
  })

  test('other falls through', () => {
    expect(parseAddress('teammate-name')).toEqual({
      scheme: 'other',
      target: 'teammate-name',
    })
  })
})

describe('parseTcpTarget', () => {
  test('valid host:port', () => {
    expect(parseTcpTarget('192.168.1.20:7100')).toEqual({
      host: '192.168.1.20',
      port: 7100,
    })
  })

  test('hostname:port', () => {
    expect(parseTcpTarget('my-host:8080')).toEqual({
      host: 'my-host',
      port: 8080,
    })
  })

  test('invalid format returns null', () => {
    expect(parseTcpTarget('no-port')).toBeNull()
    expect(parseTcpTarget('')).toBeNull()
  })
})
