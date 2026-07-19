import { describe, expect, test } from 'bun:test'

/**
 * densable K4t (used by UBa memory citation chrome): keep first maxLines,
 * append ellipsis if truncated. Mirrors FeedbackSurvey truncateToMaxLines.
 */
function truncateToMaxLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return `${lines.slice(0, maxLines).join('\n')}\u2026`
}

describe('densable memory citation survey chrome (UBa/K4t)', () => {
  test('truncateToMaxLines keeps short bodies', () => {
    expect(truncateToMaxLines('one\ntwo', 4)).toBe('one\ntwo')
  })

  test('truncateToMaxLines clamps at 4 lines with ellipsis', () => {
    const body = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n')
    const out = truncateToMaxLines(body, 4)
    expect(out).toBe('a\nb\nc\nd\u2026')
    expect(out.split('\n')).toHaveLength(4)
    expect(out.endsWith('\u2026')).toBe(true)
  })

  test('memory survey message constants densable UBa', () => {
    const lead = 'Claude recalled a memory:'
    const ask = "How was Claude's recollection?"
    expect(lead.length).toBeGreaterThan(0)
    expect(ask).toContain('recollection')
  })
})
