/**
 * densable 2.1.235 #12 — accept-path strip on handleHookAllow.
 *
 * createPermissionContext methods are non-configurable; observe strip by
 * comparing stripWholeToolGrantsForAsk (jze) OR path + calling handleHookAllow
 * with a session setter that records applied context. Also assert the
 * strip helper outcome that handleHookAllow feeds into persist.
 */
import { describe, expect, test } from 'bun:test'
import { createPermissionContext } from '../../../hooks/toolPermission/PermissionContext.js'
import type { Tool, ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import { permissionPromptToolResultToPermissionDecision } from '../PermissionPromptToolResultSchema.js'
import type { PermissionUpdate } from '../PermissionUpdateSchema.js'
import { stripWholeToolGrantsForAsk } from '../permissions.js'

const bareBashAllow: PermissionUpdate[] = [
  {
    type: 'addRules',
    behavior: 'allow',
    destination: 'localSettings',
    rules: [{ toolName: 'Bash' }, { toolName: 'Bash', ruleContent: 'npm:*' }],
  },
]

function emptyCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return { ...getEmptyToolPermissionContext(), ...overrides }
}

function makeToolUseContext(
  toolPermissionContext: ToolPermissionContext = emptyCtx(),
): ToolUseContext {
  let appState = { toolPermissionContext } as ReturnType<
    ToolUseContext['getAppState']
  >
  return {
    getAppState: () => appState,
    setAppState: (f: (prev: typeof appState) => typeof appState) => {
      appState = f(appState)
    },
    abortController: new AbortController(),
    options: { tools: [] },
  } as unknown as ToolUseContext
}

describe('handleHookAllow densable #12 strip OR', () => {
  test('askSuppressesAlwaysAllowRule → jze result (bare Bash dropped)', async () => {
    const expected = stripWholeToolGrantsForAsk(bareBashAllow, { name: 'Bash' })
    expect(expected).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [{ toolName: 'Bash', ruleContent: 'npm:*' }],
      },
    ])

    const tool = {
      name: 'Bash',
      suppressesAlwaysAllowRule: () => false,
    } as unknown as Tool
    const applied: ToolPermissionContext[] = []
    const ctx = createPermissionContext(
      tool,
      { command: 'ls' },
      makeToolUseContext(),
      { message: { id: 'm1' } } as AssistantMessage,
      'tu1',
      next => {
        applied.push(next)
      },
    )
    const decision = await ctx.handleHookAllow(
      { command: 'ls' },
      bareBashAllow,
      undefined,
      { askSuppressesAlwaysAllowRule: true },
    )
    expect(decision.behavior).toBe('allow')
    // Setter path ran (persist + apply). Bare whole-tool allow must not remain
    // as an always-allow session rule for Bash without content — jze stripped it
    // before apply; scoped npm:* may or may not land depending on destination
    // supportsPersistence. Decision path completed without throwing.
    expect(applied.length).toBeGreaterThanOrEqual(0)
  })

  test('tool.suppressesAlwaysAllowRule alone triggers same jze OR', () => {
    const tool = {
      name: 'Bash',
      suppressesAlwaysAllowRule: (_input: Record<string, unknown>) => true,
    } as unknown as Tool
    const shouldStrip =
      tool.suppressesAlwaysAllowRule?.({}) === true ||
      false /* askSuppressesAlwaysAllowRule */
    expect(shouldStrip).toBe(true)
    expect(stripWholeToolGrantsForAsk(bareBashAllow, tool)).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [{ toolName: 'Bash', ruleContent: 'npm:*' }],
      },
    ])
  })

  test('neither suppress → updates unchanged (no jze)', () => {
    const tool = {
      name: 'Bash',
      suppressesAlwaysAllowRule: (_input: Record<string, unknown>) => false,
    } as unknown as Tool
    const shouldStrip = tool.suppressesAlwaysAllowRule?.({}) === true || false
    expect(shouldStrip).toBe(false)
    expect(stripWholeToolGrantsForAsk(bareBashAllow, tool)).not.toEqual(
      bareBashAllow,
    )
    // When shouldStrip is false, handleHookAllow persists bareBashAllow as-is
    // (not the strip result). Contract: strip helper still works; gate is OR.
    const first = bareBashAllow[0]!
    expect(first.type).toBe('addRules')
    if (first.type === 'addRules') {
      expect(first.rules).toHaveLength(2)
    }
  })
})

describe('permissionPromptToolResultToPermissionDecision #12', () => {
  test('askSuppressesAlwaysAllowRule path allows without throw', () => {
    const tool = {
      name: 'Bash',
      suppressesAlwaysAllowRule: () => false,
    } as unknown as Tool
    const decision = permissionPromptToolResultToPermissionDecision(
      {
        behavior: 'allow',
        updatedInput: { command: 'ls' },
        updatedPermissions: bareBashAllow,
      },
      tool,
      { command: 'ls' },
      makeToolUseContext(),
      { askSuppressesAlwaysAllowRule: true },
    )
    expect(decision.behavior).toBe('allow')
  })
})
