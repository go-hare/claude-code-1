/**
 * densable 2.1.239 #52 / #41 — readline word keys + placeholder kill.
 */
import { describe, expect, test } from 'bun:test'
import { Cursor } from '../Cursor.js'

describe('Cursor readline word keys densable 2.1.239', () => {
  test('forwardWord stops at punctuation; nextWord jumps to next start', () => {
    const text = 'foo,bar'
    const cursor = Cursor.fromText(text, 80, 0)
    expect(cursor.forwardWord().offset).toBe(3)
    expect(cursor.nextWord().offset).toBe(4)
    expect(cursor.forwardWord().text).toBe(text)
  })

  test('foo.bar punctuation separates readline words', () => {
    const text = 'foo.bar'
    const cursor = Cursor.fromText(text, 80, 0)
    expect(cursor.forwardWord().offset).toBe(3)
    expect(cursor.killWord().killed).toBe('foo')
    expect(cursor.killWord().cursor.text).toBe('.bar')
  })

  test('backwardWord / backwardKillWord are symmetric', () => {
    const text = 'foo,bar'
    const cursor = Cursor.fromText(text, 80, text.length)
    expect(cursor.backwardWord().offset).toBe(4)
    expect(cursor.backwardKillWord().killed).toBe('bar')
    expect(cursor.backwardKillWord().cursor.text).toBe('foo,')
  })

  test('killRange does not tear [Pasted text #N]', () => {
    const text = 'see [Pasted text #1] more'
    const inside = text.indexOf('Pasted')
    const cursor = Cursor.fromText(text, 80, inside)
    const { cursor: next, killed } = cursor.killWord()
    expect(killed).toContain('[Pasted text #1]')
    expect(next.text).not.toMatch(/\[Pasted text/)
    expect(next.text.includes('[Pasted')).toBe(false)
  })

  test('left/right hop a pasted chip as one unit', () => {
    const text = 'x[Pasted text #2]y'
    const start = text.indexOf('[')
    const end = text.indexOf(']') + 1
    const atStart = Cursor.fromText(text, 80, start)
    expect(atStart.right().offset).toBe(end)
    const atEnd = Cursor.fromText(text, 80, end)
    expect(atEnd.left().offset).toBe(start)
  })

  test('deleteWORDBefore still uses whitespace WORD via killRange', () => {
    const text = 'foo bar-baz'
    const cursor = Cursor.fromText(text, 80, text.length)
    const word = cursor.deleteWORDBefore()
    expect(word.killed).toBe('bar-baz')
    expect(word.cursor.text).toBe('foo ')
  })
})
