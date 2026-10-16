import { describe, expect, test } from 'bun:test'

import {
  designSystemsListPermissionRule,
  hasPreToolUseHook,
  typesListPermissionRule,
} from '../quickstartRules.js'

function ruleContext(deny: string[] = [], ask: string[] = []) {
  return {
    getAppState: () => ({
      toolPermissionContext: {
        alwaysDenyRules: { user: deny },
        alwaysAskRules: { user: ask },
      },
    }),
  }
}

describe('gold 2.1.289 Artifact ra/bit analog', () => {
  test('Artifact(list_types) deny hits typesListPermissionRule', () => {
    expect(typesListPermissionRule(ruleContext(['Artifact(list_types)']))).toBe(
      'Artifact(list_types)',
    )
  })

  test('Artifact({action:list,scope:types}) deny hits leftover object form', () => {
    expect(
      typesListPermissionRule(
        ruleContext(['Artifact({action:list,scope:types})']),
      ),
    ).toBe('Artifact({action:list,scope:types})')
  })

  test('Artifact({action: "list", scope: "types"}) deny hits', () => {
    expect(
      typesListPermissionRule(
        ruleContext(['Artifact({action: "list", scope: "types"})']),
      ),
    ).toBe('Artifact({action: "list", scope: "types"})')
  })

  test('tool-wide Artifact deny hits', () => {
    expect(typesListPermissionRule(ruleContext(['Artifact']))).toBe('Artifact')
  })

  test('tool-wide Artifact ask + pipelineRan true is undefined', () => {
    expect(
      typesListPermissionRule(ruleContext([], ['Artifact']), true),
    ).toBeUndefined()
  })

  test('tool-wide Artifact ask + pipelineRan false hits', () => {
    expect(typesListPermissionRule(ruleContext([], ['Artifact']), false)).toBe(
      'Artifact',
    )
  })

  test('designSystemsListPermissionRule hits Design System list shape', () => {
    const rule = 'Artifact({action:list,type:Design System,scope:all})'
    expect(
      designSystemsListPermissionRule(ruleContext([rule]), undefined),
    ).toBe(rule)
  })

  test('hasPreToolUseHook catch: getAppState throw → true', () => {
    expect(
      hasPreToolUseHook({
        getAppState: () => {
          throw new Error('sessionHooks boom')
        },
      }),
    ).toBe(true)
  })

  test('hasPreToolUseHook sessionHooks Map with Artifact matcher → true', () => {
    const sessionHooks = new Map([
      [
        'agent-1',
        {
          hooks: {
            PreToolUse: [{ matcher: 'Artifact', hooks: [{ type: 'command' }] }],
          },
        },
      ],
    ])
    expect(
      hasPreToolUseHook({
        agentId: 'agent-1',
        getAppState: () => ({ sessionHooks }),
      }),
    ).toBe(true)
  })

  test('empty hooks → false', () => {
    expect(
      hasPreToolUseHook({
        sessionId: 'sess-empty',
        getAppState: () => ({
          sessionHooks: new Map(),
          toolPermissionContext: {},
        }),
      }),
    ).toBe(false)
  })
})
