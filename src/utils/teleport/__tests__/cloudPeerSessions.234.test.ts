import { describe, expect, test } from 'bun:test'
import {
  CLOUD_PEER_UNREACHABLE_FROM_HERE,
  mapD5vCloudPeerSessions,
} from '../cloudPeerSessions.js'
import type { CcrSessionListRow } from '../walkCcrSessionList.js'

const rows: CcrSessionListRow[] = [
  {
    id: 'session_self',
    title: 'me',
    environment_kind: 'cloud',
    worker_status: 'idle',
  },
  {
    id: 'session_bridge',
    title: 'rc',
    environment_kind: 'bridge',
    worker_status: 'running',
  },
  {
    id: 'session_other',
    title: 'peer',
    environment_kind: 'cloud',
    worker_status: 'idle',
  },
]

describe('mapD5vCloudPeerSessions densable D5v', () => {
  test('filters self session id and marks unreachable bridge rows', () => {
    const sessions = mapD5vCloudPeerSessions(rows, {
      selfSessionId: 'self',
      unreachableFromHere: true,
    })
    expect(sessions.map(s => s.id)).toEqual(['session_bridge', 'session_other'])
    const bridge = sessions.find(s => s.id === 'session_bridge')
    expect(bridge?.remoteControl).toBe(true)
    expect(bridge?.unreachableFromHere).toBe(true)
    const other = sessions.find(s => s.id === 'session_other')
    expect(other?.unreachableFromHere).toBeUndefined()
    expect(CLOUD_PEER_UNREACHABLE_FROM_HERE).toBe(
      'not reachable from this cloud session',
    )
  })

  test('keeps self when selfSessionId is empty', () => {
    const sessions = mapD5vCloudPeerSessions(rows, {
      selfSessionId: '',
      unreachableFromHere: false,
    })
    expect(sessions.map(s => s.id)).toContain('session_self')
    expect(sessions.every(s => s.unreachableFromHere !== true)).toBe(true)
  })
})
