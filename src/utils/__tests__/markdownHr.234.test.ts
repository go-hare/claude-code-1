/**
 * densable 2.1.234 #16 — HR renders with trailing newline so it does not
 * run into the next line (SEA `case"hr":return"---"+AY`).
 */
import { describe, expect, test } from 'bun:test'
import { configureMarked, formatToken } from '../markdown.js'

describe('densable 2.1.234 #16 markdown HR', () => {
  test('hr token appends trailing newline', () => {
    configureMarked()
    const rendered = formatToken(
      { type: 'hr', raw: '---' } as never,
      'dark' as never,
    )
    expect(rendered).toBe('---\n')
  })
})
