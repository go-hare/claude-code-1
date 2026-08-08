/**
 * densable 2.1.218 multi-env Remote Control server list (OWs / qpn / jpn).
 *
 * In NODE_ENV=test, getGlobalConfig/saveGlobalConfig use the in-memory
 * TEST_GLOBAL_CONFIG_FOR_TESTING object — reset remoteControl each test.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
} from '../../utils/config.js'

function clearRemoteControl(): void {
  saveGlobalConfig(current => {
    if (!('remoteControl' in current) || current.remoteControl === undefined) {
      return current
    }
    // Object.assign test path cannot delete keys — set empty array.
    return { ...current, remoteControl: [] } as GlobalConfig
  })
}

beforeEach(() => {
  clearRemoteControl()
})

afterEach(() => {
  clearRemoteControl()
})

describe('densable 2.1.218 OWs/qpn/jpn remoteControlServers', () => {
  test('normalizeRemoteControlList accepts array and single object', async () => {
    const { normalizeRemoteControlList } = await import(
      '../remoteControlServers.js'
    )
    expect(normalizeRemoteControlList(undefined)).toEqual([])
    expect(normalizeRemoteControlList(null)).toEqual([])
    expect(normalizeRemoteControlList({ dir: '/a' })).toEqual([{ dir: '/a' }])
    expect(
      normalizeRemoteControlList([
        { dir: '/a' },
        { name: 'no-dir' },
        { dir: '/b' },
      ]),
    ).toEqual([{ dir: '/a' }, { dir: '/b' }])
  })

  test('addRemoteControlServer upserts by dir (qpn)', async () => {
    const {
      addRemoteControlServer,
      listRemoteControlServers,
      removeRemoteControlServer,
    } = await import('../remoteControlServers.js')

    expect(listRemoteControlServers()).toEqual([])
    expect(
      addRemoteControlServer({
        dir: '/proj/a',
        name: 'A',
        spawnMode: 'same-dir',
      }),
    ).toBe('added')
    expect(listRemoteControlServers()).toEqual([
      { dir: '/proj/a', name: 'A', spawnMode: 'same-dir' },
    ])
    // sanity: persisted on GlobalConfig.remoteControl
    expect(
      (getGlobalConfig() as GlobalConfig & { remoteControl?: unknown })
        .remoteControl,
    ).toEqual([{ dir: '/proj/a', name: 'A', spawnMode: 'same-dir' }])

    expect(
      addRemoteControlServer({
        dir: '/proj/a',
        name: 'A-renamed',
        spawnMode: 'worktree',
      }),
    ).toBe('updated')
    expect(listRemoteControlServers()).toEqual([
      { dir: '/proj/a', name: 'A-renamed', spawnMode: 'worktree' },
    ])

    expect(
      addRemoteControlServer({
        dir: '/proj/b',
        spawnMode: 'same-dir',
      }),
    ).toBe('added')
    const list = listRemoteControlServers()
    expect(list).toHaveLength(2)
    expect(list.find(s => s.dir === '/proj/b')?.name).toBe('b')

    expect(removeRemoteControlServer('/proj/a')).toBe(true)
    expect(removeRemoteControlServer('/proj/a')).toBe(false)
    expect(listRemoteControlServers().map(s => s.dir)).toEqual(['/proj/b'])
    expect(removeRemoteControlServer('/proj/b')).toBe(true)
    expect(listRemoteControlServers()).toEqual([])
  })
})
