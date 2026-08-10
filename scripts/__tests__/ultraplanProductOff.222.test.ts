import { describe, expect, test } from 'bun:test'

/**
 * densable 2.1.222 #21 — Removed ultraplan feature (product contract).
 *
 * SEA still carries residual `/ultraplan` strings; alignment is product
 * default OFF via DEFAULT_BUILD_FEATURES, not zero-string deletion.
 */

describe('densable 2.1.222 #21 ultraplan product default OFF', () => {
  test('DEFAULT_BUILD_FEATURES excludes ULTRAPLAN', async () => {
    const { DEFAULT_BUILD_FEATURES } = await import('../defines.ts')
    expect(DEFAULT_BUILD_FEATURES).not.toContain('ULTRAPLAN')
  })

  test('defines.ts comments densable 2.1.222 remove + residual gate', async () => {
    const text = await Bun.file('scripts/defines.ts').text()
    expect(text).toContain('densable 2.1.222 #21 Removed ultraplan feature')
    expect(text).toContain("// 'ULTRAPLAN'")
    // Must not re-enable as an active list entry
    expect(text).not.toMatch(/^\s*'ULTRAPLAN'/m)
  })

  test('commands.ts gates /ultraplan registration on feature(ULTRAPLAN)', async () => {
    const text = await Bun.file('src/commands.ts').text()
    expect(text).toContain("feature('ULTRAPLAN')")
    expect(text).toContain("require('./commands/ultraplan.js')")
    expect(text).toContain('...(ultraplan ? [ultraplan] : [])')
  })

  test('product surfaces keep feature(ULTRAPLAN) gates', async () => {
    const files = [
      'src/utils/processUserInput/processUserInput.ts',
      'src/components/PromptInput/PromptInput.tsx',
      'src/screens/REPL.tsx',
      'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx',
    ]
    for (const f of files) {
      const text = await Bun.file(f).text()
      expect(text).toContain("feature('ULTRAPLAN')")
    }
  })
})
