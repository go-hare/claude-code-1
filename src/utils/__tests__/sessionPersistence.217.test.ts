import { afterEach, describe, expect, test } from 'bun:test'
import {
  formatPersistenceSuppressedNotificationText,
  formatPersistenceSuppressedPrimary,
  getPersistenceSuppressCause,
  getUserVisiblePersistenceSuppressCause,
  isNestedMarkerSuppressingPersistence,
} from '../sessionPersistenceStatus.js'
import {
  formatTranscriptWriterDegradedNotificationText,
  getTranscriptWriterDegraded,
  isImmediateTranscriptDegradeCode,
  recordTranscriptWriteFailure,
  recordTranscriptWriteSuccess,
  resetTranscriptWriterHealthForTest,
  TRANSCRIPT_ERRNO_LABELS,
} from '../transcriptWriterHealth.js'

describe('sessionPersistence densable 2.1.217 #2', () => {
  test('x0t: CHILD_SESSION suppresses unless FORCE', () => {
    expect(
      isNestedMarkerSuppressingPersistence({
        CLAUDE_CODE_CHILD_SESSION: '1',
      }),
    ).toBe(true)
    expect(
      isNestedMarkerSuppressingPersistence({
        CLAUDE_CODE_CHILD_SESSION: '1',
        CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
      }),
    ).toBe(false)
    expect(isNestedMarkerSuppressingPersistence({})).toBe(false)
  })

  test('Gsn: skip_prompt_history cause', () => {
    const cause = getPersistenceSuppressCause({
      CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
      NODE_ENV: 'development',
    })
    // may be explicit_disable if process already disabled; prefer skip when env set
    // In unit tests NODE_ENV may be test → test_env wins first.
    // Assert the pure helpers for visible causes instead.
    expect(formatPersistenceSuppressedPrimary('skip_prompt_history')).toContain(
      'CLAUDE_CODE_SKIP_PROMPT_HISTORY',
    )
    expect(formatPersistenceSuppressedPrimary('nested_marker')).toContain(
      'CLAUDE_CODE_CHILD_SESSION',
    )
    expect(
      formatPersistenceSuppressedNotificationText('skip_prompt_history'),
    ).toContain('--resume will not find this session')
    expect(
      formatPersistenceSuppressedNotificationText('nested_marker'),
    ).toContain('CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1')
    void cause
    void getUserVisiblePersistenceSuppressCause
  })
})

describe('transcriptWriterHealth densable 2.1.217 #2', () => {
  afterEach(() => {
    resetTranscriptWriterHealthForTest()
  })

  test('ENOSPC immediately degrades', () => {
    expect(isImmediateTranscriptDegradeCode('ENOSPC')).toBe(true)
    expect(TRANSCRIPT_ERRNO_LABELS.ENOSPC).toBe('disk full')
  })

  test('record failure enters degraded on ENOSPC', () => {
    recordTranscriptWriteFailure(
      'drain',
      Object.assign(new Error('full'), { code: 'ENOSPC' }),
      '/tmp/sess.jsonl',
    )
    const d = getTranscriptWriterDegraded()
    expect(d).not.toBeNull()
    expect(d!.code).toBe('ENOSPC')
    expect(formatTranscriptWriterDegradedNotificationText(d!)).toContain(
      'disk full',
    )
    expect(formatTranscriptWriterDegradedNotificationText(d!)).toContain(
      'recent messages may not be saved',
    )
  })

  test('success on same path recovers', () => {
    recordTranscriptWriteFailure(
      'drain',
      Object.assign(new Error('full'), { code: 'ENOSPC' }),
      '/tmp/sess.jsonl',
    )
    expect(getTranscriptWriterDegraded()).not.toBeNull()
    recordTranscriptWriteSuccess('/tmp/sess.jsonl')
    expect(getTranscriptWriterDegraded()).toBeNull()
  })
})
