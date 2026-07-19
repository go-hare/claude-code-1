import { describe, expect, test } from 'bun:test'
import { parseBindings, parseKeystroke } from '../parser.js'
import {
  resolveActionForKeystroke,
  resolveKeyWithChordState,
} from '../resolver.js'
import type { KeybindingBlock } from '../types.js'

/**
 * densable singleKey / fQc alignment:
 * - resolveActionForKeystroke = fQc(RAt(key), context, bindings)
 * - default enter→chat:submit keeps singleKey:false so interceptor skips bare Enter
 * - rebound chat:submit (singleKey:true) is resolved by single-key chord resolve
 */
describe('resolveActionForKeystroke (densable fQc)', () => {
  const blocks: KeybindingBlock[] = [
    {
      context: 'Chat',
      bindings: {
        enter: 'chat:submit',
        'ctrl+s': 'chat:stash',
        'ctrl+j': 'chat:newline',
      },
    },
    {
      context: 'Global',
      bindings: {
        'ctrl+t': 'app:toggleTodos',
      },
    },
  ]
  const bindings = parseBindings(blocks)

  test('enter maps to chat:submit in Chat (default Bt=true)', () => {
    expect(
      resolveActionForKeystroke(parseKeystroke('enter'), 'Chat', bindings),
    ).toBe('chat:submit')
  })

  test('ctrl+s maps to chat:stash in Chat', () => {
    expect(
      resolveActionForKeystroke(parseKeystroke('ctrl+s'), 'Chat', bindings),
    ).toBe('chat:stash')
  })

  test('unbound key returns null', () => {
    expect(
      resolveActionForKeystroke(parseKeystroke('f1'), 'Chat', bindings),
    ).toBeNull()
  })

  test('last matching single-key binding wins (user override)', () => {
    const withOverride = parseBindings([
      ...blocks,
      {
        context: 'Chat',
        bindings: {
          enter: 'chat:newline',
        },
      },
    ])
    expect(
      resolveActionForKeystroke(parseKeystroke('enter'), 'Chat', withOverride),
    ).toBe('chat:newline')
  })

  test('ignores multi-keystroke chords', () => {
    const withChord = parseBindings([
      {
        context: 'Chat',
        bindings: {
          'ctrl+x ctrl+s': 'chat:submit',
          enter: 'chat:newline',
        },
      },
    ])
    // ctrl+x alone is not a single-key binding
    expect(
      resolveActionForKeystroke(parseKeystroke('ctrl+x'), 'Chat', withChord),
    ).toBeNull()
    expect(
      resolveActionForKeystroke(parseKeystroke('enter'), 'Chat', withChord),
    ).toBe('chat:newline')
  })
})

describe('singleKey resolve path (densable ChordInterceptor scan)', () => {
  test('rebound chat:submit on ctrl+s resolves as match for singleKey invoke', () => {
    const bindings = parseBindings([
      {
        context: 'Chat',
        bindings: {
          // enter no longer submits
          enter: 'chat:newline',
          'ctrl+s': 'chat:submit',
        },
      },
    ])

    // densable: enterIsSubmit = fQc(enter) === chat:submit → false → singleKey:true
    expect(
      resolveActionForKeystroke(parseKeystroke('enter'), 'Chat', bindings),
    ).toBe('chat:newline')

    const enterKey = {
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
    }

    const result = resolveKeyWithChordState(
      's',
      enterKey as never,
      ['Chat', 'Global'],
      bindings,
      null,
    )
    expect(result).toEqual({ type: 'match', action: 'chat:submit' })
  })

  test('default enter:chat:submit is a non-chord match (interceptor defers to TextInput)', () => {
    const bindings = parseBindings([
      {
        context: 'Chat',
        bindings: {
          enter: 'chat:submit',
        },
      },
    ])

    const enterKey = {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      pageDown: false,
      pageUp: false,
      home: false,
      end: false,
      return: true,
      escape: false,
      ctrl: false,
      shift: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      super: false,
      wheelUp: false,
      wheelDown: false,
    }

    // wasInChord=false → interceptor does not invoke unless singleKey
    const result = resolveKeyWithChordState(
      '\r',
      enterKey as never,
      ['Chat', 'Global'],
      bindings,
      null,
    )
    expect(result).toEqual({ type: 'match', action: 'chat:submit' })
    // And fQc confirms Bt so PromptInput sets singleKey:!true = false
    expect(
      resolveActionForKeystroke(parseKeystroke('enter'), 'Chat', bindings),
    ).toBe('chat:submit')
  })
})
