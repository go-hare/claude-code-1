/**
 * densable 2.1.248 #31 rc-reconnect-prompt (official pe / Ze / ot / xi).
 *
 * GOLD: official-248 claude.exe sendControlRequest @198368650,
 * setOnConnect Ze.clear @198351726, Local-only retract @198370564,
 * xi getPendingPrompts @198343486.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { SDKControlRequest } from '../../entrypoints/sdk/controlTypes.js'
import { handleServerControlRequest } from '../bridgeMessaging.js'
import {
  createRemoteBridgePendingForwards,
  isBridgePermissionForwardSubtype,
  LOCAL_ONLY_RETRACT,
  NOT_FORWARDING_GATED_DIALOG,
} from '../remoteBridgeCore.js'
import type { ReplBridgeTransport } from '../replBridgeTransport.js'

const coreSrc = readFileSync(
  join(import.meta.dir, '../remoteBridgeCore.ts'),
  'utf8',
)
const messagingSrc = readFileSync(
  join(import.meta.dir, '../bridgeMessaging.ts'),
  'utf8',
)

function req(
  id: string,
  subtype: 'can_use_tool' | 'request_user_dialog',
): SDKControlRequest {
  return {
    type: 'control_request',
    request_id: id,
    request:
      subtype === 'can_use_tool'
        ? {
            subtype: 'can_use_tool',
            tool_name: 'Bash',
            input: {},
            tool_use_id: `tu-${id}`,
          }
        : {
            subtype: 'request_user_dialog',
            dialog_kind: 'refusal_fallback_prompt',
          },
  } as SDKControlRequest
}

describe('densable 2.1.248 #31 pe/Ze reconnect prompt', () => {
  test('HOST wires official pe/Ze reconnect + local-only strings', () => {
    expect(coreSrc).toContain('createRemoteBridgePendingForwards')
    expect(coreSrc).toContain(
      'Not forwarding request_user_dialog while writes are gated / transport recovering (local-only):',
    )
    expect(coreSrc).toContain(
      'Local-only retract of a declined dialog forward request_id=',
    )
    expect(coreSrc).toContain('pendingForwards.onReconnect()')
    expect(coreSrc).toContain("reportState('requires_action'")
    expect(coreSrc).toContain('localOnlyDialogForwards.clear()')
    expect(coreSrc).toContain(
      'getPendingPrompts: () => pendingForwards.getPendingPrompts()',
    )
    expect(messagingSrc).toContain('pending_permission_requests')
    expect(messagingSrc).toContain('pending_user_dialog_requests')
  })

  test('gated request_user_dialog is Ze local-only; cancel retracts without forward', () => {
    const peZe = createRemoteBridgePendingForwards()
    const dialog = req('d1', 'request_user_dialog')
    peZe.noteForward(dialog)
    peZe.markLocalOnly('d1')
    expect(peZe.localOnlyDialogForwards.has('d1')).toBe(true)
    expect(peZe.retractLocalOnly('d1')).toBe(true)
    expect(peZe.pendingControlForwards.size).toBe(0)
    expect(peZe.localOnlyDialogForwards.size).toBe(0)
    expect(peZe.retractLocalOnly('d1')).toBe(false)
  })

  test('reconnect Ze.clear keeps pe and re-emits last details', () => {
    const peZe = createRemoteBridgePendingForwards()
    const details = {
      tool_name: 'dialog:refusal_fallback_prompt',
      display_tool_name: 'Claude needs your input',
      action_description:
        'Respond to the refusal_fallback_prompt dialog to continue',
      tool_use_id: '',
      request_id: 'd2',
    }
    peZe.noteForward(req('d2', 'request_user_dialog'), details)
    peZe.markLocalOnly('d2')
    const replayed = peZe.onReconnect()
    expect(replayed.reemit).toBe(true)
    expect(replayed.details).toEqual(details)
    expect(peZe.localOnlyDialogForwards.size).toBe(0)
    expect(peZe.pendingControlForwards.has('d2')).toBe(true)
    // after Ze.clear, cancel is no longer local-only retract
    expect(peZe.retractLocalOnly('d2')).toBe(false)
    expect(peZe.pendingControlForwards.has('d2')).toBe(true)
  })

  test('xi getPendingPrompts clears Ze and returns pe requests', () => {
    const peZe = createRemoteBridgePendingForwards()
    peZe.noteForward(req('p1', 'can_use_tool'))
    peZe.markLocalOnly('p1')
    const pending = peZe.getPendingPrompts()
    expect(pending.map(r => r.request_id)).toEqual(['p1'])
    expect(peZe.localOnlyDialogForwards.size).toBe(0)
  })

  test('subtype gate is official can_use_tool || request_user_dialog', () => {
    expect(isBridgePermissionForwardSubtype('can_use_tool')).toBe(true)
    expect(isBridgePermissionForwardSubtype('request_user_dialog')).toBe(true)
    expect(isBridgePermissionForwardSubtype('initialize')).toBe(false)
    expect(NOT_FORWARDING_GATED_DIALOG).toContain(
      'Not forwarding request_user_dialog while writes are gated / transport recovering (local-only):',
    )
    expect(LOCAL_ONLY_RETRACT).toContain(
      'Local-only retract of a declined dialog forward request_id=',
    )
  })

  test('initialize inbound splits xi prompts onto official pending_* fields', () => {
    const writes: unknown[] = []
    const transport = {
      write: (event: unknown) => {
        writes.push(event)
        return Promise.resolve()
      },
    } as unknown as ReplBridgeTransport
    const perm = req('perm-1', 'can_use_tool')
    const dialog = req('dlg-1', 'request_user_dialog')
    handleServerControlRequest(
      {
        type: 'control_request',
        request_id: 'init-1',
        request: { subtype: 'initialize' },
      } as SDKControlRequest,
      {
        transport,
        sessionId: 'sess',
        getPendingPrompts: () => [perm, dialog],
      },
    )
    expect(writes).toHaveLength(1)
    const event = writes[0] as {
      response: {
        subtype: string
        pending_permission_requests?: SDKControlRequest[]
        pending_user_dialog_requests?: SDKControlRequest[]
      }
    }
    expect(event.response.subtype).toBe('success')
    expect(event.response.pending_permission_requests).toEqual([perm])
    expect(event.response.pending_user_dialog_requests).toEqual([dialog])
  })
})
