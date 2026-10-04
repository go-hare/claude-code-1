/**
 * densable 2.1.283 leftover unique headless/PWt/TXn/Ke/st/dt/tn copy wrap.
 *
 * Unique copy only — keep existing minify hosts.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('../../utils/debug.js', () => debugMock())
mock.module('../../utils/debug.ts', () => debugMock())
mock.module('src/utils/debug.js', () => debugMock())
mock.module('src/utils/debug.ts', () => debugMock())
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())
mock.module('src/services/analytics/index.js', () => analyticsMock())
mock.module('src/services/analytics/index.ts', () => analyticsMock())

const {
  CLOUD_SESSION_LOST_RECONNECTING,
  cloudSessionDidNotAcceptOptionalCopy,
  cloudSessionDidNotAcceptRequiredCopy,
  cloudSessionDidNotApplyCreatePermissionModeCopy,
  cloudSessionWaitingUndeclaredDialogCopy,
  headlessAgentReusesFinishedRequestIdCopy,
  headlessConsumedOwnEchoCopy,
  headlessDroppedUnknownFrameCopy,
  headlessHostCouldNotAnswerCopy,
  headlessNotPassingOwnQuestionDialogCopy,
  headlessNotPassingUndeclaredDialogCopy,
  remoteCreatePermissionModeDefaultNotTakenCopy,
  remoteCreatePermissionModeNotTakenCopy,
  remoteCreatePermissionModeTakenCopy,
} = await import('../leftoverHeadlessCopy.js')

const src = readFileSync(
  join(import.meta.dir, '../leftoverHeadlessCopy.ts'),
  'utf8',
)
const leftoverUnique = readFileSync(
  join(import.meta.dir, '../leftoverUnique.ts'),
  'utf8',
)

describe('leftoverHeadlessCopy 283 leftover unique wrap', () => {
  test('source-locks leftover unique; no minify public API', () => {
    expect(src).toContain('leftover `PWt` @202288597')
    expect(src).toContain("The session took its create's")
    expect(src).toContain('permission mode push was not taken')
    expect(src).toContain(
      'The default mode sent after that refusal was not taken either',
    )
    expect(src).toContain('attach could not start the device registration')
    expect(src).toContain("could not check the session's binding")
    expect(src).toContain('reuses finished request_id')
    expect(src).toContain('host could not answer')
    expect(src).toContain('frame this build does not write')
    expect(src).toContain('consumed our own echo of')
    expect(src).toContain('interrupt not dispatched')
    expect(src).toContain('could not announce a swept command')
    expect(src).toContain('dropped control_response for unknown request')
    expect(src).toContain("settling the opener's work failed")
    expect(src).toContain('the worker took this client')
    expect(src).toContain('was not answered')
    expect(src).toContain('opening request')
    expect(src).toContain(
      'so this attach was stopped rather than continue without it',
    )
    expect(src).toContain('it keeps its own')
    expect(src).toContain('frame after stdout closed')
    expect(src).toContain('ignoring ${type} frame while closing')
    expect(src).toContain('ignoring host ${type} frame')
    expect(src).toContain('discarded session not released')
    expect(src).toContain("never the cloud session's")
    expect(src).toContain('did not declare the kind')
    expect(src).toContain('did not declare it can show')
    expect(src).toContain(
      'Lost the connection to the cloud session — reconnecting',
    )
    expect(src).toContain('permission mode requested when it was created')
    expect(src).toContain('stream error')
    expect(src).toContain('[headlessCloudClient] attach preflight failed')
    expect(src).toContain('re-reading the serve-only link threw')
    expect(src).toContain('built-in tool names could not be read')
    expect(src).toContain('transport close failed')
    expect(src).not.toMatch(/^export (async )?function tn\b/m)
    expect(src).not.toMatch(/^export (async )?function PWt\b/m)
    expect(src).not.toMatch(/^export (async )?function Ke\b/m)
    expect(src).not.toContain('new WebSocket')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('FOCUS_IN')
    expect(leftoverUnique).toContain("from './leftoverHeadlessCopy.js'")
    expect(leftoverUnique).toContain('logRemoteHeadlessClientAgentRequest')
    expect(leftoverUnique).toContain('logDroppedCloudSessionKey')
    expect(leftoverUnique).toContain('applyInterruptCancelQueued')
  })

  test('1:1 leftover unique copies', () => {
    expect(remoteCreatePermissionModeTakenCopy('plan')).toBe(
      "[remote] The session took its create's plan permission mode as a live request",
    )
    expect(
      remoteCreatePermissionModeNotTakenCopy('plan', 'timeout', 'x'),
    ).toContain(
      "[remote] The create's plan permission mode push was not taken (timeout):",
    )
    expect(remoteCreatePermissionModeDefaultNotTakenCopy('boom')).toContain(
      'The default mode sent after that refusal was not taken either',
    )
    expect(headlessAgentReusesFinishedRequestIdCopy('ask', 'id-1')).toContain(
      'reuses finished request_id',
    )
    expect(headlessHostCouldNotAnswerCopy('ask', 'id-1', 'nope')).toContain(
      'host could not answer ask',
    )
    expect(headlessDroppedUnknownFrameCopy('system', 'host', false)).toContain(
      'frame this build does not write',
    )
    expect(
      headlessDroppedUnknownFrameCopy('heartbeat_probe', 'host', true),
    ).toContain('service event')
    expect(headlessConsumedOwnEchoCopy('u1')).toBe(
      '[headlessCloudClient] consumed our own echo of u1',
    )
    expect(cloudSessionDidNotAcceptRequiredCopy('tools')).toBe(
      'Error: the cloud session did not accept tools, so this attach was stopped rather than continue without it.',
    )
    expect(cloudSessionDidNotAcceptOptionalCopy('plugins')).toBe(
      'The cloud session did not accept plugins; it keeps its own.',
    )
    expect(headlessNotPassingOwnQuestionDialogCopy('cloud_sync')).toContain(
      "never the cloud session's",
    )
    expect(headlessNotPassingUndeclaredDialogCopy('ask')).toContain(
      'did not declare the kind',
    )
    expect(cloudSessionWaitingUndeclaredDialogCopy('ask')).toContain(
      'did not declare it can show',
    )
    expect(CLOUD_SESSION_LOST_RECONNECTING).toBe(
      'Lost the connection to the cloud session — reconnecting…',
    )
    expect(
      cloudSessionDidNotApplyCreatePermissionModeCopy('plan', 'default'),
    ).toBe(
      'The cloud session did not apply the plan permission mode requested when it was created; it is in default mode.',
    )
  })
})
