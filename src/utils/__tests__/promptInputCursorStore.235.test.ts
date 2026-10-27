/**
 * densable 2.1.235 #15 — savedCursorOffset / acf / Oyr remount restore.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  clampNormalModeCursorOffset,
  getPromptInputCursorState,
  getPromptInputStoreStash,
  getPromptInputValueStore,
  getSavedPromptInputCursorOffset,
  normalizeVimModeForCursorRestore,
  resetPromptInputCursorStoreForTests,
  resolveRemountCursorOffset,
  savePromptInputCursorOffset,
  setPromptInputStoreStash,
  setPromptInputStoreValue,
} from '../promptInputCursorStore.js'

afterEach(() => {
  resetPromptInputCursorStoreForTests()
})

describe('densable 2.1.289 nD valueStore fields', () => {
  test('initial state has stash/linkSuppliedTexts/submittedLinkPrefill', () => {
    const s = getPromptInputCursorState()
    expect(s.stash).toBeNull()
    expect(s.submittedLinkPrefill).toBeNull()
    expect(s.linkSuppliedTexts.size).toBe(0)
    expect(s.active).toBe(false)
  })

  test('sSr stash round-trip', () => {
    setPromptInputStoreStash({
      text: 'x',
      cursorOffset: 1,
      mode: 'prompt',
      pastedContents: {},
    })
    expect(getPromptInputStoreStash()?.text).toBe('x')
    setPromptInputStoreStash(null)
    expect(getPromptInputStoreStash()).toBeNull()
  })
})

describe('densable 2.1.235 #15 savedCursorOffset', () => {
  test('acf save + remount restore mid-string offset', () => {
    savePromptInputCursorOffset(3)
    expect(getSavedPromptInputCursorOffset()).toBe(3)
    expect(
      resolveRemountCursorOffset({
        input: 'abcdef',
        vimEnabled: false,
        vimMode: 'INSERT',
      }),
    ).toBe(3)
  })

  test('no saved offset → end of input (legacy jump)', () => {
    expect(
      resolveRemountCursorOffset({
        input: 'hello',
        vimEnabled: true,
        vimMode: 'INSERT',
      }),
    ).toBe(5)
  })

  test('NORMAL Oyr clamp: EOF lands on last grapheme, not past it', () => {
    expect(clampNormalModeCursorOffset('abc', 3)).toBe(2)
    expect(
      resolveRemountCursorOffset({
        input: 'abc',
        vimEnabled: true,
        vimMode: 'NORMAL',
      }),
    ).toBe(2)
  })

  test('NORMAL Oyr clamp: before newline sits on last char of line', () => {
    expect(clampNormalModeCursorOffset('ab\ncd', 2)).toBe(1)
  })

  test('RgE: VISUAL* collapses to NORMAL for restore', () => {
    expect(normalizeVimModeForCursorRestore('VISUAL')).toBe('NORMAL')
    expect(normalizeVimModeForCursorRestore('VISUAL LINE')).toBe('NORMAL')
    expect(normalizeVimModeForCursorRestore('INSERT')).toBe('INSERT')
  })

  test('pyt setValue clears savedCursorOffset', () => {
    savePromptInputCursorOffset(4)
    setPromptInputStoreValue('changed')
    expect(getSavedPromptInputCursorOffset()).toBeNull()
  })

  test('saved past length falls back to end', () => {
    savePromptInputCursorOffset(99)
    expect(
      resolveRemountCursorOffset({
        input: 'hi',
        vimEnabled: false,
        vimMode: 'INSERT',
      }),
    ).toBe(2)
  })

  test('NORMAL remount restores mid-buffer saved offset without clamp', () => {
    savePromptInputCursorOffset(2)
    expect(
      resolveRemountCursorOffset({
        input: 'hello',
        vimEnabled: true,
        vimMode: 'NORMAL',
      }),
    ).toBe(2)
  })

  test('NORMAL remount with saved EOF applies Oyr', () => {
    savePromptInputCursorOffset(5)
    expect(
      resolveRemountCursorOffset({
        input: 'hello',
        vimEnabled: true,
        vimMode: 'NORMAL',
      }),
    ).toBe(4)
  })
})

describe('densable 2.1.289 wLe empty clears launchWarning', () => {
  test('emptying non-empty value clears launchWarning', () => {
    getPromptInputValueStore().setState(prev => ({
      ...prev,
      value: 'deeplink',
      launchWarning: { type: 'deep-link', text: undefined },
    }))
    setPromptInputStoreValue('')
    const s = getPromptInputCursorState()
    expect(s.value).toBe('')
    expect(s.launchWarning).toBeNull()
    expect(s.linkSuppliedTexts.has('deeplink')).toBe(true)
    expect(s.submittedLinkPrefill).toBe('deeplink')
  })
})
