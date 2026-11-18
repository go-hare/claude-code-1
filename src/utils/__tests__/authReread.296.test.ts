import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('rereadManagedSettingsIfNeeded callers (#371)', () => {
  test('auth.ts calls rereadManagedSettingsIfNeeded in validateForceLoginOrg', () => {
    const authSrc = readFileSync(join(import.meta.dir, '..', 'auth.ts'), 'utf8')
    expect(authSrc).toContain('rereadManagedSettingsIfNeeded')
    const fnIdx = authSrc.indexOf('export async function validateForceLoginOrg')
    expect(fnIdx).toBeGreaterThan(-1)
    const slice = authSrc.slice(fnIdx, fnIdx + 600)
    expect(slice).toContain('await rereadManagedSettingsIfNeeded()')
  })

  test('main.tsx calls rereadManagedSettingsIfNeeded after migrations and before initializeToolPermissionContext', () => {
    const mainSrc = readFileSync(
      join(import.meta.dir, '..', '..', 'main.tsx'),
      'utf8',
    )
    const matches = mainSrc.match(/await rereadManagedSettingsIfNeeded\(\)/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })
})
