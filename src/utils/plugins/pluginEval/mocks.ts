/**
 * densable `Yl`/`ql`/`Aa` — mock MCP stand-in prep for a case.
 * Gold `Aa` argv is `[...selfCommand, "--eval-mock-server", spec, hash]`.
 * Agent relay (`sc`) stays on the existing host.
 */

import { createHash, randomBytes } from 'crypto'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { buildCliLaunch } from '../../cliLaunch.js'
import { logForDebugging } from '../../debug.js'
import { buildMcpToolName } from '../../../services/mcp/mcpStringUtils.js'
import { doesEnterpriseMcpConfigExist } from '../../../services/mcp/config.js'
import { EVAL_AGENT_MOCK_BUDGET_PER_TURN } from './constants.js'
import type { AgentRelayRun } from './agentRelay.js'
import { hashEvalMockSpecJson } from './mockKeys.js'
import type { PreparedMockServer, PreparedRunMocks } from './mockIntegrity.js'
import { pinReplayRecordings, REPLAY_DIR } from './replay.js'
import type {
  MockServerBinding,
  PreparedMocks,
  ResolvedCase,
  RunArm,
} from './types.js'

/**
 * densable `$o` — managed-mcp.json exclusive control blocks stand-ins.
 */
export class MockEnterpriseExclusiveError extends Error {
  readonly mockDirs: string[]
  readonly code = 'mocks: managed-mcp.json exclusive control blocks stand-ins'
  constructor(dirs: string[]) {
    const n = dirs.length
    const unit = n === 1 ? 'stand-in' : 'stand-ins'
    super(
      `mocks: this machine's managed-mcp.json gives the organization exclusive control of MCP servers, so the eval child cannot register the mock ${unit} for ${dirs.map(d => `mocks/${d}/`).join(', ')} (nor the plugin's own servers) — mocks cannot be served here; run the suite on a machine without managed-mcp.json, or with --mocks off (the plugin's servers still will not load under exclusive control)`,
    )
    this.name = 'MockEnterpriseExclusiveError'
    this.mockDirs = dirs
  }
}

function normalizeSegment(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

async function loadMockDir(dir: string): Promise<MockServerBinding['loaded']> {
  const tools = new Map<
    string,
    {
      kind: 'fixed' | 'agent'
      prompt?: string
      sourceHash?: string
      sourceFile?: string
      abortWhen?: string | null
    }
  >()
  let entries: Array<{ name: string; isFile: () => boolean }> = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return {
      dirName: basename(dir),
      tools,
      listings: new Map(),
      recordings: {},
    }
  }
  const notes: string[] = []
  let replayDir: string | undefined
  let recordings: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const tool = entry.name.replace(/\.md$/, '')
    if (tool.startsWith('_')) continue
    const sourceFile = join(dir, entry.name)
    const text = await readFile(sourceFile, 'utf8').catch(() => '')
    const kind = /type:\s*agent/.test(text) ? 'agent' : 'fixed'
    const sourceHash = createHash('sha256').update(text).digest('hex')
    tools.set(tool, {
      kind,
      prompt: text,
      sourceHash,
      sourceFile,
      abortWhen: null,
    })
    if (kind === 'agent' && replayDir === undefined) {
      replayDir = join(dirname(dirname(sourceFile)), REPLAY_DIR, basename(dir))
      recordings = await pinReplayRecordings(replayDir, notes)
    }
  }
  return {
    dirName: basename(dir),
    tools,
    listings: new Map(),
    recordings,
    replayDir,
    pinNotes: notes,
  }
}

async function collectMockDirs(start: string, stop: string): Promise<string[]> {
  const dirs: string[] = []
  let dir = start
  for (;;) {
    const mocks = join(dir, 'mocks')
    try {
      const entries = await readdir(mocks, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) dirs.push(join(mocks, entry.name))
      }
    } catch {
      // no mocks here
    }
    if (dir === stop) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirs
}

/** densable `Tn`. */
export function mocksForArm(
  servers: MockServerBinding[],
  arm: RunArm | undefined,
): MockServerBinding[] {
  return arm === 'without'
    ? servers.filter(s => s.kind === 'standalone')
    : [...servers]
}

/**
 * densable `Ca` @212170075 — with-without without-arm has no standalone
 * stand-in, so untagged mock_calls graders are with-only.
 */
export function mockCallsWithOnly(
  servers: MockServerBinding[],
  arm: RunArm | undefined,
): boolean {
  const active = servers.filter(server => !server.withheld)
  return (
    arm !== undefined &&
    active.length > 0 &&
    mocksForArm(active, 'without').length === 0
  )
}

/** densable `Yl`. */
export async function prepareCaseMocks(
  case_: ResolvedCase,
  root: string,
  _evalDirSegments: string[],
  options: { allowRealServers: boolean },
): Promise<PreparedMocks> {
  const dirs = await collectMockDirs(case_.caseDir, root)
  const servers: MockServerBinding[] = []
  const notes: string[] = []
  for (const dir of dirs) {
    const loaded = await loadMockDir(dir)
    const segment = normalizeSegment(loaded.dirName)
    servers.push({
      kind: 'standalone',
      registeredName: segment,
      segment,
      loaded,
    })
    if (loaded.pinNotes) notes.push(...loaded.pinNotes)
  }
  if (servers.length === 0 && options.allowRealServers) {
    notes.push(
      "mocks: no mocks/ — the plugin's REAL server processes start (--allow-real-servers), as you, outside the sandbox that confines shell tools",
    )
  }
  return { servers, notes }
}

/** densable `Un` — fully-qualified mocked tool names. */
export function mockedToolNames(servers: MockServerBinding[]): string[] {
  const names: string[] = []
  for (const server of servers) {
    for (const tool of server.loaded.tools.keys()) {
      names.push(buildMcpToolName(server.registeredName, tool))
    }
  }
  return names
}

