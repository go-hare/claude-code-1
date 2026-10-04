/**
 * densable mock-integrity cluster wrapping writeRunMocks / spawnEval / runOne:
 *   `Cf` @212235582  watch stream-json
 *   `Of` @212237081  init registration / identity / tools
 *   `Ha` @212181189  call-log lines
 *   `$f` @212239029  stand-in records vs trace
 *   `If` @212238667  annotate toolCalls
 *   `Df` @212240634  mock tally
 *   `Ba` @212181417  stand-in identity
 *   `pg` @212342345  agent-mock answers vs annotated toolCalls
 *
 * Gold `$3o` `--eval-mock-server` is the cli.tsx fast path. Integrity
 * fail-closes when a stand-in never identifies or the call log cannot cover
 * mocked tool_use in the child's trace.
 */
import { open, rm, stat } from 'fs/promises'
import { matchExpect } from './agentMock.js'
import type { AgentRelayRun, AgentRelayAnswer } from './agentRelay.js'
import { EVAL_ABORTED_BY_MOCK } from './constants.js'
import {
  hashEvalInput,
  mockOutputKey,
  prefixMockAbortOutput,
} from './mockKeys.js'
import type { AgentRunResult, ToolCallRecord } from './types.js'

export {
  hashEvalInput,
  hashEvalJson,
  mockOutputKey,
  prefixMockAbortOutput,
} from './mockKeys.js'

/** densable `po` @212181171 — 16 MiB call-log cap. */
export const MOCK_CALL_LOG_CAP = 16 * 1024 * 1024

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return 'null'
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}

export type MockSetupFailureKind =
  | 'registration'
  | 'identity'
  | 'tools_missing'
  | 'integrity'

export type PreparedMockServer = {
  dirName: string
  registeredName: string
  segment: string
  kind: 'shadow' | 'standalone'
  withheld: boolean
  tools: string[]
  toolFullNames: Record<string, string>
  responderKinds: Record<string, 'fixed' | 'agent'>
  expects: Record<string, Record<string, unknown> | null | undefined>
}

export type PreparedRunMocks = {
  configPath: string
  callLogPath: string
  nonce: string
  mockedTools: string[]
  agentRun: AgentRelayRun | null
  agentCallBudget: number
  servers: PreparedMockServer[]
}

export type MockCallLogRecord = {
  nonce: string
  seq: number
  replay?: 'hit' | 'miss'
  server: string
  tool: string
  responder: 'fixed' | 'agent'
  input: unknown
  verdict: 'ok' | 'tool_error' | 'abort'
  output: string
  ms: number
}

export type MockWatchVerdict =
  | {
      kind: MockSetupFailureKind
      message: string
    }
  | {
      kind: 'abort'
      message: string
      abort: { server: string; tool: string; reason: string }
    }

function eventContent(event: unknown): unknown[] {
  if (!event || typeof event !== 'object') return []
  const rec = event as Record<string, unknown>
  const message = rec.message
  if (!message || typeof message !== 'object') return []
  const content = (message as Record<string, unknown>).content
  return Array.isArray(content) ? content : []
}

/** densable `Ei`. */
export function mockResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(block =>
        block && typeof block === 'object' && 'text' in block
          ? String((block as { text?: unknown }).text ?? '')
          : '',
      )
      .join('')
  }
  return ''
}

/** densable `Af`. */
export function parseMockAbort(message: string): {
  server: string
  tool: string
  reason: string
} {
  const match = /^([^/\s]+)\/(\S+) — (.*)$/s.exec(message)
  return match
    ? {
        server: match[1] ?? '?',
        tool: match[2] ?? '?',
        reason: match[3] ?? message,
      }
    : { server: '?', tool: '?', reason: message }
}

/** densable `Nf`. */
export function isMockStandinDisconnect(output: string): boolean {
  return (
    /^MCP server "[^"\n]*" is not connected\b/.test(output) ||
    /^MCP error -32000: Connection closed\b/.test(output)
  )
}

