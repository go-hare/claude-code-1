import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { getEventListeners } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from '@claude-code/builtin-tools/tools/GlobTool/GlobTool.js'
import chokidar from 'chokidar'
import { WebSocketServer } from 'ws'
import { z } from 'zod/v4'
import { mcpServeHandler } from '../../cli/handlers/mcp.js'
import {
  attachSubagentFrameResultMeta,
  carrySubagentFrameResult,
  EDIT_RESULT_META_KEY,
  EDIT_RESULT_META_VERSION,
  evaluateSubagentFrameResultHolds,
  getSubagentFrameResult,
  hasSubagentFrameResult,
  isEditResultMetaRequested,
  SUBAGENT_FRAME_RESULT_SYMBOL,
  withSubagentFrameResult,
} from '../../services/mcp/editResultMeta.js'
import {
  buildSessionTunnelRelayUrl,
  EX_CONFIG,
  EX_POLICY,
  EX_UNAVAILABLE,
  guardRelayTokenDescriptor,
  isToolServerDaemonMode,
  parseSessionTunnelEnvelope,
  readSessionTunnelLineFromStdin,
  SESSION_TUNNEL_PORT,
  setToolServerDaemonMode,
  startEarlySessionTunnelDial,
  startSessionTunnel,
  ToolServerPortTakenError,
  TUNNEL_HOLD_DEADLINE_MS,
  TUNNEL_LIVENESS_DEADLINE_MS,
  validateSessionTunnelLaunch,
} from '../../services/mcp/sessionTunnel.js'
import {
  buildTool,
  getEmptyToolPermissionContext,
  type Tool,
} from '../../Tool.js'
import * as setupMod from '../../setup.js'
import * as debugMod from '../../utils/debug.js'
import { getMatchingHooks, hasHookForEvent } from '../../utils/hooks.js'
import {
  initializeFileChangedWatcher,
  resetFileChangedWatcherForTesting,
} from '../../utils/hooks/fileChangedWatcher.js'
import * as hooksSnapshotMod from '../../utils/hooks/hooksConfigSnapshot.js'
import * as diskOutputMod from '../../utils/task/diskOutput.js'
import { createMcpServeDispatcher, formatMcpServeToolResult } from '../mcp.js'
import {
  checkMcpHttpRequestSecurity,
  type McpHttpServerHandle,
  startMCPServerHttp,
} from '../mcpHttpServer.js'

const tempDirs: string[] = []
const openHandles: McpHttpServerHandle[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function sendRawHttpRequest(opts: {
  port: number
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: opts.port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers,
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    if (opts.body !== undefined) {
      req.write(opts.body)
    }
    req.end()
  })
}

afterEach(async () => {
  setToolServerDaemonMode(false)
  resetFileChangedWatcherForTesting()
  hooksSnapshotMod.resetHooksConfigSnapshot()
  while (openHandles.length > 0) {
    const handle = openHandles.pop()!
    await handle.close()
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup error
    }
  }
})

describe('2.1.331 editResultMeta & subagentFrameResult carry-through', () => {
  test('isEditResultMetaRequested matches only Edit with claudecode/editResult === "1"', () => {
    expect(EDIT_RESULT_META_KEY).toBe('claudecode/editResult')
    expect(EDIT_RESULT_META_VERSION).toBe('1')
    expect(
      isEditResultMetaRequested('Edit', { 'claudecode/editResult': '1' }),
    ).toBe(true)
    expect(
      isEditResultMetaRequested('Read', { 'claudecode/editResult': '1' }),
    ).toBe(false)
    expect(
      isEditResultMetaRequested('Edit', { 'claudecode/editResult': '2' }),
    ).toBe(false)
    expect(isEditResultMetaRequested('Edit', null)).toBe(false)
    expect(isEditResultMetaRequested('Edit', undefined)).toBe(false)
  })

  test('attachSubagentFrameResultMeta attaches meta when fresh and skips on error, stale, or throwing predicate', async () => {
    const base: {
      content: Array<{ type: 'text'; text: string }>
      isError?: boolean
      _meta?: Record<string, unknown>
    } = { content: [{ type: 'text', text: 'ok' }] }
    const attached = await attachSubagentFrameResultMeta(base, {
      subagentFrameResult: { filePath: '/tmp/a.ts', lines: 3 },
      subagentFrameResultHolds: async () => true,
    })
    expect(attached._meta).toEqual({
      'claudecode/editResult': { filePath: '/tmp/a.ts', lines: 3 },
    })

    const skippedStale = await attachSubagentFrameResultMeta(base, {
      subagentFrameResult: { stale: true },
      subagentFrameResultHolds: () => false,
    })
    expect(skippedStale._meta).toBeUndefined()

    const skippedThrow = await attachSubagentFrameResultMeta(base, {
      subagentFrameResult: { stale: true },
      subagentFrameResultHolds: () => {
        throw new Error('freshness check boom')
      },
    })
    expect(skippedThrow._meta).toBeUndefined()

    const errorBase: {
      content: Array<{ type: 'text'; text: string }>
      isError?: boolean
      _meta?: Record<string, unknown>
    } = { ...base, isError: true }
    const skippedError = await attachSubagentFrameResultMeta(errorBase, {
      subagentFrameResult: { shouldNotAttach: true },
    })
    expect(skippedError._meta).toBeUndefined()
  })

  test('SUBAGENT_FRAME_RESULT_SYMBOL carry-through helpers round-trip cleanly', () => {
    const frame = { edits: [{ old: 'a', next: 'b' }] }
    const wrapped = { id: 'toolu_1', ...withSubagentFrameResult(frame) }
    expect(hasSubagentFrameResult(wrapped)).toBe(true)
    expect(getSubagentFrameResult(wrapped)).toEqual(frame)
    expect(wrapped[SUBAGENT_FRAME_RESULT_SYMBOL]).toEqual(frame)

    const carried = { cloned: true, ...carrySubagentFrameResult(wrapped) }
    expect(hasSubagentFrameResult(carried)).toBe(true)
    expect(getSubagentFrameResult(carried)).toEqual(frame)

    const empty = { plain: true, ...withSubagentFrameResult(undefined) }
    expect(hasSubagentFrameResult(empty)).toBe(false)
    expect(getSubagentFrameResult(empty)).toBeUndefined()
    expect(carrySubagentFrameResult(empty)).toEqual({})
  })
})

