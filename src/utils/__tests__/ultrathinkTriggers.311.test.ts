import { describe, expect, test } from 'bun:test'
import { findThinkingTriggerPositions } from '../thinking.js'

describe('ultrathink trigger positions (2.1.311 #1288)', () => {
  test('highlights standalone ultrathink in normal prose', () => {
    const pos = findThinkingTriggerPositions('please ultrathink about this')
    expect(pos).toEqual([{ word: 'ultrathink', start: 7, end: 17 }])
  })

  test('ignores slash commands starting with /', () => {
    expect(findThinkingTriggerPositions('/review ultrathink')).toEqual([])
  })

  test('ignores ultrathink inside quotes and brackets', () => {
    expect(findThinkingTriggerPositions('use "ultrathink" here')).toEqual([])
    expect(findThinkingTriggerPositions("use 'ultrathink' here")).toEqual([])
    expect(findThinkingTriggerPositions('use `ultrathink` here')).toEqual([])
    expect(findThinkingTriggerPositions('see (ultrathink) note')).toEqual([])
    expect(findThinkingTriggerPositions('see [ultrathink] note')).toEqual([])
    expect(findThinkingTriggerPositions('see {ultrathink} note')).toEqual([])
    expect(findThinkingTriggerPositions('<ultrathink>')).toEqual([])
  })

  test('allows apostrophes inside words without breaking delimiter matching', () => {
    const pos = findThinkingTriggerPositions("don't forget to ultrathink")
    expect(pos).toEqual([{ word: 'ultrathink', start: 16, end: 26 }])
  })

  test('ignores ultrathink in file paths, flags, and URLs', () => {
    expect(findThinkingTriggerPositions('open /tmp/ultrathink/file')).toEqual(
      [],
    )
    expect(findThinkingTriggerPositions('open src\\ultrathink\\x')).toEqual([])
    expect(findThinkingTriggerPositions('pass --ultrathink-mode')).toEqual([])
    expect(findThinkingTriggerPositions('check ultrathink?')).toEqual([])
    expect(findThinkingTriggerPositions('check ultrathink.ts')).toEqual([])
    expect(findThinkingTriggerPositions('check ultrathink?')).toEqual([])
  })

  test('allows ultrathink followed by sentence-ending period', () => {
    const pos = findThinkingTriggerPositions('please ultrathink.')
    expect(pos).toEqual([{ word: 'ultrathink', start: 7, end: 17 }])
  })
})
