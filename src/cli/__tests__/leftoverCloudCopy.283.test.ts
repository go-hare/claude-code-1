/**
 * densable 2.1.283 leftover unique copy wrap source-lock.
 *
 * Gold SEA `/tmp/official-283/package/claude` + `/tmp/gold-leftover-remaining.txt`.
 * Unique leftover strings only — no Yo compositor fleet / hook fleet / Far key store.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

const debugLogs: string[] = []
function debugWithCapture() {
  return {
    ...debugMock(),
    logForDebugging: (msg: string) => {
      debugLogs.push(msg)
    },
  }
}
mock.module('../../utils/debug.js', debugWithCapture)
mock.module('../../utils/debug.ts', debugWithCapture)
mock.module('src/utils/debug.js', debugWithCapture)
mock.module('src/utils/debug.ts', debugWithCapture)
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())
mock.module('src/services/analytics/index.js', () => analyticsMock())
mock.module('src/services/analytics/index.ts', () => analyticsMock())

const {
  ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN,
  CCR_DIR_SYNC_MODE_PROMPT,
  CLOUD_ATTACH_SYNC_CONSENT_COPY,
  CLOUD_CLIENT_CLOSED_BEFORE_REQUEST_COMPLETED,
  CLOUD_CLIENT_CLOSED_BEFORE_SEND_CONFIRMED,
  CLOUD_PRINT_NEEDS_TASK,
  CLOUD_SESSION_FAILED_TO_START,
  CLOUD_SYNC_CONSENT_COPY,
  CLOUD_TRANSCRIPT_JSONL,
  CLOUD_WORKER_TIMEOUT_NO_ANSWER,
  CONSENT_ATTACH_SYNC_BODY,
  CONSENT_ATTACH_SYNC_BODY_KEY,
  CONSENT_ATTACH_SYNC_DETAIL,
  CONSENT_ATTACH_SYNC_DETAIL_KEY,
  CONSENT_ATTACH_SYNC_TITLE,
  CONSENT_ATTACH_SYNC_TITLE_KEY,
  CONSENT_SYNC_BODY,
  CONSENT_SYNC_BODY_KEY,
  CONSENT_SYNC_DETAIL,
  CONSENT_SYNC_DETAIL_KEY,
  CONSENT_SYNC_TITLE,
  CONSENT_SYNC_TITLE_KEY,
  CONTENT_BLOCK_MUST_BE_OBJECT_TEXT_STRING,
  DROPPING_CONTROL_REQUEST_WITHOUT_ID_OR_REQUEST,
  EDE_DIAGNOSTIC_PREFIX,
  emptyTranscriptPath,
  FAILED_HOST_ERROR,
  HEADLESS_CLOUD_SYNC_QUESTION_ABANDONED,
  logSyncQuestionAbandoned,
  POLICY_INVALID_REASON,
  savedHooksAnswerIgnoredUnlocated,
  savedHooksAnswerIgnoredWritable,
  SESSION_STREAM_NOT_CONNECTED,
  TENGU_DEVICE_HOOK_SERVED,
  TENGU_DEVICE_HOOKS_CLIENT_REGISTER,
  TENGU_DEVICE_HOOKS_CONSENT_NOTICE,
  TENGU_DEVICE_HOOKS_LAPSE_LINE,
  TENGU_DEVICE_HOOKS_REACH_PINNED,
  TENGU_DEVICE_HOOKS_SOURCE_PINNED,
  UNTRUSTED_DEVICE,
  attachDirSyncElsewhereUnknownReason,
  classifyAttachDirSyncElsewhereUnknown,
  isFailedHostError,
  logCcrDirSyncModePrompt,
  logDeviceHookServed,
  logDroppedControlRequestWithoutIdOrRequest,
  stripEdeDiagnosticErrors,
} = await import('../leftoverCloudCopy.js')

const src = readFileSync(
  join(import.meta.dir, '../leftoverCloudCopy.ts'),
  'utf8',
)
const leftoverUnique = readFileSync(
  join(import.meta.dir, '../leftoverUnique.ts'),
  'utf8',
)
const sessionBody = readFileSync(
  join(import.meta.dir, '../cloudSession.ts'),
  'utf8',
)

afterEach(() => {
  debugLogs.length = 0
})

describe('leftoverCloudCopy 283 leftover unique wrap', () => {
  test('source-locks unique strings + 1:1 copies; no minify public API', () => {
    expect(src).toContain('gold `xo` @202278654')
    expect(src).toContain('tengu_device_hook_served')
    expect(src).toContain('cloud-transcript.jsonl')
    expect(src).toContain('emptyTranscriptPath')
    expect(src).toContain('gold leftover `Eo` @202280653')
    expect(src).toContain('timeout: no answer from the cloud worker in time')
    expect(src).toContain('disconnected: the session stream is not connected')
    expect(src).toContain('tengu_device_hooks_consent_notice')
    expect(src).toContain(
      "The saved answer about this machine's hooks is ignored here: this cloud session can itself write ${path}. Decide for it in /hooks.",
    )
    expect(src).toContain(
      "The saved answer about this machine's hooks is ignored here: ${path} could not be located to check who can write it. Decide for this session in /hooks.",
    )
    expect(src).toContain('tengu_device_hooks_client_register')
    expect(src).toContain('tengu_device_hooks_lapse_line')
    expect(src).toContain('tengu_device_hooks_reach_pinned')
    expect(src).toContain('tengu_device_hooks_source_pinned')
    expect(src).toContain('gold `qt` @202326531')
    expect(src).toContain('gold `gs` @202326896')
    expect(src).toContain('failed_host_error')
    expect(src).toContain('gold `_jt` @202330701')
    expect(src).toContain('consent.attach_sync.title')
    expect(src).toContain('consent.attach_sync.body')
    expect(src).toContain('consent.attach_sync.detail')
    expect(src).toContain('consent.sync.title')
    expect(src).toContain('consent.sync.body')
    expect(src).toContain('consent.sync.detail')
    expect(src).toContain('CONSENT_SYNC_TITLE_KEY')
    expect(src).toContain('Keep this folder in sync with the cloud session?')
    expect(src).toContain('Sync this project directory to the cloud?')
    expect(src).toContain('gold `bXn` @202348264')
    expect(src).toContain('[ede_diagnostic]')
    expect(src).toContain('gold `ot`')
    expect(src).toContain('The cloud session failed to start.')
    expect(src).toContain('gold `ie` @202352615')
    expect(src).toContain('gold `at`')
    expect(src).toContain(
      'dropping control_request without request_id or request',
    )
    expect(src).toContain(
      'the cloud client closed before this request completed',
    )
    expect(src).toContain(
      'every content block must be an object, and a text block must carry string text',
    )
    expect(src).toContain(
      'the cloud client closed before the send was confirmed',
    )
    expect(src).toContain('gold `on` @202404306')
    expect(src).toContain('ccr_dir_sync_mode_prompt')
    expect(src).toContain('[headlessCloud] sync question abandoned')
    expect(src).toContain('logSyncQuestionAbandoned')
    expect(src).toContain('leftover print-arm @202463137')
    expect(src).toContain(
      "Error: claude -p --cloud needs a task: pass it as the prompt, as --cloud's value, or on stdin.",
    )
    expect(src).toContain('gold leftover `Yo` @202433401')
    expect(src).toContain('COMPOSITOR')
    expect(src).toContain('attach_dir_sync_elsewhere_unknown')
    expect(src).toContain('gold `Tn` @202441256')
    expect(src).toContain('untrusted device')
    expect(src).toContain('Tgt("policy_invalid")')
    expect(src).toContain(
      "export const POLICY_INVALID_REASON = 'policy_invalid'",
    )
    expect(src).not.toMatch(/^export (async )?function xo\b/m)
    expect(src).not.toMatch(/^export (async )?function qt\b/m)
    expect(src).not.toMatch(/^export (async )?function _jt\b/m)
    expect(src).not.toMatch(/^export (async )?function bXn\b/m)
    expect(src).not.toMatch(/^export (async )?function ie\b/m)
    expect(src).not.toMatch(/^export (async )?function on\b/m)
    expect(src).not.toMatch(/^export (async )?function Yo\b/m)
    expect(src).not.toMatch(/^export (async )?function Tn\b/m)
    expect(src).not.toContain('new WebSocket')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(leftoverUnique).toContain("from './leftoverCloudCopy.js'")
    expect(leftoverUnique).toContain('CONSENT_ATTACH_SYNC_TITLE_KEY')
    expect(leftoverUnique).toContain('CONSENT_SYNC_TITLE_KEY')
    expect(leftoverUnique).toContain('CLOUD_SYNC_CONSENT_COPY')
    expect(leftoverUnique).toContain(
      'CLOUD_CLIENT_CLOSED_BEFORE_REQUEST_COMPLETED',
    )
    expect(leftoverUnique).toContain('applyInterruptCancelQueued')
    expect(leftoverUnique).toContain('CLOUD_MESSAGE_NOT_DELIVERED')
    expect(leftoverUnique).toContain('gold leftover `_jt` @202330701')
    expect(leftoverUnique).toContain('emptyTranscriptPath')
    expect(leftoverUnique).toContain('logSyncQuestionAbandoned')
    expect(leftoverUnique).toContain('CLOUD_PRINT_NEEDS_TASK')
    expect(leftoverUnique).toContain('POLICY_INVALID_REASON')
    expect(leftoverUnique).toContain('stripEdeDiagnosticErrors')
    expect(sessionBody).toContain("from './leftoverCloudCopy.js'")
    expect(sessionBody).toContain('CLOUD_ATTACH_SYNC_CONSENT_COPY')
    expect(sessionBody).toContain('TENGU_DEVICE_HOOK_SERVED')
    expect(sessionBody).toContain('CONSENT_SYNC_TITLE_KEY')
    expect(sessionBody).toContain('emptyTranscriptPath')
    expect(sessionBody).toContain('CLOUD_PRINT_NEEDS_TASK')
    expect(sessionBody).toContain('logSyncQuestionAbandoned')
    expect(sessionBody).not.toMatch(
      /export \{[^}]*stripEdeDiagnosticErrors[^}]*\} from '\.\/leftoverCloudCopy\.js'/s,
    )
    expect(sessionBody).not.toMatch(
      /export \{[^}]*POLICY_INVALID_REASON[^}]*\} from '\.\/leftoverCloudCopy\.js'/s,
    )
    expect(sessionBody).not.toMatch(
      /export \{[^}]*CLOUD_SYNC_CONSENT_COPY[^}]*\} from '\.\/leftoverCloudCopy\.js'/s,
    )
  })

  test('1:1 leftover unique copies', () => {
    expect(TENGU_DEVICE_HOOK_SERVED).toBe('tengu_device_hook_served')
    expect(CLOUD_TRANSCRIPT_JSONL).toBe('cloud-transcript.jsonl')
    expect(emptyTranscriptPath()).toBe('cloud-transcript.jsonl')
    expect(CLOUD_WORKER_TIMEOUT_NO_ANSWER).toBe(
      'timeout: no answer from the cloud worker in time',
    )
    expect(SESSION_STREAM_NOT_CONNECTED).toBe(
      'disconnected: the session stream is not connected',
    )
    expect(TENGU_DEVICE_HOOKS_CONSENT_NOTICE).toBe(
      'tengu_device_hooks_consent_notice',
    )
    expect(TENGU_DEVICE_HOOKS_CLIENT_REGISTER).toBe(
      'tengu_device_hooks_client_register',
    )
    expect(TENGU_DEVICE_HOOKS_LAPSE_LINE).toBe('tengu_device_hooks_lapse_line')
    expect(TENGU_DEVICE_HOOKS_REACH_PINNED).toBe(
      'tengu_device_hooks_reach_pinned',
    )
    expect(TENGU_DEVICE_HOOKS_SOURCE_PINNED).toBe(
      'tengu_device_hooks_source_pinned',
    )
    expect(savedHooksAnswerIgnoredWritable('/tmp/hooks')).toBe(
      "The saved answer about this machine's hooks is ignored here: this cloud session can itself write /tmp/hooks. Decide for it in /hooks.",
    )
    expect(savedHooksAnswerIgnoredUnlocated('/tmp/hooks')).toBe(
      "The saved answer about this machine's hooks is ignored here: /tmp/hooks could not be located to check who can write it. Decide for this session in /hooks.",
    )
    expect(FAILED_HOST_ERROR).toBe('failed_host_error')
    expect(POLICY_INVALID_REASON).toBe('policy_invalid')
    expect(isFailedHostError(FAILED_HOST_ERROR)).toBe(true)
    expect(isFailedHostError('answered')).toBe(false)
    expect(CONSENT_ATTACH_SYNC_TITLE_KEY).toBe('consent.attach_sync.title')
    expect(CONSENT_ATTACH_SYNC_BODY_KEY).toBe('consent.attach_sync.body')
    expect(CONSENT_ATTACH_SYNC_DETAIL_KEY).toBe('consent.attach_sync.detail')
    expect(CONSENT_SYNC_TITLE_KEY).toBe('consent.sync.title')
    expect(CONSENT_SYNC_BODY_KEY).toBe('consent.sync.body')
    expect(CONSENT_SYNC_DETAIL_KEY).toBe('consent.sync.detail')
    expect(CONSENT_SYNC_TITLE).toBe('Sync this project directory to the cloud?')
    expect(CONSENT_SYNC_BODY).toBe(
      'Allow Claude Code to sync files from this project directory into cloud sessions, so Claude can work on them in the cloud.',
    )
    expect(CONSENT_SYNC_DETAIL).toContain(
      'Secrets, credentials, and gitignored files are never synced and all synced files are encrypted at rest.',
    )
    expect(CLOUD_SYNC_CONSENT_COPY.title).toBe(CONSENT_SYNC_TITLE)
    expect(CLOUD_SYNC_CONSENT_COPY.body).toBe(CONSENT_SYNC_BODY)
    expect(CLOUD_SYNC_CONSENT_COPY.detail).toBe(CONSENT_SYNC_DETAIL)
    expect(CONSENT_ATTACH_SYNC_TITLE).toBe(
      'Keep this folder in sync with the cloud session?',
    )
    expect(CONSENT_ATTACH_SYNC_BODY).toContain(
      'This folder is a checkout of the repository the cloud session works in.',
    )
    expect(CONSENT_ATTACH_SYNC_DETAIL).toContain(
      'files under .claude and .mcp.json are never written on this computer',
    )
    expect(CLOUD_ATTACH_SYNC_CONSENT_COPY.title).toBe(CONSENT_ATTACH_SYNC_TITLE)
    expect(CLOUD_ATTACH_SYNC_CONSENT_COPY.body).toBe(CONSENT_ATTACH_SYNC_BODY)
    expect(CLOUD_ATTACH_SYNC_CONSENT_COPY.detail).toBe(
      CONSENT_ATTACH_SYNC_DETAIL,
    )
    expect(CLOUD_SESSION_FAILED_TO_START).toBe(
      'The cloud session failed to start.',
    )
    expect(CLOUD_SESSION_FAILED_TO_START.endsWith('.')).toBe(true)
    expect(DROPPING_CONTROL_REQUEST_WITHOUT_ID_OR_REQUEST).toBe(
      '[headlessCloudClient] dropping control_request without request_id or request',
    )
    expect(CLOUD_CLIENT_CLOSED_BEFORE_REQUEST_COMPLETED).toBe(
      'the cloud client closed before this request completed',
    )
    expect(CONTENT_BLOCK_MUST_BE_OBJECT_TEXT_STRING).toBe(
      'every content block must be an object, and a text block must carry string text',
    )
    expect(CLOUD_CLIENT_CLOSED_BEFORE_SEND_CONFIRMED).toBe(
      'the cloud client closed before the send was confirmed',
    )
    expect(CCR_DIR_SYNC_MODE_PROMPT).toBe('ccr_dir_sync_mode_prompt')
    expect(HEADLESS_CLOUD_SYNC_QUESTION_ABANDONED).toBe(
      '[headlessCloud] sync question abandoned',
    )
    expect(CLOUD_PRINT_NEEDS_TASK).toBe(
      "Error: claude -p --cloud needs a task: pass it as the prompt, as --cloud's value, or on stdin.",
    )
    expect(ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN).toBe(
      'attach_dir_sync_elsewhere_unknown',
    )
    expect(UNTRUSTED_DEVICE).toBe('untrusted device')
    expect(EDE_DIAGNOSTIC_PREFIX).toBe('[ede_diagnostic]')
  })

  test('thin wrappers: xo logEvent, ie logForDebugging, bXn strip, Yo classify', () => {
    logDeviceHookServed({ outcome: 'answered', durationMs: 1 })
    logCcrDirSyncModePrompt('cancelled')
    logDroppedControlRequestWithoutIdOrRequest()
    logSyncQuestionAbandoned('boom')
    expect(debugLogs).toEqual([
      '[headlessCloudClient] dropping control_request without request_id or request',
      '[headlessCloud] sync question abandoned: boom',
    ])
    expect(
      stripEdeDiagnosticErrors({
        type: 'result',
        errors: ['[ede_diagnostic] x', 'keep'],
      }),
    ).toEqual({ type: 'result', errors: ['keep'] })
    expect(classifyAttachDirSyncElsewhereUnknown({ kind: 'unknown' })).toBe(
      true,
    )
    expect(
      attachDirSyncElsewhereUnknownReason({ why: 'elsewhere_unknown' }),
    ).toBe(ATTACH_DIR_SYNC_ELSEWHERE_UNKNOWN)
    expect(
      attachDirSyncElsewhereUnknownReason({ why: 'lookup_failed' }),
    ).toBeUndefined()
  })
})
