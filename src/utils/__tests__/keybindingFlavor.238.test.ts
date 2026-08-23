import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'
import { Cursor } from '../Cursor.js'
import { SettingsSchema } from '../settings/types.js'

const settingsSnap = snapshotModuleExports(realSettings)

let settingsState: Record<string, unknown> = {}

mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => settingsState,
  }),
)
mock.module(
  '../settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => settingsState,
  }),
)

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
    '../settings/settings.js',
  ])
})

beforeEach(() => {
  settingsState = {}
})

describe('Cursor.deleteWORDBefore (densable 2.1.238)', () => {
  test('classic word stops at punctuation; WORD clears to whitespace', () => {
    const text = 'foo bar-baz'
    const cursor = Cursor.fromText(text, 80, text.length)

    const classic = cursor.deleteWordBefore()
    expect(classic.killed).toBe('baz')
    expect(classic.cursor.text).toBe('foo bar-')

    const word = cursor.deleteWORDBefore()
    expect(word.killed).toBe('bar-baz')
    expect(word.cursor.text).toBe('foo ')
  })

  test('WORD treats hyphenated token as one unit', () => {
    const text = 'hello-world!'
    const cursor = Cursor.fromText(text, 80, text.length)
    const classic = cursor.deleteWordBefore()
    const word = cursor.deleteWORDBefore()
    expect(classic.killed).toBe('world!')
    expect(classic.cursor.text).toBe('hello-')
    expect(word.killed).toBe('hello-world!')
    expect(word.cursor.text).toBe('')
  })

  test('at start returns empty kill', () => {
    const cursor = Cursor.fromText('abc', 80, 0)
    expect(cursor.deleteWORDBefore()).toEqual({ cursor, killed: '' })
  })
})

describe('SettingsSchema keybindingFlavor', () => {
  test('accepts classic and readline; omittable', () => {
    expect(SettingsSchema().safeParse({}).success).toBe(true)
    expect(
      SettingsSchema().safeParse({ keybindingFlavor: 'classic' }).success,
    ).toBe(true)
    expect(
      SettingsSchema().safeParse({ keybindingFlavor: 'readline' }).success,
    ).toBe(true)
    expect(
      SettingsSchema().safeParse({ keybindingFlavor: 'emacs' }).success,
    ).toBe(false)
  })
})

describe('getKeybindingFlavor (SEA xKi)', () => {
  test('defaults to classic when unset', async () => {
    const { getKeybindingFlavor, DEFAULT_KEYBINDING_FLAVOR } = await import(
      '../keybindingFlavor.js'
    )
    expect(DEFAULT_KEYBINDING_FLAVOR).toBe('classic')
    expect(getKeybindingFlavor()).toBe('classic')
  })

  test('reads readline from settings', async () => {
    settingsState = { keybindingFlavor: 'readline' }
    const { getKeybindingFlavor } = await import('../keybindingFlavor.js')
    expect(getKeybindingFlavor()).toBe('readline')
  })
})
