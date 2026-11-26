import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { randomUUID, type UUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import {
  getMainThreadAgentId,
  getOriginalCwd,
  getSessionId,
  getTotalCostUSD,
  resetStateForTests,
  setIsInteractive,
} from '../../bootstrap/state.js'
import { QueryEngine } from '../../QueryEngine.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import {
  backgroundExistingForegroundTask,
  backgroundTask,
  installShellPressureReap,
  registerForeground,
  resetQuietCheckinOwnersForTests,
  spawnShellTask,
  startQuietCheckin,
} from '../../tasks/LocalShellTask/LocalShellTask.js'
import { buildTool, type Tool } from '../../Tool.js'
import { createFileStateCacheWithSizeLimit } from '../fileStateCache.js'
import { clearGatewayAuth } from '../gatewayEnv.js'
import {
  clearCommandQueue,
  getCommandQueueSnapshot,
  resetCommandQueue,
} from '../messageQueueManager.js'
import { createUserMessage } from '../messages.js'
import { createMonitorStreamPump } from '../monitorStreamNotify.js'
import {
  exitSessionContext,
  getSessionAlsStore,
  hasActiveSessionAls,
  runWithNewHostSession,
  runWithSession,
  sessionContextAls,
} from '../sessionContextAls.js'
import {
  createSessionHost,
  getBootstrapSession,
  resetSessionHostForTests,
} from '../sessionHost.js'
import {
  createRootSession,
  registerSessionContextReader,
  type Session,
} from '../sessionRoot.js'
import {
  clearNotChainParentForTests,
  clearSessionMessagesCache,
  flushSessionStorage,
  getAgentTranscriptPath,
  getTranscriptPath,
  resetProjectForTesting,
} from '../sessionStorage.js'
import type { ShellCommand } from '../ShellCommand.js'
import {
  _clearOutputsForTest,
  _resetTaskOutputDirForTest,
} from '../task/diskOutput.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { createTaskRegistry } from '../taskRegistry.js'
import { ToolStateSlots } from '../toolState.js'
import { runAgent } from '@claude-code/builtin-tools/tools/AgentTool/runAgent.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'

// Ensure MACRO.VERSION is defined when running standalone under bun test.
;(globalThis as unknown as { MACRO?: { VERSION: string } }).MACRO ??= {
  VERSION: '0.0.0-test',
}

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_API_KEY',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CONFIG_DIR',
  'TEST_ENABLE_SESSION_PERSISTENCE',
  'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE',
  'CLAUDE_CODE_SKIP_PROMPT_HISTORY',
  'CLAUDE_CODE_SIMPLE',
] as const

const tick = (ms = 5): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function sseFrame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function buildToolUseSseStream(opts: {
  msgId: string
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
  inputTokens: number
  outputTokens: number
}): string {
  return [
    sseFrame('message_start', {
      type: 'message_start',
      message: {
        id: opts.msgId,
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: opts.inputTokens,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }),
    sseFrame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: opts.toolUseId,
        name: opts.toolName,
        input: {},
      },
    }),
    sseFrame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: JSON.stringify(opts.toolInput),
      },
    }),
    sseFrame('content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    }),
    sseFrame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: opts.outputTokens },
    }),
    sseFrame('message_stop', { type: 'message_stop' }),
  ].join('')
}

function buildTextSseStream(opts: {
  msgId: string
  text: string
  inputTokens: number
  outputTokens: number
}): string {
  return [
    sseFrame('message_start', {
      type: 'message_start',
      message: {
        id: opts.msgId,
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: opts.inputTokens,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }),
    sseFrame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    sseFrame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: opts.text },
    }),
    sseFrame('content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    }),
    sseFrame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: opts.outputTokens },
    }),
    sseFrame('message_stop', { type: 'message_stop' }),
  ].join('')
}

function extractRequestMarker(messages: unknown): 'alpha' | 'bravo' {
  const serialized = JSON.stringify(messages)
  if (serialized.includes('MARKER_ALPHA')) return 'alpha'
  if (serialized.includes('MARKER_BRAVO')) return 'bravo'
  return 'alpha'
}

function hasToolResultInMessages(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false
  return messages.some(msg => {
    if (!msg || typeof msg !== 'object') return false
    const content = (msg as { content?: unknown }).content
    if (!Array.isArray(content)) return false
    return content.some(
      block =>
        block !== null &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'tool_result',
    )
  })
}

type DeferredShell = {
  shellCommand: ShellCommand
  resolveExit: (result: {
    code: number
    interrupted: boolean
    stdout?: string
    stderr?: string
    killedByBackgroundCap?: boolean
  }) => void
}