async function readCappedFile(
  path: string,
  cap: number,
): Promise<{ text: string; truncated: boolean }> {
  try {
    const st = await stat(path)
    if (!st.isFile()) return { text: '', truncated: false }
    const size = Math.min(st.size, cap)
    const buf = Buffer.alloc(size)
    const handle = await open(path, 'r')
    try {
      let offset = 0
      while (offset < size) {
        const { bytesRead } = await handle.read(
          buf,
          offset,
          size - offset,
          offset,
        )
        if (bytesRead <= 0) break
        offset += bytesRead
      }
      return {
        text: buf.subarray(0, offset).toString('utf8'),
        truncated: st.size > cap,
      }
    } finally {
      await handle.close()
    }
  } catch {
    return { text: '', truncated: false }
  }
}

function parseCallLogLine(
  raw: unknown,
  nonce: string,
): MockCallLogRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (rec.nonce !== nonce) return null
  if (typeof rec.seq !== 'number' || typeof rec.server !== 'string') return null
  if (typeof rec.tool !== 'string') return null
  if (rec.responder !== 'fixed' && rec.responder !== 'agent') return null
  if (
    rec.verdict !== 'ok' &&
    rec.verdict !== 'tool_error' &&
    rec.verdict !== 'abort'
  ) {
    return null
  }
  if (typeof rec.output !== 'string' || typeof rec.ms !== 'number') return null
  return {
    nonce,
    seq: rec.seq,
    replay:
      rec.replay === 'hit' || rec.replay === 'miss' ? rec.replay : undefined,
    server: rec.server,
    tool: rec.tool,
    responder: rec.responder,
    input: rec.input,
    verdict: rec.verdict,
    output: rec.output,
    ms: rec.ms,
  }
}

/** densable `Ha`. */
export async function readMockCallLog(
  callLogPath: string,
  nonce: string,
): Promise<{ records: MockCallLogRecord[]; truncated: boolean }> {
  const { text, truncated } = await readCappedFile(
    callLogPath,
    MOCK_CALL_LOG_CAP,
  )
  const records: MockCallLogRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = parseCallLogLine(JSON.parse(line) as unknown, nonce)
      if (parsed) records.push(parsed)
    } catch {
      // ignore malformed lines
    }
  }
  return { records, truncated }
}

/** densable `Ba`. */
export async function readMockStandinIdentity(
  callLogPath: string,
  nonce: string,
): Promise<Set<string>> {
  const identified = new Set<string>()
  const { text } = await readCappedFile(callLogPath, MOCK_CALL_LOG_CAP)
  for (const line of text.split('\n')) {
    if (!line.includes('"ready"')) continue
    try {
      const rec = JSON.parse(line) as { ready?: unknown; server?: unknown }
      if (rec.ready === nonce && typeof rec.server === 'string') {
        identified.add(rec.server)
      }
    } catch {
      // ignore
    }
  }
  return identified
}

/** densable `Of`. */
export async function checkMockInit(
  event: Record<string, unknown>,
  mocks: PreparedRunMocks,
): Promise<MockWatchVerdict | null> {
  const listed = Array.isArray(event.mcp_servers) ? event.mcp_servers : []
  for (const server of mocks.servers) {
    const matches = listed.filter(
      (entry: unknown) =>
        entry !== null &&
        typeof entry === 'object' &&
        (entry as { name?: unknown }).name === server.registeredName,
    )
    if (matches.length !== 1) {
      return {
        kind: 'registration',
        message:
          matches.length === 0
            ? `mock stand-in for ${server.dirName} registered as "${server.registeredName}" is missing from the child's MCP servers — either a managed MCP policy dropped it (see stderr below) or the mocks/ directory name does not match a server this plugin registers`
            : `mock stand-in for ${server.dirName} registered as "${server.registeredName}" appears twice in the child's MCP servers`,
      }
    }
    const status = (matches[0] as { status?: unknown })?.status
    if (status !== 'connected') {
      return {
        kind: 'registration',
        message: `mock stand-in for ${server.dirName} ("${server.registeredName}") did not connect (status: ${String(status)})`,
      }
    }
  }
  const identified = await readMockStandinIdentity(
    mocks.callLogPath,
    mocks.nonce,
  )
  for (const server of mocks.servers) {
    if (!identified.has(server.dirName)) {
      return {
        kind: 'identity',
        message: `the server connected as "${server.registeredName}" did not identify as this run's mock stand-in for ${server.dirName} — refusing to run against what may be the real server`,
      }
    }
  }
  const offered = new Set(
    Array.isArray(event.tools) ? event.tools.map(String) : [],
  )
  const missing = mocks.mockedTools.filter(name => !offered.has(name))
  if (missing.length > 0) {
    return {
      kind: 'tools_missing',
      message: `mocked tools not offered by the child: ${missing.join(', ')}`,
    }
  }
  await rm(mocks.configPath, { force: true }).catch(() => {})
  return null
}

