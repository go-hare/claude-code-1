import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isSessionPersistenceDisabled,
  setSessionPersistenceDisabled,
} from 'src/bootstrap/state.js'
import {
  buildTool,
  createExplicitToolDeps,
  createToolCallContext,
  NativeToolElsewhereError,
  NeverRunsInThisProcessError,
  registerRemoteNativeToolRunner,
  resolveToolUseContext,
  type RemoteNativeToolRunner,
  type Tool,
  type ToolDef,
} from 'src/Tool.js'
import type { Message } from 'src/types/message.js'
import { z } from 'zod/v4'
import { ArtifactTool } from '../ArtifactTool/ArtifactTool.js'
import { AskUserQuestionTool } from '../AskUserQuestionTool/AskUserQuestionTool.js'
import { BriefTool } from '../BriefTool/BriefTool.js'
import { ClaudeDesignTool } from '../ClaudeDesignTool/ClaudeDesignTool.js'
import { DesignSyncTool } from '../DesignSyncTool/DesignSyncTool.js'
import { EndConversationTool } from '../EndConversationTool/EndConversationTool.js'
import {
  END_CONVERSATION_FORK_REFLECTION_PROMPT,
  END_CONVERSATION_TOOL_RESULT,
  getEndConversationReflectionPrompt,
} from '../EndConversationTool/prompt.js'
import { ObserverReportTool } from '../ObserverReportTool/ObserverReportTool.js'
import { NO_PENDING_EVENTS } from '../PollTool/constants.js'
import { PollTool } from '../PollTool/PollTool.js'
import { ProposeSkillsTool } from '../ProposeSkillsTool/ProposeSkillsTool.js'
import { PushNotificationTool } from '../PushNotificationTool/PushNotificationTool.js'
import { ReadNotificationsTool } from '../ReadNotificationsTool/ReadNotificationsTool.js'
import { ReportFindingsTool } from '../ReportFindingsTool/ReportFindingsTool.js'
import { ReviewArtifactTool } from '../ReviewArtifactTool/ReviewArtifactTool.js'
import { SearchExtraToolsTool } from '../SearchExtraToolsTool/SearchExtraToolsTool.js'
import { SendFeedbackTool } from '../SendFeedbackTool/SendFeedbackTool.js'
import {
  SEND_USER_FILE_ARGUMENTS_CHANGED_ERROR,
  SendUserFileTool,
} from '../SendUserFileTool/SendUserFileTool.js'
import { SleepTool } from '../SleepTool/SleepTool.js'
import { SnipTool } from '../SnipTool/SnipTool.js'
import { SubscribePRTool } from '../SubscribePRTool/SubscribePRTool.js'
import { SuggestBackgroundPRTool } from '../SuggestBackgroundPRTool/SuggestBackgroundPRTool.js'
import {
  createSyntheticOutputTool,
  SyntheticOutputTool,
} from '../SyntheticOutputTool/SyntheticOutputTool.js'
import { TestingPermissionTool } from '../testing/TestingPermissionTool.js'

