import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { preparePlanModeRestoreOnInteractiveResume } from '../permissions/planModeResume.js'

const SRC = readFileSync(join(import.meta.dir, '../sessionRestore.ts'), 'utf8')

describe('2.1.290 #97 processResumedConversation wires planModeResume', () => {
  test('processResumedConversation invokes preparePlanModeRestoreOnInteractiveResume with interactive lane', () => {
    expect(SRC).toContain('preparePlanModeRestoreOnInteractiveResume')
    expect(SRC).toContain('storedPermissionMode: result.permissionMode')
    expect(SRC).toContain(
      'permissionModeSuppliedOnInvocation:\n          !!opts.permissionModeSuppliedOnInvocation',
    )
    expect(SRC).toContain("lane: 'interactive'")
    expect(SRC).toContain(
      'toolPermissionContext: restoredToolPermissionContext',
    )
  })

  test('preparePlanModeRestoreOnInteractiveResume respects permissionModeSuppliedOnInvocation and storedPermissionMode', async () => {
    const baseCtx = {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    } as Parameters<
      Awaited<ReturnType<typeof preparePlanModeRestoreOnInteractiveResume>>
    >[0]

    const pinnedApply = await preparePlanModeRestoreOnInteractiveResume({
      storedPermissionMode: 'plan',
      messages: [],
      forkSession: false,
      permissionModeSuppliedOnInvocation: true,
      lane: 'interactive',
    })
    expect(pinnedApply(baseCtx)).toBeUndefined()
  })
})
