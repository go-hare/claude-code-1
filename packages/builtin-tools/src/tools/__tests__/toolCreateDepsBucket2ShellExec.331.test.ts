import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  buildTool,
  createExplicitToolDeps,
  createToolCallContext,
  getEmptyToolPermissionContext,
  NativeToolElsewhereError,
  NeverRunsInThisProcessError,
  registerRemoteNativeToolRunner,
  type RemoteNativeToolSession,
  type Tool,
  type ToolDeps,
  type ToolUseContext,
} from 'src/Tool.js'
import type { AppState } from 'src/state/AppState.js'
import { getBootstrapSessionHost } from 'src/utils/sessionHost.js'
import { BashTool } from '../BashTool/BashTool.js'
import { ExecuteTool } from '../ExecuteTool/ExecuteTool.js'
import { MonitorTool } from '../MonitorTool/MonitorTool.js'
import { PowerShellTool } from '../PowerShellTool/PowerShellTool.js'
import { REPLTool } from '../REPLTool/REPLTool.js'

function createDisklessSession(): RemoteNativeToolSession {
  return {
    root: {},
    host: {
      launchOptions: {
        diskless: () => true,
      },
    },
  }
}

describe('2.1.331 Tool.create(deps) Bucket 2 — Shell, Execution, REPL & Monitor', () => {
  afterEach(() => {
    getBootstrapSessionHost().launchOptions.replaceDiskless(false)
  })

  test('proxy-probe safety: all 5 tools return instance methods without eagerly reading deps', () => {
    const probeDeps = new Proxy({} as ToolDeps, {
      get: () => undefined,
    })

    for (const tool of [
      BashTool,
      PowerShellTool,
      REPLTool,
      ExecuteTool,
      MonitorTool,
    ]) {
      const instance = tool.create(probeDeps)
      expect(typeof instance.call).toBe('function')
    }

    const monitorInstance = MonitorTool.create(probeDeps)
    expect(typeof monitorInstance.permissionCheckFailureDecision).toBe(
      'function',
    )
    expect(
      monitorInstance.permissionCheckFailureDecision!(
        { command: 'echo ok', description: 'probe', timeout_ms: 5000 },
        createToolCallContext(),
      ),
    ).toBeUndefined()
  })

  describe('BashTool', () => {
    test('direct BashTool.create(createExplicitToolDeps()).call runs echo hello-di with zero ALS / ToolUseContext', async () => {
      const deps = createExplicitToolDeps()
      const instance = BashTool.create(deps)
      const callCtx = createToolCallContext({ toolUseId: 'tu-bash-di-1' })

      const validation = await instance.validateInput!(
        { command: 'echo hello-di' },
        callCtx,
      )
      expect(validation).toEqual({ result: true })

      const result = await instance.call({ command: 'echo hello-di' }, callCtx)
      expect(result.data.stdout).toBe('hello-di')
      expect(result.data.stderr).toBe('')
      expect(result.data.interrupted).toBe(false)
    })

    test('isReadOnly guards against diskless process via isNativeToolDisabledInThisProcess', () => {
      expect(BashTool.isReadOnly({ command: 'ls' })).toBe(true)

      getBootstrapSessionHost().launchOptions.replaceDiskless(true)
      expect(BashTool.isReadOnly({ command: 'ls' })).toBe(false)
    })

    test('exposes outputSchemaAcrossProcesses and fromAnotherProcess', () => {
      const schema = BashTool.outputSchemaAcrossProcesses
      expect(schema).toBeDefined()
      const sample = {
        stdout: 'ok',
        stderr: '',
        interrupted: false,
      }
      expect(schema?.safeParse(sample).success).toBe(true)
      expect(schema?.safeParse({ invalid: true }).success).toBe(false)

      const hydrated = BashTool.fromAnotherProcess?.(sample)
      expect(hydrated).toEqual({ data: sample })
    })

    test('outputSchemaAcrossProcesses strips forged host-side paths and privilege/background flags', async () => {
      const forgedPayload = {
        stdout: 'ok',
        stderr: 'warn',
        interrupted: false,
        isImage: false,
        timedOutAfterMs: 1234,
        noOutputExpected: false,
        persistedOutputPath: '/etc/passwd',
        persistedOutputSize: 999999,
        rawOutputPath: '/etc/shadow',
        dangerouslyDisableSandbox: true,
        backgroundTaskId: 'bg-forged',
        backgroundedByUser: true,
        backgroundedByTurnAbort: true,
        assistantAutoBackgrounded: true,
        backgroundedToDeliverMessage: true,
        backgroundCwdHint: 'forged hint',
        backgroundEndsWithFinalResponse: true as const,
        returnCodeInterpretation: 'forged',
        structuredContent: [{ type: 'text', text: 'forged' }],
        bashEditDiff: { files: [], moreFiles: 0 },
      }

      const parsed =
        BashTool.outputSchemaAcrossProcesses?.safeParse(forgedPayload)
      expect(parsed?.success).toBe(true)
      if (parsed?.success) {
        expect(parsed.data).toEqual({
          stdout: 'ok',
          stderr: 'warn',
          interrupted: false,
          isImage: false,
          timedOutAfterMs: 1234,
          noOutputExpected: false,
        })
        for (const forbidden of [
          'persistedOutputPath',
          'persistedOutputSize',
          'rawOutputPath',
          'dangerouslyDisableSandbox',
          'backgroundTaskId',
          'backgroundedByUser',
          'backgroundedByTurnAbort',
          'returnCodeInterpretation',
          'structuredContent',
          'bashEditDiff',
        ]) {
          expect(forbidden in (parsed.data as object)).toBe(false)
        }
      }

      // End-to-end through registerRemoteNativeToolRunner
      const disklessSession = createDisklessSession()
      const unregister = registerRemoteNativeToolRunner(
        disklessSession,
        'Bash',
        async () => ({ output: forgedPayload }),
      )
      const disklessCtx = {
        session: disklessSession,
        abortController: new AbortController(),
        options: { tools: [], mcpClients: [] },
        getAppState: () =>
          ({
            tasks: {},
            toolPermissionContext: getEmptyToolPermissionContext(),
          }) as unknown as AppState,
        setAppState: () => {},
        readFileState: new Map(),
      } as unknown as ToolUseContext

      try {
        const res = await BashTool.call({ command: 'echo ok' }, disklessCtx)
        expect(res.data).toEqual({
          stdout: 'ok',
          stderr: 'warn',
          interrupted: false,
          isImage: false,
          timedOutAfterMs: 1234,
          noOutputExpected: false,
        })
        expect(res.data.persistedOutputPath).toBeUndefined()
        expect(res.data.dangerouslyDisableSandbox).toBeUndefined()
        expect(res.data.bashEditDiff).toBeUndefined()
      } finally {
        unregister()
      }
    })

    test('diskless session throws NeverRunsInThisProcessError locally and routes through registerRemoteNativeToolRunner when attached', async () => {
      const disklessSession = createDisklessSession()

      // Local create fails closed with NeverRunsInThisProcessError
      expect(() =>
        BashTool.create(createExplicitToolDeps({ session: disklessSession })),
      ).toThrow(NeverRunsInThisProcessError)

      // Registering a remote runner routes BashTool.call cross-process even when diskless
      let seenToolName: string | undefined
      let seenCommand: string | undefined
      const unregister = registerRemoteNativeToolRunner(
        disklessSession,
        'Bash',
        async (toolName, input) => {
          seenToolName = toolName
          seenCommand = (input as { command?: string }).command
          return {
            output: {
              stdout: 'remote-hello',
              stderr: '',
              interrupted: false,
            },
          }
        },
      )

      const disklessCtx = {
        session: disklessSession,
        abortController: new AbortController(),
        options: { tools: [], mcpClients: [] },
        getAppState: () =>
          ({
            tasks: {},
            toolPermissionContext: getEmptyToolPermissionContext(),
          }) as unknown as AppState,
        setAppState: () => {},
        readFileState: new Map(),
      } as unknown as ToolUseContext

      try {
        const remoteRes = await BashTool.call(
          { command: 'echo remote' },
          disklessCtx,
        )
        expect(seenToolName).toBe('Bash')
        expect(seenCommand).toBe('echo remote')
        expect(remoteRes.data).toEqual({
          stdout: 'remote-hello',
          stderr: '',
          interrupted: false,
        })
      } finally {
        unregister()
      }

      // Malformed remote output fails outputSchemaAcrossProcesses validation with ANSWER_LOST
      const unregisterBad = registerRemoteNativeToolRunner(
        disklessSession,
        'Bash',
        async () => ({
          output: { missingRequiredFields: true },
        }),
      )
      try {
        await expect(
          BashTool.call({ command: 'echo bad' }, disklessCtx),
        ).rejects.toMatchObject({
          name: NativeToolElsewhereError.name,
          code: 'ANSWER_LOST',
        })
      } finally {
        unregisterBad()
      }

      // After unregistering, legacy BashTool.call on diskless session throws NeverRunsInThisProcessError
      expect(() =>
        BashTool.call({ command: 'echo after-unregister' }, disklessCtx),
      ).toThrow(NeverRunsInThisProcessError)
    })
  })

  describe('PowerShellTool', () => {
    test('direct PowerShellTool.create(createExplicitToolDeps()).validateInput works without ALS', async () => {
      const instance = PowerShellTool.create(createExplicitToolDeps())
      const callCtx = createToolCallContext({ toolUseId: 'tu-ps-di-1' })

      const valid = await instance.validateInput!(
        { command: 'Write-Output "hello-di"' },
        callCtx,
      )
      expect(valid).toEqual({ result: true })
    })

    test('isReadOnly guards against diskless process via isNativeToolDisabledInThisProcess', () => {
      let localCommandReads = 0
      const localInput = {
        get command() {
          localCommandReads += 1
          return 'Get-Location'
        },
      }
      PowerShellTool.isReadOnly(localInput)
      expect(localCommandReads).toBeGreaterThan(0)

      getBootstrapSessionHost().launchOptions.replaceDiskless(true)
      let disklessCommandReads = 0
      const disklessInput = {
        get command() {
          disklessCommandReads += 1
          return 'Get-Location'
        },
      }
      expect(PowerShellTool.isReadOnly(disklessInput)).toBe(false)
      expect(PowerShellTool.isConcurrencySafe(disklessInput)).toBe(false)
      expect(disklessCommandReads).toBe(0)
    })

    test('diskless session throws NeverRunsInThisProcessError on PowerShellTool.create', () => {
      const disklessSession = createDisklessSession()
      expect(() =>
        PowerShellTool.create(
          createExplicitToolDeps({ session: disklessSession }),
        ),
      ).toThrow(NeverRunsInThisProcessError)
    })
  })

  describe('MonitorTool', () => {
    test('direct MonitorTool.create(deps) validateInput and checkPermissions work with zero ToolUseContext', async () => {
      const deps = createExplicitToolDeps()
      const instance = MonitorTool.create(deps)
      const callCtx = createToolCallContext({ toolUseId: 'tu-mon-di-1' })

      expect(
        await instance.validateInput!(
          {
            command: 'echo tick',
            description: 'watch ticks',
            timeout_ms: 5000,
          },
          callCtx,
        ),
      ).toEqual({ result: true })

      const invalidBoth = await instance.validateInput!(
        {
          command: 'echo tick',
          ws: { url: 'wss://example.com/events' },
          description: 'both',
          timeout_ms: 5000,
        },
        callCtx,
      )
      expect(invalidBoth.result).toBe(false)

      const invalidEmptyDesc = await instance.validateInput!(
        { command: 'echo tick', description: '   ', timeout_ms: 5000 },
        callCtx,
      )
      expect(invalidEmptyDesc.result).toBe(false)

      const wsAsk = await instance.checkPermissions!(
        {
          ws: { url: 'wss://example.com/events' },
          description: 'ws feed',
          timeout_ms: 5000,
        },
        callCtx,
      )
      expect(wsAsk.behavior).toBe('ask')
    })

    test('permissionCheckFailureDecision enforces bashCommandClamps via both create(deps) and legacy MonitorTool.permissionCheckFailureDecision', () => {
      const basePerms = getEmptyToolPermissionContext()
      const clampedPerms = {
        ...basePerms,
        bashCommandClamps: ['echo *'],
      } as ReturnType<typeof getEmptyToolPermissionContext>

      const input = {
        command: 'echo hi',
        description: 'clamped monitor',
        timeout_ms: 5000,
      }
      const callCtx = createToolCallContext()

      // Via create(deps) with unlayeredPermissions
      const viaUnlayered = MonitorTool.create(
        createExplicitToolDeps({
          unlayeredPermissions: () => clampedPerms,
        }),
      ).permissionCheckFailureDecision!(input, callCtx)
      expect(viaUnlayered?.behavior).toBe('deny')
      if (viaUnlayered?.behavior === 'deny') {
        expect(viaUnlayered.message).toContain('bashCommandClamp')
      }

      // Via create(deps) with permissions
      const viaPermissions = MonitorTool.create(
        createExplicitToolDeps({
          permissions: () => clampedPerms,
        }),
      ).permissionCheckFailureDecision!(input, callCtx)
      expect(viaPermissions?.behavior).toBe('deny')

      // Via create(deps) without clamps
      const noClamps = MonitorTool.create(createExplicitToolDeps())
        .permissionCheckFailureDecision!(input, callCtx)
      expect(noClamps).toBeUndefined()

      // Via legacy MonitorTool.permissionCheckFailureDecision(input, ctx)
      const legacyCtx = {
        abortController: new AbortController(),
        getAppState: () =>
          ({
            tasks: {},
            toolPermissionContext: clampedPerms,
          }) as unknown as AppState,
        setAppState: () => {},
        options: { tools: [], mcpClients: [] },
      } as unknown as ToolUseContext

      const viaLegacy = MonitorTool.permissionCheckFailureDecision(
        input,
        legacyCtx,
      )
      expect(viaLegacy?.behavior).toBe('deny')
      if (viaLegacy?.behavior === 'deny') {
        expect(viaLegacy.message).toContain('bashCommandClamp')
      }

      const legacyNoClamp = MonitorTool.permissionCheckFailureDecision(input, {
        ...legacyCtx,
        getAppState: () =>
          ({
            tasks: {},
            toolPermissionContext: basePerms,
          }) as unknown as AppState,
      })
      expect(legacyNoClamp).toBeUndefined()
    })

    test('diskless session throws NeverRunsInThisProcessError on MonitorTool.create', () => {
      const disklessSession = createDisklessSession()
      expect(() =>
        MonitorTool.create(
          createExplicitToolDeps({ session: disklessSession }),
        ),
      ).toThrow(NeverRunsInThisProcessError)
    })
  })

  describe('REPLTool', () => {
    test('direct REPLTool.create(deps) checks permissions via deps.permissions() and executes call', async () => {
      const autoPerms = {
        ...getEmptyToolPermissionContext(),
        mode: 'auto' as const,
      }
      const autoInstance = REPLTool.create(
        createExplicitToolDeps({ permissions: () => autoPerms }),
      )
      const callCtx = createToolCallContext()

      const autoDecision = await autoInstance.checkPermissions!(
        { code: '1 + 1' },
        callCtx,
      )
      expect(autoDecision.behavior).toBe('passthrough')

      const defaultInstance = REPLTool.create(createExplicitToolDeps())
      const defaultDecision = await defaultInstance.checkPermissions!(
        { code: '1 + 1' },
        callCtx,
      )
      expect(defaultDecision.behavior).toBe('allow')

      const callRes = await defaultInstance.call({ code: '1 + 1' }, callCtx)
      expect(callRes.data.tool_calls).toBe(0)
      expect(callRes.data.result).toContain('REPL tool is not available')
    })
  })

  describe('ExecuteTool', () => {
    test('direct ExecuteTool.create(deps) delegates to target tool from deps.tools and returns passthrough on checkPermissions', async () => {
      const echoSchema = z.strictObject({ text: z.string() })
      const DummyEchoTool = buildTool({
        name: 'DummyEcho',
        maxResultSizeChars: 1000,
        get inputSchema() {
          return echoSchema
        },
        async description() {
          return 'Echo input text'
        },
        async prompt() {
          return 'Echo input text'
        },
        renderToolUseMessage(input: Partial<z.infer<typeof echoSchema>>) {
          return input.text ?? ''
        },
        create(_deps: ToolDeps) {
          return {
            async call(input: z.infer<typeof echoSchema>) {
              return { data: { echoed: input.text } }
            },
          }
        },
        mapToolResultToToolResultBlockParam(
          content: { echoed: string },
          toolUseID: string,
        ) {
          return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: JSON.stringify(content),
          }
        },
      })

      const deps = createExplicitToolDeps({
        tools: [DummyEchoTool as unknown as Tool],
      })
      const instance = ExecuteTool.create(deps)
      const callCtx = createToolCallContext({ toolUseId: 'tu-exec-di-1' })

      const perm = await instance.checkPermissions!(
        { tool_name: 'DummyEcho', params: { text: 'hello' } },
        callCtx,
      )
      expect(perm.behavior).toBe('passthrough')

      const okRes = await instance.call(
        { tool_name: 'DummyEcho', params: { text: 'hello-di' } },
        callCtx,
      )
      expect(okRes.data).toEqual({
        tool_name: 'DummyEcho',
        result: { echoed: 'hello-di' },
      })

      const missingRes = await instance.call(
        { tool_name: 'NoSuchTool', params: {} },
        callCtx,
      )
      expect(missingRes.data).toEqual({
        tool_name: 'NoSuchTool',
        result: null,
      })
      expect(missingRes.newMessages?.length).toBeGreaterThan(0)
    })
  })
})
