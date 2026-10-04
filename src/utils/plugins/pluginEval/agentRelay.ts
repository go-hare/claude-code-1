/**
 * densable `sc` / `Gm` / `Hm` / `Wm` — mock agent unix/pipe relay.
 * Gold listens on a temp socket (unix) or named pipe (win32), parses one
 * JSON line `{token, registeredName, tool, input}`, answers `{verdict,text}`.
 * Agent responders call densable `Km` (`answerAgentMock`).
 */

import { randomBytes, timingSafeEqual } from 'crypto'
import { createServer, type Server, type Socket } from 'net'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { logForDebugging } from '../../debug.js'
import {
  MOCK_AGENT_FAILED,
  answerAgentMock,
  type AgentMockHistoryEntry,
  type AgentMockResponder as LlmAgentResponder,
} from './agentMock.js'
import {
  hashEvalInput,
  mockOutputKey,
  prefixMockAbortOutput,
} from './mockKeys.js'

const REQUEST_CAP = 1_048_576
const IDLE_MS = 30_000
const RELAY_INTERNAL = `${MOCK_AGENT_FAILED} (relay_internal) — see the eval debug log`

const requestSchema = z.object({
  token: z.string(),
  registeredName: z.string(),
  tool: z.string(),
  input: z.unknown(),
})

export type MockRelayVerdict = {
  verdict: 'ok' | 'tool_error' | 'abort'
  text: string
}

/** densable `e.answers.push` @212311228 — keys for `pg`. */
export type AgentRelayAnswer = {
  server: string
  tool: string
  inputKey: string
  verdict: 'ok' | 'tool_error' | 'abort'
  outputKey: string
}

export type AgentMockResponder = {
  kind: 'agent'
  body?: string
  prompt?: string
  abortWhen?: string | null
  expect?: Record<string, unknown> | null
  baseDir?: string
  replay?: {
    mockHash: string
    replayDir?: string
    pinned?: Record<string, string>
  }
}

export type AgentRelayRun = {
  relay: { socketPath: string; token: string }
  attachSpecs: (
    specs: Array<{
      registeredName: string
      server: string
      responders: Record<
        string,
        AgentMockResponder | { kind: 'fixed'; body?: string }
      >
    }>,
  ) => void
  state: {
    aborted: { server: string; tool: string; reason: string } | null
    agentCalls: number
    /** densable `relaysReceived(dirName, tool)` — in-flight vs answered. */
    relaysReceived: (server: string, tool: string) => number
    answers: AgentRelayAnswer[]
    inFlight: number
  }
  /** densable `settled()` — drain the answer queue after dispose. */
  settled: () => Promise<void>
  dispose: () => void
}

export type AgentRelayService = {
  registerRun: (params: { model?: string; callBudget: number }) => AgentRelayRun
  close: () => Promise<void>
}

type RunState = {
  specs: Map<
    string,
    {
      server: string
      responders: Record<
        string,
        AgentMockResponder | { kind: 'fixed'; body?: string }
      >
    }
  >
  callBudget: number
  abort: AbortController
  agentCalls: number
  aborted: { server: string; tool: string; reason: string } | null
  queue: Promise<unknown>
  model?: string
  history: Map<string, AgentMockHistoryEntry[]>
  received: Map<string, number>
  answers: AgentRelayAnswer[]
  inFlight: number
}

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()))
}

async function handleRequest(
  line: string,
  runs: Map<string, RunState>,
): Promise<MockRelayVerdict> {
  let parsed: z.infer<typeof requestSchema>
  try {
    parsed = requestSchema.parse(JSON.parse(line))
  } catch {
    return { verdict: 'tool_error', text: 'malformed mock relay request' }
  }
  let run: RunState | undefined
  for (const [token, state] of runs) {
    if (tokensEqual(parsed.token, token)) {
      run = state
      break
    }
  }
  if (run === undefined) {
    return { verdict: 'tool_error', text: 'mock relay: no such run' }
  }
  if (run.aborted !== null) {
    return { verdict: 'abort', text: run.aborted.reason }
  }
  if (run.abort.signal.aborted) {
    return { verdict: 'abort', text: 'run ended' }
  }
  run.agentCalls++
  const spec = run.specs.get(parsed.registeredName)
  const receivedKey = `${spec?.server ?? parsed.registeredName}\0${parsed.tool}`
  run.received.set(receivedKey, (run.received.get(receivedKey) ?? 0) + 1)
  run.inFlight++
  try {
    if (run.agentCalls > run.callBudget) {
      const reason = `mock call budget exceeded (${run.callBudget} agent-answered calls this run)`
      run.aborted = {
        server: spec?.server ?? '(no mocked server)',
        tool: parsed.tool,
        reason,
      }
      return { verdict: 'abort', text: reason }
    }
    const responder = spec?.responders[parsed.tool]
    if (
      spec === undefined ||
      responder === undefined ||
      responder.kind !== 'agent'
    ) {
      return {
        verdict: 'tool_error',
        text: `no agent mock for ${parsed.registeredName}/${parsed.tool}`,
      }
    }
    if (typeof responder.body === 'string' && responder.body.length > 0) {
      return { verdict: 'ok', text: responder.body }
    }
    const prompt = responder.prompt ?? ''
    if (prompt.length === 0) {
      return {
        verdict: 'tool_error',
        text: `no agent mock for ${parsed.registeredName}/${parsed.tool}`,
      }
    }
    const history = run.history.get(spec.server) ?? []
    const llm: LlmAgentResponder = {
      kind: 'agent',
      prompt,
      abortWhen: responder.abortWhen ?? null,
      expect: responder.expect ?? null,
      baseDir: responder.baseDir ?? process.cwd(),
      replay: responder.replay,
    }
    const answered = await answerAgentMock({
      server: spec.server,
      tool: parsed.tool,
      input: parsed.input,
      responder: llm,
      history,
      model: run.model,
      signal: run.abort.signal,
    })
    run.answers.push({
      server: spec.server,
      tool: parsed.tool,
      inputKey: hashEvalInput(parsed.input),
      verdict: answered.verdict,
      outputKey: mockOutputKey(
        prefixMockAbortOutput(answered.text),
        answered.verdict,
      ),
    })
    history.push({
      server: spec.server,
      tool: parsed.tool,
      input: parsed.input,
      verdict: answered.verdict,
      output: answered.text,
    })
    if (history.length > 40) history.splice(0, history.length - 40)
    run.history.set(spec.server, history)
    if (answered.verdict === 'abort' && run.aborted === null) {
      run.aborted = {
        server: spec.server,
        tool: parsed.tool,
        reason: answered.text,
      }
    }
    return { verdict: answered.verdict, text: answered.text }
  } finally {
    run.inFlight--
  }
}

