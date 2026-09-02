import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  notifyBridgeFromDooResult,
  type DooBridgeNotify,
} from '../notifyBridgeFromDooResult.js'

describe('notifyBridgeFromDooResult (W / Hnu)', () => {
  test('allow sends updatedInput and permissionUpdates', () => {
    const notify = mock<DooBridgeNotify>(() => {})
    const permissionUpdates = [
      {
        type: 'addRules' as const,
        rules: [
          { toolName: 'ClaudeInChromeDomain', ruleContent: 'example.com' },
        ],
        behavior: 'allow' as const,
        destination: 'session' as const,
      },
    ]
    notifyBridgeFromDooResult(
      notify,
      {
        behavior: 'allow',
        updatedInput: { url: 'https://example.com' },
        permissionUpdates,
      },
      { url: 'fallback' },
    )
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]![0]).toEqual({
      behavior: 'allow',
      updatedInput: { url: 'https://example.com' },
      updatedPermissions: permissionUpdates,
    })
  })

  test('allow without updatedInput uses fallback', () => {
    const notify = mock<DooBridgeNotify>(() => {})
    notifyBridgeFromDooResult(notify, { behavior: 'allow' }, { x: 1 })
    expect(notify.mock.calls[0]![0]).toEqual({
      behavior: 'allow',
      updatedInput: { x: 1 },
    })
  })

  test('deny uses feedback; cancelled is official W deny + User aborted', () => {
    const notify = mock<DooBridgeNotify>(() => {})
    notifyBridgeFromDooResult(
      notify,
      { behavior: 'deny', feedback: 'nope' },
      {},
    )
    expect(notify.mock.calls[0]![0]).toEqual({
      behavior: 'deny',
      message: 'nope',
    })
    notify.mockClear()
    notifyBridgeFromDooResult(notify, { behavior: 'cancelled' }, {})
    expect(notify.mock.calls[0]![0]).toEqual({
      behavior: 'deny',
      message: 'User aborted',
    })
  })

  test('no-op without notifyBridge', () => {
    expect(() =>
      notifyBridgeFromDooResult(undefined, { behavior: 'allow' }, {}),
    ).not.toThrow()
  })

  test('interactiveHandler doo settle calls W() notify, not cancel-only', () => {
    const src = readFileSync(
      join(import.meta.dir, '../handlers/interactiveHandler.ts'),
      'utf8',
    )
    expect(src).toContain('notifyBridgeFromDooResult(')
    const settle = src.slice(src.indexOf('void session.result.then'))
    expect(settle).toContain('notifyBridgeFromDooResult(')
    expect(settle).toContain('popQueuedCommandsOnPermissionDeny()')
    expect(settle.slice(0, 800)).not.toMatch(
      /if \(bridgeCallbacks && bridgeRequestId\) \{\s*bridgeCallbacks\.cancelRequest/,
    )
  })

  test('onReject and pipe deny pop queued drafts', () => {
    const src = readFileSync(
      join(import.meta.dir, '../handlers/interactiveHandler.ts'),
      'utf8',
    )
    const onReject = src.slice(src.indexOf('onReject(feedback?'))
    expect(onReject.slice(0, 280)).toContain(
      'popQueuedCommandsOnPermissionDeny()',
    )
    const pipeElse = src.slice(src.lastIndexOf('} else {\n        popQueued'))
    expect(pipeElse.slice(0, 120)).toContain(
      'popQueuedCommandsOnPermissionDeny()',
    )
  })
})
