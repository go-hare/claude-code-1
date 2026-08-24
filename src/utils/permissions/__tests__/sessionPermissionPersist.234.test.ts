/**
 * densable 2.1.234 #8 — bg subagent session permission answers must persist.
 *
 * Gold: y8r both setters identical; createSubagentContext always inherits
 * setSessionToolPermissionContext; m4n.persistPermissions default path writes
 * via session setter (+ n3e emit), including session deny rules.
 */
import { describe, expect, test } from 'bun:test'
import { createPermissionContext } from '../../../hooks/toolPermission/PermissionContext.js'
import type { AppState } from '../../../state/AppState.js'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import { createFileStateCacheWithSizeLimit } from '../../fileStateCache.js'
import { createSubagentContext } from '../../forkedAgent.js'
import { createAppStatePermissionContextSetters } from '../permissionContextSetters.js'
import {
  emitPermissionRecheck,
  onPermissionRecheck,
} from '../permissionRecheck.js'
import type { PermissionUpdate } from '../PermissionUpdateSchema.js'

function emptyCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return { ...getEmptyToolPermissionContext(), ...overrides }
}

describe('createAppStatePermissionContextSetters densable y8r', () => {
  test('both setters are the same writer into toolPermissionContext', () => {
    let state = {
      toolPermissionContext: emptyCtx(),
    } as AppState
    const setAppState = (f: (prev: AppState) => AppState) => {
      state = f(state)
    }
    const setters = createAppStatePermissionContextSetters(setAppState)
    expect(setters.setToolPermissionContext).toBe(
      setters.setSessionToolPermissionContext,
    )

    setters.setSessionToolPermissionContext(prev => ({
      ...prev,
      alwaysDenyRules: {
        ...prev.alwaysDenyRules,
        session: ['Bash(rm:*)'],
      },
    }))
    expect(state.toolPermissionContext.alwaysDenyRules.session).toEqual([
      'Bash(rm:*)',
    ])

    setters.setToolPermissionContext(prev => ({
      ...prev,
      alwaysAllowRules: {
        ...prev.alwaysAllowRules,
        session: ['Read(./src/**)'],
      },
    }))
    expect(state.toolPermissionContext.alwaysAllowRules.session).toEqual([
      'Read(./src/**)',
    ])
  })

  test('identity update does not allocate a new AppState', () => {
    let state = {
      toolPermissionContext: emptyCtx(),
    } as AppState
    const before = state
    const setAppState = (f: (prev: AppState) => AppState) => {
      state = f(state)
    }
    const { setSessionToolPermissionContext } =
      createAppStatePermissionContextSetters(setAppState)
    setSessionToolPermissionContext(prev => prev)
    expect(state).toBe(before)
  })
})

describe('permissionRecheck densable n3e', () => {
  test('emitPermissionRecheck notifies listeners', () => {
    const hits: number[] = []
    const off = onPermissionRecheck(() => {
      hits.push(1)
    })
    emitPermissionRecheck()
    expect(hits).toEqual([1])
    off()
    emitPermissionRecheck()
    expect(hits).toEqual([1])
  })
})

describe('createSubagentContext session permission inheritance', () => {
  function parentStub(): {
    parent: ToolUseContext
    sessionCalls: ToolPermissionContext[]
    toolCalls: ToolPermissionContext[]
  } {
    const sessionCalls: ToolPermissionContext[] = []
    const toolCalls: ToolPermissionContext[] = []
    const toolPermissionContext = emptyCtx()
    const parent = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext }) as AppState,
      setAppState: () => {},
      setToolPermissionContext: (
        update:
          | ToolPermissionContext
          | ((prev: ToolPermissionContext) => ToolPermissionContext),
      ) => {
        const next =
          typeof update === 'function' ? update(toolPermissionContext) : update
        toolCalls.push(next)
      },
      setSessionToolPermissionContext: (
        update:
          | ToolPermissionContext
          | ((prev: ToolPermissionContext) => ToolPermissionContext),
      ) => {
        const next =
          typeof update === 'function' ? update(toolPermissionContext) : update
        sessionCalls.push(next)
      },
      readFileState: createFileStateCacheWithSizeLimit(10),
      contentReplacementState: undefined,
      updateAttributionState: () => {},
      setResponseLength: () => {},
      options: {} as ToolUseContext['options'],
      messages: [],
      pendingNestedMemoryTriggers: new Set<string>(),
      queryTracking: { chainId: 'p', depth: 0 },
    } as unknown as ToolUseContext
    return { parent, sessionCalls, toolCalls }
  }

  test('!shareSetAppState: tool setter noop, session setter always inherited', () => {
    const { parent, sessionCalls, toolCalls } = parentStub()
    const child = createSubagentContext(parent)
    expect(child.setSessionToolPermissionContext).toBe(
      parent.setSessionToolPermissionContext,
    )
    child.setToolPermissionContext(prev => ({
      ...prev,
      alwaysAllowRules: { session: ['should-not-land'] },
    }))
    expect(toolCalls).toEqual([])

    child.setSessionToolPermissionContext(prev => ({
      ...prev,
      alwaysDenyRules: { session: ['Bash(curl:*)'] },
    }))
    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0]!.alwaysDenyRules.session).toEqual(['Bash(curl:*)'])
  })

  test('shareSetAppState: both setters inherited from parent', () => {
    const { parent } = parentStub()
    const child = createSubagentContext(parent, { shareSetAppState: true })
    expect(child.setToolPermissionContext).toBe(parent.setToolPermissionContext)
    expect(child.setSessionToolPermissionContext).toBe(
      parent.setSessionToolPermissionContext,
    )
  })
})

