import { describe, expect, test } from 'bun:test'
import type { Key } from '@anthropic/ink'
import { resolveKey } from '@anthropic/ink'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { parseBindings } from '../keybindings/parser.js'

/**
 * densable ChordInterceptor singleKey resolves each registration as
 * [...activeContexts, registration.context, 'Global'] with last-wins.
 * Elevating Footer / MessageSelector / HistorySearch / Transcript / Settings
 * into activeContexts is required so overlapping keys don't stick on Chat/Global.
 */
describe('context elevation last-wins (densable Dnt / activeContexts)', () => {
  const bindings = parseBindings(DEFAULT_BINDINGS)

  const bare = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    wheelUp: false,
    wheelDown: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    fn: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
  } as Key

  test('Settings elevated: ctrl+d/u last-win halfPage over Global app:exit', () => {
    const ctrl = { ...bare, ctrl: true }
    expect(resolveKey('d', ctrl, ['Global'], bindings)).toEqual({
      type: 'match',
      action: 'app:exit',
    })
    expect(resolveKey('d', ctrl, ['Settings', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'scroll:halfPageDown',
    })
    expect(resolveKey('u', ctrl, ['Settings', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'scroll:halfPageUp',
    })
  })

  test('Footer elevated: enter/escape last-win over Chat', () => {
    // Without Footer in activeContexts, Chat owns enter
    expect(
      resolveKey('', { ...bare, return: true }, ['Chat', 'Global'], bindings),
    ).toEqual({ type: 'match', action: 'chat:submit' })

    // With Footer elevated (pill focused), footer:* wins
    expect(
      resolveKey(
        '',
        { ...bare, return: true },
        ['Footer', 'Chat', 'Global'],
        bindings,
      ),
    ).toEqual({ type: 'match', action: 'footer:openSelected' })

    expect(
      resolveKey(
        '',
        { ...bare, escape: true },
        ['Footer', 'Chat', 'Global'],
        bindings,
      ),
    ).toEqual({ type: 'match', action: 'footer:clearSelection' })

    // x → footer:close when Footer elevated
    expect(
      resolveKey('x', bare, ['Footer', 'Chat', 'Global'], bindings),
    ).toEqual({ type: 'match', action: 'footer:close' })
  })

  test('MessageSelector elevated: j/k/enter last-win over Chat', () => {
    expect(
      resolveKey('j', bare, ['MessageSelector', 'Chat', 'Global'], bindings),
    ).toEqual({ type: 'match', action: 'messageSelector:down' })
    expect(
      resolveKey('k', bare, ['MessageSelector', 'Chat', 'Global'], bindings),
    ).toEqual({ type: 'match', action: 'messageSelector:up' })
    expect(
      resolveKey(
        '',
        { ...bare, return: true },
        ['MessageSelector', 'Chat', 'Global'],
        bindings,
      ),
    ).toEqual({ type: 'match', action: 'messageSelector:select' })
  })

  test('HistorySearch elevated: ctrl+c / ctrl+r last-win over Global', () => {
    const ctrl = { ...bare, ctrl: true }
    // Global alone
    expect(resolveKey('c', ctrl, ['Global'], bindings)).toEqual({
      type: 'match',
      action: 'app:interrupt',
    })
    expect(resolveKey('r', ctrl, ['Global'], bindings)).toEqual({
      type: 'match',
      action: 'history:search',
    })
    // HistorySearch elevated
    expect(
      resolveKey('c', ctrl, ['HistorySearch', 'Global'], bindings),
    ).toEqual({ type: 'match', action: 'historySearch:cancel' })
    expect(
      resolveKey('r', ctrl, ['HistorySearch', 'Global'], bindings),
    ).toEqual({ type: 'match', action: 'historySearch:next' })
  })

  test('Autocomplete elevated: escape last-win over Chat', () => {
    expect(
      resolveKey(
        '',
        { ...bare, escape: true },
        ['Autocomplete', 'Chat', 'Global'],
        bindings,
      ),
    ).toEqual({ type: 'match', action: 'autocomplete:dismiss' })
  })
})
