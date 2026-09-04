/**
 * densable 2.1.243 #13 — cached auto-mode disable must recheck GrowthBook
 * before permission-mode resolve (`Vo` / `wd` / `gb-killswitch-recheck`).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const growthbookSrc = readFileSync(
  join(import.meta.dir, '../growthbook.ts'),
  'utf8',
)
const mainSrc = readFileSync(join(import.meta.dir, '../../../main.tsx'), 'utf8')

describe('densable 2.1.243 #13 auto-mode cached disable', () => {
  test('wd sources match official override|disabled|payload|disk|fallback', () => {
    expect(growthbookSrc).toContain('export type FeatureValueSource =')
    expect(growthbookSrc).toContain("| 'override'")
    expect(growthbookSrc).toContain("| 'disabled'")
    expect(growthbookSrc).toContain("| 'payload'")
    expect(growthbookSrc).toContain("| 'disk'")
    expect(growthbookSrc).toContain("| 'fallback'")
    expect(growthbookSrc).toContain('export function getFeatureValueWithSource')
  })

  test('Vo waits 1500ms and swallows init failure', () => {
    expect(growthbookSrc).toContain(
      'export const GROWTHBOOK_PERMISSION_MODE_WAIT_MS = 1500',
    )
    expect(growthbookSrc).toContain(
      'export async function awaitGrowthBookInitForPermissionMode',
    )
    expect(growthbookSrc).toContain('.catch(() => {})')
  })

  test('empty cache waits gb-before-mode; disk disable waits killswitch recheck', () => {
    expect(growthbookSrc).toContain("'gb-before-mode'")
    expect(growthbookSrc).toContain("'gb-killswitch-recheck'")
    expect(growthbookSrc).toContain("'tengu_auto_mode_config'")
    expect(growthbookSrc).toContain("config.value?.enabled === 'disabled'")
    expect(growthbookSrc).toContain("config.source === 'disk'")
    expect(growthbookSrc).toContain('hasAnyGrowthBookOverrides()')
  })

  test('main awaits Vo before qc / initialPermissionModeFromCLI', () => {
    const awaitAt = mainSrc.indexOf(
      'await awaitGrowthBookBeforePermissionMode()',
    )
    const qcAt = mainSrc.indexOf('initialPermissionModeFromCLI({')
    expect(awaitAt).toBeGreaterThan(0)
    expect(qcAt).toBeGreaterThan(awaitAt)
    expect(qcAt - awaitAt).toBeLessThan(400)
  })
})