/** densable `Cf`. */
export function createMockTraceWatcher(
  mocks: PreparedRunMocks,
): (
  event: unknown,
) => MockWatchVerdict | Promise<MockWatchVerdict | null> | null {
  const mocked = new Set(mocks.mockedTools)
  const expects = new Map<
    string,
    { server: string; tool: string; expect: Record<string, unknown> }
  >()
  for (const server of mocks.servers) {
    for (const tool of server.tools) {
      const spec = server.expects[tool]
      if (spec) {
        expects.set(server.toolFullNames[tool] ?? '', {
          server: server.dirName,
          tool,
          expect: spec,
        })
      }
    }
  }
  const agentServed = new Set(
    mocks.servers.flatMap(server =>
      server.tools
        .filter(tool => server.responderKinds[tool] === 'agent')
        .map(tool => server.toolFullNames[tool] ?? ''),
    ),
  )
  const mockedIds = new Set<string>()
  const agentIds = new Set<string>()
  let agentResults = 0
  const abortPrefix = `${EVAL_ABORTED_BY_MOCK} ${mocks.nonce}:`
  return event => {
    if (!event || typeof event !== 'object') return null
    const rec = event as Record<string, unknown>
    if (rec.type === 'system' && rec.subtype === 'init') {
      return checkMockInit(rec, mocks)
    }
    for (const block of eventContent(rec)) {
      if (
        rec.type === 'assistant' &&
        block !== null &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'tool_use'
      ) {
        const use = block as { id?: unknown; name?: unknown; input?: unknown }
        if (
          typeof use.id === 'string' &&
          typeof use.name === 'string' &&
          mocked.has(use.name)
        ) {
          mockedIds.add(use.id)
          if (agentServed.has(use.name)) agentIds.add(use.id)
          const expect = expects.get(use.name)
          if (expect) {
            const violation = matchExpect(use.input, expect.expect)
            if (violation !== null) {
              return {
                kind: 'abort',
                message: `stopped by harness: ${expect.server}/${expect.tool} — the model's call violates expect: ${violation}`,
                abort: {
                  server: expect.server,
                  tool: expect.tool,
                  reason: `the model's call violates expect: ${violation}`,
                },
              }
            }
          }
        }
      } else if (
        rec.type === 'user' &&
        block !== null &&
        typeof block === 'object'
      ) {
        const result = block as {
          type?: unknown
          tool_use_id?: unknown
          is_error?: unknown
          content?: unknown
        }
        if (
          result.type !== 'tool_result' ||
          typeof result.tool_use_id !== 'string'
        ) {
          continue
        }
        if (
          agentIds.has(result.tool_use_id) &&
          ++agentResults > 2 * mocks.agentCallBudget
        ) {
          return {
            kind: 'integrity',
            message: `mocks: agent-served mock results in the trace exceeded twice the run budget (${mocks.agentCallBudget}) — the harness's own gate refuses at the budget, so this run's mocked calls were answered other than through it; the run is not graded`,
          }
        }
        if (result.is_error === true && mockedIds.has(result.tool_use_id)) {
          const text = mockResultText(result.content)
          if (text.startsWith(abortPrefix)) {
            const reason = text.slice(abortPrefix.length).trim()
            return {
              kind: 'abort',
              message: `stopped by mock: ${reason}`,
              abort: parseMockAbort(reason),
            }
          }
        }
      }
    }
    return null
  }
}

