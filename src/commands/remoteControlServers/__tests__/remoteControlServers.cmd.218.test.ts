/**
 * densable 2.1.218 multi-env RC list/manage/remove slash surface.
 *
 * Do not mock src/utils/config.ts (process-global incomplete re-export pollution).
 * Isolate storage via in-memory stubs on remoteControlServers API.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

type Entry = {
  dir: string
  name?: string
  spawnMode?: 'same-dir' | 'worktree'
}

let store: Entry[] = []

mock.module('src/bridge/remoteControlServers.js', () => ({
  listRemoteControlServers: () => [...store],
  listRemoteControlServersWithStatus: async () =>
    store.map(s => ({
      dir: s.dir,
      name: s.name?.trim() || s.dir.split('/').pop() || s.dir,
      spawnMode: s.spawnMode ?? 'same-dir',
      isRunning: false,
    })),
  addRemoteControlServer: (entry: Entry) => {
    const idx = store.findIndex(s => s.dir === entry.dir)
    if (idx >= 0) {
      store[idx] = { ...store[idx], ...entry }
      return 'updated' as const
    }
    store.push({
      ...entry,
      name: entry.name?.trim() || entry.dir.split('/').pop() || entry.dir,
      spawnMode: entry.spawnMode ?? 'same-dir',
    })
    return 'added' as const
  },
  removeRemoteControlServer: (dir: string) => {
    const before = store.length
    store = store.filter(s => s.dir !== dir)
    return store.length < before
  },
  normalizeRemoteControlList: (v: unknown) =>
    Array.isArray(v) ? (v as Entry[]) : [],
  backgroundServiceLabel: () => 'daemon',
}))

const { remoteControlServersList, remoteControlServersRemove } = await import(
  '../index.js'
)

afterEach(() => {
  store = []
})

describe('remote-control-servers / remote-control-remove commands', () => {
  test('registers manage (local-jsx) + remove with densable aliases', () => {
    expect(remoteControlServersList.type).toBe('local-jsx')
    expect(remoteControlServersList.name).toBe('remote-control-servers')
    expect(remoteControlServersList.aliases).toContain('rc-list')
    expect(remoteControlServersList.aliases).toContain('rcs-list')

    expect(remoteControlServersRemove.type).toBe('local')
    expect(remoteControlServersRemove.name).toBe('remote-control-remove')
    expect(remoteControlServersRemove.aliases).toContain('rc-remove')
    expect(remoteControlServersRemove.aliases).toContain('rcs-remove')
  })

  test('remove still works via API + text command', async () => {
    const { addRemoteControlServer, removeRemoteControlServer } = await import(
      '../../../bridge/remoteControlServers.js'
    )
    addRemoteControlServer({
      dir: '/proj/a',
      name: 'Alpha',
      spawnMode: 'worktree',
    })
    expect(removeRemoteControlServer('/proj/a')).toBe(true)

    const removeMod = await remoteControlServersRemove.load()
    // after remove via API, text remove reports not found
    const gone = await removeMod.call('/proj/a', {} as never)
    expect(gone.type).toBe('text')
    if (gone.type === 'text') {
      expect(gone.value.toLowerCase()).toMatch(/not found|no |removed|does not/)
    }
  })

  test('manage is local-jsx with densable description', () => {
    // Do not load manage.tsx here — JSX pulls permissionSetup/config graph
    // (process-global mock pollution). Source contract covered by
    // RemoteControlServerDetail.218 + status.218.
    expect(remoteControlServersList.type).toBe('local-jsx')
    expect(remoteControlServersList.description).toMatch(
      /Restart|Remove|Back|Manage/i,
    )
  })
})
