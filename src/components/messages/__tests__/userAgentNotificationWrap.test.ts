import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORPHAN_SHELL_STOPPED_SUMMARY } from '../../../utils/orphanAgentResume.js'

describe('UserAgentNotificationMessage wrap', () => {
  test('gold Sp is one Text [circle, space, summary] — not a grow-column', () => {
    const src = readFileSync(
      join(import.meta.dir, '../UserAgentNotificationMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('flexDirection="column"')
    expect(src).toContain('aria-hidden')
    expect(src).toContain('{BLACK_CIRCLE}')
    expect(src).toContain("{' '}")
    expect(src).toContain('{summary}')
    expect(src).not.toMatch(/flexGrow=\{/)
    expect(src).not.toContain('width="100%"')
    expect(src).not.toContain('flexDirection="row"')
  })

  test('orphan shell summary stays a single long paragraph for the wrap path', () => {
    expect(ORPHAN_SHELL_STOPPED_SUMMARY.includes('\n')).toBe(false)
    expect(ORPHAN_SHELL_STOPPED_SUMMARY.length).toBeGreaterThan(200)
    expect(
      ORPHAN_SHELL_STOPPED_SUMMARY.startsWith('No completion record was found'),
    ).toBe(true)
  })
})
