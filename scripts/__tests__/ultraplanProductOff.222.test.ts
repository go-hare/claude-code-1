import { existsSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

/**
 * densable 2.1.222 #21 — Removed ultraplan feature (product contract).
 *
 * Official product-cut the command. Local follow-through is full deletion
 * (command / dialogs / ccrSession / ULTRAPLAN_TAG / AppState fields), not a
 * residual FEATURE_ULTRAPLAN=1 revive gate. ultracode / ultrareview keyword
 * helpers live in workflowKeyword.ts and are unrelated.
 */

describe('densable 2.1.222 #21 ultraplan product cut', () => {
  test('DEFAULT_BUILD_FEATURES excludes ULTRAPLAN', async () => {
    const { DEFAULT_BUILD_FEATURES } = await import('../defines.ts')
    expect(DEFAULT_BUILD_FEATURES).not.toContain('ULTRAPLAN')
  })

  test('defines.ts comments densable 2.1.222 remove and does not list ULTRAPLAN', async () => {
    const text = await Bun.file('scripts/defines.ts').text()
    expect(text).toContain('densable 2.1.222 #21 Removed ultraplan feature')
    expect(text).not.toMatch(/^\s*'ULTRAPLAN'/m)
    expect(text).not.toContain('FEATURE_ULTRAPLAN=1')
  })

  test('slash command and UI modules are gone', () => {
    expect(existsSync('src/commands/ultraplan.tsx')).toBe(false)
    expect(existsSync('src/commands/ultraplan.js')).toBe(false)
    expect(existsSync('src/components/ultraplan')).toBe(false)
    expect(existsSync('src/utils/ultraplan')).toBe(false)
  })

  test('commands.ts does not register /ultraplan', async () => {
    const text = await Bun.file('src/commands.ts').text()
    expect(text).not.toContain("feature('ULTRAPLAN')")
    expect(text).not.toContain('commands/ultraplan')
  })

  test('product surfaces do not gate on feature(ULTRAPLAN)', async () => {
    const files = [
      'src/utils/processUserInput/processUserInput.ts',
      'src/components/PromptInput/PromptInput.tsx',
      'src/screens/REPL.tsx',
      'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
    ]
    for (const f of files) {
      const text = await Bun.file(f).text()
      expect(text).not.toContain("feature('ULTRAPLAN')")
    }
  })

  test('ultracode/ultrareview keyword helpers survive in workflowKeyword.ts', async () => {
    const text = await Bun.file('src/utils/workflowKeyword.ts').text()
    expect(text).toContain('findUltracodeTriggerPositions')
    expect(text).toContain('findUltrareviewTriggerPositions')
    expect(text).not.toContain('findUltraplanTriggerPositions')
  })
})