const ALL_BUCKET_5_TOOLS: ReadonlyArray<{ name: string; tool: Tool }> = [
  { name: 'ArtifactTool', tool: ArtifactTool as unknown as Tool },
  { name: 'ReviewArtifactTool', tool: ReviewArtifactTool as unknown as Tool },
  { name: 'ClaudeDesignTool', tool: ClaudeDesignTool as unknown as Tool },
  { name: 'DesignSyncTool', tool: DesignSyncTool as unknown as Tool },
  {
    name: 'AskUserQuestionTool',
    tool: AskUserQuestionTool as unknown as Tool,
  },
  { name: 'BriefTool', tool: BriefTool as unknown as Tool },
  { name: 'SendUserFileTool', tool: SendUserFileTool as unknown as Tool },
  {
    name: 'PushNotificationTool',
    tool: PushNotificationTool as unknown as Tool,
  },
  {
    name: 'ReadNotificationsTool',
    tool: ReadNotificationsTool as unknown as Tool,
  },
  { name: 'SendFeedbackTool', tool: SendFeedbackTool as unknown as Tool },
  {
    name: 'SearchExtraToolsTool',
    tool: SearchExtraToolsTool as unknown as Tool,
  },
  { name: 'ProposeSkillsTool', tool: ProposeSkillsTool as unknown as Tool },
  {
    name: 'EndConversationTool',
    tool: EndConversationTool as unknown as Tool,
  },
  { name: 'ObserverReportTool', tool: ObserverReportTool as unknown as Tool },
  { name: 'PollTool', tool: PollTool as unknown as Tool },
  { name: 'ReportFindingsTool', tool: ReportFindingsTool as unknown as Tool },
  { name: 'SleepTool', tool: SleepTool as unknown as Tool },
  { name: 'SnipTool', tool: SnipTool as unknown as Tool },
  { name: 'SubscribePRTool', tool: SubscribePRTool as unknown as Tool },
  {
    name: 'SuggestBackgroundPRTool',
    tool: SuggestBackgroundPRTool as unknown as Tool,
  },
  {
    name: 'SyntheticOutputTool',
    tool: SyntheticOutputTool as unknown as Tool,
  },
  {
    name: 'TestingPermissionTool',
    tool: TestingPermissionTool as unknown as Tool,
  },
]

function makeSession(diskless = false) {
  return {
    root: {},
    host: {
      launchOptions: {
        diskless: () => diskless,
      },
    },
  }
}

function makeFakeDeferredTool(name: string, searchHint: string): Tool {
  const schema = z.strictObject({})
  return buildTool({
    name,
    searchHint,
    shouldDefer: true,
    maxResultSizeChars: 1000,
    inputSchema: schema,
    async description() {
      return searchHint
    },
    async prompt() {
      return `Tool ${name}: ${searchHint}`
    },
    mapToolResultToToolResultBlockParam(_data, id) {
      return { tool_use_id: id, type: 'tool_result', content: 'ok' }
    },
    renderToolUseMessage() {
      return null
    },
    create() {
      return {
        async call() {
          return { data: 'ok' }
        },
      }
    },
  } satisfies ToolDef<typeof schema, string>) as unknown as Tool
}

