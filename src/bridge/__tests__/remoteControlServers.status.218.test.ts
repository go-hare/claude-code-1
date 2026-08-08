/**
 * densable $Lf / zb helpers for multi-env RC manage.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

// Prefer real test GlobalConfig path (same as remoteControlServers.218.test).
// Do NOT incomplete-mock config.ts (process-global pollution).
import { saveGlobalConfig, type GlobalConfig } from '../../utils/config.js'
import {
  addRemoteControlServer,
  backgroundServiceLabel,
  listRemoteControlServersWithStatus,
  removeRemoteControlServer,
} from '../remoteControlServers.js'

function clearRemoteControl(): void {
  saveGlobalConfig(current => {
    return { ...current, remoteControl: [] } as GlobalConfig
  })
}

afterEach(() => {
  clearRemoteControl()
})

describe('listRemoteControlServersWithStatus densable $Lf', () => {
  test('maps name/spawnMode defaults + isRunning boolean', async () => {
    clearRemoteControl()
    addRemoteControlServer({ dir: '/proj/a' })
    const rows = await listRemoteControlServersWithStatus()
    expect(rows.length).toBe(1)
    expect(rows[0]!.dir).toBe('/proj/a')
    expect(rows[0]!.name).toBe('a')
    expect(rows[0]!.spawnMode).toBe('same-dir')
    expect(typeof rows[0]!.isRunning).toBe('boolean')
  })

  test('remove then empty', async () => {
    clearRemoteControl()
    addRemoteControlServer({ dir: '/p', name: 'P', spawnMode: 'worktree' })
    expect(removeRemoteControlServer('/p')).toBe(true)
    expect(await listRemoteControlServersWithStatus()).toEqual([])
  })
})

describe('backgroundServiceLabel densable zb', () => {
  test('returns densable zb vocabulary', () => {
    // densable: xit()? "daemon" : "background service"
    // test runtime usually has feature('DAEMON')=false → background service
    expect(['daemon', 'background service']).toContain(backgroundServiceLabel())
  })
})