/** densable `If`. */
export function annotateMockToolCalls(
  toolCalls: ToolCallRecord[],
  mocks: PreparedRunMocks,
): void {
  const abortPrefix = `${EVAL_ABORTED_BY_MOCK} ${mocks.nonce}:`
  const responders = new Map<string, string>()
  for (const server of mocks.servers) {
    for (const tool of server.tools) {
      const full = server.toolFullNames[tool]
      if (full !== undefined) {
        responders.set(full, server.responderKinds[tool] ?? 'fixed')
      }
    }
  }
  for (const call of toolCalls) {
    const responder = responders.get(call.name)
    if (responder === undefined) continue
    call.mock = {
      responder,
      verdict:
        call.isError === undefined
          ? 'no_result'
          : !call.isError
            ? 'ok'
            : (call.output ?? '').startsWith(abortPrefix)
              ? 'abort'
              : 'tool_error',
    }
  }
}

/** densable `$f`. */
export function compareMockCallLog(
  toolCalls: ToolCallRecord[],
  records: MockCallLogRecord[] | null,
  mocks: PreparedRunMocks,
  killed: 'unprovokable' | 'provokable' | null,
): string | null {
  if (records === null) {
    return `the mock call log exceeded ${Math.round(MOCK_CALL_LOG_CAP / 1048576)} MiB, so the stand-ins' records cannot be verified against the trace — reduce per-call payloads or split the case; the run is not graded`
  }
  const byFullName = new Map<string, { server: string; tool: string }>()
  for (const server of mocks.servers) {
    for (const tool of server.tools) {
      byFullName.set(server.toolFullNames[tool] ?? '', {
        server: server.dirName,
        tool,
      })
    }
  }
  const logCounts = new Map<string, number>()
  for (const rec of records) {
    const key = `${rec.server}/${rec.tool}`
    logCounts.set(key, (logCounts.get(key) ?? 0) + 1)
  }
  const skipServers = new Set<string>()
  if (killed !== null && mocks.agentRun !== null) {
    for (const server of mocks.servers) {
      for (const tool of server.tools) {
        if (server.responderKinds[tool] !== 'agent') continue
        const answered = toolCalls.filter(
          call =>
            call.name === server.toolFullNames[tool] &&
            call.isError !== undefined,
        ).length
        if (
          mocks.agentRun.state.relaysReceived(server.dirName, tool) > answered
        ) {
          skipServers.add(server.dirName)
        }
      }
    }
  }
  const lastAnswered = toolCalls.findLastIndex(
    call => call.isError !== undefined,
  )
  const traceCounts = new Map<string, number>()
  let disconnectKey: string | null = null
  for (const [index, call] of toolCalls.entries()) {
    const ident = byFullName.get(call.name)
    if (ident === undefined) continue
    if (call.isError === undefined) {
      if (killed === 'unprovokable' && index > lastAnswered) continue
      if (skipServers.has(ident.server)) continue
    } else if (call.deniedByChild) {
      continue
    }
    const key = `${ident.server}/${ident.tool}`
    traceCounts.set(key, (traceCounts.get(key) ?? 0) + 1)
    if (
      disconnectKey === null &&
      call.isError === true &&
      isMockStandinDisconnect(call.output ?? '')
    ) {
      disconnectKey = key
    }
  }
  for (const [key, count] of traceCounts) {
    const logged = logCounts.get(key) ?? 0
    if (logged < count) {
      return key === disconnectKey
        ? `a call to mocked ${key} was answered by the child's MCP client, not the stand-in — the stand-in died and could not be respawned; the run is not graded`
        : `mocked calls to ${key} in the trace (${count}) outnumber this run's stand-in records for it (${logged}) — a stand-in died or stalled, something else answered, or the call log was altered; the run is not graded`
    }
  }
  return null
}

/** densable `Df`. Live tally keeps `unmocked: string[]`. */
export function tallyMockedCalls(
  toolCalls: ToolCallRecord[],
  mocks: PreparedRunMocks,
): { total: number; errors: number; unmocked: string[] } {
  const mocked = new Set(mocks.mockedTools)
  const prefixes = mocks.servers.map(server => ({
    prefix: `mcp__${server.segment}__`,
    dirName: server.dirName,
  }))
  let total = 0
  let errors = 0
  const unmocked = new Map<string, number>()
  for (const call of toolCalls) {
    if (mocked.has(call.name)) {
      total++
      if (call.mock?.verdict === 'tool_error') errors++
      continue
    }
    const hit = prefixes.find(prefix => call.name.startsWith(prefix.prefix))
    if (hit) {
      const name = `${hit.dirName}/${call.name.slice(hit.prefix.length)}`
      unmocked.set(name, (unmocked.get(name) ?? 0) + 1)
    }
  }
  return {
    total,
    errors,
    unmocked: [...unmocked].map(([tool, count]) =>
      count > 1 ? `${tool}×${count}` : tool,
    ),
  }
}

