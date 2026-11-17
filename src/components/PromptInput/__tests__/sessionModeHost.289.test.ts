import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const footer = readFileSync(
  join(import.meta.dir, '../PromptInputFooter.tsx'),
  'utf8',
)
const pill = readFileSync(
  join(import.meta.dir, '../PromptInputFooterLeftSide.tsx'),
  'utf8',
)

describe('densable 2.1.289 SessionMode SessionStateRow', () => {
  test('jF lives on the footer SessionStateRow, not ModePill', () => {
    expect(footer).toContain("component: 'SessionMode'")
    expect(footer).toContain("requestId: 'session-mode'")
    expect(footer).toContain("shownModes.join(' & ')")
    expect(footer).toContain("separated ? ' · '")
    expect(footer).toContain("memoryToggledOff() ? ['memory paused']")
    expect(pill).not.toContain("component: 'SessionMode'")
    expect(pill).toContain('{permissionModeIndicator(mode)}')
    expect(pill).toContain("{' on'}")
  })
})
