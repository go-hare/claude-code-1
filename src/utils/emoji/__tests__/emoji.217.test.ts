import { describe, expect, test } from 'bun:test'
import {
  EMOJI_COMPLETE_RE,
  EMOJI_PARTIAL_RE,
  EMOJI_SUGGESTION_LIMIT,
  getEmoji,
  getEmojiSuggestions,
  isEmojiJustCompleted,
} from '../index.js'

describe('emoji shortcode (densable 2.1.217 #1)', () => {
  test('map has densable shortcodes', () => {
    expect(getEmoji('zzz')).toBeTruthy()
    expect(getEmoji('+1')).toBeTruthy()
    expect(getEmoji('smile')).toBeTruthy()
  })

  test('getEmojiSuggestions sorts startsWith then length, limit 20', () => {
    const s = getEmojiSuggestions('sm')
    expect(s.length).toBeGreaterThan(0)
    expect(s.length).toBeLessThanOrEqual(EMOJI_SUGGESTION_LIMIT)
    // startsWith preferred
    expect(s[0]!.description.startsWith(':sm')).toBe(true)
    expect(s[0]!.id.startsWith('emoji:')).toBe(true)
    expect(s[0]!.displayText).toBeTruthy()
  })

  test('partial regex requires ≥2 body chars', () => {
    expect(':a'.match(EMOJI_PARTIAL_RE)).toBeNull()
    expect('hi :ab'.match(EMOJI_PARTIAL_RE)?.[2]).toBe('ab')
  })

  test('complete regex matches :name:', () => {
    expect('x :smile:'.match(EMOJI_COMPLETE_RE)?.[2]).toBe('smile')
  })

  test('isEmojiJustCompleted detects closing colon type', () => {
    // 'hi :smile:' length 10 — cursor at end after typing the closing ':'
    expect(isEmojiJustCompleted('hi :smile:', 'hi :smile', 10)).toBe(true)
    // previous not a pure prefix growth of shortcode body+':'
    expect(isEmojiJustCompleted('hi :smile:', 'xx :smile', 10)).toBe(false)
    expect(isEmojiJustCompleted('hi :smile:', undefined, 10)).toBe(false)
  })
})