describe('Official 2.1.331 Bucket 5 Tools — Tool.create(deps) Migration', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  test('all 22 Bucket 5 tools expose create(deps) and survive undefined-returning Proxy probe without eager deps calls', () => {
    expect(ALL_BUCKET_5_TOOLS).toHaveLength(22)

    for (const { name, tool } of ALL_BUCKET_5_TOOLS) {
      expect(typeof tool.create).toBe('function')

      // Mirrors buildTool's optional-method probe (`hasInstanceOptionalMethod`)
      const probeDeps = new Proxy(
        {} as Parameters<NonNullable<Tool['create']>>[0],
        {
          get: () => undefined,
        },
      )
      const instance = tool.create!(probeDeps)
      expect(instance).toBeDefined()
      expect(typeof instance.call).toBe('function')

      // Explicit deps instantiation also succeeds on a non-diskless session
      const explicitDeps = createExplicitToolDeps({
        session: makeSession(false),
      })
      const explicitInstance = tool.create!(explicitDeps)
      expect(typeof explicitInstance.call).toBe('function')
      expect(name.length).toBeGreaterThan(0)
    }
  })

  test('EndConversationTool.create(deps) calls deps.markEndedByModel() and callCtx.abort directly without ALS', async () => {
    const prevDisabled = isSessionPersistenceDisabled()
    setSessionPersistenceDisabled(true)
    try {
      // 1. Fork path
      let markCount = 0
      const forkDeps = createExplicitToolDeps({
        agentId: 'agent_fork_1' as never,
        isNonInteractiveSession: false,
        markEndedByModel: () => {
          markCount++
        },
      })
      const forkCallCtx = createToolCallContext()
      const forkRes = await EndConversationTool.create(forkDeps).call(
        {},
        forkCallCtx,
      )
      expect(forkRes.data).toEqual({
        ended: false,
        message: END_CONVERSATION_FORK_REFLECTION_PROMPT,
      })
      expect(markCount).toBe(0)
      expect(forkCallCtx.signal.aborted).toBe(false)

      // 2. First main-thread call reflects
      const firstDeps = createExplicitToolDeps({
        isNonInteractiveSession: false,
        messages: () => [],
        markEndedByModel: () => {
          markCount++
        },
      })
      const firstRes = await EndConversationTool.create(firstDeps).call(
        {},
        createToolCallContext(),
      )
      expect(firstRes.data).toEqual({
        ended: false,
        message: getEndConversationReflectionPrompt(),
      })
      expect(markCount).toBe(0)

      // 3. Second main-thread call ends interactive session via deps.markEndedByModel()
      const priorMessages = [
        {
          type: 'assistant',
          uuid: '00000000-0000-4000-8000-000000000010',
          timestamp: new Date().toISOString(),
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tu_end_1',
                name: 'EndConversation',
                input: {},
              },
            ],
          },
        },
        {
          type: 'user',
          uuid: '00000000-0000-4000-8000-000000000011',
          timestamp: new Date().toISOString(),
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_end_1',
                content: 'reflect',
              },
            ],
          },
        },
      ] as unknown as Message[]

      const secondDeps = createExplicitToolDeps({
        isNonInteractiveSession: false,
        messages: () => priorMessages,
        markEndedByModel: () => {
          markCount++
        },
      })
      const endCallCtx = createToolCallContext()
      const endRes = await EndConversationTool.create(secondDeps).call(
        {},
        endCallCtx,
      )
      expect(endRes.data).toEqual({
        ended: true,
        message: END_CONVERSATION_TOOL_RESULT,
      })
      expect(markCount).toBe(1)
      expect(endCallCtx.signal.aborted).toBe(true)
      expect(endCallCtx.signal.reason).toBe('end_conversation')

      // Also verify default createExplicitToolDeps markEndedByModel updates appState.endedByModel
      const defaultDeps = createExplicitToolDeps({
        isNonInteractiveSession: false,
        messages: () => priorMessages,
      })
      await EndConversationTool.create(defaultDeps).call(
        {},
        createToolCallContext(),
      )
      expect(defaultDeps.getAppState().endedByModel).toBe(true)
    } finally {
      setSessionPersistenceDisabled(prevDisabled)
    }
  })

  test('SyntheticOutputTool and createSyntheticOutputTool execute via create(deps) with Ajv validation', async () => {
    const deps = createExplicitToolDeps()
    const callCtx = createToolCallContext()

    const baseInstance = SyntheticOutputTool.create(deps)
    expect(
      await baseInstance.checkPermissions?.({ answer: 42 }, callCtx),
    ).toEqual({
      behavior: 'allow',
      updatedInput: { answer: 42 },
    })
    const baseRes = await baseInstance.call({ answer: 42 }, callCtx)
    expect(baseRes.data).toBe('Structured output provided successfully')
    expect(baseRes.structured_output).toEqual({ answer: 42 })
    expect(baseRes.endsTurn).toBe(true)

    const built = createSyntheticOutputTool({
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
      required: ['count'],
      additionalProperties: false,
    })
    expect('tool' in built).toBe(true)
    if ('tool' in built) {
      const schemaInstance = built.tool.create!(deps)
      const ok = await schemaInstance.call({ count: 7 }, callCtx)
      expect(ok.structured_output).toEqual({ count: 7 })
      expect(ok.endsTurn).toBe(true)

      await expect(
        schemaInstance.call({ count: 'not-a-number' }, callCtx),
      ).rejects.toThrow('Output does not match required schema')
    }
  })

  test('BriefTool.create(deps) validates and executes cleanly without ALS', async () => {
    const deps = createExplicitToolDeps()
    const callCtx = createToolCallContext()
    const instance = BriefTool.create(deps)

    expect(
      await instance.validateInput?.(
        { message: 'Hello user', status: 'normal' },
        callCtx,
      ),
    ).toEqual({ result: true })

    const res = await instance.call(
      { message: 'Build finished', status: 'proactive' },
      callCtx,
    )
    expect(res.data.message).toBe('Build finished')
    expect(typeof res.data.sentAt).toBe('string')
  })

  test('SleepTool.create(deps) respects callCtx.signal cancellation directly', async () => {
    const deps = createExplicitToolDeps()
    const abortController = new AbortController()
    const callCtx = createToolCallContext({ abortController })

    abortController.abort()
    const res = await SleepTool.create(deps).call(
      { duration_seconds: 30 },
      callCtx,
    )
    expect(res.data.interrupted).toBe(true)
    expect(res.data.slept_seconds).toBe(0)
  })

  test('SearchExtraToolsTool.create(deps) reads deps.tools, deps.getAppState(), and deps.session directly', async () => {
    const calendarTool = makeFakeDeferredTool(
      'mcp__calendar__create_event',
      'schedule calendar meeting event',
    )
    const slackTool = makeFakeDeferredTool(
      'mcp__slack__post_message',
      'post slack channel message',
    )
    const sessionA = makeSession(false)
    const deps = createExplicitToolDeps({
      session: sessionA,
      tools: [calendarTool, slackTool],
      getAppState: () =>
        ({
          mcp: {
            clients: [
              { name: 'linear', type: 'pending' },
              { name: 'slack', type: 'connected' },
            ],
            tools: [],
            commands: [],
            resources: {},
          },
        }) as never,
    })

    const instance = SearchExtraToolsTool.create(deps)
    const callCtx = createToolCallContext()

    const selected = await instance.call(
      { query: 'select:mcp__calendar__create_event', max_results: 5 },
      callCtx,
    )
    expect(selected.data.matches).toEqual(['mcp__calendar__create_event'])
    expect(selected.data.total_deferred_tools).toBe(2)

    const keyword = await instance.call(
      { query: 'slack message', max_results: 5 },
      callCtx,
    )
    expect(keyword.data.matches).toContain('mcp__slack__post_message')

    const missing = await instance.call(
      { query: 'select:mcp__linear__list_issues', max_results: 5 },
      callCtx,
    )
    expect(missing.data.matches).toEqual([])
    expect(missing.data.pending_mcp_servers).toEqual(['linear'])
  })

  test('ReportFindingsTool.create(deps) returns structured count and findings', async () => {
    const deps = createExplicitToolDeps()
    const findings = [
      {
        file: 'src/foo.ts',
        line: 42,
        summary: 'Missing null guard',
        failure_scenario: 'Throws TypeError on empty response',
        category: 'correctness',
      },
    ]
    const res = await ReportFindingsTool.create(deps).call(
      { level: 'high', findings },
      createToolCallContext(),
    )
    expect(res.data).toEqual({
      count: 1,
      level: 'high',
      findings,
    })
  })

  test('ObserverReportTool.create(deps) gates on deps.agentId without ALS', async () => {
    const mainDeps = createExplicitToolDeps()
    const mainInst = ObserverReportTool.create(mainDeps)
    const callCtx = createToolCallContext()

    const perm = await mainInst.checkPermissions?.({ report: 'check' }, callCtx)
    expect(perm?.behavior).toBe('deny')

    const res = await mainInst.call({ report: 'check' }, callCtx)
    expect(res.data.success).toBe(false)
    expect(res.data.message).toContain('only available to an observer agent')
  })

  test('SendUserFileTool: diskless create() throws NeverRunsInThisProcessError, local TOCTOU works via explicit deps, and remote runner validates + hydrates via fromAnotherProcess', async () => {
    // 1. Diskless host refuses local instantiation via NeverRunsInThisProcessError
    const disklessSession = makeSession(true)
    const disklessDeps = createExplicitToolDeps({ session: disklessSession })
    expect(() => SendUserFileTool.create(disklessDeps)).toThrow(
      NeverRunsInThisProcessError,
    )

    // 2. Local explicit-deps execution + session-scoped TOCTOU guard
    const dir = mkdtempSync(join(tmpdir(), 'send-user-file-b5-'))
    tempDirs.push(dir)
    const fileA = join(dir, 'report.txt')
    const fileB = join(dir, 'secret.txt')
    writeFileSync(fileA, 'report-body')
    writeFileSync(fileB, 'secret-body')

    const localSession = makeSession(false)
    const localDeps = createExplicitToolDeps({
      session: localSession,
      getAppState: () =>
        ({
          replBridgeEnabled: false,
          toolPermissionContext: {
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          },
        }) as never,
    })
    const localInst = SendUserFileTool.create(localDeps)
    const okCallCtx = createToolCallContext({ toolUseId: 'tu_local_ok' })
    await localInst.checkPermissions?.({ files: [fileA] }, okCallCtx)
    const okRes = await localInst.call({ files: [fileA] }, okCallCtx)
    expect(okRes.data.sent).toBe(true)
    expect(okRes.data.size).toBe(11)

    const toctouCallCtx = createToolCallContext({ toolUseId: 'tu_local_mut' })
    await localInst.checkPermissions?.({ files: [fileA] }, toctouCallCtx)
    const toctouRes = await localInst.call({ files: [fileB] }, toctouCallCtx)
    expect(toctouRes.data.sent).toBe(false)
    expect(toctouRes.data.error).toBe(SEND_USER_FILE_ARGUMENTS_CHANGED_ERROR)

    // 3. Direct fromAnotherProcess unit behavior
    const longPath = `${'x'.repeat(2500)}\u0000\u0007\u001b[31m`
    const trustedPathWithAngles = '/tmp/report<v1>.png'
    const hydrated = SendUserFileTool.fromAnotherProcess!(
      {
        sent: true,
        file_path: `/tmp/out\u0000\u0007\u202E<script>.png`,
        file_uuid: `uuid\u0008\x1b[31m-1234\x1b[0m`,
        error: `<tool_use_error>spoof\u202E</tool_use_error>`,
        caption: 'untrusted-remote-caption',
        display: 'attach',
        rendered_locally: true,
        pathValidated: true,
        opens_by_path: { '/etc/passwd': 1 },
        upload_error_code: 'ADMIN',
        upload_suspected_limit_bytes: 999,
        scaled: true,
        thumbnail: 'forged-thumb',
        files: [
          {
            file_path: trustedPathWithAngles,
            sent: true,
            pathValidated: true,
            opens_by_path: { '/etc/shadow': 1 },
            upload_error_code: 'FORGED',
            upload_suspected_limit_bytes: 123,
            scaled: true,
            thumbnail: 'thumb',
          },
          {
            file_path: longPath,
            sent: true,
            file_uuid: 'fid\x00_1',
            error: 'err\x1b[31m<bad>\u202Eok\x1b[0m',
          },
        ],
        attachments: [
          {
            path: trustedPathWithAngles,
            size: 64,
            isImage: true,
            pathValidated: true,
            opens_by_path: { '/etc/hosts': 1 },
            upload_error_code: 'ERR',
            upload_suspected_limit_bytes: 456,
            scaled: true,
            thumbnail: 'thumb2',
          },
          {
            path: longPath,
            size: 128,
            isImage: true,
            file_uuid: 'att\u0007_uuid',
          },
        ],
      } as Parameters<
        NonNullable<typeof SendUserFileTool.fromAnotherProcess>
      >[0],
      {
        files: [trustedPathWithAngles],
        caption: 'Trusted caption\nLine 2',
        display: 'render',
      },
    )
    expect(hydrated.data).toBeDefined()
    expect(hydrated.data!.caption).toBe('Trusted caption\nLine 2')
    expect(hydrated.data!.display).toBe('render')
    expect('rendered_locally' in hydrated.data!).toBe(false)
    for (const priv of [
      'pathValidated',
      'opens_by_path',
      'upload_error_code',
      'upload_suspected_limit_bytes',
      'scaled',
      'thumbnail',
    ]) {
      expect(priv in hydrated.data!).toBe(false)
      expect(priv in hydrated.data!.files![0]!).toBe(false)
      expect(priv in hydrated.data!.attachments![0]!).toBe(false)
    }
    expect(hydrated.data!.file_path).toBe('/tmp/out &lt;script&gt;.png')
    expect(hydrated.data!.file_path).not.toContain('\u202E')
    expect(hydrated.data!.file_path).not.toContain('<script>')
    expect(hydrated.data!.file_uuid).toBe('uuid -1234')
    expect(hydrated.data!.error).toBe(
      '&lt;tool_use_error&gt;spoof &lt;/tool_use_error&gt;',
    )
    // Exact input path is preserved verbatim; untrusted paths are sanitized & capped
    expect(hydrated.data!.files![0]!.file_path).toBe(trustedPathWithAngles)
    expect(hydrated.data!.attachments![0]!.path).toBe(trustedPathWithAngles)
    expect(hydrated.data!.files![1]!.file_path.length).toBe(2001)
    expect(hydrated.data!.files![1]!.file_path.endsWith('…')).toBe(true)
    expect(hydrated.data!.files![1]!.file_path).not.toMatch(
      /[\p{Cc}\p{Cf}\p{Cs}]/u,
    )
    expect(hydrated.data!.files![1]!.file_uuid).toBe('fid _1')
    expect(hydrated.data!.files![1]!.error).toBe('err &lt;bad&gt; ok')
    expect(hydrated.data!.attachments![1]!.path.length).toBe(2001)
    expect(hydrated.data!.attachments![1]!.file_uuid).toBe('att _uuid')

    // Invalid / omitted caption & display in input must not leak remote values
    const stripped = SendUserFileTool.fromAnotherProcess!(
      {
        sent: true,
        file_path: '/tmp/a.txt',
        caption: 'spoofed',
        display: 'render',
        rendered_locally: true,
      },
      {
        files: ['/tmp/a.txt'],
        caption: 123 as unknown as string,
        display: 'popup' as unknown as 'render',
      },
    )
    expect(stripped.data!.caption).toBeUndefined()
    expect(stripped.data!.display).toBeUndefined()
    expect('rendered_locally' in stripped.data!).toBe(false)

    // 4. Cross-process remote runner dispatch on diskless session validates schema + runs fromAnotherProcess
    const remoteRunner: RemoteNativeToolRunner = async (_name, input) => {
      const rec = input as { file_path?: string }
      if (rec.file_path === '/corrupt') {
        return { output: { invalid_shape: true } }
      }
      return {
        output: {
          sent: true,
          file_path: `/remote/chart\u0000.png`,
          rendered_locally: true,
          attachments: [
            {
              path: `/remote/chart\u0007\u202E<tag>.png`,
              size: 42,
              isImage: true,
              file_uuid: 'u\x001',
            },
          ],
        },
      }
    }

    const dispose = registerRemoteNativeToolRunner(
      disklessSession,
      'SendUserFile',
      remoteRunner,
    )
    try {
      const disklessCtx = resolveToolUseContext(disklessDeps)
      const remoteRes = await SendUserFileTool.call(
        {
          file_path: '/remote/chart.png',
          caption: 'Quarterly chart',
          display: 'attach',
        },
        disklessCtx,
      )
      expect(remoteRes.data.sent).toBe(true)
      expect(remoteRes.data.file_path).toBe('/remote/chart .png')
      expect(remoteRes.data.caption).toBe('Quarterly chart')
      expect(remoteRes.data.display).toBe('attach')
      expect('rendered_locally' in remoteRes.data).toBe(false)
      expect(remoteRes.data.attachments?.[0]?.path).toBe(
        '/remote/chart &lt;tag&gt;.png',
      )
      expect(remoteRes.data.attachments?.[0]?.file_uuid).toBe('u 1')

      // Corrupt remote payload rejected with ANSWER_LOST & non-retryable message
      let thrown: unknown
      try {
        await SendUserFileTool.call({ file_path: '/corrupt' }, disklessCtx)
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(NativeToolElsewhereError)
      expect((thrown as NativeToolElsewhereError).code).toBe('ANSWER_LOST')
      expect((thrown as NativeToolElsewhereError).message).toContain(
        'Check its effect before running it again.',
      )
    } finally {
      dispose()
    }
  })

  test('remaining Bucket 5 tools execute/validate cleanly via Tool.create(createExplicitToolDeps())', async () => {
    const deps = createExplicitToolDeps({
      loopModel: () => 'claude-opus-4-6',
      isNonInteractiveSession: true,
    })
    const callCtx = createToolCallContext({ toolUseId: 'tu_b5_misc' })

    // SnipTool
    const snipRes = await SnipTool.create(deps).call(
      { message_ids: ['m1', 'm2'], reason: 'free space' },
      callCtx,
    )
    expect(snipRes.data).toEqual({ snipped_count: 2, summary: 'free space' })

    // ReviewArtifactTool
    const reviewRes = await ReviewArtifactTool.create(deps).call(
      {
        artifact: 'const x = 1',
        title: 'snippet.ts',
        annotations: [{ line: 1, message: 'looks good', severity: 'info' }],
        summary: 'LGTM',
      },
      callCtx,
    )
    expect(reviewRes.data).toEqual({
      artifact: 'const x = 1',
      title: 'snippet.ts',
      annotationCount: 1,
      summary: 'LGTM',
    })

    // TestingPermissionTool
    const testPermInst = TestingPermissionTool.create!(deps)
    expect(await testPermInst.checkPermissions?.({}, callCtx)).toEqual({
      behavior: 'ask',
      message: 'Run test?',
    })
    expect((await testPermInst.call({}, callCtx)).data).toBe(
      'TestingPermission executed successfully',
    )

    // AskUserQuestionTool
    const askInst = AskUserQuestionTool.create!(deps)
    const sampleQuestions = [
      {
        question: 'Pick a color?',
        header: 'Color',
        options: [
          { label: 'Red', description: 'Warm' },
          { label: 'Blue', description: 'Cool' },
        ],
        multiSelect: false,
      },
    ]
    expect(
      await askInst.validateInput?.({ questions: sampleQuestions }, callCtx),
    ).toEqual({ result: true })
    expect(
      (
        await askInst.checkPermissions?.(
          { questions: sampleQuestions },
          callCtx,
        )
      )?.behavior,
    ).toBe('ask')
    const askRes = await askInst.call(
      {
        questions: sampleQuestions,
        answers: { 'Pick a color?': 'Blue' },
      },
      callCtx,
    )
    expect(askRes.data.answers).toEqual({ 'Pick a color?': 'Blue' })

    // ProposeSkillsTool
    const proposeInst = ProposeSkillsTool.create(deps)
    const invalidProp = await proposeInst.validateInput?.(
      {
        proposals: [
          {
            name: 'my-skill',
            kind: 'improvement',
            target: 'my-skill',
            description: 'Improve it',
            edits: [{ old_string: 'a', new_string: 'b' }],
            skillMd: '---\nname: my-skill\n---\nBody',
          },
        ],
      },
      callCtx,
    )
    expect(invalidProp?.result).toBe(false)
    const proposeRes = await proposeInst.call(
      {
        proposals: [
          {
            name: 'my-skill',
            kind: 'new',
            description: 'Do something useful',
            skillMd: '---\nname: my-skill\n---\nInstructions here',
          },
        ],
      },
      callCtx,
    )
    expect(proposeRes.data).toEqual({ proposalCount: 1 })

    // PushNotificationTool
    const prevDisablePresence =
      process.env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK
    process.env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK = '1'
    try {
      const pushRes = await PushNotificationTool.create(deps).call(
        { title: 'Done', body: 'All checks passed' },
        callCtx,
      )
      expect(pushRes.data.sent).toBe(false)
      expect(pushRes.data.disabledReason).toBe('no_transport')
    } finally {
      if (prevDisablePresence === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK
      } else {
        process.env.CLAUDE_CODE_DISABLE_NOTIFICATION_PRESENCE_CHECK =
          prevDisablePresence
      }
    }

    // ReadNotificationsTool
    const subagentDeps = createExplicitToolDeps({
      agentId: 'sub_1' as never,
    })
    await expect(
      ReadNotificationsTool.create(subagentDeps).call({}, callCtx),
    ).rejects.toThrow('main conversation')
    const mainNotifRes = await ReadNotificationsTool.create(deps).call(
      {},
      callCtx,
    )
    expect(Array.isArray(mainNotifRes.data.notifications)).toBe(true)
    expect(typeof mainNotifRes.data.remaining).toBe('number')

    // SendFeedbackTool
    const feedbackInst = SendFeedbackTool.create(deps)
    const feedbackInput = {
      type: 'bug' as const,
      title: 'Test feedback',
      details: '**What happened:** test',
    }
    expect(
      (await feedbackInst.checkPermissions?.(feedbackInput, callCtx))?.behavior,
    ).toBe('allow')

    // PollTool
    await expect(
      PollTool.create(subagentDeps).call({}, callCtx),
    ).rejects.toThrow()
    const pollRes = await PollTool.create(deps).call({}, callCtx)
    expect(pollRes.data.content).toBe(NO_PENDING_EVENTS)
    expect(pollRes.data.eventCount).toBe(0)

    // SubscribePRTool
    const badPrRes = await SubscribePRTool.create(deps).call(
      { repo: 'invalid-repo-format', pr_number: 1 },
      callCtx,
    )
    expect(badPrRes.data.subscribed).toBe(false)
    expect(badPrRes.data.error).toBe('repo must be owner/repo')

    // SuggestBackgroundPRTool
    const suggestRes = await SuggestBackgroundPRTool.create(deps).call(
      { title: 'Cleanup', description: 'Refactor helper' },
      callCtx,
    )
    expect(suggestRes.data).toEqual({ suggested: false, suggestion_id: '' })

    // ArtifactTool
    const artifactInst = ArtifactTool.create(deps)
    const blobValidation = await artifactInst.validateInput?.(
      {
        action: 'read_file',
        url: 'https://claude.ai/artifacts/test-slug',
        path: '_blob/0123456789abcdef0123456789abcdef',
      } as never,
      callCtx,
    )
    expect(blobValidation?.result).toBe(false)

    // ClaudeDesignTool
    const designInst = ClaudeDesignTool.create(deps)
    const projectScopeDeny = await designInst.checkPermissions?.(
      {
        operation: 'finalize_plan',
        arguments: { project_id: 'proj_1', scope: 'project' },
      },
      callCtx,
    )
    expect(projectScopeDeny?.behavior).toBe('deny')

    // DesignSyncTool
    const syncInst = DesignSyncTool.create(deps)
    const syncInvalid = await syncInst.validateInput?.(
      { method: 'finalize_plan', projectId: 'proj_1' },
      callCtx,
    )
    expect(syncInvalid?.result).toBe(false)
    const syncReportRes = await syncInst.call(
      { method: 'report_validate' },
      callCtx,
    )
    expect(syncReportRes.data).toEqual({ method: 'report_validate' })
  })
})
