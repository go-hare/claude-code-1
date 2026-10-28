/**
 * densable 2.1.289 Auto-compact /config row:
 *   value: t0t `s.autoCompactEnabled` (settings ?? global)
 *   persist: W2 → userSettings (`B('autoCompactEnabled')`) then live `w`
 *   gate: Lf / Yo("autoCompactEnabled", true)
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const config = readFileSync(join(import.meta.dir, '../Config.tsx'), 'utf8')
const gate = readFileSync(
  join(import.meta.dir, '../../../services/compact/autoCompact.ts'),
  'utf8',
)

describe('densable 2.1.289 autoCompact W2 / Yo', () => {
  test('hKe row reads settings then global, writes userSettings', () => {
    expect(config).toContain("id: 'autoCompact'")
    expect(config).toContain("label: 'Auto-compact'")
    expect(config).toContain(
      'settingsData?.autoCompactEnabled ?? globalConfig.autoCompactEnabled',
    )
    expect(config).toContain("B('autoCompactEnabled', autoCompactEnabled)")
    expect(config).toContain(
      'setGlobalConfig({ ...globalConfig, autoCompactEnabled })',
    )
    expect(config).not.toContain(
      'W(current => ({ ...current, autoCompactEnabled }))',
    )
    expect(config).toContain('autoCompactEnabled: iu?.autoCompactEnabled')
    expect(config).toContain(
      '// densable `w` — live snapshot only. Persist is W2/`B` (userSettings).',
    )
  })

  test('Lf reads Yo settings before legacy GlobalConfig', () => {
    const fn = gate.slice(gate.indexOf('export function isAutoCompactEnabled'))
    expect(fn.indexOf('DISABLE_COMPACT')).toBeLessThan(
      fn.indexOf('DISABLE_AUTO_COMPACT'),
    )
    expect(fn.indexOf('getInitialSettings().autoCompactEnabled')).toBeLessThan(
      fn.indexOf('getGlobalConfig().autoCompactEnabled'),
    )
  })
})