/** densable `Oo` — 4 × max_turns when any responder is agent. */
export function agentMockCallBudget(
  servers: MockServerBinding[],
  maxTurns: number,
): number {
  const hasAgent = servers.some(server =>
    [...server.loaded.tools.values()].some(tool => tool.kind === 'agent'),
  )
  return hasAgent ? EVAL_AGENT_MOCK_BUDGET_PER_TURN * maxTurns : 0
}

function toPreparedServer(server: MockServerBinding): PreparedMockServer {
  const tools = [...server.loaded.tools.keys()]
  return {
    dirName: server.loaded.dirName,
    registeredName: server.registeredName,
    segment: server.segment,
    kind: server.kind,
    withheld: server.withheld === true,
    tools,
    toolFullNames: Object.fromEntries(
      tools.map(tool => [tool, buildMcpToolName(server.registeredName, tool)]),
    ),
    responderKinds: Object.fromEntries(
      [...server.loaded.tools].map(([tool, spec]) => [tool, spec.kind]),
    ),
    expects: Object.fromEntries(
      [...server.loaded.tools].map(([tool, spec]) => [tool, spec.expect]),
    ),
  }
}

/**
 * densable `ql` / `Aa`: write mcp config + per-server spec JSON + call log path.
 * Gold `Gi() && p_()` — this SEA `Gi` is always true; `p_` is
 * `doesEnterpriseMcpConfigExist`.
 */
export async function writeRunMocks(
  servers: MockServerBinding[],
  sandboxOutDir: string,
  options: {
    maxTurns?: number
    agentRun?: AgentRelayRun | null
  } = {},
): Promise<PreparedRunMocks | null> {
  const exclusive = doesEnterpriseMcpConfigExist()
  const active = servers.filter(s => !s.withheld)
  if (exclusive && active.length > 0) {
    throw new MockEnterpriseExclusiveError(active.map(s => s.loaded.dirName))
  }
  if (exclusive && servers.length > 0) {
    logForDebugging(
      `eval mocks: managed-mcp.json has exclusive MCP control; ${servers.length} withheld stand-in(s) not registered (plugin servers do not load in the child)`,
    )
  }
  if (active.length === 0) return null
  const nonce = randomBytes(6).toString('hex')
  const callLogPath = join(sandboxOutDir, 'mock-calls.jsonl')
  const mocksDir = join(sandboxOutDir, 'mocks')
  await mkdir(mocksDir, { recursive: true })
  const mcpServers: Record<
    string,
    { type: 'stdio'; command: string; args: string[]; env?: NodeJS.ProcessEnv }
  > = {}
  for (const server of active) {
    const specPath = join(mocksDir, `${server.segment}.json`)
    const spec = {
      registeredName: server.registeredName,
      server: server.loaded.dirName,
      nonce,
      callLogPath,
      tools: [...server.loaded.tools.keys()],
      responders: Object.fromEntries(
        [...server.loaded.tools].map(([name, tool]) => [
          name,
          {
            kind: tool.kind,
            prompt: tool.prompt,
            abortWhen: tool.abortWhen ?? null,
            expect: tool.expect ?? null,
            baseDir: tool.sourceFile
              ? dirname(tool.sourceFile)
              : server.loaded.dirName,
          },
        ]),
      ),
      agent: options.agentRun?.relay ?? null,
    }
    const json = JSON.stringify(spec)
    await writeFile(specPath, json, { mode: 0o600 })
    const launch = buildCliLaunch([
      '--eval-mock-server',
      specPath,
      hashEvalMockSpecJson(json),
    ])
    mcpServers[server.registeredName] = {
      type: 'stdio',
      command: launch.execPath,
      args: launch.args,
      env: launch.env,
    }
  }
  const configPath = join(sandboxOutDir, 'mocks.json')
  await writeFile(configPath, JSON.stringify({ mcpServers }), { mode: 0o600 })
  await writeFile(callLogPath, '', { mode: 0o600 })
  if (options.agentRun) {
    options.agentRun.attachSpecs(
      active.map(server => ({
        registeredName: server.registeredName,
        server: server.loaded.dirName,
        responders: Object.fromEntries(
          [...server.loaded.tools].map(([name, tool]) => [
            name,
            {
              kind: tool.kind,
              prompt: tool.prompt,
              abortWhen: tool.abortWhen ?? null,
              expect: tool.expect ?? null,
              baseDir: tool.sourceFile ? dirname(tool.sourceFile) : undefined,
              replay:
                tool.kind === 'agent' && tool.sourceHash
                  ? {
                      mockHash: tool.sourceHash,
                      replayDir: server.loaded.replayDir,
                      pinned: server.loaded.recordings,
                    }
                  : undefined,
            },
          ]),
        ),
      })),
    )
  }
  return {
    configPath,
    callLogPath,
    nonce,
    mockedTools: mockedToolNames(active),
    agentRun: options.agentRun ?? null,
    agentCallBudget: agentMockCallBudget(active, options.maxTurns ?? 0),
    servers: active.map(toPreparedServer),
  }
}

export function summarizeMocks(servers: MockServerBinding[]): string {
  return servers
    .map(server => {
      if (server.withheld)
        return `${server.loaded.dirName}[not started: no mock]`
      const tools = [...server.loaded.tools]
        .map(([name, spec]) => `${name}=${spec.kind}`)
        .join(', ')
      const pinned = Object.keys(server.loaded.recordings).length
      return `${server.loaded.dirName}${server.kind === 'standalone' ? '[standalone]' : ''}(${tools}${pinned > 0 ? `; replay: ${pinned} pinned` : ''})`
    })
    .join(', ')
}
