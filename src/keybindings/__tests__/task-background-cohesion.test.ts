import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../defaultBindings.js'
import { parseBindings, parseChord, chordToString } from '../parser.js'
import { resolveKeyWithChordState } from '../resolver.js'
import {
  formatTaskBackgroundTmuxShortcut,
  isTaskBackgroundBindingCustomized,
  TASK_BACKGROUND_COHESION_KEY,
  TASK_BACKGROUND_DEFAULT_KEY,
} from '../useTaskBackgroundKeybinding.js'

/**
 * densable task:background cohesion (tpr / Um_):
 * - default Task binds ctrl+x ctrl+b AND ctrl+b
 * - Um_ detects customized Task bindings
 * - tmux display doubles ctrl+b tokens only
 */

function ctrlLetterKey(letter: string) {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: true,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    wheelUp: false,
    wheelDown: false,
    fn: false,
    // letter is carried via input arg, not Key
    _letter: letter,
  }
}

describe('densable task:background default bindings', () => {
  const bindings = parseBindings(DEFAULT_BINDINGS)

  test('Task defaults include ctrl+b and ctrl+x ctrl+b', () => {
    const taskBg = bindings.filter(
      b => b.context === 'Task' && b.action === 'task:background',
    )
    const fingerprints = new Set(taskBg.map(b => chordToString(b.chord)))
    expect(
      fingerprints.has(chordToString(parseChord(TASK_BACKGROUND_DEFAULT_KEY))),
    ).toBe(true)
    expect(
      fingerprints.has(chordToString(parseChord(TASK_BACKGROUND_COHESION_KEY))),
    ).toBe(true)
  })

  test('default pair is not considered customized', () => {
    expect(isTaskBackgroundBindingCustomized(bindings)).toBe(false)
  })

  test('ctrl+b single-key resolves to task:background in Task', () => {
    const key = ctrlLetterKey('b')
    const result = resolveKeyWithChordState(
      'b',
      key as never,
      ['Task', 'Global'],
      bindings,
      null,
    )
    expect(result).toEqual({ type: 'match', action: 'task:background' })
  })

  test('ctrl+x starts chord then ctrl+b completes task:background', () => {
    const started = resolveKeyWithChordState(
      'x',
      ctrlLetterKey('x') as never,
      ['Task', 'Global'],
      bindings,
      null,
    )
    expect(started.type).toBe('chord_started')
    if (started.type !== 'chord_started') return

    const completed = resolveKeyWithChordState(
      'b',
      ctrlLetterKey('b') as never,
      ['Task', 'Global'],
      bindings,
      started.pending,
    )
    expect(completed).toEqual({ type: 'match', action: 'task:background' })
  })
})

describe('isTaskBackgroundBindingCustomized (densable Um_)', () => {
  test('custom chord is customized', () => {
    const bindings = parseBindings([
      {
        context: 'Task',
        bindings: {
          'ctrl+shift+b': 'task:background',
        },
      },
    ])
    expect(isTaskBackgroundBindingCustomized(bindings)).toBe(true)
  })

  test('null-unbind of default ctrl+b is customized', () => {
    const bindings = parseBindings([
      ...DEFAULT_BINDINGS,
      {
        context: 'Task',
        bindings: {
          'ctrl+b': null,
        },
      },
    ])
    expect(isTaskBackgroundBindingCustomized(bindings)).toBe(true)
  })

  test('only default pair remains non-customized', () => {
    const bindings = parseBindings([
      {
        context: 'Task',
        bindings: {
          'ctrl+x ctrl+b': 'task:background',
          'ctrl+b': 'task:background',
        },
      },
    ])
    expect(isTaskBackgroundBindingCustomized(bindings)).toBe(false)
  })
})

describe('formatTaskBackgroundTmuxShortcut', () => {
  test('doubles bare ctrl+b', () => {
    expect(formatTaskBackgroundTmuxShortcut('ctrl+b')).toBe('ctrl+b ctrl+b')
  })

  test('doubles only ctrl+b tokens in cohesion chord', () => {
    expect(formatTaskBackgroundTmuxShortcut('ctrl+x ctrl+b')).toBe(
      'ctrl+x ctrl+b ctrl+b',
    )
  })

  test('empty stays empty', () => {
    expect(formatTaskBackgroundTmuxShortcut('')).toBe('')
  })
})
