/**
 * densable 2.1.289 Kx idle prompt char is dimColor, not USER_TYPE subtle / isLoading-gated.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(
  join(import.meta.dir, '../PromptInputModeIndicator.tsx'),
  'utf8',
)

describe('densable 2.1.289 Kx idle PromptChar', () => {
  test('idle pointer is dimColor, not USER_TYPE subtle or isLoading-gated', () => {
    expect(src).toContain('if (themeColor)')
    expect(src).toContain('<Text dimColor>')
    expect(src).not.toContain("process.env.USER_TYPE === 'ant'")
    expect(src).not.toContain("isAnt ? 'subtle'")
    const idle = src.slice(
      src.indexOf('return (', src.indexOf('if (themeColor)')) + 1,
    )
    expect(idle).toContain('<Text dimColor>')
    const bash = src.slice(
      src.indexOf("mode === 'bash'"),
      src.indexOf(
        '<PromptChar isLoading={isLoading} themeColor={isAgentSwarmsEnabled()',
      ),
    )
    expect(bash).toContain('color="bashBorder"')
    expect(bash).not.toContain('dimColor={isLoading}')
  })
})
