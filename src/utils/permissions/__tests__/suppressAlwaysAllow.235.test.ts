import { describe, expect, test } from 'bun:test'
import { SDKControlPermissionRequestSchema } from '../../../entrypoints/sdk/controlSchemas.js'
import { createPermissionContext } from '../../../hooks/toolPermission/PermissionContext.js'
import type { AppState } from '../../../state/AppState.js'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import { stripWholeToolGrantsForAsk } from '../permissions.js'
import type { PermissionUpdate } from '../PermissionUpdateSchema.js'
import { shouldShowPersistentAllowOption } from '../showAlwaysAllow.js'

/**
 * densable 2.1.235 #12 accept-path gate used by pipe/bridge/SDK hook allow.
 * Mirrors interactiveHandler + executePermissionRequestHooksForSDK OR.
 */
function selectUpdatesForSuppressAsk(
  updates: PermissionUpdate[],
  tool: {
    name: string
    suppressesAlwaysAllowRule?: (input: Record<string, unknown>) => boolean
  },
  input: Record<string, unknown>,
  askSuppressesAlwaysAllowRule: boolean,
  context?: ToolPermissionContext,
): PermissionUpdate[] {
  const shouldStrip =
    tool.suppressesAlwaysAllowRule?.(input) === true ||
    askSuppressesAlwaysAllowRule === true
  return shouldStrip
    ? stripWholeToolGrantsForAsk(updates, tool, context)
    : updates
}

