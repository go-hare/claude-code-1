import { describe, expect, test } from 'bun:test'
import {
  remoteUnavailableNotificationText,
  resolveRemoteSlashDispatch,
} from '../remoteSlashDispatch.js'

describe('resolveRemoteSlashDispatch densable evs', () => {
  test('prompt always post-text', () => {
    expect(
      resolveRemoteSlashDispatch({
        type: 'prompt',
        thinClientDispatch: 'local-then-rpc',
      }),
    ).toBe('post-text')
  })

  test('undefined dispatch: local-jsx local, else post-text', () => {
    expect(resolveRemoteSlashDispatch({ type: 'local-jsx' })).toBe('local')
    expect(resolveRemoteSlashDispatch({ type: 'local' })).toBe('post-text')
  })

  test('local-then-rpc needs rpcOk for local commands', () => {
    expect(
      resolveRemoteSlashDispatch({
        type: 'local',
        thinClientDispatch: 'local-then-rpc',
        rpcOk: false,
      }),
    ).toBe('unavailable')
    expect(
      resolveRemoteSlashDispatch({
        type: 'local',
        thinClientDispatch: 'local-then-rpc',
        rpcOk: true,
      }),
    ).toBe('local')
  })

  test('post-text / twin', () => {
    expect(
      resolveRemoteSlashDispatch({
        type: 'local-jsx',
        thinClientDispatch: 'post-text',
      }),
    ).toBe('post-text')
    expect(
      resolveRemoteSlashDispatch({
        type: 'local',
        thinClientDispatch: 'twin',
      }),
    ).toBe('post-text')
  })

  test('notification copy densable', () => {
    expect(remoteUnavailableNotificationText('config', true)).toContain(
      'read-only',
    )
    expect(remoteUnavailableNotificationText('config', false)).toContain(
      'cloud sessions',
    )
  })
})
