import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.289 isBypassPermissionsModeAvailable', () => {
  test('needs bypass launch mode or --allow-dangerously-skip-permissions', () => {
    const src = readFileSync(
      join(import.meta.dir, '../permissionSetup.ts'),
      'utf8',
    )
    const start = src.indexOf(
      'export async function initializeToolPermissionContext(',
    )
    const body = src.slice(
      start,
      src.indexOf('loadAllPermissionRulesFromDisk()', start),
    )
    expect(body).toContain("(permissionMode === 'bypassPermissions' ||")
    expect(body).toContain('allowDangerouslySkipPermissions) &&')
    expect(body).toContain('!bypassDisabledBySettings &&')
    expect(body).toContain('!restricted')
    expect(body).not.toContain(
      'const isBypassPermissionsModeAvailable = !restricted',
    )
  })
})
