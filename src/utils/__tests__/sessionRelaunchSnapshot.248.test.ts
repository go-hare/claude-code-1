import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildRelaunchProactivity,
  createRelaunchSdkAssistantMessage,
  formatRelaunchPersistFailMessage,
  getSessionProactivityLevel,
  isAssistantTeamEnvSkipped,
  QUOTA_HANDOFF_CANCEL_CLAUSE,
  QUOTA_HANDOFF_WARNING,
  RELAUNCH_BRIDGE_SDK_COPY,
} from '../sessionRelaunchSnapshot.js'

function src(rel: string): string {
  return readFileSync(join(import.meta.dir, rel), 'utf8')
}

describe('densable 2.1.248 zL / EBt / ha / lUe / proactivity', () => {
  test('dtt relaunch copy matches official', () => {
    expect(QUOTA_HANDOFF_WARNING.relaunch).toContain(
      'Claude Code relaunched during the wait',
    )
    expect(QUOTA_HANDOFF_WARNING.relaunch).toContain(
      'send a prompt then to continue',
    )
    expect(QUOTA_HANDOFF_WARNING.process_exit).toContain(
      'Claude Code exited during the wait',
    )
  })

  test('EBt is assistant text, not bzu tool_use', () => {
    const msg = createRelaunchSdkAssistantMessage(
      RELAUNCH_BRIDGE_SDK_COPY,
      'sid',
    )
    expect(msg.type).toBe('assistant')
    expect(RELAUNCH_BRIDGE_SDK_COPY).toContain(
      'Switching to latest Claude Code',
    )
    const content = (
      msg as {
        message?: { content?: { type?: string; text?: string }[] }
      }
    ).message?.content
    expect(content?.[0]?.type).toBe('text')
    expect(content?.[0]?.text).toBe(RELAUNCH_BRIDGE_SDK_COPY)
    expect(JSON.stringify(msg)).not.toContain('PushNotification')
    expect((msg as { is_meta?: boolean }).is_meta).toBeUndefined()
  })

  test('ha() leftover is isTeammate', () => {
    const snap = src('../sessionRelaunchSnapshot.ts')
    expect(snap).toContain('official ha()')
    expect(snap).toContain('isTeammate()')
    expect(typeof isAssistantTeamEnvSkipped()).toBe('boolean')
  })

  test('proactivity slot is getProactivityLevel + ctx', () => {
    expect(getSessionProactivityLevel({})).toBeUndefined()
    expect(getSessionProactivityLevel({ proactivityLevel: 'high' })).toBe(
      'high',
    )
    expect(buildRelaunchProactivity('high', { mode: 'default' })).toEqual({
      proactivityLevel: 'high',
      toolPermissionContext: { mode: 'default' },
    })
  })

  test('Mhr wires zL / EBt / ha / lUe / proactivity', () => {
    const body = src('../../commands/update/update.ts')
    expect(body).toContain('createRelaunchSdkAssistantMessage')
    expect(body).toContain('RELAUNCH_BRIDGE_SDK_COPY')
    expect(body).toContain('snapshotSessionForRelaunch')
    expect(body).toContain('zL(t.messages,"relaunch"')
    expect(body).toContain('isAssistantTeamEnvSkipped')
    expect(body).toContain('await lUe()')
    expect(body).toContain('getProactivityLevel')
    expect(body).toContain('proactivity:')
  })

  test('le wires official proactivity slot', () => {
    const gate = src('../gatewayLoginRelaunch.ts')
    expect(gate).toContain('proactivity:')
    expect(gate).toContain('proactivityLevel')
  })

  test('Ake leftover /tui wires zL + proactivity, not _G injectTuiSwitch:false', () => {
    const body = src('../../commands/tui/index.ts')
    expect(body).toContain('snapshotSessionForRelaunch')
    expect(body).toContain('"relaunch"')
    expect(body).toContain('proactivity:')
    expect(body).toContain('getProactivityLevel')
    const start = body.indexOf('async function applyTuiRelaunchAfterSwitch')
    expect(start).toBeGreaterThan(-1)
    const end = body.indexOf('async function refuseBeforeTuiPersist', start)
    const apply = body.slice(start, end === -1 ? undefined : end)
    expect(apply).toContain('snapshotSessionForRelaunch')
    expect(apply).toContain('proactivity:')
    expect(apply).toContain('getProactivityLevel')
    expect(apply).not.toContain('injectTuiSwitch: false')
    expect(apply).toContain('withRelaunchKet')
  })

  test('Ket WL clause matches official p', () => {
    expect(QUOTA_HANDOFF_CANCEL_CLAUSE).toContain(
      'automatic continue at the usage-limit reset was cancelled',
    )
    expect(QUOTA_HANDOFF_CANCEL_CLAUSE).toContain('/rate-limit-options')
    expect(
      formatRelaunchPersistFailMessage('boom', true, { as: 'clause' }),
    ).toBe(`boom \u2014 ${QUOTA_HANDOFF_CANCEL_CLAUSE}`)
    expect(
      formatRelaunchPersistFailMessage('boom', false, { as: 'clause' }),
    ).toBe('boom')
    const snap = src('../sessionRelaunchSnapshot.ts')
    expect(snap).toContain('official Ket')
    expect(snap).toContain('official WL')
  })
})