function answerBucketKey(parts: {
  tool: string
  verdict: string
  outputKey: string
}): string {
  return jsonText([parts.tool, parts.verdict, parts.outputKey])
}

/**
 * densable `pg` @212342345 — agent-mock relay answers vs annotated toolCalls.
 * mismatch / absorbedInFlightAnswer → integrity, skip grade.
 */
export function compareAgentMockAnswers(
  answers: AgentRelayAnswer[],
  run: Pick<AgentRunResult, 'toolCalls' | 'killedInFlight'>,
  mocks: PreparedRunMocks,
): {
  mismatch: string | null
  absorbedInFlightAnswer: boolean
  inputsRewritten: number
  deniedByChild: number
} {
  const agentTools = new Map<string, { server: string; tool: string }>()
  for (const server of mocks.servers) {
    for (const tool of server.tools) {
      if (server.responderKinds[tool] !== 'agent') continue
      agentTools.set(server.toolFullNames[tool] ?? '', {
        server: server.dirName,
        tool,
      })
    }
  }
  const byServer = new Map<
    string,
    Map<string, { tool: string; inputKeys: string[]; rewritten: number }>
  >()
  for (const answer of answers) {
    const buckets = byServer.get(answer.server) ?? new Map()
    const key = answerBucketKey(answer)
    const bucket = buckets.get(key) ?? {
      tool: answer.tool,
      inputKeys: [],
      rewritten: 0,
    }
    bucket.inputKeys.push(answer.inputKey)
    buckets.set(key, bucket)
    byServer.set(answer.server, buckets)
  }
  const noResult = new Map<string, Set<string>>()
  const problems: string[] = []
  let rewritten = 0
  let denied = 0
  for (const call of run.toolCalls) {
    const ident = agentTools.get(call.name)
    if (ident === undefined || call.mock === undefined) continue
    if (call.deniedByChild) {
      denied++
      continue
    }
    if (call.mock.verdict === 'no_result') {
      const tools = noResult.get(ident.server) ?? new Set()
      tools.add(ident.tool)
      noResult.set(ident.server, tools)
      continue
    }
    const buckets = byServer.get(ident.server)
    const key = answerBucketKey({
      tool: ident.tool,
      verdict: call.mock.verdict,
      outputKey: mockOutputKey(
        prefixMockAbortOutput(call.output ?? ''),
        call.mock.verdict,
      ),
    })
    const bucket = buckets?.get(key)
    if (
      bucket === undefined ||
      bucket.inputKeys.length - bucket.rewritten <= 0
    ) {
      problems.push(
        `${ident.server}/${ident.tool}: a result in the trace is not one the harness gave — altered after the stand-in returned it (a PostToolUse hook that rewrites this tool's output does that; a run cannot be graded on answers the harness did not give) or answered by something else`,
      )
      break
    }
    const at = bucket.inputKeys.indexOf(hashEvalInput(call.input))
    if (at === -1) {
      bucket.rewritten++
      rewritten++
    } else {
      bucket.inputKeys.splice(at, 1)
    }
  }
  for (const buckets of byServer.values()) {
    for (const bucket of buckets.values()) {
      bucket.inputKeys.splice(0, bucket.rewritten)
    }
  }
  let absorbed = false
  if (problems.length === 0) {
    for (const [server, buckets] of byServer) {
      const leftover = [...buckets.values()].flatMap(({ tool, inputKeys }) =>
        inputKeys.map(() => tool),
      )
      if (leftover.length === 0) continue
      if (
        leftover.length === 1 &&
        run.killedInFlight &&
        noResult.get(server)?.has(leftover[0] ?? '')
      ) {
        absorbed = true
        continue
      }
      problems.push(
        `${server}: the harness answered ${leftover.length} agent mock ${plural(leftover.length, 'call')} the trace does not show (the responder was reached other than through the mocked tools)`,
      )
      break
    }
  }
  return {
    mismatch: problems.length === 0 ? null : `mocks: ${problems.join('; ')}`,
    absorbedInFlightAnswer: absorbed,
    inputsRewritten: rewritten,
    deniedByChild: denied,
  }
}

