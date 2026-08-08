/**
 * densable 2.1.218 multi-env Add-server command registration surface.
 */
import { describe, expect, test } from 'bun:test'
import remoteControlAddServer from '../index.js'

describe('densable 2.1.218 remote-control-add-server command', () => {
  test('registers local-jsx with densable multi-env aliases', () => {
    expect(remoteControlAddServer.type).toBe('local-jsx')
    expect(remoteControlAddServer.name).toBe('remote-control-add-server')
    expect(remoteControlAddServer.aliases).toContain('rc-add')
    expect(remoteControlAddServer.aliases).toContain('rcs-add')
    expect(remoteControlAddServer.immediate).toBe(true)
  })

  test('load() exports call that mounts dialog', async () => {
    const mod = await remoteControlAddServer.load()
    expect(typeof mod.call).toBe('function')
  })
})
