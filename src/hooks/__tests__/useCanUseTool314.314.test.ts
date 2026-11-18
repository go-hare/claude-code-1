import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('#1388 & #1426 useCanUseTool auto-mode denial handling (2.1.314)', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/hooks/useCanUseTool.tsx'),
    'utf8',
  )

  test('#1388 excludes decisionReason.noVerdict === true from recordAutoModeDenial and auto-mode-denied', () => {
    expect(src).toContain("'noVerdict' in result.decisionReason")
    expect(src).toContain('if (!hasNoVerdict)')
  })

  test('#1426 formats auto-mode-denied notification with blocked by auto mode, /permissions, and Auto mode: label', () => {
    expect(src).toContain('{toolLabel} blocked by auto mode')
    expect(src).toContain('· /permissions')
    expect(src).toContain('`Auto mode: ${reasonHint}`')
  })
})
