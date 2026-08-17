import { describe, expect, test } from 'bun:test'
import {
  classifyBridgeHttpStatus,
  extractBridge403Resource,
  isNonTerminalBridgeFailure,
  isRemoteCredentials,
  isTerminalBridgeFailure,
  type BridgeCredentialResult,
  type RemoteCredentials,
} from '../codeSessionApi.js'
import {
  CLASSIFIED_CLOSE_REASON_CODES,
  closeCodeForClassifiedReason,
  formatCloseCause,
  isEpochStaleRecoverableClose,
} from '../remintRecovery.js'

/**
 * densable 2.1.232 #39 residual — Hde/mdt credential shapes + gzp close causes.
 */
describe('bridge credential result densable Hde/mdt', () => {
  const ok: RemoteCredentials = {
    worker_jwt: 'jwt',
    api_base_url: 'https://api.example',
    expires_in: 3600,
    worker_epoch: 1,
  }

  test('isRemoteCredentials / Hde / mdt guards', () => {
    expect(isRemoteCredentials(ok)).toBe(true)
    expect(isRemoteCredentials(null)).toBe(false)
    const hde: BridgeCredentialResult = {
      terminal: false,
      reason: 'oauth_rejected',
    }
    expect(isNonTerminalBridgeFailure(hde)).toBe(true)
    expect(isTerminalBridgeFailure(hde)).toBe(false)
    expect(isRemoteCredentials(hde)).toBe(false)
    const mdt: BridgeCredentialResult = {
      terminal: true,
      reason: 'malformed_response',
      status: 200,
    }
    expect(isTerminalBridgeFailure(mdt)).toBe(true)
    expect(isNonTerminalBridgeFailure(mdt)).toBe(false)
  })

  test('A$p HTTP status classifier', () => {
    expect(classifyBridgeHttpStatus(401)).toBe('oauth_rejected')
    expect(classifyBridgeHttpStatus(408)).toBe('transient')
    expect(classifyBridgeHttpStatus(429)).toBe('transient')
    expect(classifyBridgeHttpStatus(503)).toBe('transient')
    expect(classifyBridgeHttpStatus(403)).toBe('rejected')
    expect(classifyBridgeHttpStatus(400)).toBe('rejected')
  })

  test('fDe 403 resource extract', () => {
    expect(
      extractBridge403Resource({
        error: { resource: 'untrusted_device' },
      }),
    ).toBe('untrusted_device')
    expect(
      extractBridge403Resource({
        error: { resource: 'session_stale_relogin' },
      }),
    ).toBe('session_stale_relogin')
    expect(extractBridge403Resource({}, 'need trusted device token')).toBe(
      'untrusted_device',
    )
    expect(extractBridge403Resource({})).toBeUndefined()
  })
})

describe('classified close codes densable gzp', () => {
  test('gzp table 1:1', () => {
    expect(CLASSIFIED_CLOSE_REASON_CODES.epoch_conflict).toBe(4090)
    expect(CLASSIFIED_CLOSE_REASON_CODES.epoch_stale).toBe(4090)
    expect(CLASSIFIED_CLOSE_REASON_CODES.token_expired).toBe(4094)
    expect(CLASSIFIED_CLOSE_REASON_CODES.auth_exhausted).toBe(4094)
  })

  test('closeCodeForClassifiedReason', () => {
    expect(closeCodeForClassifiedReason('token_expired')).toBe(4094)
    expect(closeCodeForClassifiedReason('epoch_conflict')).toBe(4090)
    expect(
      closeCodeForClassifiedReason('token_expired', {
        causeTypedCloseCodes: false,
      }),
    ).toBe(4090)
    expect(closeCodeForClassifiedReason('unknown_reason')).toBe(4090)
  })

  test('Co close_cause telemetry', () => {
    expect(formatCloseCause(undefined)).toBe('')
    expect(formatCloseCause('epoch_conflict')).toBe('epoch_conflict')
  })

  test('epoch_conflict is NOT recoverable (densable Jr==="epoch_stale" only)', () => {
    expect(isEpochStaleRecoverableClose(4090, 'epoch_stale', true)).toBe(true)
    expect(isEpochStaleRecoverableClose(4090, 'epoch_conflict', true)).toBe(
      false,
    )
    expect(isEpochStaleRecoverableClose(4090, 'epoch_stale', false)).toBe(false)
    expect(
      isEpochStaleRecoverableClose(4090, 'superseded_by_worker', true),
    ).toBe(false)
  })
})
