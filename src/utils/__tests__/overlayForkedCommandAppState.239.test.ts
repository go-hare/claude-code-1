/**
 * densable 2.1.239 leftover — official oSi.
 */
import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { AppState } from '../../state/AppState.js'
import { overlayForkedCommandAppState } from '../forkedAgent.js'

function app(commandAllow: string[] = [], commandDeny: string[] = []) {
  const toolPermissionContext = getEmptyToolPermissionContext()
  toolPermissionContext.alwaysAllowRules.command = commandAllow
  toolPermissionContext.alwaysDenyRules.command = commandDeny
  return {
    getAppState: () => ({ toolPermissionContext }) as unknown as AppState,
  }
}

describe('densable 2.1.239 oSi leftover', () => {
  test('identity when lists are empty and no replace/freeze', () => {
    const { getAppState } = app()
    expect(overlayForkedCommandAppState(getAppState, [], [])).toBe(getAppState)
  })

  test('merge allowed when replace is off', () => {
    const { getAppState } = app(['Bash'])
    const next = overlayForkedCommandAppState(getAppState, ['Read'], [])
    expect(next().toolPermissionContext.alwaysAllowRules.command).toEqual([
      'Bash',
      'Read',
    ])
  })

  test('replaceCommandRules replaces allow list', () => {
    const { getAppState } = app(['Bash'])
    const next = overlayForkedCommandAppState(getAppState, ['Read'], [], {
      replaceCommandRules: true,
    })
    expect(next().toolPermissionContext.alwaysAllowRules.command).toEqual([
      'Read',
    ])
  })

  test('replaceDenyRules replaces deny list', () => {
    const { getAppState } = app([], ['Write'])
    const next = overlayForkedCommandAppState(getAppState, [], ['Edit'], {
      replaceDenyRules: true,
    })
    expect(next().toolPermissionContext.alwaysDenyRules.command).toEqual([
      'Edit',
    ])
  })

  test('frozenCommandDenies prepends then unique-merges', () => {
    const { getAppState } = app([], ['Write'])
    const next = overlayForkedCommandAppState(getAppState, [], ['Edit'], {
      frozenCommandDenies: ['Bash'],
    })
    expect(next().toolPermissionContext.alwaysDenyRules.command).toEqual([
      'Bash',
      'Write',
      'Edit',
    ])
  })
})
