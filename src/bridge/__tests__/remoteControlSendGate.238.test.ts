/**
 * densable 2.1.238 #27 — Aom / Rom Remote Control send gate.
 * Do not mock bootstrap/replBridgeHandle (process-global mock.module).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  formatRemoteControlSendBlock,
  getRemoteControlSendBlockReason,
  NO_CONTAINER_ADDRESS_MESSAGE,
  RC_DISCONNECTED_MESSAGE,
} from '../remoteControlSendGate.js'

describe('remoteControlSendGate densable 2.1.238 Aom/Rom', () => {
  const prevRemote = process.env.CLAUDE_CODE_REMOTE
  const prevSid = process.env.CLAUDE_CODE_REMOTE_SESSION_ID

  afterEach(() => {
    if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
    else process.env.CLAUDE_CODE_REMOTE = prevRemote
    if (prevSid === undefined) delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    else process.env.CLAUDE_CODE_REMOTE_SESSION_ID = prevSid
  })

  test('Rom copy is SEA-exact', () => {
    expect(formatRemoteControlSendBlock('rc-disconnected')).toBe(
      RC_DISCONNECTED_MESSAGE,
    )
    expect(RC_DISCONNECTED_MESSAGE).toBe('Remote Control is not connected')
    expect(formatRemoteControlSendBlock('no-container-address')).toBe(
      NO_CONTAINER_ADDRESS_MESSAGE,
    )
  })

  test('local non-RC without live handle is rc-disconnected', () => {
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    expect(getRemoteControlSendBlockReason()).toBe('rc-disconnected')
  })

  test('CLAUDE_CODE_REMOTE with session id is allowed (not false-positive)', () => {
    process.env.CLAUDE_CODE_REMOTE = 'true'
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'cse_remote_1'
    expect(getRemoteControlSendBlockReason()).toBeUndefined()
  })

  test('CLAUDE_CODE_REMOTE without session id is no-container-address', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
    expect(getRemoteControlSendBlockReason()).toBe('no-container-address')
  })

  test('TMn: garbage sid is no-container-address (no live-handle fallback)', () => {
    process.env.CLAUDE_CODE_REMOTE = 'true'
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'garbage'
    expect(getRemoteControlSendBlockReason()).toBe('no-container-address')
  })

  test('TMn: empty suffix after prefix is no-container-address', () => {
    process.env.CLAUDE_CODE_REMOTE = 'true'
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'session_'
    expect(getRemoteControlSendBlockReason()).toBe('no-container-address')
  })
})
