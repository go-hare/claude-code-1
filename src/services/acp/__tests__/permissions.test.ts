import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import type { AgentSideConnection } from '@agentclientprotocol/sdk'
import type { Tool as ToolType, ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'

const askDecision = {
  behavior: 'ask',
  message: 'approval required',
  decisionReason: { type: 'mode', mode: 'default' },
} as const

const hasPermissionsMock = mock(async (): Promise<unknown> => askDecision)
const toolInfoMock = mock(() => ({
  title: 'Bash',
  kind: 'execute',
  content: [],
  locations: [],
}))

const permissionsModuleSnapshot = {
  ...(require('../../../utils/permissions/permissions.ts') as Record<
    string,
    unknown
  >),
}
const bridgeModuleSnapshot = {
  ...(require('../bridge.ts') as Record<string, unknown>),
}

afterAll(() => {
  mock.module('../bridge.js', () => bridgeModuleSnapshot)
  mock.module(
    '../../../utils/permissions/permissions.js',
    () => permissionsModuleSnapshot,
  )
})

mock.module('../../../utils/permissions/permissions.js', () => ({
  ...permissionsModuleSnapshot,
  hasPermissionsToUseTool: hasPermissionsMock,
}))

mock.module('../bridge.js', () => ({
  ...bridgeModuleSnapshot,
  toolInfoFromToolUse: toolInfoMock,
}))

const { createAcpCanUseTool } = await import('../permissions.js')
const {
  ACP_ALLOW_ONCE,
  ACP_ALLOW_WITH_UPDATES,
  ACP_EXIT_PLAN_AUTO,
  ACP_EXIT_PLAN_BYPASS,
  ACP_EXIT_PLAN_DEFAULT,
  ACP_REJECT,
} = await import('../permissionOptions.js')

type PermissionResponse =
  | { outcome: { outcome: 'cancelled' } }
  | { outcome: { outcome: 'selected'; optionId: string } }

function makeConn(
  permissionResponse: PermissionResponse = {
    outcome: { outcome: 'selected', optionId: ACP_ALLOW_ONCE },
  },
): AgentSideConnection {
  return {
    requestPermission: mock(async () => permissionResponse),
    sessionUpdate: mock(async () => {}),
  } as unknown as AgentSideConnection
}

function makeTool(name: string): ToolType {
  return { name } as unknown as ToolType
}

const dummyContext = {} as unknown as ToolUseContext
const dummyMsg = {} as unknown as AssistantMessage

describe('createAcpCanUseTool', () => {
  beforeEach(() => {
    hasPermissionsMock.mockReset()
    hasPermissionsMock.mockResolvedValue(askDecision)
    toolInfoMock.mockClear()
  })

  test('returns pipeline allow without client delegation', async () => {
    const conn = makeConn()
    const input = { command: 'ls' }
    hasPermissionsMock.mockResolvedValueOnce({
      behavior: 'allow',
      updatedInput: input,
    })

    const canUseTool = createAcpCanUseTool(conn, 'sess-1', () => 'default')
    const result = await canUseTool(
      makeTool('Bash'),
      input,
      dummyContext,
      dummyMsg,
      'tu_1',
    )

    expect(result).toEqual({ behavior: 'allow', updatedInput: input })
    expect(
      (conn.requestPermission as ReturnType<typeof mock>).mock.calls,
    ).toHaveLength(0)
  })

  test('returns pipeline deny without client delegation', async () => {
    const conn = makeConn()
    hasPermissionsMock.mockResolvedValueOnce({
      behavior: 'deny',
      message: 'blocked by policy',
      decisionReason: { type: 'other', reason: 'blocked by policy' },
    })

    const canUseTool = createAcpCanUseTool(conn, 'sess-1', () => 'default')
    const result = await canUseTool(
      makeTool('Bash'),
      { command: 'rm -rf /' },
      dummyContext,
      dummyMsg,
      'tu_2',
    )

    expect(result.behavior).toBe('deny')
    expect(
      (conn.requestPermission as ReturnType<typeof mock>).mock.calls,
    ).toHaveLength(0)
  })

  test('denies when the permission pipeline throws', async () => {
    const conn = makeConn()
    hasPermissionsMock.mockRejectedValueOnce(new Error('rule loader failed'))
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const canUseTool = createAcpCanUseTool(conn, 'sess-1', () => 'default')
      const result = await canUseTool(
        makeTool('Edit'),
        { file_path: '/tmp/x' },
        dummyContext,
        dummyMsg,
        'tu_3',
      )

      expect(result).toMatchObject({
        behavior: 'deny',
        decisionReason: { type: 'other', reason: 'Permission pipeline failed' },
        toolUseID: 'tu_3',
      })
      if (result.behavior !== 'deny') {
        throw new Error('expected deny result')
      }
      expect(result.message).toBe('Permission pipeline failed')
      expect(
        (conn.requestPermission as ReturnType<typeof mock>).mock.calls,
      ).toHaveLength(0)
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('delegates ask decisions to the ACP client', async () => {
    const conn = makeConn({
      outcome: { outcome: 'selected', optionId: ACP_ALLOW_ONCE },
    })
    const input = { command: 'ls' }
    const canUseTool = createAcpCanUseTool(conn, 'sess-1', () => 'default')
    const result = await canUseTool(
      makeTool('Bash'),
      input,
      dummyContext,
      dummyMsg,
      'tu_4',
    )

    expect(result).toEqual({ behavior: 'allow', updatedInput: input })
    const callArgs = (conn.requestPermission as ReturnType<typeof mock>).mock
      .calls[0][0] as Record<string, unknown>
    expect(callArgs.sessionId).toBe('sess-1')
    expect((callArgs.toolCall as Record<string, unknown>).toolCallId).toBe(
      'tu_4',
    )
  })

  test('returns deny when the client rejects or cancels', async () => {
    const rejectConn = makeConn({
      outcome: { outcome: 'selected', optionId: ACP_REJECT },
    })
    const cancelConn = makeConn({ outcome: { outcome: 'cancelled' } })

    const rejectResult = await createAcpCanUseTool(
      rejectConn,
      'sess-1',
      () => 'default',
    )(makeTool('Bash'), {}, dummyContext, dummyMsg, 'tu_5')
    const cancelResult = await createAcpCanUseTool(
      cancelConn,
      'sess-1',
      () => 'default',
    )(makeTool('Read'), {}, dummyContext, dummyMsg, 'tu_6')

    expect(rejectResult.behavior).toBe('deny')
    expect(cancelResult.behavior).toBe('deny')
  })

  test('returns deny when client permission request fails', async () => {
    const conn = {
      requestPermission: mock(async () => {
        throw new Error('connection lost')
      }),
      sessionUpdate: mock(async () => {}),
    } as unknown as AgentSideConnection
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      const result = await createAcpCanUseTool(conn, 'sess-1', () => 'default')(
        makeTool('Write'),
        {},
        dummyContext,
        dummyMsg,
        'tu_7',
      )

      expect(result.behavior).toBe('deny')
      if (result.behavior !== 'deny') {
        throw new Error('expected deny result')
      }
      expect(result.message).toContain('Permission request failed')
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('options use official allow-once / allow-with-updates / reject ids', async () => {
    const conn = makeConn({ outcome: { outcome: 'cancelled' } })
    const canUseTool = createAcpCanUseTool(conn, 'sess-3', () => 'default')
    await canUseTool(makeTool('WebSearch'), {}, dummyContext, dummyMsg, 'tu_8')

    const { options } = (conn.requestPermission as ReturnType<typeof mock>).mock
      .calls[0][0] as Record<string, unknown>
    const opts = options as Array<Record<string, unknown>>
    expect(opts.map(option => option.optionId)).toEqual([
      ACP_ALLOW_ONCE,
      ACP_ALLOW_WITH_UPDATES,
      ACP_REJECT,
    ])
    expect(opts.find(option => option.optionId === 'allow')).toBeUndefined()
    expect(
      opts.find(option => option.optionId === 'allow_always'),
    ).toBeUndefined()
  })

  test('ExitPlanMode omits bypass option when the session does not expose it', async () => {
    const conn = makeConn({ outcome: { outcome: 'cancelled' } })
    const canUseTool = createAcpCanUseTool(
      conn,
      'sess-4',
      () => 'plan',
      undefined,
      undefined,
      undefined,
      () => false,
    )

    await canUseTool(
      makeTool('ExitPlanMode'),
      {},
      dummyContext,
      dummyMsg,
      'tu_9',
    )

    const { options } = (conn.requestPermission as ReturnType<typeof mock>).mock
      .calls[0][0] as Record<string, unknown>
    const opts = options as Array<Record<string, unknown>>
    expect(opts.some(option => option.optionId === ACP_EXIT_PLAN_BYPASS)).toBe(
      false,
    )
    expect(opts.some(option => option.optionId === ACP_EXIT_PLAN_AUTO)).toBe(
      true,
    )
    expect(opts.some(option => option.optionId === ACP_EXIT_PLAN_DEFAULT)).toBe(
      true,
    )
  })

  test('ExitPlanMode includes bypass option when the session exposes it', async () => {
    const conn = makeConn({ outcome: { outcome: 'cancelled' } })
    const canUseTool = createAcpCanUseTool(
      conn,
      'sess-5',
      () => 'plan',
      undefined,
      undefined,
      undefined,
      () => true,
      undefined,
      () => ['default', 'bypassPermissions'],
    )

    await canUseTool(
      makeTool('ExitPlanMode'),
      {},
      dummyContext,
      dummyMsg,
      'tu_10',
    )

    const { options } = (conn.requestPermission as ReturnType<typeof mock>).mock
      .calls[0][0] as Record<string, unknown>
    const opts = options as Array<Record<string, unknown>>
    expect(opts.some(option => option.optionId === ACP_EXIT_PLAN_BYPASS)).toBe(
      true,
    )
    expect(opts.some(option => option.optionId === ACP_EXIT_PLAN_AUTO)).toBe(
      false,
    )
  })

  test('ExitPlanMode rejects a bypass selection that was not offered', async () => {
    const conn = makeConn({
      outcome: { outcome: 'selected', optionId: ACP_EXIT_PLAN_BYPASS },
    })
    const onModeChange = mock(() => {})
    const canUseTool = createAcpCanUseTool(
      conn,
      'sess-6',
      () => 'plan',
      undefined,
      undefined,
      onModeChange,
      () => false,
    )

    const result = await canUseTool(
      makeTool('ExitPlanMode'),
      {},
      dummyContext,
      dummyMsg,
      'tu_11',
    )

    expect(result.behavior).toBe('deny')
    expect(onModeChange).not.toHaveBeenCalled()
    expect(
      (conn.sessionUpdate as ReturnType<typeof mock>).mock.calls,
    ).toHaveLength(0)
  })

  test('checkTerminalOutput honors standard clientCapabilities.terminal', async () => {
    // Standard ACP v1 client advertises terminal: true without any _meta hint.
    const conn = makeConn({ outcome: { outcome: 'cancelled' } })
    const capabilities = { terminal: true } as any
    const canUseTool = createAcpCanUseTool(
      conn,
      'sess-term',
      () => 'default',
      capabilities,
    )
    await canUseTool(makeTool('Bash'), {}, dummyContext, dummyMsg, 'tu_term')

    const { toolCall } = (conn.requestPermission as ReturnType<typeof mock>)
      .mock.calls[0][0] as Record<string, unknown>
    // toolInfoFromToolUse is mocked; we only assert the standard capability is
    // respected (no crash, request delegated). The legacy _meta path is
    // exercised separately below.
    expect(toolCall).toBeDefined()
  })

  test('checkTerminalOutput falls back to legacy _meta.terminal_output', async () => {
    const conn = makeConn({ outcome: { outcome: 'cancelled' } })
    const capabilities = { _meta: { terminal_output: true } } as any
    const canUseTool = createAcpCanUseTool(
      conn,
      'sess-term-legacy',
      () => 'default',
      capabilities,
    )
    await canUseTool(makeTool('Bash'), {}, dummyContext, dummyMsg, 'tu_term2')

    expect(
      (conn.requestPermission as ReturnType<typeof mock>).mock.calls,
    ).toHaveLength(1)
  })

  test('cancelled permission outcome invokes onPermissionCancelled callback', async () => {
    const conn = makeConn({ outcome: { outcome: 'cancelled' } })
    const onPermissionCancelled = mock(() => {})
    const canUseTool = createAcpCanUseTool(
      conn,
      'sess-cancel',
      () => 'default',
      undefined,
      undefined,
      undefined,
      undefined,
      onPermissionCancelled,
    )

    const result = await canUseTool(
      makeTool('Bash'),
      {},
      dummyContext,
      dummyMsg,
      'tu_cancel',
    )

    expect(result.behavior).toBe('deny')
    expect(onPermissionCancelled).toHaveBeenCalledTimes(1)
  })

  test('ExitPlanMode cancelled outcome invokes onPermissionCancelled callback', async () => {
    const conn = makeConn({ outcome: { outcome: 'cancelled' } })
    const onPermissionCancelled = mock(() => {})
    const canUseTool = createAcpCanUseTool(
      conn,
      'sess-cancel-plan',
      () => 'plan',
      undefined,
      undefined,
      undefined,
      undefined,
      onPermissionCancelled,
    )

    const result = await canUseTool(
      makeTool('ExitPlanMode'),
      {},
      dummyContext,
      dummyMsg,
      'tu_cancel_plan',
    )

    expect(result.behavior).toBe('deny')
    expect(onPermissionCancelled).toHaveBeenCalledTimes(1)
  })

  test('ExitPlanMode returns deny when client permission request throws', async () => {
    const conn = {
      requestPermission: mock(async () => {
        throw new Error('connection lost')
      }),
      sessionUpdate: mock(async () => {}),
    } as unknown as AgentSideConnection
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const onModeChange = mock(() => {})

    try {
      const result = await createAcpCanUseTool(
        conn,
        'sess-plan-fail',
        () => 'plan',
        undefined,
        undefined,
        onModeChange,
      )(makeTool('ExitPlanMode'), {}, dummyContext, dummyMsg, 'tu_plan_fail')

      expect(result.behavior).toBe('deny')
      if (result.behavior !== 'deny') {
        throw new Error('expected deny result')
      }
      expect(result.message).toContain('Permission request failed')
      expect(onModeChange).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('legacy allow / allow_always aliases are denied', async () => {
    const allowConn = makeConn({
      outcome: { outcome: 'selected', optionId: 'allow' },
    })
    const alwaysConn = makeConn({
      outcome: { outcome: 'selected', optionId: 'allow_always' },
    })
    const allow = await createAcpCanUseTool(
      allowConn,
      'sess-legacy',
      () => 'default',
    )(makeTool('Bash'), { command: 'ls' }, dummyContext, dummyMsg, 'tu_legacy')
    const always = await createAcpCanUseTool(
      alwaysConn,
      'sess-legacy2',
      () => 'default',
    )(makeTool('Bash'), { command: 'ls' }, dummyContext, dummyMsg, 'tu_legacy2')
    expect(allow.behavior).toBe('deny')
    expect(always.behavior).toBe('deny')
  })

  test('allow-with-updates applies session suggestions', async () => {
    hasPermissionsMock.mockResolvedValueOnce({
      ...askDecision,
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    })
    const persist = mock(() => {})
    const ctx = {
      setSessionToolPermissionContext: persist,
    } as unknown as ToolUseContext
    const conn = makeConn({
      outcome: { outcome: 'selected', optionId: ACP_ALLOW_WITH_UPDATES },
    })
    const result = await createAcpCanUseTool(conn, 'sess-dur', () => 'default')(
      makeTool('Bash'),
      { command: 'npm test' },
      ctx,
      dummyMsg,
      'tu_dur',
    )
    expect(result.behavior).toBe('allow')
    expect(persist).toHaveBeenCalled()
  })
})
