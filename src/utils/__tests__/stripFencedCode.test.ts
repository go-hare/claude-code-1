import { describe, expect, test } from 'bun:test'
import { stripOuterMarkdownFences } from '../stripFencedCode.js'

describe('stripOuterMarkdownFences densable eee', () => {
  test('strips language fence', () => {
    expect(stripOuterMarkdownFences('```ts\nconst x = 1\n```')).toBe(
      'const x = 1',
    )
  })

  test('strips bare fence', () => {
    expect(stripOuterMarkdownFences('```\nhi\n```')).toBe('hi')
  })

  test('no fence unchanged (trimmed)', () => {
    expect(stripOuterMarkdownFences('  plain  ')).toBe('plain')
  })
})