function attachSocket(socket: Socket, runs: Map<string, RunState>): void {
  let buf = Buffer.alloc(0)
  let done = false
  const reply = (payload: MockRelayVerdict) => {
    if (done) return
    done = true
    socket.end(`${JSON.stringify(payload)}\n`)
  }
  socket.on('error', () => socket.destroy())
  socket.setTimeout(IDLE_MS, () => socket.destroy())
  socket.on('data', chunk => {
    if (done) return
    buf = Buffer.concat([buf, Buffer.from(chunk)])
    if (buf.length > REQUEST_CAP) {
      reply({
        verdict: 'abort',
        text: "mock relay request too large (a hook that rewrites this tool's input may have inflated it)",
      })
      return
    }
    const nl = buf.indexOf(10)
    if (nl === -1) return
    const line = buf.subarray(0, nl).toString('utf8')
    socket.setTimeout(0)
    handleRequest(line, runs).then(reply, error => {
      logForDebugging(
        `plugin eval: mock relay failed: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'warn' },
      )
      reply({ verdict: 'abort', text: RELAY_INTERNAL })
    })
  })
}

/** densable `sc`. */
export async function startEvalAgentRelay(): Promise<AgentRelayService> {
  const runs = new Map<string, RunState>()
  const sockets = new Set<Socket>()
  const tmp =
    process.platform === 'win32'
      ? null
      : await mkdtemp(join(tmpdir(), 'cc-eval-agent-'))
  const socketPath =
    tmp === null
      ? `\\\\.\\pipe\\cc-eval-agent-${randomBytes(8).toString('hex')}`
      : join(tmp, 's')
  const server = createServer(socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    attachSocket(socket, runs)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, () => {
        server.off('error', reject)
        resolve()
      })
    })
  } catch (error) {
    await closeServer(server).catch(() => {})
    if (tmp !== null)
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  server.on('error', error => {
    logForDebugging(
      `plugin eval: agent service error: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
  })
  server.unref()
  return {
    registerRun({ model, callBudget }) {
      const token = randomBytes(16).toString('hex')
      const state: RunState = {
        specs: new Map(),
        callBudget,
        abort: new AbortController(),
        agentCalls: 0,
        aborted: null,
        queue: Promise.resolve(),
        model,
        history: new Map(),
        received: new Map(),
        answers: [],
        inFlight: 0,
      }
      runs.set(token, state)
      return {
        relay: { socketPath, token },
        attachSpecs(specs) {
          for (const spec of specs) {
            state.specs.set(spec.registeredName, spec)
          }
        },
        state: {
          get aborted() {
            return state.aborted
          },
          get agentCalls() {
            return state.agentCalls
          },
          relaysReceived(server, tool) {
            return state.received.get(`${server}\0${tool}`) ?? 0
          },
          get answers() {
            return state.answers
          },
          get inFlight() {
            return state.inFlight
          },
        },
        async settled() {
          await state.queue.catch(() => {})
        },
        dispose() {
          state.abort.abort()
          runs.delete(token)
        },
      }
    },
    async close() {
      for (const run of runs.values()) run.abort.abort()
      runs.clear()
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      try {
        await closeServer(server)
        if (tmp !== null) await rm(tmp, { recursive: true, force: true })
      } catch (error) {
        logForDebugging(
          `eval mocks: agent service teardown: ${error instanceof Error ? error.message : String(error)}`,
          { level: 'error' },
        )
      }
    },
  }
}