describe('persistPermissions densable m4n session path', () => {
  function makeCtx(
    setSession: ToolUseContext['setSessionToolPermissionContext'],
  ) {
    let toolPermissionContext = emptyCtx()
    const toolUseContext = {
      getAppState: () => ({ toolPermissionContext }) as AppState,
      setAppState: () => {},
      setToolPermissionContext: () => {},
      setSessionToolPermissionContext: (
        update:
          | ToolPermissionContext
          | ((prev: ToolPermissionContext) => ToolPermissionContext),
      ) => {
        const next =
          typeof update === 'function' ? update(toolPermissionContext) : update
        toolPermissionContext = next
        setSession(update)
      },
      abortController: new AbortController(),
    } as unknown as ToolUseContext

    const assistantMessage = {
      message: { id: 'msg-1' },
    } as unknown as AssistantMessage

    const tool = {
      name: 'Bash',
      userFacingName: () => 'Bash',
    } as unknown as Parameters<typeof createPermissionContext>[0]

    return {
      ctx: createPermissionContext(
        tool,
        { command: 'echo hi' },
        toolUseContext,
        assistantMessage,
        'tu-1',
      ),
      getContext: () => toolPermissionContext,
    }
  }

  test('default path writes session deny rules via setSessionToolPermissionContext', async () => {
    const hits: number[] = []
    const off = onPermissionRecheck(() => {
      hits.push(1)
    })

    const { ctx, getContext } = makeCtx(() => {})
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        behavior: 'deny',
        destination: 'session',
        rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }],
      },
    ]
    const permanent = ctx.persistPermissions(updates)
    expect(permanent).toBe(false) // session destination is not disk-persistable
    expect(getContext().alwaysDenyRules.session).toEqual(['Bash(rm:*)'])

    // densable setImmediate(() => n3e.emit())
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(hits).toEqual([1])
    off()
  })

  test('default path writes session allow rules via setSessionToolPermissionContext', () => {
    const { ctx, getContext } = makeCtx(() => {})
    ctx.persistPermissions([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'session',
        rules: [{ toolName: 'Read', ruleContent: './src/**' }],
      },
    ])
    expect(getContext().alwaysAllowRules.session).toEqual(['Read(./src/**)'])
  })

  test('override permissionContextSetter uses Ina restore then Bie (teammate path)', () => {
    const overrideCalls: ToolPermissionContext[] = []
    let toolPermissionContext = emptyCtx({
      strippedDangerousRules: {
        userSettings: ['Bash(sudo:*)'],
      },
    })
    const toolUseContext = {
      getAppState: () => ({ toolPermissionContext }) as AppState,
      setAppState: () => {},
      setToolPermissionContext: () => {},
      setSessionToolPermissionContext: () => {
        throw new Error('session setter must not be used on override path')
      },
      abortController: new AbortController(),
    } as unknown as ToolUseContext

    const assistantMessage = {
      message: { id: 'msg-2' },
    } as unknown as AssistantMessage
    const tool = {
      name: 'Bash',
      userFacingName: () => 'Bash',
    } as unknown as Parameters<typeof createPermissionContext>[0]

    const ctx = createPermissionContext(
      tool,
      { command: 'ls' },
      toolUseContext,
      assistantMessage,
      'tu-2',
      next => {
        overrideCalls.push(next)
        toolPermissionContext = next
      },
    )

    ctx.persistPermissions([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'session',
        rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }],
      },
    ])

    expect(overrideCalls).toHaveLength(1)
    // Ina restored strippedDangerousRules into alwaysAllowRules.userSettings
    expect(overrideCalls[0]!.alwaysAllowRules.userSettings).toEqual([
      'Bash(sudo:*)',
    ])
    expect(overrideCalls[0]!.alwaysAllowRules.session).toEqual(['Bash(ls:*)'])
    expect(overrideCalls[0]!.strippedDangerousRules).toBeUndefined()
  })
})