/** densable `dg` @212342297 — wait for the relay queue after dispose. */
const AGENT_RELAY_SETTLE_MS = 5000

/**
 * densable mc @212333347 — after of, `pg(F.state.answers,K,D)` then integrity.
 * Captures `inFlight` before dispose; awaits `settled()` up to 5s.
 */
export async function applyAgentMockAnswerIntegrity(
  agent: AgentRunResult,
  mocks: PreparedRunMocks,
): Promise<void> {
  const run = mocks.agentRun
  if (run === null) return
  const inFlight = run.state.inFlight
  run.dispose()
  await Promise.race([
    run.settled(),
    new Promise<void>(resolve => {
      setTimeout(resolve, AGENT_RELAY_SETTLE_MS)
    }),
  ])
  const compared = compareAgentMockAnswers(run.state.answers, agent, mocks)
  if (agent.aborted === null && agent.mockSetupFailure === null) {
    if (compared.mismatch !== null) {
      agent.mockSetupFailure = 'integrity'
      agent.error =
        agent.error === null
          ? compared.mismatch
          : `${agent.error} · ${compared.mismatch}`
    } else if (compared.absorbedInFlightAnswer || inFlight > 0) {
      agent.mockSetupFailure = 'integrity'
      agent.error = `${agent.error ?? 'ended'} · mocks: an agent mock call was in flight when the child was killed (its answer or abort_when verdict never reached the run) — the run is not graded`
    }
  }
}

export async function applyMockIntegrity(params: {
  toolCalls: ToolCallRecord[]
  mocks: PreparedRunMocks
  watchVerdict: MockWatchVerdict | null
  watchJobs: Promise<void>[]
  killedInFlight: boolean
  interrupted: boolean
  error: string | null
  stderr: string
}): Promise<{
  mockSetupFailure: MockSetupFailureKind | null
  aborted: { server: string; tool: string; reason: string } | null
  error: string | null
  mockCalls: MockCallLogRecord[]
  mockTally: { total: number; errors: number; unmocked: string[] } | null
}> {
  await Promise.all(params.watchJobs)
  const log = await readMockCallLog(
    params.mocks.callLogPath,
    params.mocks.nonce,
  )
  annotateMockToolCalls(params.toolCalls, params.mocks)
  const killed: 'unprovokable' | 'provokable' | null =
    params.watchVerdict !== null || params.interrupted
      ? 'unprovokable'
      : params.killedInFlight
        ? 'provokable'
        : null
  const mismatch = compareMockCallLog(
    params.toolCalls,
    log.truncated ? null : log.records,
    params.mocks,
    killed,
  )
  let verdict = params.watchVerdict
  if (verdict === null && mismatch !== null) {
    const message =
      params.killedInFlight && params.error !== null
        ? `${params.error} · ${mismatch} (the child was killed before it reported which calls it refused itself; a call its own hook blocked is counted as unserved)`
        : mismatch
    verdict = { kind: 'integrity', message }
  }
  if (verdict !== null && verdict.kind !== 'abort') {
    const error =
      verdict.kind === 'registration' && params.stderr.length > 0
        ? `${verdict.message} · child stderr: ${params.stderr.slice(-1000)}`
        : verdict.message
    return {
      mockSetupFailure: verdict.kind,
      aborted: null,
      error,
      mockCalls: log.records,
      mockTally:
        params.mocks.mockedTools.length > 0
          ? tallyMockedCalls(params.toolCalls, params.mocks)
          : null,
    }
  }
  if (verdict !== null) {
    return {
      mockSetupFailure: null,
      aborted: verdict.abort ?? {
        server: '?',
        tool: '?',
        reason: verdict.message,
      },
      error: null,
      mockCalls: log.records,
      mockTally:
        params.mocks.mockedTools.length > 0
          ? tallyMockedCalls(params.toolCalls, params.mocks)
          : null,
    }
  }
  return {
    mockSetupFailure: null,
    aborted: null,
    error: params.error,
    mockCalls: log.records,
    mockTally:
      params.mocks.mockedTools.length > 0
        ? tallyMockedCalls(params.toolCalls, params.mocks)
        : null,
  }
}