function makeDeferredShellCommand(taskId: string): DeferredShell {
  let resolveExit!: DeferredShell['resolveExit']
  const result = new Promise<{
    code: number
    interrupted: boolean
    stdout?: string
    stderr?: string
    killedByBackgroundCap?: boolean
  }>(resolve => {
    resolveExit = resolve
  })
  const taskOutput = {
    taskId,
    flush: async () => {},
  }
  let status: 'running' | 'backgrounded' | 'completed' | 'killed' = 'running'
  const shellCommand = {
    get status() {
      return status
    },
    taskOutput,
    result,
    outputEnded: Promise.resolve(),
    background: () => {
      if (status === 'completed' || status === 'killed') return false
      status = 'backgrounded'
      return true
    },
    kill: () => {
      status = 'killed'
    },
    cleanup: () => {},
  } as unknown as ShellCommand
  return { shellCommand, resolveExit }
}

describe('Official 2.1.331 ALS boundary preservation: QueryEngine AsyncGenerator, runAgent, LocalShellTask, and MonitorStreamPump', () => {
  const tempDirs: string[] = []
  const savedEnv: Partial<
    Record<(typeof ENV_KEYS)[number], string | undefined>
  > = {}
  let sseServer: ReturnType<typeof Bun.serve>
  let seqCounter = 0

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  beforeAll(() => {
    sseServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith('/v1/messages')) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        const body = (await req.json()) as { messages?: unknown }
        const marker = extractRequestMarker(body.messages)
        const id = ++seqCounter
        const isSecondTurn = hasToolResultInMessages(body.messages)
        // Stagger network latency slightly so concurrent host streams interleave yields!
        await tick(marker === 'alpha' ? 8 : 4)
        const sse = !isSecondTurn
          ? buildToolUseSseStream({
              msgId: `msg_${marker}_tool_${id}`,
              toolUseId: `toolu_${marker}_${id}`,
              toolName: 'ProbeAlsHost',
              toolInput: { tag: marker },
              inputTokens: marker === 'alpha' ? 1_000 : 4_000,
              outputTokens: marker === 'alpha' ? 200 : 800,
            })
          : buildTextSseStream({
              msgId: `msg_${marker}_final_${id}`,
              text: `REPLY_${marker.toUpperCase()}_OK`,
              inputTokens: marker === 'alpha' ? 1_200 : 4_800,
              outputTokens: marker === 'alpha' ? 150 : 600,
            })
        return new Response(sse, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
          },
        })
      },
    })
  })

  afterAll(() => {
    sseServer?.stop(true)
  })

  beforeEach(async () => {
    registerSessionContextReader(getSessionAlsStore)
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    const cfgDir = await makeTempDir('cc-331-als-gen-cfg-')
    process.env.CLAUDE_CONFIG_DIR = cfgDir
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-als-boundary-331'
    process.env.ANTHROPIC_BASE_URL = sseServer.url.origin
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    process.env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = '1'

    clearGatewayAuth()
    resetSettingsCache()
    resetStateForTests()
    resetCommandQueue()
    resetQuietCheckinOwnersForTests()
    resetProjectForTesting()
    clearSessionMessagesCache()
    clearNotChainParentForTests()
    await _clearOutputsForTest()
    _resetTaskOutputDirForTest()
    resetSessionHostForTests()
  })

  afterEach(async () => {
    resetQuietCheckinOwnersForTests()
    resetCommandQueue()
    resetProjectForTesting()
    clearSessionMessagesCache()
    clearNotChainParentForTests()
    await _clearOutputsForTest()
    _resetTaskOutputDirForTest()
    clearGatewayAuth()
    resetSettingsCache()
    resetStateForTests()
    resetSessionHostForTests()
    registerSessionContextReader(getSessionAlsStore)

    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('1. QueryEngine: two engines constructed in runWithNewHostSession and iterated COMPLETELY OUTSIDE ALS in Promise.all preserve Session, CWD, sessionStorage, and CostLedger on every yield', async () => {
    const dirA = await makeTempDir('cc-331-qe-alpha-')
    const dirB = await makeTempDir('cc-331-qe-bravo-')
    const sessionIdA = randomUUID()
    const sessionIdB = randomUUID()

    const defaultBootstrap = getBootstrapSession()
    const defaultSessionId = getSessionId()

    const toolObservations: Array<{
      tag: string
      sessionId: string
      originalCwd: string
      transcriptPath: string
    }> = []
    const canUseToolObservations: Array<{
      toolName: string
      sessionId: string
      originalCwd: string
    }> = []

    const probeTool: Tool = buildTool({
      name: 'ProbeAlsHost',
      description: async () =>
        'Probes active ALS Session inside tool execution',
      prompt: async () => 'Probes active ALS Session inside tool execution',
      inputSchema: z.object({ tag: z.string() }),
      maxResultSizeChars: 100_000,
      renderToolUseMessage: () => null,
      isConcurrencySafe: () => true,
      isReadOnly: () => true,
      async call(input) {
        // Yield across an async timer inside tool execution to prove ALS survives nested awaits too!
        await tick(input.tag === 'alpha' ? 12 : 5)
        const observed = {
          tag: input.tag,
          sessionId: getSessionId(),
          originalCwd: getOriginalCwd(),
          transcriptPath: getTranscriptPath(),
        }
        toolObservations.push(observed)
        return {
          data: observed,
        }
      },
      mapToolResultToToolResultBlockParam(data, toolUseID) {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: JSON.stringify(data),
        }
      },
    })

    function createHostEngine(cwd: string): QueryEngine {
      let appState = getDefaultAppState()
      const setAppState = (
        updater: (prev: typeof appState) => typeof appState,
      ) => {
        appState = updater(appState)
      }
      return new QueryEngine({
        cwd,
        tools: [probeTool],
        commands: [],
        mcpClients: [],
        agents: [],
        canUseTool: async tool => {
          canUseToolObservations.push({
            toolName: tool.name,
            sessionId: getSessionId(),
            originalCwd: getOriginalCwd(),
          })
          return { behavior: 'allow' as const, updatedInput: {} }
        },
        getAppState: () => appState,
        setAppState,
        readFileCache: createFileStateCacheWithSizeLimit(16),
        toolState: new ToolStateSlots(),
        customSystemPrompt: 'Test system prompt.',
        thinkingConfig: { type: 'disabled' },
      })
    }

    // Construct BOTH QueryEngines inside separate isolated host sessions:
    let sessionA!: Session
    let sessionB!: Session
    const engineA = runWithNewHostSession(
      { id: sessionIdA, cwd: dirA, originalCwd: dirA, projectRoot: dirA },
      s => {
        sessionA = s
        return createHostEngine(dirA)
      },
    )
    const engineB = runWithNewHostSession(
      { id: sessionIdB, cwd: dirB, originalCwd: dirB, projectRoot: dirB },
      s => {
        sessionB = s
        return createHostEngine(dirB)
      },
    )

    // Verify we are COMPLETELY OUTSIDE any ALS context right now!
    expect(hasActiveSessionAls()).toBe(false)
    expect(getSessionId()).toBe(defaultSessionId)
    expect(engineA.getSessionId()).toBe(sessionIdA)
    expect(engineB.getSessionId()).toBe(sessionIdB)

    // Iterate `for await (const msg of engine.submitMessage(...))` COMPLETELY OUTSIDE `runWithNewHostSession` in `Promise.all`!
    const [messagesA, messagesB] = await Promise.all([
      (async () => {
        const out: Array<Record<string, unknown>> = []
        for await (const msg of engineA.submitMessage(
          'Please inspect MARKER_ALPHA',
        )) {
          // Inside the outer consumer loop body, ALS must NOT leak from the generator!
          expect(hasActiveSessionAls()).toBe(false)
          expect(getSessionId()).toBe(defaultSessionId)
          out.push(msg as unknown as Record<string, unknown>)
          await tick(3)
        }
        return out
      })(),
      (async () => {
        const out: Array<Record<string, unknown>> = []
        for await (const msg of engineB.submitMessage(
          'Please inspect MARKER_BRAVO',
        )) {
          expect(hasActiveSessionAls()).toBe(false)
          expect(getSessionId()).toBe(defaultSessionId)
          out.push(msg as unknown as Record<string, unknown>)
          await tick(2)
        }
        return out
      })(),
    ])

    // 1a. Every yielded SDKMessage carries its bound host's session_id (NEVER defaultSessionId!)
    const resultA = messagesA.find(m => m.type === 'result')
    const resultB = messagesB.find(m => m.type === 'result')
    expect(resultA).toMatchObject({
      subtype: 'success',
      is_error: false,
      result: 'REPLY_ALPHA_OK',
    })
    expect(resultB).toMatchObject({
      subtype: 'success',
      is_error: false,
      result: 'REPLY_BRAVO_OK',
    })
    expect(messagesA.length).toBeGreaterThanOrEqual(4)
    expect(messagesB.length).toBeGreaterThanOrEqual(4)
    for (const msg of messagesA) {
      if ('session_id' in msg) {
        expect(msg.session_id).toBe(sessionIdA)
      }
    }
    for (const msg of messagesB) {
      if ('session_id' in msg) {
        expect(msg.session_id).toBe(sessionIdB)
      }
    }

    // 1b. Tool calls and canUseTool hooks executed after `.next()` yields ran inside each engine's bound Session!
    const obsAlpha = toolObservations.find(o => o.tag === 'alpha')
    const obsBravo = toolObservations.find(o => o.tag === 'bravo')
    expect(obsAlpha).toBeDefined()
    expect(obsBravo).toBeDefined()
    expect(obsAlpha?.sessionId).toBe(sessionIdA)
    expect(obsAlpha?.originalCwd).toBe(dirA.normalize('NFC'))
    expect(obsBravo?.sessionId).toBe(sessionIdB)
    expect(obsBravo?.originalCwd).toBe(dirB.normalize('NFC'))

    expect(
      canUseToolObservations.some(
        c =>
          c.sessionId === sessionIdA && c.originalCwd === dirA.normalize('NFC'),
      ),
    ).toBe(true)
    expect(
      canUseToolObservations.some(
        c =>
          c.sessionId === sessionIdB && c.originalCwd === dirB.normalize('NFC'),
      ),
    ).toBe(true)

    // 1c. CostLedger updates stayed strictly isolated per Session; default bootstrapSession has 0 cost!
    const costA = runWithSession(sessionA, () => getTotalCostUSD())
    const costB = runWithSession(sessionB, () => getTotalCostUSD())
    expect(costA).toBeGreaterThan(0)
    expect(costB).toBeGreaterThan(0)
    expect(costB).toBeGreaterThan(costA)
    expect(resultA?.total_cost_usd).toBeCloseTo(costA, 8)
    expect(resultB?.total_cost_usd).toBeCloseTo(costB, 8)
    expect(defaultBootstrap.costLedger.totalCostUSD()).toBe(0)
    expect(getTotalCostUSD()).toBe(0)

    // 1d. sessionStorage persisted transcripts to two distinct host project directories without cross-talk!
    await runWithSession(sessionA, () => flushSessionStorage())
    await runWithSession(sessionB, () => flushSessionStorage())
    const transcriptPathA = runWithSession(sessionA, () => getTranscriptPath())
    const transcriptPathB = runWithSession(sessionB, () => getTranscriptPath())
    const defaultTranscriptPath = getTranscriptPath()
    expect(transcriptPathA).not.toBe(transcriptPathB)
    expect(existsSync(transcriptPathA)).toBe(true)
    expect(existsSync(transcriptPathB)).toBe(true)
    expect(existsSync(defaultTranscriptPath)).toBe(false)

    const rawA = await readFile(transcriptPathA, 'utf8')
    const rawB = await readFile(transcriptPathB, 'utf8')
    expect(rawA).toContain('MARKER_ALPHA')
    expect(rawA).toContain('REPLY_ALPHA_OK')
    expect(rawA).not.toContain('MARKER_BRAVO')
    expect(rawA).not.toContain('REPLY_BRAVO_OK')

    expect(rawB).toContain('MARKER_BRAVO')
    expect(rawB).toContain('REPLY_BRAVO_OK')
    expect(rawB).not.toContain('MARKER_ALPHA')
    expect(rawB).not.toContain('REPLY_ALPHA_OK')
  })

  test('1e. QueryEngine supports explicit config.session and preserves boundSession on early generator .return() / break outside ALS', async () => {
    const dirExplicit = await makeTempDir('cc-331-qe-explicit-')
    const explicitSessionId = randomUUID()
    const explicitSession = createRootSession({
      host: createSessionHost(),
      id: explicitSessionId,
      project: {
        originalCwd: dirExplicit,
        projectRoot: dirExplicit,
        cwd: dirExplicit,
      },
    })

    // Construct OUTSIDE `runWithSession`, passing `session: explicitSession` via QueryEngineConfig!
    expect(hasActiveSessionAls()).toBe(false)
    let appState = getDefaultAppState()
    const engine = new QueryEngine({
      cwd: dirExplicit,
      session: explicitSession,
      tools: [],
      commands: [],
      mcpClients: [],
      agents: [],
      canUseTool: async () => ({
        behavior: 'allow' as const,
        updatedInput: {},
      }),
      getAppState: () => appState,
      setAppState: f => {
        appState = f(appState)
      },
      readFileCache: createFileStateCacheWithSizeLimit(8),
      customSystemPrompt: 'Explicit session test.',
      thinkingConfig: { type: 'disabled' },
    })

    expect(engine.getBoundSession()).toBe(explicitSession)
    expect(engine.getSessionId()).toBe(explicitSessionId)

    // Break after the first yielded `system/init` frame from OUTSIDE ALS — exercises `bound.return()` cleanup!
    let firstFrameSessionId: string | undefined
    for await (const msg of engine.submitMessage('MARKER_ALPHA early break')) {
      firstFrameSessionId = (msg as { session_id?: string }).session_id
      break
    }
    expect(firstFrameSessionId).toBe(explicitSessionId)
    expect(hasActiveSessionAls()).toBe(false)

    engine.interrupt()
    expect(engine.getAbortSignal().aborted).toBe(true)
    engine.resetAbortController()
    expect(engine.getAbortSignal().aborted).toBe(false)
  })

  test('2. runAgent: detached subagent AsyncGenerators spawned in two hosts and iterated inside exitSessionContext keep spawning Session ALS', async () => {
    const dirA = await makeTempDir('cc-331-agent-alpha-')
    const dirB = await makeTempDir('cc-331-agent-bravo-')
    const sessionIdA = randomUUID()
    const sessionIdB = randomUUID()

    const subagentToolHits: Array<{
      tag: string
      sessionId: string
      originalCwd: string
    }> = []

    const probeTool: Tool = buildTool({
      name: 'ProbeAlsHost',
      description: async () =>
        'Probes active ALS Session inside subagent tool call',
      prompt: async () => 'Probes active ALS Session inside subagent tool call',
      inputSchema: z.object({ tag: z.string() }),
      maxResultSizeChars: 100_000,
      renderToolUseMessage: () => null,
      isConcurrencySafe: () => true,
      isReadOnly: () => true,
      async call(input) {
        await tick(6)
        const hit = {
          tag: input.tag,
          sessionId: getSessionId(),
          originalCwd: getOriginalCwd(),
        }
        subagentToolHits.push(hit)
        return { data: hit }
      },
      mapToolResultToToolResultBlockParam(data, toolUseID) {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: JSON.stringify(data),
        }
      },
    })

    const agentDef: AgentDefinition = {
      agentType: 'als-probe-worker',
      whenToUse: 'Test ALS preservation',
      getSystemPrompt: () => 'You are an ALS test subagent.',
      tools: ['ProbeAlsHost'],
      source: 'built-in',
      baseDir: 'built-in',
    }

    function spawnDetachedAgentGen(promptText: string, agentId: string) {
      let state = getDefaultAppState()
      const setAppState = (f: (prev: typeof state) => typeof state) => {
        state = f(state)
      }
      const taskRegistry = createTaskRegistry(() => state, setAppState)
      return runAgent({
        agentDefinition: agentDef,
        promptMessages: [createUserMessage({ content: promptText })],
        toolUseContext: {
          options: {
            commands: [],
            debug: false,
            mainLoopModel: 'claude-sonnet-4-6',
            tools: [probeTool],
            verbose: false,
            thinkingConfig: { type: 'disabled' },
            mcpClients: [],
            mcpResources: {},
            isNonInteractiveSession: true,
            agentDefinitions: {
              activeAgents: [agentDef],
              allAgents: [agentDef],
            },
          },
          abortController: new AbortController(),
          readFileState: createFileStateCacheWithSizeLimit(8),
          getAppState: () => state,
          setAppState,
          setAppStateForTasks: setAppState,
          taskRegistry,
          messages: [],
          setMessages: () => {},
          setInProgressToolUseIDs: () => {},
          setResponseLength: () => {},
          toolState: new ToolStateSlots(),
        } as unknown as Parameters<typeof runAgent>[0]['toolUseContext'],
        canUseTool: async () => ({
          behavior: 'allow' as const,
          updatedInput: {},
        }),
        isAsync: true,
        useExactTools: true,
        querySource: 'agent:custom',
        availableTools: [probeTool],
        override: {
          agentId: agentId as Parameters<typeof runAgent>[0]['override'] extends
            | { agentId?: infer A }
            | undefined
            ? A
            : never,
          userContext: {},
          systemContext: {},
        },
      })
    }

    let sessionA!: Session
    let sessionB!: Session
    const agentIdA = `agent-alpha-${randomUUID().slice(0, 8)}`
    const agentIdB = `agent-bravo-${randomUUID().slice(0, 8)}`

    const genA = runWithNewHostSession(
      { id: sessionIdA, cwd: dirA, originalCwd: dirA, projectRoot: dirA },
      s => {
        sessionA = s
        return spawnDetachedAgentGen('Subagent MARKER_ALPHA', agentIdA)
      },
    )
    const genB = runWithNewHostSession(
      { id: sessionIdB, cwd: dirB, originalCwd: dirB, projectRoot: dirB },
      s => {
        sessionB = s
        return spawnDetachedAgentGen('Subagent MARKER_BRAVO', agentIdB)
      },
    )

    // Consume BOTH subagent generators inside `exitSessionContext` (zero ALS!) in parallel
    await exitSessionContext(() =>
      Promise.all([
        (async () => {
          for await (const _msg of genA) {
            expect(hasActiveSessionAls()).toBe(false)
            await tick(2)
          }
        })(),
        (async () => {
          for await (const _msg of genB) {
            expect(hasActiveSessionAls()).toBe(false)
            await tick(2)
          }
        })(),
      ]),
    )

    const hitA = subagentToolHits.find(h => h.tag === 'alpha')
    const hitB = subagentToolHits.find(h => h.tag === 'bravo')
    expect(hitA).toEqual({
      tag: 'alpha',
      sessionId: sessionIdA,
      originalCwd: dirA.normalize('NFC'),
    })
    expect(hitB).toEqual({
      tag: 'bravo',
      sessionId: sessionIdB,
      originalCwd: dirB.normalize('NFC'),
    })

    await runWithSession(sessionA, () => flushSessionStorage())
    await runWithSession(sessionB, () => flushSessionStorage())
    const sidechainA = runWithSession(sessionA, () =>
      getAgentTranscriptPath(
        agentIdA as Parameters<typeof getAgentTranscriptPath>[0],
      ),
    )
    const sidechainB = runWithSession(sessionB, () =>
      getAgentTranscriptPath(
        agentIdB as Parameters<typeof getAgentTranscriptPath>[0],
      ),
    )
    expect(existsSync(sidechainA)).toBe(true)
    expect(existsSync(sidechainB)).toBe(true)
    expect(await readFile(sidechainA, 'utf8')).toContain('REPLY_ALPHA_OK')
    expect(await readFile(sidechainB, 'utf8')).toContain('REPLY_BRAVO_OK')
  })

  test('3a. LocalShellTask: spawnShellTask + foreground->background transitions + pressure reap route notifications to originating host when OS callbacks fire inside AsyncLocalStorage.exit()', async () => {
    const dirA = await makeTempDir('cc-331-shell-alpha-')
    const dirB = await makeTempDir('cc-331-shell-bravo-')

    let sessionA!: Session
    let sessionB!: Session
    let stateA = getDefaultAppState()
    let stateB = getDefaultAppState()
    const setAppStateA = (f: (prev: typeof stateA) => typeof stateA) => {
      stateA = f(stateA)
    }
    const setAppStateB = (f: (prev: typeof stateB) => typeof stateB) => {
      stateB = f(stateB)
    }

    let bgShellA!: DeferredShell
    let bgShellB!: DeferredShell
    let fgShellA!: DeferredShell
    let fgTaskIdA!: string
    let fgShellB!: DeferredShell
    let fgTaskIdB!: string
    let pressureShellA!: DeferredShell
    let disposePressureA!: () => void

    let handleA!: Awaited<ReturnType<typeof spawnShellTask>>
    let handleB!: Awaited<ReturnType<typeof spawnShellTask>>

    await Promise.all([
      runWithNewHostSession(
        { id: randomUUID(), cwd: dirA, isInteractive: true },
        async s => {
          sessionA = s
          setIsInteractive(true)

          bgShellA = makeDeferredShellCommand('bash-bg-alpha')
          handleA = await spawnShellTask(
            {
              command: 'echo alpha-bg',
              description: 'alpha background build',
              shellCommand: bgShellA.shellCommand,
              toolUseId: 'tu-bg-a',
            },
            {
              abortController: new AbortController(),
              getAppState: () => stateA,
              setAppState: setAppStateA,
            },
          )

          fgShellA = makeDeferredShellCommand('bash-fg-alpha')
          fgTaskIdA = registerForeground(
            {
              command: 'echo alpha-fg-to-bg',
              description: 'alpha promoted command',
              shellCommand: fgShellA.shellCommand,
            },
            setAppStateA,
            'tu-fg-a',
            () => stateA,
          )

          pressureShellA = makeDeferredShellCommand('bash-pressure-alpha')
          await spawnShellTask(
            {
              command: 'sleep 999',
              description: 'alpha memory-pressure candidate',
              shellCommand: pressureShellA.shellCommand,
              toolUseId: 'tu-press-a',
            },
            {
              abortController: new AbortController(),
              getAppState: () => stateA,
              setAppState: setAppStateA,
            },
          )
          // Replace with deterministic scarce-memory override for pressure-reap verification
          const regA = createTaskRegistry(() => stateA, setAppStateA)
          disposePressureA = installShellPressureReap(
            'bash-pressure-alpha',
            'alpha memory-pressure candidate',
            regA,
            'tu-press-a',
            'bash',
            undefined,
            {
              isInteractive: true,
              getNow: () => Date.now(),
              getLastInteraction: () => Date.now() - 45 * 60_000,
              isMainLoopBusy: () => false,
              checkHostMemory: () => ({ scarce: true, detail: 'avail=64MB' }),
            },
          )
        },
      ),
      runWithNewHostSession(
        { id: randomUUID(), cwd: dirB, isInteractive: true },
        async s => {
          sessionB = s
          bgShellB = makeDeferredShellCommand('bash-bg-bravo')
          handleB = await spawnShellTask(
            {
              command: 'echo bravo-bg',
              description: 'bravo background test',
              shellCommand: bgShellB.shellCommand,
              toolUseId: 'tu-bg-b',
            },
            {
              abortController: new AbortController(),
              getAppState: () => stateB,
              setAppState: setAppStateB,
            },
          )

          fgShellB = makeDeferredShellCommand('bash-fg-bravo')
          fgTaskIdB = registerForeground(
            {
              command: 'echo bravo-auto-bg',
              description: 'bravo auto-backgrounded command',
              shellCommand: fgShellB.shellCommand,
            },
            setAppStateB,
            'tu-fg-b',
            () => stateB,
          )
        },
      ),
    ])

    try {
      // Simulate unbound OS EventEmitter / socket control callbacks via `sessionContextAls.exit(...)`!
      sessionContextAls.exit(() => {
        expect(hasActiveSessionAls()).toBe(false)

        // 1. Promote foreground tasks to background FROM OUTSIDE ALS (Ctrl+B / control socket / auto-bg timer)
        const regA = createTaskRegistry(() => stateA, setAppStateA)
        expect(backgroundTask(fgTaskIdA, regA)).toBe(true)
        expect(
          backgroundExistingForegroundTask(
            fgTaskIdB,
            fgShellB.shellCommand,
            'bravo auto-backgrounded command',
            setAppStateB,
            'tu-fg-b',
            () => stateB,
          ),
        ).toBe(true)

        // 2. Fire OS child-process exit callbacks FROM OUTSIDE ALS
        bgShellA.resolveExit({
          code: 0,
          interrupted: false,
          stdout: 'alpha ok',
        })
        bgShellB.resolveExit({
          code: 2,
          interrupted: false,
          stderr: 'bravo err',
        })
        fgShellA.resolveExit({
          code: 0,
          interrupted: false,
          stdout: 'alpha fg ok',
        })
        fgShellB.resolveExit({
          code: 0,
          interrupted: false,
          stdout: 'bravo fg ok',
        })

        // 3. Fire global process `memoryPressure` event FROM OUTSIDE ALS
        ;(
          process as unknown as {
            emit: (ev: string, level?: string) => boolean
          }
        ).emit('memoryPressure', 'critical')
        pressureShellA.resolveExit({ code: 143, interrupted: true })
      })

      await Promise.all([handleA.settled, handleB.settled])
      await tick(30)

      // Default bootstrapSession queue MUST remain completely untouched!
      expect(getCommandQueueSnapshot()).toHaveLength(0)

      const queueA = runWithSession(sessionA, () => getCommandQueueSnapshot())
      const queueB = runWithSession(sessionB, () => getCommandQueueSnapshot())
      const mainAgentA = runWithSession(sessionA, () => getMainThreadAgentId())
      const mainAgentB = runWithSession(sessionB, () => getMainThreadAgentId())

      const valuesA = queueA.map(cmd => String(cmd.value))
      const valuesB = queueB.map(cmd => String(cmd.value))

      // Host A received ONLY its 3 notifications (bg, promoted fg, pressure reap)
      expect(
        valuesA.some(
          v =>
            v.includes('alpha background build') &&
            v.includes('<status>completed</status>'),
        ),
      ).toBe(true)
      expect(
        valuesA.some(
          v =>
            v.includes('alpha promoted command') &&
            v.includes('<status>completed</status>'),
        ),
      ).toBe(true)
      expect(
        valuesA.some(
          v =>
            v.includes('alpha memory-pressure candidate') &&
            v.includes('<status>killed</status>'),
        ),
      ).toBe(true)
      expect(valuesA.some(v => v.includes('bravo'))).toBe(false)
      for (const cmd of queueA) {
        expect(cmd.agentId).toBe(mainAgentA)
      }

      // Host B received ONLY its 2 notifications (bg failed + auto-bg completed)
      expect(
        valuesB.some(
          v =>
            v.includes('bravo background test') &&
            v.includes('<status>failed</status>'),
        ),
      ).toBe(true)
      expect(
        valuesB.some(
          v =>
            v.includes('bravo auto-backgrounded command') &&
            v.includes('<status>completed</status>'),
        ),
      ).toBe(true)
      expect(valuesB.some(v => v.includes('alpha'))).toBe(false)
      for (const cmd of queueB) {
        expect(cmd.agentId).toBe(mainAgentB)
      }
    } finally {
      disposePressureA?.()
      runWithSession(sessionA, () => clearCommandQueue())
      runWithSession(sessionB, () => clearCommandQueue())
    }
  })

  test('3b. MonitorStreamPump & startQuietCheckin: unbound child stdout/exit & timer callbacks inside AsyncLocalStorage.exit() always route to originating host queue', async () => {
    const dirA = await makeTempDir('cc-331-mon-alpha-')
    const dirB = await makeTempDir('cc-331-mon-bravo-')

    let sessionA!: Session
    let sessionB!: Session
    let flushDebounceA: (() => void) | undefined
    let flushDebounceB: (() => void) | undefined

    const pumpA = runWithNewHostSession({ id: randomUUID(), cwd: dirA }, s => {
      sessionA = s
      return createMonitorStreamPump({
        description: 'alpha service logs',
        taskRef: { id: 'mon-alpha-1' },
        killTask: () => false,
        schedule: flush => {
          flushDebounceA = flush
          return () => {}
        },
      })
    })

    const pumpB = runWithNewHostSession({ id: randomUUID(), cwd: dirB }, s => {
      sessionB = s
      return createMonitorStreamPump({
        description: 'bravo deploy watch',
        taskRef: { id: 'mon-bravo-1' },
        killTask: () => false,
        schedule: flush => {
          flushDebounceB = flush
          return () => {}
        },
      })
    })

    // Also arm startQuietCheckin in Host A and let its interval fire outside ALS!
    let stateA = getDefaultAppState()
    const setAppStateA = (f: (prev: typeof stateA) => typeof stateA) => {
      stateA = f(stateA)
    }
    const quietShell = makeDeferredShellCommand('quiet-shell-alpha')
    let disposeQuietA!: () => void

    await runWithSession(sessionA, async () => {
      await spawnShellTask(
        {
          command: 'long-build',
          description: 'alpha silent build',
          shellCommand: quietShell.shellCommand,
        },
        {
          abortController: new AbortController(),
          getAppState: () => stateA,
          setAppState: setAppStateA,
        },
      )
      const regA = createTaskRegistry(() => stateA, setAppStateA)
      disposeQuietA = startQuietCheckin(
        {
          taskId: 'quiet-shell-alpha',
          description: 'alpha silent build',
          taskRegistry: regA,
        },
        {
          thresholdMs: 20,
          pollMs: 10,
          getOutputSize: async () => 0,
          getNow: Date.now,
          getLastInteraction: () => Date.now() - 60_000,
          isMainLoopBusy: () => false,
        },
      )
    })

    try {
      await tick(55)

      // Fire monitor stdout chunks, debounce flushes, and process exits COMPLETELY OUTSIDE ALS!
      await sessionContextAls.exit(async () => {
        expect(hasActiveSessionAls()).toBe(false)

        pumpA.onData('alpha-event-line-1\nalpha-tail-partial')
        pumpB.onData('bravo-event-line-1\n')

        flushDebounceA?.()
        flushDebounceB?.()

        await Promise.all([
          pumpA.reportExit({
            terminalNotification: {
              taskId: 'mon-alpha-1',
              status: 'completed',
              summary: 'Monitor "alpha service logs" stream ended',
              outputFile: join(dirA, 'mon-alpha-1.output'),
            },
          }),
          pumpB.reportExit({
            terminalNotification: {
              taskId: 'mon-bravo-1',
              status: 'failed',
              summary: 'Monitor "bravo deploy watch" script failed (exit 1)',
              outputFile: join(dirB, 'mon-bravo-1.output'),
            },
          }),
        ])
      })

      // Default bootstrapSession queue MUST be 100% empty!
      expect(getCommandQueueSnapshot()).toHaveLength(0)

      const queueA = runWithSession(sessionA, () => getCommandQueueSnapshot())
      const queueB = runWithSession(sessionB, () => getCommandQueueSnapshot())
      const mainAgentA = runWithSession(sessionA, () => getMainThreadAgentId())
      const mainAgentB = runWithSession(sessionB, () => getMainThreadAgentId())

      const valuesA = queueA.map(c => String(c.value))
      const valuesB = queueB.map(c => String(c.value))

      // Host A received:
      //  1) Monitor stream batch `<event>alpha-event-line-1</event>`
      //  2) Terminal monitor notification with drained partial `alpha-tail-partial`
      //  3) Quiet check-in notification for `alpha silent build`
      expect(
        valuesA.some(
          v =>
            v.includes('Monitor event: "alpha service logs"') &&
            v.includes('<event>alpha-event-line-1</event>'),
        ),
      ).toBe(true)
      expect(
        valuesA.some(
          v =>
            v.includes('Monitor "alpha service logs" stream ended') &&
            v.includes('<status>completed</status>') &&
            v.includes('alpha-tail-partial'),
        ),
      ).toBe(true)
      expect(
        valuesA.some(
          v =>
            v.includes('alpha silent build') &&
            v.includes('This is a check-in, not a completion.'),
        ),
      ).toBe(true)
      expect(valuesA.some(v => v.includes('bravo'))).toBe(false)
      for (const cmd of queueA) {
        expect(cmd.agentId).toBe(mainAgentA)
      }

      // Host B received ONLY its batch + terminal monitor notification
      expect(
        valuesB.some(
          v =>
            v.includes('Monitor event: "bravo deploy watch"') &&
            v.includes('<event>bravo-event-line-1</event>'),
        ),
      ).toBe(true)
      expect(
        valuesB.some(
          v =>
            v.includes('Monitor "bravo deploy watch" script failed (exit 1)') &&
            v.includes('<status>failed</status>'),
        ),
      ).toBe(true)
      expect(valuesB.some(v => v.includes('alpha'))).toBe(false)
      for (const cmd of queueB) {
        expect(cmd.agentId).toBe(mainAgentB)
      }

      // Disposing quiet check-in from OUTSIDE ALS removes the pending check-in from Host A's queue!
      sessionContextAls.exit(() => {
        disposeQuietA()
      })
      const queueAAfterDispose = runWithSession(sessionA, () =>
        getCommandQueueSnapshot(),
      )
      expect(
        queueAAfterDispose.some(c =>
          String(c.value).includes('This is a check-in, not a completion.'),
        ),
      ).toBe(false)
    } finally {
      disposeQuietA?.()
      quietShell.resolveExit({ code: 0, interrupted: true })
      await tick(10)
    }
  })
})
