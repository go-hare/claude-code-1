import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..', '..', '..')

describe('v2.1.302–2.1.309 Design & Privacy Settings alignment', () => {
  test('#896: design-login displays December 14, 2026 standalone Claude Design sunset notice', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/design-login/designLogin.tsx'),
      'utf8',
    )
    expect(src).toContain('December 14, 2026')
    expect(src).toContain('claude.ai/design')
    expect(src).toContain('{DESIGN_LOGIN_SUNSET_NOTICE}')
  })

  test('#910: /design consent and /design revoke point to claude.ai/design/settings in cloud sessions', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/design-consent/call.ts'),
      'utf8',
    )
    expect(src).toContain('isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)')
    expect(src).toContain('grant it at claude.ai/design/settings')
    expect(src).toContain('revoke it at claude.ai/design/settings')
  })

  test('#983 & #1141: privacy-settings clears grove caches, aborts on config failure, and uses updated copy', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/privacy-settings/privacy-settings.tsx'),
      'utf8',
    )
    expect(src).toContain('getGroveSettings.cache.clear?.()')
    expect(src).toContain('getGroveNoticeConfig.cache.clear?.()')
    expect(src).toContain('!settingsResult.success || !configResult.success')
    expect(src).toContain(
      'Unable to fetch your privacy settings at this time. Check ${PRIVACY_SETTINGS_URL}',
    )
    expect(src).toContain('"Help improve our AI models" set to')
  })
})