describe('densable 2.1.235 #12 suppressAlwaysAllowRule', () => {
  test('shouldShowPersistentAllowOption hides when ask.suppressAlwaysAllowRule', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: {
          behavior: 'ask',
          suppressAlwaysAllowRule: true,
        },
      }),
    ).toBe(false)
  })

  test('shouldShowPersistentAllowOption hides when tool.suppressesAlwaysAllowRule', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: { behavior: 'ask' },
        tool: { suppressesAlwaysAllowRule: () => true },
        input: {},
      }),
    ).toBe(false)
  })

  test('shouldShowPersistentAllowOption keeps when neither suppress nor org-cap', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: { behavior: 'ask' },
        tool: { suppressesAlwaysAllowRule: () => false },
        input: {},
        isAskCappedByOrg: false,
      }),
    ).toBe(true)
  })

  test('shouldShowPersistentAllowOption hides when org ask-capped', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        isAskCappedByOrg: true,
      }),
    ).toBe(false)
  })

  test('stripWholeToolGrantsForAsk removes bare tool allow, keeps scoped rules', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [
          { toolName: 'Bash' },
          { toolName: 'Bash', ruleContent: 'npm:*' },
          { toolName: 'Read' },
        ],
      },
      {
        type: 'addDirectories',
        destination: 'session',
        directories: ['/tmp'],
      },
    ]

    const stripped = stripWholeToolGrantsForAsk(updates, { name: 'Bash' })
    expect(stripped).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [
          { toolName: 'Bash', ruleContent: 'npm:*' },
          { toolName: 'Read' },
        ],
      },
      {
        type: 'addDirectories',
        destination: 'session',
        directories: ['/tmp'],
      },
    ])
  })

  test('stripWholeToolGrantsForAsk drops entire addRules when only bare tool allow', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [{ toolName: 'Monitor' }],
      },
    ]
    expect(stripWholeToolGrantsForAsk(updates, { name: 'Monitor' })).toEqual([])
  })

  test('can_use_tool schema accepts suppress_always_allow_rule egress field', () => {
    const parsed = SDKControlPermissionRequestSchema().parse({
      subtype: 'can_use_tool',
      tool_name: 'StubSuppressTool',
      input: { path: '/tmp/x' },
      tool_use_id: 'tu-1',
      suppress_always_allow_rule: true,
    })
    expect(parsed.suppress_always_allow_rule).toBe(true)
  })

  test('can_use_tool schema omits suppress_always_allow_rule when unset', () => {
    const parsed = SDKControlPermissionRequestSchema().parse({
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input: { command: 'ls' },
      tool_use_id: 'tu-2',
    })
    expect(parsed.suppress_always_allow_rule).toBeUndefined()
  })

  test('handleHookAllow strips bare whole-tool allow when ask suppress set', async () => {
    let toolPermissionContext = getEmptyToolPermissionContext()
    const toolUseContext = {
      getAppState: () => ({ toolPermissionContext }) as AppState,
      setAppState: () => {},
      setToolPermissionContext: () => {},
      setSessionToolPermissionContext: (
        update:
          | ToolPermissionContext
          | ((prev: ToolPermissionContext) => ToolPermissionContext),
      ) => {
        toolPermissionContext =
          typeof update === 'function' ? update(toolPermissionContext) : update
      },
      abortController: new AbortController(),
    } as unknown as ToolUseContext

    const tool = {
      name: 'StubSuppressTool',
      userFacingName: () => 'StubSuppressTool',
      suppressesAlwaysAllowRule: () => false,
    } as unknown as Parameters<typeof createPermissionContext>[0]

    const ctx = createPermissionContext(
      tool,
      { path: '/tmp/a' },
      toolUseContext,
      { message: { id: 'msg-hook' } } as unknown as AssistantMessage,
      'tu-hook',
    )

    await ctx.handleHookAllow(
      { path: '/tmp/a' },
      [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [
            { toolName: 'StubSuppressTool' },
            { toolName: 'StubSuppressTool', ruleContent: 'path:/tmp/a' },
          ],
        },
      ],
      undefined,
      { askSuppressesAlwaysAllowRule: true },
    )

    expect(toolPermissionContext.alwaysAllowRules.session).toEqual([
      'StubSuppressTool(path:/tmp/a)',
    ])
  })

  test('handleHookAllow strips when tool.suppressesAlwaysAllowRule is true', async () => {
    let toolPermissionContext = getEmptyToolPermissionContext()
    const toolUseContext = {
      getAppState: () => ({ toolPermissionContext }) as AppState,
      setAppState: () => {},
      setToolPermissionContext: () => {},
      setSessionToolPermissionContext: (
        update:
          | ToolPermissionContext
          | ((prev: ToolPermissionContext) => ToolPermissionContext),
      ) => {
        toolPermissionContext =
          typeof update === 'function' ? update(toolPermissionContext) : update
      },
      abortController: new AbortController(),
    } as unknown as ToolUseContext

    const tool = {
      name: 'StubSuppressTool',
      userFacingName: () => 'StubSuppressTool',
      suppressesAlwaysAllowRule: () => true,
    } as unknown as Parameters<typeof createPermissionContext>[0]

    const ctx = createPermissionContext(
      tool,
      { path: '/tmp/b' },
      toolUseContext,
      { message: { id: 'msg-tool' } } as unknown as AssistantMessage,
      'tu-tool',
    )

    await ctx.handleHookAllow({ path: '/tmp/b' }, [
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'session',
        rules: [{ toolName: 'StubSuppressTool' }],
      },
    ])

    expect(toolPermissionContext.alwaysAllowRules.session ?? []).toEqual([])
  })

  test('pipe/bridge persist path strips when ask suppress set', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [
          { toolName: 'StubSuppressTool' },
          { toolName: 'StubSuppressTool', ruleContent: 'scope:x' },
        ],
      },
    ]
    const stripped = selectUpdatesForSuppressAsk(
      updates,
      { name: 'StubSuppressTool' },
      {},
      true,
    )
    expect(stripped).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [{ toolName: 'StubSuppressTool', ruleContent: 'scope:x' }],
      },
    ])
  })

  test('SDK hook allow path strips when tool suppress set', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'session',
        rules: [{ toolName: 'StubSuppressTool' }],
      },
    ]
    const stripped = selectUpdatesForSuppressAsk(
      updates,
      {
        name: 'StubSuppressTool',
        suppressesAlwaysAllowRule: () => true,
      },
      { path: '/tmp/c' },
      false,
    )
    expect(stripped).toEqual([])
  })

  test('accept path keeps updates when neither suppress flag is set', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'session',
        rules: [{ toolName: 'Bash' }],
      },
    ]
    expect(
      selectUpdatesForSuppressAsk(
        updates,
        { name: 'Bash', suppressesAlwaysAllowRule: () => false },
        {},
        false,
      ),
    ).toEqual(updates)
  })
})