describe('2.1.331 claude mcp serve --transport http live server', () => {
  test('enforces /health, Bearer 401, DNS rebinding Host 403, Origin CSRF 403, DELETE 204, and port collision', async () => {
    const dir = makeTempDir('mcp-http-sec-')
    const handle = await startMCPServerHttp(dir, {
      port: 0,
      announceOnStdout: false,
      getToolsOverride: () => [FileReadTool, GlobTool, FileWriteTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHandles.push(handle)

    // 1. GET /health returns 200 without Authorization
    const healthRes = await fetch(new URL('/health', handle.url))
    expect(healthRes.status).toBe(200)
    expect(await healthRes.json()).toEqual({
      ok: true,
      status: 'ok',
      transport: 'http',
      resultFormat: 'raw',
    })

    // 2. Missing / wrong Authorization returns 401
    const noAuthRes = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(noAuthRes.status).toBe(401)

    const wrongAuthRes = await fetch(handle.url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-token-value',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(wrongAuthRes.status).toBe(401)

    // 3. Non-loopback Host header returns 403 (DNS rebinding protection)
    const badHostRes = await sendRawHttpRequest({
      port: handle.boundPort,
      method: 'GET',
      path: '/health',
      headers: { Host: 'evil.com' },
    })
    expect(badHostRes.status).toBe(403)

    // 4. Origin header returns 403 (CSRF protection)
    const badOriginRes = await sendRawHttpRequest({
      port: handle.boundPort,
      method: 'POST',
      path: '/mcp',
      headers: {
        Host: `127.0.0.1:${handle.boundPort}`,
        Origin: 'https://evil.com',
        Authorization: `Bearer ${handle.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(badOriginRes.status).toBe(403)

    // 5. Invalid JSON returns JSON-RPC -32700 parse error
    const badJsonRes = await fetch(handle.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${handle.authToken}`,
        'content-type': 'application/json',
      },
      body: '{not valid json',
    })
    expect(badJsonRes.status).toBe(400)
    const badJsonBody = (await badJsonRes.json()) as {
      error: { code: number }
    }
    expect(badJsonBody.error.code).toBe(-32700)

    // 6. DELETE /mcp returns 204
    const delRes = await fetch(handle.url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${handle.authToken}` },
    })
    expect(delRes.status).toBe(204)

    // 7. Binding same port throws ToolServerPortTakenError
    let caught: unknown
    try {
      const dup = await startMCPServerHttp(dir, {
        port: handle.boundPort,
        announceOnStdout: false,
        getToolsOverride: () => [],
        loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
      })
      await dup.close()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ToolServerPortTakenError)
  })

  test('executes real tools (Read, Glob, Write) over HTTP in both raw and rendered formats + checkPermissions + answer()', async () => {
    const dir = makeTempDir('mcp-http-tools-')
    const samplePath = join(dir, 'hello.txt')
    writeFileSync(samplePath, 'line one\nline two\n', 'utf8')

    // Raw format server
    const rawServer = await startMCPServerHttp(dir, {
      port: 0,
      resultFormat: 'raw',
      announceOnStdout: false,
      getToolsOverride: () => [FileReadTool, GlobTool, FileWriteTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHandles.push(rawServer)

    const authHeaders = {
      authorization: `Bearer ${rawServer.authToken}`,
      'content-type': 'application/json',
    }

    // initialize
    const initRes = await fetch(rawServer.url, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
      }),
    })
    expect(initRes.status).toBe(200)
    const sessionId = initRes.headers.get('mcp-session-id')
    expect(sessionId).toBeTruthy()
    const initBody = (await initRes.json()) as {
      result: {
        serverInfo: { name: string }
        capabilities: { tools: { listChanged: boolean } }
      }
    }
    expect(initBody.result.serverInfo.name).toBe('claude/tengu')
    expect(initBody.result.capabilities.tools.listChanged).toBe(true)

    // notifications/initialized -> 202
    const notifRes = await fetch(rawServer.url, {
      method: 'POST',
      headers: { ...authHeaders, 'mcp-session-id': sessionId! },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    })
    expect(notifRes.status).toBe(202)

    // tools/list
    const listRes = await fetch(rawServer.url, {
      method: 'POST',
      headers: { ...authHeaders, 'mcp-session-id': sessionId! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    })
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as {
      result: { tools: Array<{ name: string }> }
    }
    const listedNames = listBody.result.tools.map(t => t.name)
    expect(listedNames).toContain('Read')
    expect(listedNames).toContain('Glob')
    expect(listedNames).toContain('Write')

    // tools/call Read (raw returns JSON object string)
    const readRawRes = await fetch(rawServer.url, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'Read', arguments: { file_path: samplePath } },
      }),
    })
    expect(readRawRes.status).toBe(200)
    const readRawBody = (await readRawRes.json()) as {
      result: {
        isError?: boolean
        content: Array<{ type: string; text: string }>
      }
    }
    expect(readRawBody.result.isError).toBeUndefined()
    const parsedRawData = JSON.parse(readRawBody.result.content[0]!.text) as {
      type: string
      file: { content: string }
    }
    expect(parsedRawData.type).toBe('text')
    expect(parsedRawData.file.content).toContain('line one')

    // tools/call Glob + Write in batch
    const writtenPath = join(dir, 'created.txt')
    const batchRes = await fetch(rawServer.url, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'Write',
            arguments: {
              file_path: writtenPath,
              content: 'written via http\n',
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'Glob',
            arguments: { pattern: '*.txt', path: dir },
          },
        },
      ]),
    })
    expect(batchRes.status).toBe(200)
    const batchBody = (await batchRes.json()) as Array<{
      id: number
      result: {
        isError?: boolean
        content: Array<{ type: string; text: string }>
      }
    }>
    expect(batchBody).toHaveLength(2)
    expect(readFileSync(writtenPath, 'utf8')).toBe('written via http\n')

    // claudecode/checkPermissions over HTTP
    const permRes = await fetch(rawServer.url, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'claudecode/checkPermissions',
        params: {
          name: 'Read',
          arguments: { file_path: samplePath },
          toolUseId: 'toolu_remote_perm_1',
        },
      }),
    })
    expect(permRes.status).toBe(200)
    const permBody = (await permRes.json()) as {
      result: { behavior: string }
    }
    expect(['allow', 'ask', 'deny', 'passthrough']).toContain(
      permBody.result.behavior,
    )

    // In-process answer() direct dispatch (zero socket hop)
    const inProcRes = await rawServer.answer({
      method: 'POST',
      path: '/mcp',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${rawServer.authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }),
    })
    expect(inProcRes.status).toBe(200)
    expect(JSON.parse(inProcRes.body)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: {},
    })

    // Rendered format server
    const renderedServer = await startMCPServerHttp(dir, {
      port: 0,
      resultFormat: 'rendered',
      announceOnStdout: false,
      getToolsOverride: () => [FileReadTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHandles.push(renderedServer)

    const readRenderedRes = await fetch(renderedServer.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${renderedServer.authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'Read', arguments: { file_path: samplePath } },
      }),
    })
    expect(readRenderedRes.status).toBe(200)
    const readRenderedBody = (await readRenderedRes.json()) as {
      result: { content: Array<{ type: string; text: string }> }
    }
    const renderedText = readRenderedBody.result.content[0]!.text
    // Rendered Read tool produces numbered lines (not raw JSON object)
    expect(renderedText).toContain('line one')
    expect(renderedText).toContain('line two')
    expect(() => JSON.parse(renderedText)).toThrow()
  })

  test('attaches claudecode/editResult _meta when fresh and suppresses when subagentFrameResultHolds() returns false', async () => {
    const dir = makeTempDir('mcp-http-editmeta-')
    let holds = true

    const fakeEditTool = buildTool({
      name: 'Edit',
      maxResultSizeChars: 10_000,
      inputSchema: z.object({ file_path: z.string() }),
      outputSchema: z.object({ ok: z.boolean(), path: z.string() }),
      async description() {
        return 'Fake edit tool'
      },
      async prompt() {
        return 'Fake edit tool'
      },
      renderToolUseMessage() {
        return null
      },
      mapToolResultToToolResultBlockParam(data, toolUseID) {
        return {
          type: 'tool_result',
          tool_use_id: toolUseID,
          content: `Edited ${data.path}`,
        }
      },
      async call(input) {
        return {
          data: { ok: true, path: input.file_path },
          subagentFrameResult: {
            kind: 'edit_frame',
            filePath: input.file_path,
          },
          subagentFrameResultHolds: () => holds,
        }
      },
    }) as unknown as Tool

    const server = await startMCPServerHttp(dir, {
      port: 0,
      resultFormat: 'rendered',
      announceOnStdout: false,
      getToolsOverride: () => [fakeEditTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHandles.push(server)

    // Fresh: _meta['claudecode/editResult'] attached
    const freshRes = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${server.authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'Edit',
          arguments: { file_path: '/tmp/foo.ts' },
          _meta: { 'claudecode/editResult': '1' },
        },
      }),
    })
    const freshParsed = JSON.parse(freshRes.body) as {
      result: {
        content: Array<{ type: string; text: string }>
        _meta?: Record<string, unknown>
      }
    }
    expect(freshParsed.result.content[0]!.text).toBe('Edited /tmp/foo.ts')
    expect(freshParsed.result._meta).toEqual({
      'claudecode/editResult': {
        kind: 'edit_frame',
        filePath: '/tmp/foo.ts',
      },
    })

    // Stale: subagentFrameResultHolds() === false suppresses _meta
    holds = false
    const staleRes = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${server.authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'Edit',
          arguments: { file_path: '/tmp/foo.ts' },
          _meta: { 'claudecode/editResult': '1' },
        },
      }),
    })
    const staleParsed = JSON.parse(staleRes.body) as {
      result: { _meta?: Record<string, unknown> }
    }
    expect(staleParsed.result._meta).toBeUndefined()

    // Non-negotiated (P1-10): even when holds === true and subagentFrameResult
    // is present, omitting _meta['claudecode/editResult'] = '1' must NOT leak _meta
    holds = true
    const unnegotiatedRes = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${server.authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'Edit',
          arguments: { file_path: '/tmp/foo.ts' },
        },
      }),
    })
    const unnegotiatedParsed = JSON.parse(unnegotiatedRes.body) as {
      result: {
        content: Array<{ type: string; text: string }>
        _meta?: Record<string, unknown>
      }
    }
    expect(unnegotiatedParsed.result.content[0]!.text).toBe(
      'Edited /tmp/foo.ts',
    )
    expect(unnegotiatedParsed.result._meta).toBeUndefined()
  })
})

describe('2.1.331 --session-tunnel envelope, validation, stdin & live WebSocket E2E', () => {
  test('exports expected constants and validates session tunnel envelopes strictly', () => {
    expect(SESSION_TUNNEL_PORT).toBe(28471)
    expect(EX_CONFIG).toBe(69)
    expect(EX_UNAVAILABLE).toBe(77)
    expect(EX_POLICY).toBe(78)
    expect(TUNNEL_HOLD_DEADLINE_MS).toBe(8_000)
    expect(TUNNEL_LIVENESS_DEADLINE_MS).toBe(600_000)

    // Valid https origin
    const httpsEnv = parseSessionTunnelEnvelope(
      JSON.stringify({
        v: 1,
        session_id: 'sess_123',
        session_token: 'tok_abc',
        api_base_url: 'https://api.anthropic.com/',
        session_token_expires_at: 2_000_000_000,
        file_upload_path: '/v1/upload',
        git_token: 'ghs_xyz',
      }),
    )
    expect(httpsEnv).toEqual({
      v: 1,
      session_id: 'sess_123',
      session_token: 'tok_abc',
      api_base_url: 'https://api.anthropic.com',
      session_token_expires_at: 2_000_000_000,
      file_upload_path: '/v1/upload',
      git_token: 'ghs_xyz',
    })
    expect(buildSessionTunnelRelayUrl(httpsEnv!)).toBe(
      'wss://api.anthropic.com/v1/sessions/sess_123/tool_tunnel',
    )

    // Valid loopback http origins
    for (const loopback of [
      'http://127.0.0.1:8080',
      'http://localhost:9000',
      'http://[::1]:8080',
    ]) {
      const env = parseSessionTunnelEnvelope(
        JSON.stringify({
          v: 1,
          session_id: 'sess_local',
          session_token: 'tok_local',
          api_base_url: loopback,
        }),
      )
      expect(env).toBeDefined()
      expect(buildSessionTunnelRelayUrl(env!)).toMatch(/^ws:\/\//)
    }

    // Invalid: non-loopback http, path, query, userinfo, bad version, missing fields
    expect(
      parseSessionTunnelEnvelope(
        JSON.stringify({
          v: 1,
          session_id: 's',
          session_token: 't',
          api_base_url: 'http://evil.com',
        }),
      ),
    ).toBeUndefined()
    expect(
      parseSessionTunnelEnvelope(
        JSON.stringify({
          v: 1,
          session_id: 's',
          session_token: 't',
          api_base_url: 'https://api.anthropic.com/extra/path',
        }),
      ),
    ).toBeUndefined()
    expect(
      parseSessionTunnelEnvelope(
        JSON.stringify({
          v: 1,
          session_id: 's',
          session_token: 't',
          api_base_url: 'https://user:pass@api.anthropic.com',
        }),
      ),
    ).toBeUndefined()
    expect(
      parseSessionTunnelEnvelope(
        JSON.stringify({
          v: 2,
          session_id: 's',
          session_token: 't',
          api_base_url: 'https://api.anthropic.com',
        }),
      ),
    ).toBeUndefined()
    expect(
      parseSessionTunnelEnvelope(
        JSON.stringify({
          v: 1,
          session_id: '',
          session_token: 't',
          api_base_url: 'https://api.anthropic.com',
        }),
      ),
    ).toBeUndefined()

    // Item 6 regression: malformed session_token_expires_at must fail parsing (never silently become "never expires")
    for (const badExpiry of [0, -1, 'not-a-number', null, true]) {
      expect(
        parseSessionTunnelEnvelope(
          JSON.stringify({
            v: 1,
            session_id: 's',
            session_token: 't',
            api_base_url: 'https://api.anthropic.com',
            session_token_expires_at: badExpiry,
          }),
        ),
      ).toBeUndefined()
    }

    // validateSessionTunnelLaunch checks
    expect(
      validateSessionTunnelLaunch({
        transport: 'http',
        port: 28471,
        envelope: httpsEnv,
      }),
    ).toBeUndefined()
    expect(
      validateSessionTunnelLaunch({
        transport: 'stdio',
        port: 28471,
        envelope: httpsEnv,
      }),
    ).toContain('--transport http')
    expect(
      validateSessionTunnelLaunch({
        transport: 'http',
        port: 9999,
        envelope: httpsEnv,
      }),
    ).toContain('28471')
    expect(
      validateSessionTunnelLaunch({
        transport: 'http',
        port: 28471,
        envelope: undefined,
      }),
    ).toContain('which must be a pipe')
    expect(
      validateSessionTunnelLaunch({
        transport: 'http',
        port: 28471,
        envelope: httpsEnv,
        nonessentialTrafficDisabled: true,
      }),
    ).toContain('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
    expect(
      validateSessionTunnelLaunch({
        transport: 'http',
        port: 28471,
        envelope: httpsEnv,
        isAnthropicProvider: false,
      }),
    ).toContain('Anthropic API provider')
  })

  test('readSessionTunnelLineFromStdin rejects TTY and reads single JSON line from pipe', async () => {
    const ttyStream = Readable.from(['{"v":1}\n']) as Readable & {
      isTTY?: boolean
    }
    ttyStream.isTTY = true
    await expect(readSessionTunnelLineFromStdin(ttyStream)).rejects.toThrow(
      'which must be a pipe',
    )

    const pipeStream = Readable.from([
      '{"v":1,"session_id":"s1"}\n{"second":"ignored"}\n',
    ])
    const line = await readSessionTunnelLineFromStdin(pipeStream, {
      isTTY: false,
    })
    expect(line).toBe('{"v":1,"session_id":"s1"}')
  })

  test('guardRelayTokenDescriptor records guard state for descriptor env or --session-tunnel daemon argv', () => {
    expect(guardRelayTokenDescriptor({}, ['mcp', 'serve'])).toEqual({
      guarded: false,
      madeNonDumpable: false,
    })
    expect(
      guardRelayTokenDescriptor(
        { CCR_AGENT_PROXY_TOKEN_FILE_DESCRIPTOR: '3' },
        ['mcp', 'serve'],
      ).guarded,
    ).toBe(true)
    expect(
      guardRelayTokenDescriptor({}, [
        'mcp',
        'serve',
        '--transport',
        'http',
        '--port',
        '28471',
        '--session-tunnel',
      ]).guarded,
    ).toBe(true)
  })

  test('E2E: startSessionTunnel connects to real WebSocket relay and bridges tools/list & tools/call via answerInProcess', async () => {
    const dir = makeTempDir('mcp-tunnel-e2e-')
    const targetFile = join(dir, 'tunnel-test.txt')
    writeFileSync(targetFile, 'hello across session tunnel!\n', 'utf8')

    const httpServerHandle = await startMCPServerHttp(dir, {
      port: 0,
      resultFormat: 'rendered',
      announceOnStdout: false,
      getToolsOverride: () => [FileReadTool, GlobTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHandles.push(httpServerHandle)

    // Spy on answer() to prove zero loopback hop (answerInProcess) is invoked!
    let inProcessCalls = 0
    const origAnswer = httpServerHandle.answer
    const instrumentedHandle = {
      ...httpServerHandle,
      answer: async (req: Parameters<typeof origAnswer>[0]) => {
        inProcessCalls += 1
        return await origAnswer(req)
      },
    }

    // Real local WebSocket relay server over node:http
    const relayHttp = createHttpServer()
    const wss = new WebSocketServer({ server: relayHttp })
    await new Promise<void>(resolve =>
      relayHttp.listen(0, '127.0.0.1', () => resolve()),
    )
    const relayAddr = relayHttp.address() as { port: number }
    const relayOrigin = `http://127.0.0.1:${relayAddr.port}`

    const receivedFrames: Array<Record<string, unknown>> = []
    let resolveAuth: () => void
    const authReceived = new Promise<void>(r => {
      resolveAuth = r
    })
    let resolveListResp: (frame: Record<string, unknown>) => void
    const listRespPromise = new Promise<Record<string, unknown>>(r => {
      resolveListResp = r
    })
    let resolveCallResp: (frame: Record<string, unknown>) => void
    const callRespPromise = new Promise<Record<string, unknown>>(r => {
      resolveCallResp = r
    })

    let serverSocket: import('ws').WebSocket | null = null
    wss.on('connection', (socket, req) => {
      expect(req.url).toBe('/v1/sessions/sess_e2e_1/tool_tunnel')
      serverSocket = socket
      socket.on('message', raw => {
        const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
        receivedFrames.push(msg)
        if (msg.type === 'tunnel_auth') {
          resolveAuth()
        } else if (msg.type === 'http_response' && msg.id === 'req-list') {
          resolveListResp(msg)
        } else if (msg.jsonrpc === '2.0' && msg.id === 42) {
          resolveCallResp(msg)
        }
      })
    })

    const envelope = parseSessionTunnelEnvelope(
      JSON.stringify({
        v: 1,
        session_id: 'sess_e2e_1',
        session_token: 'secret_tunnel_token',
        api_base_url: relayOrigin,
      }),
    )!

    const tunnel = startSessionTunnel(instrumentedHandle, envelope)
    try {
      expect(await tunnel.endHold()).toBe('active')
      expect(tunnel.state).toBe('open')
      await authReceived

      expect(receivedFrames[0]).toEqual({
        type: 'tunnel_auth',
        v: 1,
        session_id: 'sess_e2e_1',
        token: 'secret_tunnel_token',
      })

      // 1. Send HTTP-over-tunnel request frame for tools/list
      serverSocket!.send(
        JSON.stringify({
          type: 'http_request',
          id: 'req-list',
          method: 'POST',
          path: '/mcp',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
          }),
        }),
      )
      const listResp = await listRespPromise
      expect(listResp.status).toBe(200)
      const listRpc = JSON.parse(String(listResp.body)) as {
        result: { tools: Array<{ name: string }> }
      }
      expect(listRpc.result.tools.map(t => t.name)).toContain('Read')

      // 2. Send binary-encoded raw JSON-RPC 2.0 frame for tools/call Read
      const callPayload = JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'tools/call',
        params: {
          name: 'Read',
          arguments: { file_path: targetFile },
        },
      })
      serverSocket!.send(Buffer.from(callPayload, 'utf8'))

      const callResp = (await callRespPromise) as {
        jsonrpc: string
        id: number
        result: { content: Array<{ type: string; text: string }> }
      }
      expect(callResp.id).toBe(42)
      expect(callResp.result.content[0]!.text).toContain(
        'hello across session tunnel!',
      )
      expect(inProcessCalls).toBe(2)
    } finally {
      tunnel.stop()
      expect(tunnel.state).toBe('closed')
      wss.close()
      await new Promise<void>(resolve => relayHttp.close(() => resolve()))
    }
  })
})

describe('2.1.331 isToolServerDaemonMode() hook & FileChanged watcher suppression', () => {
  test('detects allowed claude mcp serve --transport http argv combinations strictly', () => {
    expect(
      isToolServerDaemonMode(['mcp', 'serve', '--transport', 'http']),
    ).toBe(true)
    expect(
      isToolServerDaemonMode([
        'mcp',
        'serve',
        '--transport=http',
        '--port',
        '28471',
        '--result-format',
        'rendered',
        '--session-tunnel',
        '--debug',
        '-d',
        '--verbose',
      ]),
    ).toBe(true)
    expect(
      isToolServerDaemonMode([
        'node',
        'claude',
        'mcp',
        'serve',
        '--transport',
        'http',
      ]),
    ).toBe(true)
    expect(isToolServerDaemonMode(['mcp', 'serve'])).toBe(false)
    expect(
      isToolServerDaemonMode(['mcp', 'serve', '--transport', 'stdio']),
    ).toBe(false)
    expect(
      isToolServerDaemonMode([
        'mcp',
        'serve',
        '--transport',
        'http',
        '--unknown-flag',
      ]),
    ).toBe(false)
  })

  test('suppresses FileChanged watcher and settings hooks with official debug log in daemon mode', async () => {
    const dir = makeTempDir('mcp-daemon-hooks-')
    const snapSpy = spyOn(
      hooksSnapshotMod,
      'getHooksConfigFromSnapshot',
    ).mockReturnValue({
      FileChanged: [
        {
          matcher: '.env',
          hooks: [{ type: 'command', command: 'echo should-not-run' }],
        },
      ],
      PreToolUse: [
        {
          matcher: 'Read',
          hooks: [{ type: 'command', command: 'echo should-not-run' }],
        },
      ],
    })

    const watchSpy = spyOn(chokidar, 'watch')
    const debugSpy = spyOn(debugMod, 'logForDebugging')

    try {
      // Sanity check: outside daemon mode, hooks are visible
      expect(hasHookForEvent('PreToolUse', undefined, 'sess_daemon')).toBe(true)

      setToolServerDaemonMode(true)
      expect(isToolServerDaemonMode()).toBe(true)

      // FileChanged watcher must not start
      initializeFileChangedWatcher(dir)
      expect(watchSpy).not.toHaveBeenCalled()

      // Settings hooks must be skipped
      expect(hasHookForEvent('PreToolUse', undefined, 'sess_daemon')).toBe(
        false,
      )
      const matched = await getMatchingHooks(
        undefined,
        'sess_daemon',
        'PreToolUse',
        {
          session_id: 'sess_daemon',
          transcript_path: '',
          cwd: dir,
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: join(dir, 'a.txt') },
          tool_use_id: 'toolu_1',
        },
      )
      expect(matched).toEqual([])

      const loggedMessages = debugSpy.mock.calls.map(call => String(call[0]))
      expect(
        loggedMessages.some(msg =>
          msg.includes(
            'claude mcp serve --transport http never runs them (intended)',
          ),
        ),
      ).toBe(true)
    } finally {
      snapSpy.mockRestore()
      watchSpy.mockRestore()
      debugSpy.mockRestore()
    }
  })
})

