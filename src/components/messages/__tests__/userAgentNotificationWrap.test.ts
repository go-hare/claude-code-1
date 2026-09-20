import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORPHAN_SHELL_STOPPED_SUMMARY } from '../../../utils/orphanAgentResume.js'

describe('UserAgentNotificationMessage wrap', () => {
  test('long summaries wrap in a width-constrained column (not one unbounded Text)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../UserAgentNotificationMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('width="100%"')
    expect(src).toContain('flexDirection="row"')
    expect(src).toContain('flexDirection="column"')
    expect(src).toContain('flexShrink={1}')
    // Guard against the old one-line layout that ConPTY overwrites.
    expect(src).not.toMatch(
      /<Text>\s*<Text color=\{color\}>\{BLACK_CIRCLE\}<\/Text> \{summary\}/,
    )
  })

  test('orphan shell summary stays a single long paragraph for the wrap path', () => {
    expect(ORPHAN_SHELL_STOPPED_SUMMARY.includes('\n')).toBe(false)
    expect(ORPHAN_SHELL_STOPPED_SUMMARY.length).toBeGreaterThan(200)
    expect(
      ORPHAN_SHELL_STOPPED_SUMMARY.startsWith('No completion record was found'),
    ).toBe(true)
  })
})
