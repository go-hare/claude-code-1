import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORPHAN_SHELL_STOPPED_SUMMARY } from '../../../utils/orphanAgentResume.js'

describe('UserAgentNotificationMessage wrap', () => {
  test('2.1.326 #118: uses 2-column bullet row so wrapped background results align with text', () => {
    const src = readFileSync(
      join(import.meta.dir, '../UserAgentNotificationMessage.tsx'),
      'utf8',
    )
    // Official 2.1.326 #118 (`nh` -> `ui`): 2-column row with minWidth={2} bullet gutter.
    const summaryHost = src.slice(
      src.indexOf('export function UserAgentNotificationMessage('),
      src.indexOf('if (messageId === undefined || skipSite)'),
    )
    expect(summaryHost).toContain('flexDirection="row"')
    expect(summaryHost).toContain('minWidth={2}')
    expect(summaryHost).toContain('flexGrow={1}')
    expect(src).toContain('aria-hidden')
    expect(src).toContain('{BLACK_CIRCLE}')
    expect(src).toContain('{summary}')
    expect(src).toContain('unescapeXmlEntities')
    expect(src).toContain("extractTag(text, 'duration_ms')")
    expect(src).toContain('formatDuration')
  })

  test('orphan shell summary stays a single long paragraph for the wrap path', () => {
    expect(ORPHAN_SHELL_STOPPED_SUMMARY.includes('\n')).toBe(false)
    expect(ORPHAN_SHELL_STOPPED_SUMMARY.length).toBeGreaterThan(200)
    expect(
      ORPHAN_SHELL_STOPPED_SUMMARY.startsWith('No completion record was found'),
    ).toBe(true)
  })
})