describe('2.1.331 security hardening regressions (P0-1, P1-3, P1-9, P1-10, P2-1, P2-2, P2-3)', () => {
  test('P0-1: sessionTunnel rejects SSRF/scheme-relative/cross-origin paths without calling fetch or answer, and strips mixed-case Host/Authorization/Origin headers', async () => {
    const sentFrames: Array<Record<string, unknown>> = []
    let socketInstance: FakeWebSocket | null = null

    class FakeWebSocket {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSING = 2
      static readonly CLOSED = 3
      readyState = FakeWebSocket.CONNECTING
      listeners = new Map<string, Set<(event: unknown) => void>>()

      constructor(_url: string) {
        socketInstance = this
      }

      addEventListener(type: string, fn: (event: unknown) => void): void {
        let set = this.listeners.get(type)
        if (!set) {
          set = new Set()
          this.listeners.set(type, set)
        }
        set.add(fn)
      }

      removeEventListener(type: string, fn: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(fn)
      }

      send(data: string): void {
        sentFrames.push(JSON.parse(data) as Record<string, unknown>)
      }

      close(): void {
        this.readyState = FakeWebSocket.CLOSED
      }

      emit(type: string, event: unknown): void {
        for (const fn of [...(this.listeners.get(type) ?? [])]) {
          fn(event)
        }
      }
    }

    const envelope = parseSessionTunnelEnvelope(
      JSON.stringify({
        v: 1,
        session_id: 'sess_p0_1',
        session_token: 'tok_p0_1',
        api_base_url: 'http://127.0.0.1:8080',
      }),
    )!

    // 1. Verify SSRF paths never invoke fetch() when answer() is absent
    const fetchSpy = spyOn(globalThis, 'fetch')
    const tunnelFetch = startSessionTunnel(
      {
        url: 'http://127.0.0.1:28471/mcp',
        authToken: 'secret-local-token',
      },
      envelope,
      {
        WebSocketImpl: FakeWebSocket as unknown as typeof globalThis.WebSocket,
      },
    )
    try {
      socketInstance!.readyState = FakeWebSocket.OPEN
      socketInstance!.emit('open', {})

      for (const badPath of [
        '//evil.com/steal',
        'https://evil.com/steal',
        '/\\evil.com/steal',
        'mcp',
      ]) {
        socketInstance!.emit('message', {
          data: JSON.stringify({
            type: 'http_request',
            id: `bad:${badPath}`,
            method: 'POST',
            path: badPath,
            body: '{}',
          }),
        })
      }

      await new Promise(resolve => setTimeout(resolve, 20))
      expect(fetchSpy).not.toHaveBeenCalled()
      const badResponses = sentFrames.filter(
        f => f.type === 'http_response' && String(f.id).startsWith('bad:'),
      )
      expect(badResponses).toHaveLength(4)
      for (const resp of badResponses) {
        expect(resp.status).toBe(400)
      }
    } finally {
      tunnelFetch.stop()
      fetchSpy.mockRestore()
    }

    // 2. Verify mixed-case Host/Authorization/Origin are stripped cleanly before trusted headers
    const observedHeaders: Array<Record<string, string>> = []
    const tunnelAnswer = startSessionTunnel(
      {
        url: 'http://127.0.0.1:28471/mcp',
        authToken: 'trusted-bearer-token',
        answer: async req => {
          observedHeaders.push(req.headers ?? {})
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: '{"ok":true}',
          }
        },
      },
      envelope,
      {
        WebSocketImpl: FakeWebSocket as unknown as typeof globalThis.WebSocket,
      },
    )
    try {
      socketInstance!.readyState = FakeWebSocket.OPEN
      socketInstance!.emit('open', {})

      socketInstance!.emit('message', {
        data: JSON.stringify({
          type: 'http_request',
          id: 'hdr-test',
          method: 'POST',
          path: '/mcp',
          headers: {
            Host: 'evil.com',
            HOST: 'evil2.com',
            Authorization: 'Bearer attacker-token',
            AUTHORIZATION: 'Bearer attacker-token-2',
            Origin: 'https://evil.com',
            ORIGIN: 'https://evil2.com',
            'X-Custom-Header': 'kept-value',
          },
          body: '{}',
        }),
      })

      await new Promise(resolve => setTimeout(resolve, 20))
      expect(observedHeaders).toHaveLength(1)
      const hdrs = observedHeaders[0]!
      const keys = Object.keys(hdrs)
      expect(keys).not.toContain('Host')
      expect(keys).not.toContain('HOST')
      expect(keys).not.toContain('Authorization')
      expect(keys).not.toContain('AUTHORIZATION')
      expect(keys).not.toContain('Origin')
      expect(keys).not.toContain('ORIGIN')
      expect(keys).not.toContain('origin')
      expect(hdrs.host).toBe('127.0.0.1:28471')
      expect(hdrs.authorization).toBe('Bearer trusted-bearer-token')
      expect(hdrs['x-custom-header']).toBe('kept-value')
    } finally {
      tunnelAnswer.stop()
    }
  })

  test('P1-3: enforces Mcp-Session-Id regex 400, DELETE->terminatedSessions 404, 256 LRU eviction, stateless compatibility, and clean listen failure', async () => {
    const dir = makeTempDir('mcp-http-session-')
    const server = await startMCPServerHttp(dir, {
      port: 0,
      announceOnStdout: false,
      getToolsOverride: () => [],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHandles.push(server)

    const baseHeaders = {
      host: `127.0.0.1:${server.boundPort}`,
      authorization: `Bearer ${server.authToken}`,
      'content-type': 'application/json',
    }

    // 1. Invalid Mcp-Session-Id characters / length rejected with 400 on POST and DELETE
    for (const badId of ['', 'bad id with spaces', 'bad/id', 'a'.repeat(129)]) {
      const postBad = await server.answer({
        method: 'POST',
        path: '/mcp',
        headers: { ...baseHeaders, 'mcp-session-id': badId },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      })
      expect(postBad.status).toBe(400)

      const delBad = await server.answer({
        method: 'DELETE',
        path: '/mcp',
        headers: { ...baseHeaders, 'mcp-session-id': badId },
      })
      expect(delBad.status).toBe(400)
    }

    // 2. Initialize mints a valid session; DELETE moves it to terminatedSessions; subsequent POST returns 404
    const initRes = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: baseHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    expect(initRes.status).toBe(200)
    const mintedId = initRes.headers['mcp-session-id']!
    expect(mintedId).toBeTruthy()

    const activePing = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: { ...baseHeaders, 'mcp-session-id': mintedId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
    })
    expect(activePing.status).toBe(200)

    const delRes = await server.answer({
      method: 'DELETE',
      path: '/mcp',
      headers: { ...baseHeaders, 'mcp-session-id': mintedId },
    })
    expect(delRes.status).toBe(204)

    const afterDeletePing = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: { ...baseHeaders, 'mcp-session-id': mintedId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
    })
    expect(afterDeletePing.status).toBe(404)
    expect(afterDeletePing.body).toContain('Session terminated')

    // Attempting to re-initialize a terminated session ID must ALSO return 404
    const reinitDeleted = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: { ...baseHeaders, 'mcp-session-id': mintedId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'initialize' }),
    })
    expect(reinitDeleted.status).toBe(404)

    // 3. Unknown non-minted Mcp-Session-Id on non-initialize call returns 404
    const unknownRes = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: { ...baseHeaders, 'mcp-session-id': 'never-minted-id' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'ping' }),
    })
    expect(unknownRes.status).toBe(404)

    // 4. Stateless single-shot POST without Mcp-Session-Id header still works (200)
    const statelessRes = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: baseHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'ping' }),
    })
    expect(statelessRes.status).toBe(200)

    // 5. Bounded LRU cap (256): initializing 257 sessions evicts the oldest
    const firstInit = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: baseHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 100, method: 'initialize' }),
    })
    const firstId = firstInit.headers['mcp-session-id']!
    let lastId = firstId
    for (let i = 0; i < 256; i += 1) {
      const res = await server.answer({
        method: 'POST',
        path: '/mcp',
        headers: baseHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 200 + i,
          method: 'initialize',
        }),
      })
      lastId = res.headers['mcp-session-id']!
    }
    const evictedRes = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: { ...baseHeaders, 'mcp-session-id': firstId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 500, method: 'ping' }),
    })
    expect(evictedRes.status).toBe(404)

    const newestRes = await server.answer({
      method: 'POST',
      path: '/mcp',
      headers: { ...baseHeaders, 'mcp-session-id': lastId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 501, method: 'ping' }),
    })
    expect(newestRes.status).toBe(200)

    // 6. EADDRINUSE listen failure does not construct/leak a dispatcher
    let loadAgentsCalled = false
    await expect(
      startMCPServerHttp(dir, {
        port: server.boundPort,
        announceOnStdout: false,
        getToolsOverride: () => [],
        loadAgentDefinitions: async () => {
          loadAgentsCalled = true
          return { activeAgents: [], allAgents: [] }
        },
      }),
    ).rejects.toBeInstanceOf(ToolServerPortTakenError)
    expect(loadAgentsCalled).toBe(false)
  })

  test('P2-1: validates Host port <= 65535, uses SHA-256 timingSafeEqual, checks security before 413, and closes socket on 413', async () => {
    // 1. Host header port bounds (0..65535)
    expect(
      checkMcpHttpRequestSecurity(
        { host: '127.0.0.1:65535' },
        'GET',
        '/health',
        'tok',
      ),
    ).toBeNull()
    expect(
      checkMcpHttpRequestSecurity(
        { host: '[::1]:65535' },
        'GET',
        '/health',
        'tok',
      ),
    ).toBeNull()
    expect(
      checkMcpHttpRequestSecurity(
        { host: '127.0.0.1:65536' },
        'GET',
        '/health',
        'tok',
      )?.status,
    ).toBe(403)
    expect(
      checkMcpHttpRequestSecurity(
        { host: '127.0.0.1:99999' },
        'GET',
        '/health',
        'tok',
      )?.status,
    ).toBe(403)
    expect(
      checkMcpHttpRequestSecurity(
        { host: '[::1]:99999' },
        'GET',
        '/health',
        'tok',
      )?.status,
    ).toBe(403)

    // 2. Bearer auth rejects different-length and same-length mismatches cleanly
    expect(
      checkMcpHttpRequestSecurity(
        { host: '127.0.0.1', authorization: 'Bearer short' },
        'POST',
        '/mcp',
        'a-much-longer-secret-token',
      )?.status,
    ).toBe(401)
    expect(
      checkMcpHttpRequestSecurity(
        {
          host: '127.0.0.1',
          authorization: 'Bearer a-much-longer-secret-token',
        },
        'POST',
        '/mcp',
        'a-much-longer-secret-token',
      ),
    ).toBeNull()

    // 3. Live server: security (403/401) runs BEFORE oversize Content-Length (413)
    const dir = makeTempDir('mcp-http-p2-1-')
    const server = await startMCPServerHttp(dir, {
      port: 0,
      announceOnStdout: false,
      getToolsOverride: () => [],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHandles.push(server)

    const sendRawTcp = (
      rawRequest: string,
    ): Promise<{ raw: string; statusLine: string; closed: boolean }> =>
      new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        const socket = createConnection(
          { host: '127.0.0.1', port: server.boundPort },
          () => {
            socket.write(rawRequest)
          },
        )
        socket.on('data', chunk => chunks.push(Buffer.from(chunk)))
        socket.on('close', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const statusLine = raw.split('\r\n')[0] ?? ''
          resolve({ raw, statusLine, closed: true })
        })
        socket.on('error', err => {
          // If server destroyed socket right after flushing 413 response, we may
          // still have received the complete HTTP response before ECONNRESET.
          const raw = Buffer.concat(chunks).toString('utf8')
          if (raw.startsWith('HTTP/1.1 ')) {
            resolve({
              raw,
              statusLine: raw.split('\r\n')[0] ?? '',
              closed: true,
            })
            return
          }
          reject(err)
        })
      })

    const unauthOversize = await sendRawTcp(
      [
        'POST /mcp HTTP/1.1',
        `Host: 127.0.0.1:${server.boundPort}`,
        `Content-Length: ${64 * 1024 * 1024}`,
        'Content-Type: application/json',
        'Connection: close',
        '',
        '',
      ].join('\r\n'),
    )
    expect(unauthOversize.statusLine).toContain('401')

    const badOriginOversize = await sendRawTcp(
      [
        'POST /mcp HTTP/1.1',
        `Host: 127.0.0.1:${server.boundPort}`,
        'Origin: https://evil.com',
        `Authorization: Bearer ${server.authToken}`,
        `Content-Length: ${64 * 1024 * 1024}`,
        'Content-Type: application/json',
        'Connection: close',
        '',
        '',
      ].join('\r\n'),
    )
    expect(badOriginOversize.statusLine).toContain('403')

    // 4. Authenticated oversize Content-Length returns 413 with Connection: close
    // even when client requested keep-alive, and server closes the socket.
    const authOversize = await sendRawTcp(
      [
        'POST /mcp HTTP/1.1',
        `Host: 127.0.0.1:${server.boundPort}`,
        `Authorization: Bearer ${server.authToken}`,
        `Content-Length: ${64 * 1024 * 1024}`,
        'Content-Type: application/json',
        'Connection: keep-alive',
        '',
        '',
      ].join('\r\n'),
    )
    expect(authOversize.statusLine).toContain('413')
    expect(authOversize.raw.toLowerCase()).toContain('connection: close')
    expect(authOversize.closed).toBe(true)
  })

  test('P1-9: mcpServeHandler enforces policy/config/port exit codes (EX_POLICY=78, EX_CONFIG=69, EX_UNAVAILABLE=77) and never latches daemon mode before validation', async () => {
    const savedEnv = {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
        process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
      CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
      CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
      CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
    }
    const exitCodes: number[] = []
    const exitSpy = spyOn(process, 'exit').mockImplementation((code => {
      exitCodes.push(typeof code === 'number' ? code : 0)
      return undefined as never
    }) as typeof process.exit)
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
      delete process.env.CLAUDE_CODE_USE_BEDROCK
      delete process.env.CLAUDE_CODE_USE_VERTEX
      delete process.env.CLAUDE_CODE_USE_FOUNDRY

      // 1. Invalid port with --session-tunnel -> EX_CONFIG (69), daemon mode NOT latched
      await mcpServeHandler({
        transport: 'http',
        port: '9999',
        sessionTunnel: true,
      })
      expect(exitCodes.pop()).toBe(EX_CONFIG)
      expect(isToolServerDaemonMode()).toBe(false)

      // 2. CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 -> EX_POLICY (78), daemon mode NOT latched
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
      await mcpServeHandler({
        transport: 'http',
        port: String(SESSION_TUNNEL_PORT),
        sessionTunnel: true,
      })
      expect(exitCodes.pop()).toBe(EX_POLICY)
      expect(isToolServerDaemonMode()).toBe(false)
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC

      // 3. Non-Anthropic provider (Bedrock/Vertex/Foundry) -> EX_POLICY (78), daemon mode NOT latched
      for (const envKey of [
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_USE_VERTEX',
        'CLAUDE_CODE_USE_FOUNDRY',
      ] as const) {
        process.env[envKey] = '1'
        await mcpServeHandler({
          transport: 'http',
          port: String(SESSION_TUNNEL_PORT),
          sessionTunnel: true,
        })
        expect(exitCodes.pop()).toBe(EX_POLICY)
        expect(isToolServerDaemonMode()).toBe(false)
        delete process.env[envKey]
      }

      // 4. Port already taken -> EX_UNAVAILABLE (77)
      const setupSpy = spyOn(setupMod, 'setup').mockResolvedValue(
        undefined as never,
      )
      const blocker = createHttpServer()
      await new Promise<void>(resolve =>
        blocker.listen(0, '127.0.0.1', () => resolve()),
      )
      const takenPort = (blocker.address() as { port: number }).port
      try {
        await mcpServeHandler({
          transport: 'http',
          port: String(takenPort),
        })
        expect(exitCodes.pop()).toBe(EX_UNAVAILABLE)
        expect(isToolServerDaemonMode()).toBe(false)
      } finally {
        setupSpy.mockRestore()
        await new Promise<void>(resolve => blocker.close(() => resolve()))
      }
    } finally {
      exitSpy.mockRestore()
      errorSpy.mockRestore()
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) {
          delete process.env[k]
        } else {
          process.env[k] = v
        }
      }
    }
  })

  test('P2-3: honors _meta[claudecode/toolUseId] <= 256 chars, guards getTaskOutputPath throw, and maps internal errors to -32603 vs -32602', async () => {
    const dir = makeTempDir('mcp-p2-3-')
    const observedToolUseIds: string[] = []
    let throwOnGetTools = false

    const probeTool = buildTool({
      name: 'Probe',
      maxResultSizeChars: 10_000,
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      async description() {
        return 'Probe tool'
      },
      async prompt() {
        return 'Probe tool'
      },
      renderToolUseMessage() {
        return null
      },
      mapToolResultToToolResultBlockParam(_data, toolUseID) {
        return {
          type: 'tool_result',
          tool_use_id: toolUseID,
          content: 'ok',
        }
      },
      async call(_input, context) {
        if (context.toolUseId) {
          observedToolUseIds.push(context.toolUseId)
        }
        return { data: { ok: true } }
      },
    }) as unknown as Tool

    const dispatcher = createMcpServeDispatcher({
      cwd: dir,
      getToolsOverride: () => {
        if (throwOnGetTools) {
          throw new Error('unexpected internal failure')
        }
        return [probeTool]
      },
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })

    try {
      // 1. Valid claudecode/toolUseId <= 256 chars is propagated
      const resCustom = await dispatcher.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'Probe',
          arguments: {},
          _meta: { 'claudecode/toolUseId': 'toolu_custom_123' },
        },
      })
      expect(resCustom?.error).toBeUndefined()
      expect(observedToolUseIds[0]).toBe('toolu_custom_123')

      // 2. Oversize (>256 chars) or empty toolUseId falls back to randomUUID
      const overlongId = 'x'.repeat(257)
      await dispatcher.handleJsonRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'Probe',
          arguments: {},
          _meta: { 'claudecode/toolUseId': overlongId },
        },
      })
      expect(observedToolUseIds[1]).not.toBe(overlongId)
      expect(observedToolUseIds[1]!.length).toBeGreaterThan(0)

      // 3. Unknown tool name -> -32602 (Invalid params)
      const unknownToolRes = await dispatcher.handleJsonRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'DoesNotExist', arguments: {} },
      })
      expect(unknownToolRes?.error?.code).toBe(-32602)

      // 4. Unexpected internal exception -> -32603 (Internal error)
      throwOnGetTools = true
      const internalErrRes = await dispatcher.handleJsonRpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/list',
      })
      expect(internalErrRes?.error?.code).toBe(-32603)
    } finally {
      dispatcher.dispose()
    }

    // 5. formatMcpServeToolResult survives diskless getTaskOutputPath throw
    const pathSpy = spyOn(
      diskOutputMod,
      'getTaskOutputPath',
    ).mockImplementation(() => {
      throw new Error('diskless environment')
    })
    try {
      const formatted = formatMcpServeToolResult({
        data: { stdout: 'hi', backgroundTaskId: 'bg-99' },
      })
      const parsed = JSON.parse(
        (formatted.content[0] as { type: 'text'; text: string }).text,
      ) as Record<string, unknown>
      expect(parsed).toEqual({ stdout: 'hi', backgroundTaskId: 'bg-99' })
      expect('backgroundOutputPath' in parsed).toBe(false)
    } finally {
      pathSpy.mockRestore()
    }
  })

  test('P2-2: token_update without expires_at clears expiry, closeInternal detaches WS listeners, and extractMcpServeFlags handles leading flags & rejects --port --debug', async () => {
    // 1. extractMcpServeFlags skips leading global flags and rejects --port --debug
    expect(
      isToolServerDaemonMode([
        '--debug',
        'mcp',
        'serve',
        '--transport',
        'http',
      ]),
    ).toBe(true)
    expect(
      isToolServerDaemonMode([
        'node',
        'claude',
        '--verbose',
        '-d',
        'mcp',
        'serve',
        '--transport',
        'http',
      ]),
    ).toBe(true)
    expect(
      isToolServerDaemonMode([
        'mcp',
        'serve',
        '--transport',
        'http',
        '--port',
        '--debug',
      ]),
    ).toBe(false)
    expect(
      isToolServerDaemonMode([
        'mcp',
        'serve',
        '--transport',
        'http',
        '--result-format',
        '--debug',
      ]),
    ).toBe(false)

    // 2. token_update without expires_at clears tokenExpiresAt & closeInternal detaches listeners
    let socketInstance: TrackingWebSocket | null = null
    class TrackingWebSocket {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSING = 2
      static readonly CLOSED = 3
      readyState = TrackingWebSocket.CONNECTING
      listeners = new Map<string, Set<(event: unknown) => void>>()
      sent: Array<Record<string, unknown>> = []

      constructor(_url: string) {
        socketInstance = this
      }

      addEventListener(type: string, fn: (event: unknown) => void): void {
        let set = this.listeners.get(type)
        if (!set) {
          set = new Set()
          this.listeners.set(type, set)
        }
        set.add(fn)
      }

      removeEventListener(type: string, fn: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(fn)
      }

      send(data: string): void {
        this.sent.push(JSON.parse(data) as Record<string, unknown>)
      }

      close(): void {
        this.readyState = TrackingWebSocket.CLOSED
      }

      emit(type: string, event: unknown): void {
        for (const fn of [...(this.listeners.get(type) ?? [])]) {
          fn(event)
        }
      }
    }

    // Start with a soon-to-expire token (expires in 150ms)
    const soonExpiryMs = Date.now() + 150
    const envelope = parseSessionTunnelEnvelope(
      JSON.stringify({
        v: 1,
        session_id: 'sess_p2_2',
        session_token: 'initial_tok',
        api_base_url: 'http://127.0.0.1:8080',
        session_token_expires_at: soonExpiryMs,
      }),
    )!

    const exits: Array<{ code: number; reason: string }> = []
    const tunnel = startSessionTunnel(
      {
        url: 'http://127.0.0.1:28471/mcp',
        authToken: 'tok',
        answer: async () => ({ status: 200, headers: {}, body: '{}' }),
      },
      envelope,
      {
        WebSocketImpl:
          TrackingWebSocket as unknown as typeof globalThis.WebSocket,
        onExit: (code, reason) => exits.push({ code, reason }),
      },
    )

    try {
      socketInstance!.readyState = TrackingWebSocket.OPEN
      socketInstance!.emit('open', {})
      expect(tunnel.state).toBe('open')
      expect(socketInstance!.listeners.get('open')?.size).toBe(1)
      expect(socketInstance!.listeners.get('message')?.size).toBe(1)
      expect(socketInstance!.listeners.get('error')?.size).toBe(1)
      expect(socketInstance!.listeners.get('close')?.size).toBe(1)

      // Send token_update WITHOUT expires_at -> clears tokenExpiresAt
      socketInstance!.emit('message', {
        data: JSON.stringify({ type: 'token_update', token: 'refreshed_tok' }),
      })

      // Wait past original expiry (200ms) and send a ping -> tunnel must stay open!
      await new Promise(resolve => setTimeout(resolve, 200))
      socketInstance!.emit('message', {
        data: JSON.stringify({ type: 'ping', id: 'still-alive' }),
      })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(tunnel.state).toBe('open')
      expect(exits).toHaveLength(0)
      expect(
        socketInstance!.sent.some(
          m => m.type === 'pong' && m.id === 'still-alive',
        ),
      ).toBe(true)
    } finally {
      tunnel.stop()
    }

    // After closeInternal (stop()), all 4 listeners must be detached
    expect(socketInstance!.listeners.get('open')?.size).toBe(0)
    expect(socketInstance!.listeners.get('message')?.size).toBe(0)
    expect(socketInstance!.listeners.get('error')?.size).toBe(0)
    expect(socketInstance!.listeners.get('close')?.size).toBe(0)
  })

  test('R2-P0-1, R2-P1-3, R2-P1-9: checkPermissions defers when unloaded, enforces deny rules, leaks 0 abort listeners, bounds subagentFrameResultHolds, and never falls back to raw data', async () => {
    const dir = makeTempDir('mcp-r2-disp-')
    const sampleFile = join(dir, 'sample.txt')
    writeFileSync(sampleFile, 'secret file contents\n', 'utf8')

    // 1. No policy state loaded -> claudecode/checkPermissions returns { doesNotDecide: true }
    const unloadedDispatcher = createMcpServeDispatcher({
      cwd: dir,
      getToolsOverride: () => [FileReadTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
      getToolPermissionContext: () => undefined,
    })
    try {
      const res = await unloadedDispatcher.checkPermissions({
        name: 'Read',
        arguments: { file_path: sampleFile },
      })
      expect(res).toEqual({ doesNotDecide: true })
    } finally {
      unloadedDispatcher.dispose()
    }

    // 2. Loaded deny rule -> claudecode/checkPermissions returns deny, and 100 calls leak 0 abort listeners
    const denyDispatcher = createMcpServeDispatcher({
      cwd: dir,
      getToolsOverride: () => [FileReadTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
      getToolPermissionContext: () => ({
        ...getEmptyToolPermissionContext(),
        alwaysDenyRules: { policySettings: ['Read'] },
      }),
    })
    try {
      const denied = await denyDispatcher.checkPermissions({
        name: 'Read',
        arguments: { file_path: sampleFile },
      })
      expect(denied).toMatchObject({ behavior: 'deny' })

      for (let i = 0; i < 60; i++) {
        await denyDispatcher.checkPermissions({
          name: 'Read',
          arguments: { file_path: sampleFile },
        })
        await denyDispatcher.callTool({
          name: 'Read',
          arguments: { file_path: sampleFile },
        })
      }
      expect(
        getEventListeners(denyDispatcher.abortController.signal, 'abort')
          .length,
      ).toBe(0)

      // Pre-aborted signal wired into checkPermissions
      const aborted = new AbortController()
      aborted.abort()
      await expect(
        denyDispatcher.checkPermissions(
          { name: 'Read', arguments: { file_path: sampleFile } },
          { signal: aborted.signal },
        ),
      ).rejects.toThrow()
      expect(
        getEventListeners(denyDispatcher.abortController.signal, 'abort')
          .length,
      ).toBe(0)
    } finally {
      denyDispatcher.dispose()
    }

    // 3. R2-P1-9: rendered Edit without subagentFrameResult does NOT dump raw finalResult.data into _meta
    const editWithoutFrameTool = buildTool({
      name: 'Edit',
      maxResultSizeChars: 10_000,
      inputSchema: z.object({ file_path: z.string() }),
      outputSchema: z.object({ ok: z.boolean(), fullFile: z.string() }),
      async description() {
        return 'Edit without frame'
      },
      async prompt() {
        return 'Edit without frame'
      },
      renderToolUseMessage() {
        return null
      },
      mapToolResultToToolResultBlockParam(_data, toolUseID) {
        return {
          type: 'tool_result',
          tool_use_id: toolUseID,
          content: 'Edited cleanly',
        }
      },
      async call() {
        return { data: { ok: true, fullFile: 'TOP_SECRET_RAW_FILE_BODY' } }
      },
    }) as unknown as Tool

    const renderedDisp = createMcpServeDispatcher({
      cwd: dir,
      resultFormat: 'rendered',
      getToolsOverride: () => [editWithoutFrameTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    try {
      const res = await renderedDisp.callTool({
        name: 'Edit',
        arguments: { file_path: '/tmp/a.ts' },
        _meta: { 'claudecode/editResult': '1' },
      })
      expect(res._meta).toBeUndefined()
    } finally {
      renderedDisp.dispose()
    }

    // 4. R2-P1-9: evaluateSubagentFrameResultHolds & attachSubagentFrameResultMeta bound hanging predicates with timeout & abort
    const timedOut = await evaluateSubagentFrameResultHolds(
      () => new Promise<boolean>(() => {}),
      { timeoutMs: 25 },
    )
    expect(timedOut).toBe(false)

    const ac = new AbortController()
    setTimeout(() => ac.abort(), 15)
    const baseCallResult: {
      content: Array<{ type: 'text'; text: string }>
      isError?: boolean
      _meta?: Record<string, unknown>
    } = { content: [{ type: 'text', text: 'ok' }] }
    const abortedHolds = await attachSubagentFrameResultMeta(
      baseCallResult,
      {
        subagentFrameResult: { secret: 1 },
        subagentFrameResultHolds: () => new Promise<boolean>(() => {}),
      },
      { signal: ac.signal, timeoutMs: 5_000 },
    )
    expect(abortedHolds._meta).toBeUndefined()
  })

  test('R2-P1-1, R2-P1-2, R2-P1-7: HTTP server caps batch size at 64, DELETE unknown session returns 404, aborted body cleans up, and close() drains keep-alive sockets promptly', async () => {
    const dir = makeTempDir('mcp-r2-http-')
    const server = await startMCPServerHttp(dir, {
      port: 0,
      announceOnStdout: false,
      getToolsOverride: () => [FileReadTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHandles.push(server)

    const authHeaders = {
      authorization: `Bearer ${server.authToken}`,
      'content-type': 'application/json',
    }

    // 1. Batch of 65 items rejected with HTTP 400 + JSON-RPC -32600
    const oversizeBatch = Array.from({ length: 65 }, (_, i) => ({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'ping',
    }))
    const batchRes = await fetch(server.url, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(oversizeBatch),
    })
    expect(batchRes.status).toBe(400)
    const batchBody = (await batchRes.json()) as { error: { code: number } }
    expect(batchBody.error.code).toBe(-32600)

    // 2. DELETE unknown session returns 404; DELETE active session returns 204, then second DELETE returns 404
    const delUnknown = await fetch(server.url, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${server.authToken}`,
        'mcp-session-id': 'nonexistent-session-id',
      },
    })
    expect(delUnknown.status).toBe(404)

    const initRes = await fetch(server.url, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    const activeSid = initRes.headers.get('mcp-session-id')!
    expect(activeSid).toBeTruthy()

    const delActive = await fetch(server.url, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${server.authToken}`,
        'mcp-session-id': activeSid,
      },
    })
    expect(delActive.status).toBe(204)

    const delAgain = await fetch(server.url, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${server.authToken}`,
        'mcp-session-id': activeSid,
      },
    })
    expect(delAgain.status).toBe(404)

    // 3. Mid-body TCP abort rejects body read cleanly without hanging server
    await new Promise<void>(resolve => {
      const sock = createConnection(
        { host: '127.0.0.1', port: server.boundPort },
        () => {
          sock.write(
            [
              'POST /mcp HTTP/1.1',
              `Host: 127.0.0.1:${server.boundPort}`,
              `Authorization: Bearer ${server.authToken}`,
              'Content-Type: application/json',
              'Content-Length: 1000',
              '',
              '{"partial":',
            ].join('\r\n'),
          )
          setTimeout(() => {
            sock.destroy()
            resolve()
          }, 20)
        },
      )
      sock.on('error', () => {})
    })
    const afterAbort = await fetch(new URL('/health', server.url))
    expect(afterAbort.status).toBe(200)

    // 4. Open idle keep-alive socket does NOT hang server.close()
    const keepAliveSock = createConnection(
      { host: '127.0.0.1', port: server.boundPort },
      () => {
        keepAliveSock.write(
          `GET /health HTTP/1.1\r\nHost: 127.0.0.1:${server.boundPort}\r\nConnection: keep-alive\r\n\r\n`,
        )
      },
    )
    keepAliveSock.on('error', () => {})
    await new Promise(resolve => setTimeout(resolve, 40))

    const closeStart = Date.now()
    await server.close()
    const closeElapsed = Date.now() - closeStart
    keepAliveSock.destroy()
    expect(closeElapsed).toBeLessThan(800)
  })

  test('R2-P1-6 & R2-P2-2: sessionTunnel hardens session_id, hold counters, maxBytes pre-parse, frame.code, in-flight cap, abort signal, stdin pause, and daemon mode reset', async () => {
    // 1. session_id rejects '.', '..', and invalid characters
    for (const badId of [
      '.',
      '..',
      '../evil',
      'a/b',
      'id with spaces',
      'a?b=1',
    ]) {
      expect(
        parseSessionTunnelEnvelope(
          JSON.stringify({
            v: 1,
            session_id: badId,
            session_token: 'tok',
            api_base_url: 'https://api.anthropic.com',
          }),
        ),
      ).toBeUndefined()
      expect(() =>
        buildSessionTunnelRelayUrl({
          v: 1,
          session_id: badId,
          session_token: 'tok',
          api_base_url: 'https://api.anthropic.com',
        }),
      ).toThrow(/Invalid session_id/)
    }

    // 2. readSessionTunnelLineFromStdin pauses stdin stream after reading line
    let pauseCalled = false
    const stream = Readable.from(['{"v":1}\nrest-of-stream\n'])
    const origPause = stream.pause.bind(stream)
    stream.pause = () => {
      pauseCalled = true
      return origPause()
    }
    const line = await readSessionTunnelLineFromStdin(stream, { isTTY: false })
    expect(line).toBe('{"v":1}')
    expect(pauseCalled).toBe(true)

    // 3. Mock WebSocket harness for tunnel invariants
    class FakeWs {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSING = 2
      static readonly CLOSED = 3
      readyState = FakeWs.CONNECTING
      sent: Array<Record<string, unknown>> = []
      closedWith?: { code?: number; reason?: string }
      #listeners = new Map<string, Set<(e: unknown) => void>>()
      constructor(_url: string) {
        lastWs = this
      }
      addEventListener(t: string, fn: (e: unknown) => void): void {
        const s = this.#listeners.get(t) ?? new Set()
        s.add(fn)
        this.#listeners.set(t, s)
      }
      removeEventListener(t: string, fn: (e: unknown) => void): void {
        this.#listeners.get(t)?.delete(fn)
      }
      send(data: string): void {
        this.sent.push(JSON.parse(data) as Record<string, unknown>)
      }
      close(code?: number, reason?: string): void {
        this.readyState = FakeWs.CLOSED
        this.closedWith = { code, reason }
      }
      emit(t: string, e: unknown): void {
        for (const fn of [...(this.#listeners.get(t) ?? [])]) fn(e)
      }
      openNow(): void {
        this.readyState = FakeWs.OPEN
        this.emit('open', {})
      }
    }
    let lastWs: FakeWs | undefined
    const env = parseSessionTunnelEnvelope(
      JSON.stringify({
        v: 1,
        session_id: 'sess_r2_hardened',
        session_token: 'tok_r2',
        api_base_url: 'http://127.0.0.1:8080',
      }),
    )!

    // 3a. bufferDuringHold: false does NOT trip hold_buffer_overflow even when > maxFrames arrive
    const early = startEarlySessionTunnelDial(env, {
      maxFrames: 2,
      bufferDuringHold: false,
      holdDeadlineMs: 5_000,
      WebSocketImpl: FakeWs as unknown as typeof globalThis.WebSocket,
    })
    try {
      lastWs!.openNow()
      for (let i = 0; i < 5; i++) {
        lastWs!.emit('message', {
          data: JSON.stringify({
            type: 'http_request',
            id: `r-${i}`,
            method: 'GET',
            path: '/health',
          }),
        })
      }
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(early.state).toBe('holding')
      const replies503 = lastWs!.sent.filter(
        m => m.type === 'http_response' && m.status === 503,
      )
      expect(replies503).toHaveLength(5)
    } finally {
      early.stop()
    }

    // 3b. Post-adopt maxBytes enforced BEFORE JSON.parse, invalid close code sanitized, concurrency capped, and tunnel signal aborted on stop
    const exits: Array<{ code: number; reason: string }> = []
    let capturedAnswerSignal: AbortSignal | undefined
    let releaseFirstRequest!: () => void
    const firstRequestGate = new Promise<void>(r => {
      releaseFirstRequest = r
    })
    const tunnel = startSessionTunnel(
      {
        url: 'http://127.0.0.1:28471/mcp',
        authToken: 'tok',
        answer: async req => {
          capturedAnswerSignal = req.signal
          await firstRequestGate
          return { status: 200, headers: {}, body: '{"ok":true}' }
        },
      },
      env,
      {
        maxBytes: 256,
        maxInFlightRequests: 1,
        WebSocketImpl: FakeWs as unknown as typeof globalThis.WebSocket,
        onExit: (code, reason) => exits.push({ code, reason }),
      },
    )
    try {
      lastWs!.openNow()
      // Send 2 concurrent requests with maxInFlightRequests: 1 -> 2nd gets 429
      lastWs!.emit('message', {
        data: JSON.stringify({
          type: 'http_request',
          id: 'inflight-1',
          method: 'POST',
          path: '/mcp',
          body: '{}',
        }),
      })
      lastWs!.emit('message', {
        data: JSON.stringify({
          type: 'http_request',
          id: 'inflight-2',
          method: 'POST',
          path: '/mcp',
          body: '{}',
        }),
      })
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(
        lastWs!.sent.some(
          m =>
            m.type === 'http_response' &&
            m.id === 'inflight-2' &&
            m.status === 429,
        ),
      ).toBe(true)
      expect(capturedAnswerSignal?.aborted).toBe(false)

      // Oversize frame post-adopt triggers 1009 frame_too_large before JSON.parse
      const parseSpy = spyOn(JSON, 'parse')
      try {
        lastWs!.emit('message', { data: 'x'.repeat(512) })
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(parseSpy).not.toHaveBeenCalled()
      } finally {
        parseSpy.mockRestore()
      }
      expect(tunnel.state).toBe('closed')
      expect(capturedAnswerSignal?.aborted).toBe(true)
      expect(exits).toContainEqual({
        code: EX_UNAVAILABLE,
        reason: 'frame_too_large',
      })
    } finally {
      releaseFirstRequest()
      tunnel.stop()
    }

    // 3c. Invalid remote close frame.code (-5 / 999) falls back to EX_UNAVAILABLE
    const closeExits: Array<{ code: number; reason: string }> = []
    const tunnelCode = startSessionTunnel(
      {
        url: 'http://127.0.0.1:28471/mcp',
        authToken: 'tok',
        answer: async () => ({ status: 200, headers: {}, body: '{}' }),
      },
      env,
      {
        WebSocketImpl: FakeWs as unknown as typeof globalThis.WebSocket,
        onExit: (code, reason) => closeExits.push({ code, reason }),
      },
    )
    try {
      lastWs!.openNow()
      lastWs!.emit('message', {
        data: JSON.stringify({ type: 'close', code: 9999, reason: 'bad-code' }),
      })
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(closeExits).toEqual([{ code: EX_UNAVAILABLE, reason: 'bad-code' }])
    } finally {
      tunnelCode.stop()
    }

    // 4. mcpServeHandler resets setToolServerDaemonMode(false) on generic setup() failure too
    const setupFailSpy = spyOn(setupMod, 'setup').mockRejectedValue(
      new Error('setup boom'),
    )
    const exitSpy = spyOn(process, 'exit').mockImplementation(
      (() => undefined) as unknown as typeof process.exit,
    )
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await mcpServeHandler({ transport: 'http', port: '0' })
      expect(isToolServerDaemonMode()).toBe(false)
    } finally {
      setupFailSpy.mockRestore()
      exitSpy.mockRestore()
      errSpy.mockRestore()
    }
  })
})
