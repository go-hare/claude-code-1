import { describe, expect, test } from 'bun:test'
import { applyBypassPolicyGate, ensureAgentsBypassConsent } from '../agents.js'

describe('v2.1.293 #309 — claude agents bypass consent & policy gate', () => {
  test('applyBypassPolicyGate strips bypassPermissions and allowBypass when policy disables bypass', () => {
    const out = applyBypassPolicyGate(
      {
        permissionMode: 'bypassPermissions',
        allowBypass: true,
        model: 'claude-sonnet-4-6',
      },
      () => true,
    )
    expect(out).toEqual({
      permissionMode: undefined,
      allowBypass: undefined,
      model: 'claude-sonnet-4-6',
    })
  })

  test('ensureAgentsBypassConsent skips dialog when userSettings has skipDangerousModePermissionPrompt', async () => {
    let rendered = false
    const fakeRoot = {} as never
    await ensureAgentsBypassConsent(
      fakeRoot,
      { permissionMode: 'bypassPermissions' },
      {
        isDisabled: () => false,
        getSettings: ((src: string) =>
          src === 'userSettings'
            ? { skipDangerousModePermissionPrompt: true }
            : undefined) as never,
        renderDialog: (_r, onAccept) => {
          rendered = true
          onAccept()
        },
      },
    )
    expect(rendered).toBe(false)
  })

  test('ensureAgentsBypassConsent asks for consent when consent is only in localSettings (not user/policy)', async () => {
    let rendered = false
    const fakeRoot = {} as never
    await ensureAgentsBypassConsent(
      fakeRoot,
      { permissionMode: 'bypassPermissions' },
      {
        isDisabled: () => false,
        getSettings: ((src: string) =>
          src === 'localSettings'
            ? { skipDangerousModePermissionPrompt: true }
            : undefined) as never,
        renderDialog: (_r, onAccept) => {
          rendered = true
          onAccept()
        },
      },
    )
    expect(rendered).toBe(true)
  })

  test('ensureAgentsBypassConsent skips when permissionModeInherited without allowBypass and localSettings has consent', async () => {
    let rendered = false
    const fakeRoot = {} as never
    await ensureAgentsBypassConsent(
      fakeRoot,
      {
        permissionMode: 'bypassPermissions',
        permissionModeInherited: true,
      },
      {
        isDisabled: () => false,
        getSettings: ((src: string) =>
          src === 'localSettings'
            ? { skipDangerousModePermissionPrompt: true }
            : undefined) as never,
        renderDialog: (_r, onAccept) => {
          rendered = true
          onAccept()
        },
      },
    )
    expect(rendered).toBe(false)
  })
})
