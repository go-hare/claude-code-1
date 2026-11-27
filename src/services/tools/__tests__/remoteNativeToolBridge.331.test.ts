import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { createEmbeddedHost } from '../../../entrypoints/sdk/embeddedHost.js'
import {
  clearRemoteNativeToolRunners,
  createExplicitToolDeps,
  createToolCallContext,
  getRemoteNativeToolCheck,
  LOCAL_ONLY_NATIVE_TOOL_NAMES,
  NativeToolElsewhereError,
  NeverRunsInThisProcessError,
  REMOTE_CHECK_DOES_NOT_DECIDE,
  resolveToolUseContext,
  type RemoteNativeToolSession,
} from '../../../Tool.js'
import { isAbortError } from '../../../utils/errors.js'
import {
  createSessionHost,
  runWithNewHostSession,
} from '../../../utils/sessionHost.js'
import {
  attachRemoteNativeToolBridge,
  createHttpRemoteNativeToolBridge,
  spawnRemoteNativeToolWorker,
} from '../remoteNativeToolBridge.js'
import {
  isRemoteToolsForwardEnabled,
  remoteHostSchemaProperty,
} from '../remoteToolHost.js'
import {
  type BridgeWebSocketLike,
  canForwardToAttachedMachines,
  DEVICE_BRIDGE_TOKEN_DEADLINE_SYMBOL,
  isDesktopAppHostingTenant,
  isDesktopAppTakenAway,
  isRemoteToolsPinStoredLogin,
  REMOTE_TOOLS_BRIDGE_MAX_FRAME_BYTES,
  REMOTE_TOOLS_BRIDGE_PROD_URL,
  REMOTE_TOOLS_BRIDGE_STAGING_URL,
  RemoteToolsBridgeClient,
  resolveRemoteToolsBridgeUrl,
  resolveRemoteToolsTransportMode,
  setDesktopAppHostOverride,
  setDesktopAppTakenAway,
  setRemoteToolsPinStoredLoginOverride,
  setTakesMachinesMcpToolsAlone,
  takesMachinesMcpToolsAlone,
  validateBridgeWebSocketUrl,
} from '../remoteToolsTransport.js'

function makeDisklessSession(): RemoteNativeToolSession {
  return {
    root: {},
    host: {
      launchOptions: {
        diskless: () => true,
      },
    },
  }
}

async function readHttpJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
    string,
    unknown
  >
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(text, 'utf8')),
  })
  res.end(text)
}

async function startMockMcpHttpWorker(
  handler: (
    req: IncomingMessage,
    body: Record<string, unknown>,
    res: ServerResponse,
  ) => void | Promise<void>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      const body = await readHttpJson(req)
      await handler(req, body, res)
    } catch (err) {
      sendJson(res, 500, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      })
    }
  })

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${addr.port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
      }),
  }
}

describe('createHttpRemoteNativeToolBridge (Official 2.1.331)', () => {
  test('routes Write -> Read -> Edit over real HTTP JSON-RPC, hydrates fromAnotherProcess, propagates claudecode/editResult -> subagentFrameResult, and restores NeverRunsInThisProcessError on detach', async () => {
    const authToken = 'secret-worker-token-331'
    const files = new Map<string, string>()
    const seenAuthHeaders: string[] = []
    const seenMetas: Array<Record<string, unknown> | undefined> = []

    const worker = await startMockMcpHttpWorker((req, rpc, res) => {
      seenAuthHeaders.push(req.headers.authorization ?? '')
      const params = rpc.params as {
        name: string
        arguments: Record<string, unknown>
        _meta?: Record<string, unknown>
      }
      seenMetas.push(params._meta)

      if (rpc.method !== 'tools/call') {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: rpc.id,
          error: { code: -32601, message: 'Method not found' },
        })
        return
      }

      if (params.name === 'Write') {
        const filePath = String(params.arguments.file_path)
        const content = String(params.arguments.content)
        files.set(filePath, content)
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            structuredContent: {
              type: 'create',
              filePath: '/worker-sandbox-ignored.txt',
              content,
              structuredPatch: [],
              originalFile: null,
            },
          },
        })
        return
      }

      if (params.name === 'Read') {
        const filePath = String(params.arguments.file_path)
        const content = files.get(filePath) ?? ''
        // Return via JSON-encoded text content block (standard --result-format raw)
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  type: 'text',
                  file: {
                    filePath,
                    content,
                    numLines: content.split('\n').length,
                    startLine: 1,
                    totalLines: content.split('\n').length,
                  },
                }),
              },
            ],
          },
        })
        return
      }

      if (params.name === 'Edit') {
        const filePath = String(params.arguments.file_path)
        const oldStr = String(params.arguments.old_string)
        const newStr = String(params.arguments.new_string)
        const original = files.get(filePath) ?? ''
        const updated = original.replace(oldStr, newStr)
        files.set(filePath, updated)
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            structuredContent: {
              filePath: '/worker-sandbox-ignored.txt',
              oldString: oldStr,
              newString: newStr,
              originalFile: original,
              structuredPatch: [],
              replaceAll: false,
            },
            _meta: {
              'claudecode/editResult': {
                applied: true,
                hunkCount: 1,
              },
            },
          },
        })
        return
      }

      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          isError: true,
          content: [{ type: 'text', text: 'Unknown tool' }],
        },
      })
    })

    const session = makeDisklessSession()
    const bridge = createHttpRemoteNativeToolBridge({
      url: worker.url,
      authToken,
    })

    expect(bridge.toolNames).toEqual([...LOCAL_ONLY_NATIVE_TOOL_NAMES])

    const deps = createExplicitToolDeps({ session })
    const ctx = resolveToolUseContext(
      deps,
      createToolCallContext({ toolUseId: 'toolu_bridge_1' }),
    )

    // Before attach, diskless session fails closed
    await expect(
      FileReadTool.call({ file_path: '/workspace/demo.ts' }, ctx),
    ).rejects.toThrow(NeverRunsInThisProcessError)

    const detach = attachRemoteNativeToolBridge(session, bridge)
    try {
      const writeRes = await FileWriteTool.call(
        { file_path: '/workspace/demo.ts', content: 'const v = 1\n' },
        ctx,
        undefined,
        undefined,
        undefined,
        { userModified: true },
      )
      expect(writeRes.data.type).toBe('create')
      // fromAnotherProcess restores host file_path & userModified
      expect(writeRes.data.filePath).toBe('/workspace/demo.ts')
      expect(writeRes.data.userModified).toBe(true)

      const readRes = await FileReadTool.call(
        { file_path: '/workspace/demo.ts' },
        ctx,
      )
      expect(readRes.data.type).toBe('text')
      if (readRes.data.type === 'text') {
        expect(readRes.data.file.content).toBe('const v = 1\n')
      }

      const editRes = await FileEditTool.call(
        {
          file_path: '/workspace/demo.ts',
          old_string: 'const v = 1',
          new_string: 'const v = 2',
          replace_all: false,
        },
        ctx,
        undefined,
        undefined,
        undefined,
        { userModified: false },
      )
      expect(editRes.data.filePath).toBe('/workspace/demo.ts')
      expect(editRes.data.userModified).toBe(false)
      expect(editRes.data.newString).toBe('const v = 2')
      expect(editRes.subagentFrameResult).toEqual({
        applied: true,
        hunkCount: 1,
      })

      // Auth header and _meta assertions
      expect(seenAuthHeaders).toEqual([
        `Bearer ${authToken}`,
        `Bearer ${authToken}`,
        `Bearer ${authToken}`,
      ])
      expect(seenMetas[0]?.['claudecode/toolUseId']).toBe('toolu_bridge_1')
      expect(seenMetas[2]?.['claudecode/editResult']).toBe('1')
    } finally {
      detach()
      // Detach is idempotent
      detach()
      await bridge.dispose()
      await worker.close()
      clearRemoteNativeToolRunners(session)
    }

    // After detach(), diskless fail-closed behavior is restored
    await expect(
      FileReadTool.call({ file_path: '/workspace/demo.ts' }, ctx),
    ).rejects.toThrow(NeverRunsInThisProcessError)
  })

  test('supports remote claudecode/checkPermissions returning deny, allow, ask, and REMOTE_CHECK_DOES_NOT_DECIDE', async () => {
    let mode: 'deny' | 'allow' | 'ask' | 'doesNotDecide' | 'unsupported' =
      'deny'

    const worker = await startMockMcpHttpWorker((_req, rpc, res) => {
      if (rpc.method === 'claudecode/checkPermissions') {
        if (mode === 'unsupported') {
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: rpc.id,
            error: { code: -32601, message: 'Method not found' },
          })
          return
        }
        if (mode === 'doesNotDecide') {
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: rpc.id,
            result: { doesNotDecide: true },
          })
          return
        }
        if (mode === 'deny') {
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              behavior: 'deny',
              message: 'Blocked <script>path</script>',
              decisionReason: { type: 'other', reason: 'policy deny' },
            },
          })
          return
        }
        if (mode === 'allow') {
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              behavior: 'allow',
              updatedInput: { file_path: '/safe/rewritten.txt', content: 'ok' },
            },
          })
          return
        }
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            behavior: 'ask',
            message: 'Confirm write to production file',
          },
        })
        return
      }
      sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: {} })
    })

    const session = makeDisklessSession()
    const bridge = createHttpRemoteNativeToolBridge({
      url: worker.url,
      enableRemotePermissionCheck: true,
    })
    const detach = bridge.attach(session)
    const ctx = resolveToolUseContext(
      createExplicitToolDeps({ session }),
      createToolCallContext({ toolUseId: 'toolu_perm_1' }),
    )

    try {
      const registeredCheck = getRemoteNativeToolCheck(session, 'Write')
      expect(registeredCheck).toBeDefined()

      mode = 'deny'
      const denyDecision = await registeredCheck!({
        tool: FileWriteTool,
        input: { file_path: '/etc/passwd', content: 'x' },
        context: ctx,
        toolUseID: 'toolu_perm_1',
        evaluateHere: async () => ({ behavior: 'allow' }),
      })
      expect(denyDecision).toMatchObject({
        behavior: 'deny',
        message: 'Blocked &lt;script&gt;path&lt;/script&gt;',
      })

      mode = 'allow'
      const allowDecision = await FileWriteTool.checkPermissions(
        { file_path: '/safe/a.txt', content: 'ok' },
        ctx,
      )
      expect(allowDecision).toEqual({
        behavior: 'allow',
        updatedInput: { file_path: '/safe/rewritten.txt', content: 'ok' },
      })

      mode = 'ask'
      const askDecision = await bridge.checkPermissions('Write', {
        file_path: '/prod/app.ts',
      })
      expect(askDecision).toMatchObject({
        behavior: 'ask',
        message: 'Confirm write to production file',
      })

      mode = 'doesNotDecide'
      expect(
        await registeredCheck!({
          tool: FileWriteTool,
          input: { file_path: '/a.txt', content: 'ok' },
          context: ctx,
          toolUseID: 'toolu_perm_1',
          evaluateHere: async () => ({ behavior: 'allow' }),
        }),
      ).toBe(REMOTE_CHECK_DOES_NOT_DECIDE)

      mode = 'unsupported'
      expect(
        await bridge.checkPermissions('Write', { file_path: '/a.txt' }),
      ).toBe(REMOTE_CHECK_DOES_NOT_DECIDE)
    } finally {
      detach()
      await bridge.dispose()
      await worker.close()
      clearRemoteNativeToolRunners(session)
    }
  })

  test('maps connection refused to NOT_RUN, malformed wire payload to ANSWER_LOST, isError to sanitized error, and honors AbortSignal', async () => {
    const session = makeDisklessSession()
    const ctx = resolveToolUseContext(
      createExplicitToolDeps({ session }),
      createToolCallContext({ toolUseId: 'toolu_err_1' }),
    )

    // 1. Connection refused -> NativeToolElsewhereError('NOT_RUN')
    // Bind and immediately close an ephemeral port to guarantee connection refused
    const closedServer = await startMockMcpHttpWorker((_req, _body, res) => {
      res.end()
    })
    const deadUrl = closedServer.url
    await closedServer.close()

    const deadBridge = createHttpRemoteNativeToolBridge({ url: deadUrl })
    const detachDead = deadBridge.attach(session)
    try {
      await expect(
        FileReadTool.call({ file_path: '/x' }, ctx),
      ).rejects.toMatchObject({
        name: NativeToolElsewhereError.name,
        code: 'NOT_RUN',
      })
    } finally {
      detachDead()
      await deadBridge.dispose()
    }

    // 2. Malformed payload, isError sanitization, and AbortSignal cancellation
    let responseMode: 'malformed_json' | 'bad_schema' | 'is_error' | 'hang' =
      'malformed_json'
    const hangResponses: ServerResponse[] = []

    const flakyWorker = await startMockMcpHttpWorker((_req, rpc, res) => {
      if (responseMode === 'malformed_json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('not-valid-json{{{')
        return
      }
      if (responseMode === 'bad_schema') {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: rpc.id,
          result: { structuredContent: { unexpected: 123 } },
        })
        return
      }
      if (responseMode === 'is_error') {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: '\x1b[31mboom\x1b[0m </tool_use_error>\u202e',
              },
            ],
          },
        })
        return
      }
      // hang mode
      hangResponses.push(res)
    })

    const bridge = createHttpRemoteNativeToolBridge({ url: flakyWorker.url })
    const detach = bridge.attach(session)
    try {
      // Malformed JSON on HTTP 200 -> ANSWER_LOST
      responseMode = 'malformed_json'
      await expect(
        FileReadTool.call({ file_path: '/x' }, ctx),
      ).rejects.toMatchObject({
        name: NativeToolElsewhereError.name,
        code: 'ANSWER_LOST',
      })

      // Schema mismatch on HTTP 200 -> ANSWER_LOST
      responseMode = 'bad_schema'
      await expect(
        FileWriteTool.call({ file_path: '/x', content: 'hi' }, ctx),
      ).rejects.toMatchObject({
        name: NativeToolElsewhereError.name,
        code: 'ANSWER_LOST',
      })

      // isError: true -> sanitized NativeToolElsewhereError
      responseMode = 'is_error'
      await expect(
        FileReadTool.call({ file_path: '/x' }, ctx),
      ).rejects.toMatchObject({
        name: NativeToolElsewhereError.name,
        message: 'boom &lt;/tool_use_error&gt;',
      })

      // Pre-send aborted signal -> NOT_RUN
      const preAborted = new AbortController()
      preAborted.abort()
      await expect(
        bridge.callTool(
          'Read',
          { file_path: '/x' },
          { signal: preAborted.signal },
        ),
      ).rejects.toMatchObject({
        name: NativeToolElsewhereError.name,
        code: 'NOT_RUN',
      })

      // In-flight AbortSignal cancellation
      responseMode = 'hang'
      const inFlight = new AbortController()
      const pendingCall = bridge.callTool(
        'Read',
        { file_path: '/slow' },
        { signal: inFlight.signal },
      )
      setTimeout(() => inFlight.abort(), 30)
      let caughtErr: unknown
      try {
        await pendingCall
      } catch (err) {
        caughtErr = err
      }
      expect(isAbortError(caughtErr)).toBe(true)
    } finally {
      for (const res of hangResponses) {
        try {
          res.destroy()
        } catch {}
      }
      detach()
      await bridge.dispose()
      await flakyWorker.close()
      clearRemoteNativeToolRunners(session)
    }
  })

  test('P0-2: never marks HTTP 502/503 or post-send socket drops (ECONNRESET/UND_ERR_SOCKET) as NOT_RUN, while marking 401/403/404/405 and confirmed pre-connect errors as NOT_RUN', async () => {
    // 1. HTTP 502 & 503 MUST omit code ('NOT_RUN'), while 401/403/404/405 mark NOT_RUN
    for (const status of [502, 503]) {
      const bridge = createHttpRemoteNativeToolBridge({
        url: 'http://127.0.0.1:9999/mcp',
        fetchImpl: async () =>
          new Response('upstream proxy failure', { status }),
      })
      let err: unknown
      try {
        await bridge.callTool('Bash', { command: 'rm -rf /tmp/test' })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(NativeToolElsewhereError)
      expect((err as NativeToolElsewhereError).code).toBeUndefined()
    }

    for (const status of [401, 403, 404, 405]) {
      const bridge = createHttpRemoteNativeToolBridge({
        url: 'http://127.0.0.1:9999/mcp',
        fetchImpl: async () => new Response('pre-dispatch reject', { status }),
      })
      let err: unknown
      try {
        await bridge.callTool('Bash', { command: 'echo hi' })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(NativeToolElsewhereError)
      expect((err as NativeToolElsewhereError).code).toBe('NOT_RUN')
    }

    // 2. Post-send socket drops (ECONNRESET, UND_ERR_SOCKET, generic fetch hangup) MUST omit NOT_RUN
    const postSendErrors: Error[] = [
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('read ECONNRESET'), {
          code: 'ECONNRESET',
        }),
      }),
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('other side closed'), {
          code: 'UND_ERR_SOCKET',
        }),
      }),
      new TypeError('socket hang up'),
    ]
    for (const socketErr of postSendErrors) {
      const bridge = createHttpRemoteNativeToolBridge({
        url: 'http://127.0.0.1:9999/mcp',
        fetchImpl: async () => {
          throw socketErr
        },
      })
      let err: unknown
      try {
        await bridge.callTool('Write', { file_path: '/a', content: 'b' })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(NativeToolElsewhereError)
      expect((err as NativeToolElsewhereError).code).toBeUndefined()
    }

    // 3. Confirmed pre-connect socket errors (direct or via .cause) mark NOT_RUN
    for (const preConnectCode of [
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
    ]) {
      const preConnectErr = Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error(`connect ${preConnectCode}`), {
          code: preConnectCode,
        }),
      })
      const bridge = createHttpRemoteNativeToolBridge({
        url: 'http://127.0.0.1:9999/mcp',
        fetchImpl: async () => {
          throw preConnectErr
        },
      })
      let err: unknown
      try {
        await bridge.callTool('Read', { file_path: '/a' })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(NativeToolElsewhereError)
      expect((err as NativeToolElsewhereError).code).toBe('NOT_RUN')
    }

    // 4. Mid-flight non-Error abort rejection MUST NOT mark NOT_RUN
    const ac = new AbortController()
    const abortBridge = createHttpRemoteNativeToolBridge({
      url: 'http://127.0.0.1:9999/mcp',
      fetchImpl: async () => {
        ac.abort('cancelled mid-flight')
        throw 'cancelled mid-flight'
      },
    })
    let abortErr: unknown
    try {
      await abortBridge.callTool(
        'Read',
        { file_path: '/a' },
        { signal: ac.signal },
      )
    } catch (e) {
      abortErr = e
    }
    expect(abortErr).toBeInstanceOf(NativeToolElsewhereError)
    expect((abortErr as NativeToolElsewhereError).code).toBeUndefined()
  })

  test('P1-5: checkPermissions fails closed on timeout, body read error, and non-2xx outside {404,405,501}; handles passthrough cleanly', async () => {
    // 1. Timeout fails closed as deny (never throws)
    const timeoutBridge = createHttpRemoteNativeToolBridge({
      url: 'http://127.0.0.1:9999/mcp',
      defaultTimeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const abortErr = new Error('The operation was aborted')
              abortErr.name = 'AbortError'
              reject(abortErr)
            },
            { once: true },
          )
        }),
    })
    const timedOutDecision = await timeoutBridge.checkPermissions('Write', {
      file_path: '/a',
    })
    expect(timedOutDecision).toMatchObject({
      behavior: 'deny',
      decisionReason: {
        type: 'other',
        reason: 'remote permission check timed out',
      },
    })

    // 2. response.text() throwing fails closed as deny
    const badBodyBridge = createHttpRemoteNativeToolBridge({
      url: 'http://127.0.0.1:9999/mcp',
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          text: async () => {
            throw new Error('stream reset during read')
          },
        }) as unknown as Response,
    })
    const bodyErrDecision = await badBodyBridge.checkPermissions('Write', {
      file_path: '/a',
    })
    expect(bodyErrDecision).toMatchObject({
      behavior: 'deny',
      decisionReason: {
        type: 'other',
        reason: 'remote permission check read failed',
      },
    })

    // 3. Non-2xx outside {404, 405, 501} MUST fail closed even if body contains behavior: 'allow'
    for (const status of [401, 403, 500, 502]) {
      const errStatusBridge = createHttpRemoteNativeToolBridge({
        url: 'http://127.0.0.1:9999/mcp',
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: { behavior: 'allow', updatedInput: { file_path: '/a' } },
            }),
            { status, headers: { 'Content-Type': 'application/json' } },
          ),
      })
      const decision = await errStatusBridge.checkPermissions('Write', {
        file_path: '/a',
      })
      expect(decision).toMatchObject({
        behavior: 'deny',
        decisionReason: {
          type: 'other',
          reason: `remote permission check HTTP ${status}`,
        },
      })
    }

    // 4. 404/405/501 still defer via REMOTE_CHECK_DOES_NOT_DECIDE
    for (const status of [404, 405, 501]) {
      const unsupportedBridge = createHttpRemoteNativeToolBridge({
        url: 'http://127.0.0.1:9999/mcp',
        fetchImpl: async () => new Response('', { status }),
      })
      expect(
        await unsupportedBridge.checkPermissions('Write', { file_path: '/a' }),
      ).toBe(REMOTE_CHECK_DOES_NOT_DECIDE)
    }

    // 5. behavior: 'passthrough' is preserved by checkPermissions and converted to REMOTE_CHECK_DOES_NOT_DECIDE by registeredCheck
    const session = makeDisklessSession()
    const passthroughBridge = createHttpRemoteNativeToolBridge({
      url: 'http://127.0.0.1:9999/mcp',
      enableRemotePermissionCheck: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              behavior: 'passthrough',
              message: 'Defer <tag>to local</tag>',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    })
    const detach = passthroughBridge.attach(session)
    const ctx = resolveToolUseContext(
      createExplicitToolDeps({ session }),
      createToolCallContext({ toolUseId: 'toolu_pt_1' }),
    )
    try {
      const direct = await passthroughBridge.checkPermissions('Write', {
        file_path: '/a',
      })
      expect(direct).toEqual({
        behavior: 'passthrough',
        message: 'Defer &lt;tag&gt;to local&lt;/tag&gt;',
      })

      const registeredCheck = getRemoteNativeToolCheck(session, 'Write')
      expect(registeredCheck).toBeDefined()
      const checkResult = await registeredCheck!({
        tool: FileWriteTool,
        input: { file_path: '/a', content: 'x' },
        context: ctx,
        toolUseID: 'toolu_pt_1',
        evaluateHere: async () => ({ behavior: 'allow' }),
      })
      expect(checkResult).toBe(REMOTE_CHECK_DOES_NOT_DECIDE)
    } finally {
      detach()
      await passthroughBridge.dispose()
      clearRemoteNativeToolRunners(session)
    }
  })
})

describe('spawnRemoteNativeToolWorker (Real Child OS Process)', () => {
  test('P1-5: fails fast without 7s hang when spawning a nonexistent binary (ENOENT)', async () => {
    const start = Date.now()
    await expect(
      spawnRemoteNativeToolWorker({
        command: '/definitely-nonexistent-binary-path-331',
        args: [],
        shutdownGraceMs: 5_000,
        startupTimeoutMs: 5_000,
      }),
    ).rejects.toThrow(/failed to spawn/)
    const elapsedMs = Date.now() - start
    expect(elapsedMs).toBeLessThan(1_500)
  })
  test('spawns a real child HTTP worker, parses banner URL & token, dispatches tools/call across OS processes, and kills child PID on dispose()', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'remote-native-bridge-worker-'))
    const workerScript = join(tmpDir, 'mock-mcp-http-worker.mjs')
    writeFileSync(
      workerScript,
      `
import { createServer } from 'node:http'

const TOKEN = 'child-token-331-xyz'

const server = createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (req.headers.authorization !== 'Bearer ' + TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: 'Unauthorized' } }))
    return
  }
  if (rpc.method === 'tools/call' && rpc.params?.name === 'Read') {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: rpc.id,
      result: {
        structuredContent: {
          type: 'text',
          file: {
            filePath: rpc.params.arguments.file_path,
            content: 'served-by-pid:' + process.pid,
            numLines: 1,
            startLine: 1,
            totalLines: 1,
          },
        },
      },
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Unknown method' } }))
})

server.listen(0, '127.0.0.1', () => {
  const addr = server.address()
  console.log('MCP server auth token: ' + TOKEN)
  console.log('MCP server listening on http://127.0.0.1:' + addr.port + '/mcp')
})
`,
      'utf8',
    )

    const session = makeDisklessSession()
    const ctx = resolveToolUseContext(
      createExplicitToolDeps({ session }),
      createToolCallContext({ toolUseId: 'toolu_spawn_1' }),
    )

    const spawned = await spawnRemoteNativeToolWorker({
      command: process.execPath,
      args: [workerScript],
      cwd: tmpDir,
      startupTimeoutMs: 10_000,
    })

    const childPid = spawned.pid
    try {
      expect(childPid).toBeGreaterThan(0)
      expect(childPid).not.toBe(process.pid)
      expect(spawned.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
      expect(spawned.authToken).toBe('child-token-331-xyz')

      spawned.attach(session)

      const readRes = await FileReadTool.call(
        { file_path: '/remote/from-child.txt' },
        ctx,
      )
      expect(readRes.data.type).toBe('text')
      if (readRes.data.type === 'text') {
        expect(readRes.data.file.content).toBe(`served-by-pid:${childPid}`)
      }
    } finally {
      await spawned.dispose()
      // Dispose is idempotent
      await spawned.dispose()
      clearRemoteNativeToolRunners(session)
      rmSync(tmpDir, { recursive: true, force: true })
    }

    // Verify child OS process has exited
    let alive = true
    try {
      process.kill(childPid, 0)
    } catch {
      alive = false
    }
    expect(alive).toBe(false)

    // Verify session was detached by dispose()
    await expect(
      FileReadTool.call({ file_path: '/remote/from-child.txt' }, ctx),
    ).rejects.toThrow(NeverRunsInThisProcessError)
  }, 20_000)
})

describe('remoteToolsTransport (Official 2.1.331 chunks #332 & #2194)', () => {
  const savedEnv: Record<string, string | undefined> = {}
  const envKeys = [
    'CLAUDE_CODE_REMOTE_TOOLS_FORWARD',
    'CLAUDE_CODE_REMOTE_TOOLS_DESKTOP_APP_HOST',
    'CLAUDE_CODE_REMOTE_TOOLS_PIN_STORED_LOGIN',
    'CLAUDE_REMOTE_TOOLS_BRIDGE_URL',
  ]

  for (const key of envKeys) {
    savedEnv[key] = process.env[key]
  }

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    setDesktopAppHostOverride(undefined)
    setDesktopAppTakenAway(false)
    setTakesMachinesMcpToolsAlone(false)
    setRemoteToolsPinStoredLoginOverride(undefined)
  })

  test('validateBridgeWebSocketUrl enforces wss:, rejects userinfo & non-loopback ws:, allows loopback ws: when opted in', () => {
    expect(
      validateBridgeWebSocketUrl('wss://bridge.claudeusercontent.com'),
    ).toBe('wss://bridge.claudeusercontent.com')
    expect(
      validateBridgeWebSocketUrl('wss://bridge.claudeusercontent.com/v1/ws'),
    ).toBe('wss://bridge.claudeusercontent.com/v1/ws')
    expect(validateBridgeWebSocketUrl('ws://evil.com')).toBeUndefined()
    expect(
      validateBridgeWebSocketUrl('ws://evil.com', { allowLoopbackWs: true }),
    ).toBeUndefined()
    expect(
      validateBridgeWebSocketUrl(
        'wss://user:pass@bridge.claudeusercontent.com',
      ),
    ).toBeUndefined()
    expect(
      validateBridgeWebSocketUrl('wss://user@bridge.claudeusercontent.com'),
    ).toBeUndefined()
    expect(
      validateBridgeWebSocketUrl('https://bridge.claudeusercontent.com'),
    ).toBeUndefined()
    expect(validateBridgeWebSocketUrl('ws://127.0.0.1:8080')).toBeUndefined()
    expect(
      validateBridgeWebSocketUrl('ws://127.0.0.1:8080', {
        allowLoopbackWs: true,
      }),
    ).toBe('ws://127.0.0.1:8080')
    expect(
      validateBridgeWebSocketUrl('ws://localhost:8080/bridge', {
        allowLoopbackWs: true,
      }),
    ).toBe('ws://localhost:8080/bridge')
    expect(
      validateBridgeWebSocketUrl('ws://[::1]:8080', { allowLoopbackWs: true }),
    ).toBe('ws://[::1]:8080')
  })

  test('resolveRemoteToolsBridgeUrl & resolveRemoteToolsTransportMode match chunk #2194', () => {
    expect(resolveRemoteToolsBridgeUrl({ env: {} })).toBe(
      REMOTE_TOOLS_BRIDGE_PROD_URL,
    )
    expect(
      resolveRemoteToolsBridgeUrl({ env: {}, oauthSuffix: '-staging-oauth' }),
    ).toBe(REMOTE_TOOLS_BRIDGE_STAGING_URL)
    expect(
      resolveRemoteToolsBridgeUrl({
        env: { CLAUDE_REMOTE_TOOLS_BRIDGE_URL: 'wss://custom.example.com/ws' },
      }),
    ).toBe('wss://custom.example.com/ws')
    expect(
      resolveRemoteToolsBridgeUrl({
        env: { CLAUDE_REMOTE_TOOLS_BRIDGE_URL: 'ws://evil.example.com' },
      }),
    ).toBeUndefined()

    expect(resolveRemoteToolsTransportMode()).toBe('auto')
    expect(resolveRemoteToolsTransportMode({ bridgeFlagOn: true })).toBe(
      'bridge',
    )
    expect(
      resolveRemoteToolsTransportMode({
        requested: 'auto',
        bridgeFlagOn: true,
      }),
    ).toBe('auto')
    expect(
      resolveRemoteToolsTransportMode({
        requested: 'bridge',
        bridgeFlagOn: false,
      }),
    ).toBe('bridge')
  })

  test('chunk #332 predicates isolate per-SessionHost via HostSlot and wire cleanly into remoteToolHost.ts', () => {
    process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
    delete process.env.CLAUDE_CODE_REMOTE_TOOLS_DESKTOP_APP_HOST
    delete process.env.CLAUDE_CODE_REMOTE_TOOLS_PIN_STORED_LOGIN

    const hostA = createSessionHost()
    const hostB = createSessionHost()

    expect(isDesktopAppHostingTenant(hostA)).toBe(false)
    expect(isDesktopAppTakenAway(hostA)).toBe(false)
    expect(takesMachinesMcpToolsAlone(hostA)).toBe(false)
    expect(isRemoteToolsPinStoredLogin(hostA)).toBe(false)
    expect(canForwardToAttachedMachines(hostA)).toBe(true)

    // Mutate hostA only — hostB must stay completely unaffected
    setDesktopAppHostOverride(true, hostA)
    setDesktopAppTakenAway(true, hostA)
    setTakesMachinesMcpToolsAlone(true, hostA)
    setRemoteToolsPinStoredLoginOverride(true, hostA)

    expect(isDesktopAppHostingTenant(hostA)).toBe(true)
    expect(isDesktopAppTakenAway(hostA)).toBe(true)
    expect(takesMachinesMcpToolsAlone(hostA)).toBe(true)
    expect(isRemoteToolsPinStoredLogin(hostA)).toBe(true)
    expect(canForwardToAttachedMachines(hostA)).toBe(false)

    expect(isDesktopAppHostingTenant(hostB)).toBe(false)
    expect(isDesktopAppTakenAway(hostB)).toBe(false)
    expect(takesMachinesMcpToolsAlone(hostB)).toBe(false)
    expect(isRemoteToolsPinStoredLogin(hostB)).toBe(false)
    expect(canForwardToAttachedMachines(hostB)).toBe(true)

    // Verify remoteToolHost.ts integration on isolated host session
    runWithNewHostSession({}, () => {
      expect(isRemoteToolsForwardEnabled()).toBe(true)
      expect(remoteHostSchemaProperty()?._host.type).toBe('string')

      setDesktopAppHostOverride(true)
      expect(isRemoteToolsForwardEnabled()).toBe(false)
      expect(remoteHostSchemaProperty()).toBeUndefined()

      setDesktopAppHostOverride(undefined)
      expect(isRemoteToolsForwardEnabled()).toBe(true)

      setTakesMachinesMcpToolsAlone(true)
      expect(isRemoteToolsForwardEnabled()).toBe(false)
      expect(remoteHostSchemaProperty()).toBeUndefined()

      setTakesMachinesMcpToolsAlone(false)
      setDesktopAppTakenAway(true)
      expect(remoteHostSchemaProperty()).toBeUndefined()
    })
  })

  test('RemoteToolsBridgeClient handles frame send/receive, token update + deadline symbol, MAX_FRAME_BYTES, slot contention, and idempotent dispose', () => {
    const sockets: MockWebSocket[] = []

    class MockWebSocket implements BridgeWebSocketLike {
      readyState = 0
      readonly sent: Array<string | Uint8Array | ArrayBuffer> = []
      closedWith: { code?: number; reason?: string } | undefined
      #listeners = new Map<string, Set<(event: unknown) => void>>()

      constructor(public readonly url: string) {
        sockets.push(this)
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let set = this.#listeners.get(type)
        if (!set) {
          set = new Set()
          this.#listeners.set(type, set)
        }
        set.add(listener)
      }

      removeEventListener(
        type: string,
        listener: (event: unknown) => void,
      ): void {
        this.#listeners.get(type)?.delete(listener)
      }

      send(data: string | Uint8Array | ArrayBuffer): void {
        this.sent.push(data)
      }

      close(code?: number, reason?: string): void {
        this.readyState = 3
        this.closedWith = { code, reason }
        this.emit('close', { code, reason })
      }

      emit(type: string, event: unknown): void {
        for (const fn of [...(this.#listeners.get(type) ?? [])]) {
          fn(event)
        }
      }

      openNow(): void {
        this.readyState = 1
        this.emit('open', {})
      }
    }

    const receivedFrames: unknown[] = []
    const closeInfos: Array<{
      code?: number
      reason?: string
      willReconnect: boolean
    }> = []
    let openCount = 0

    expect(REMOTE_TOOLS_BRIDGE_MAX_FRAME_BYTES).toBe(33_554_432)

    expect(
      () =>
        new RemoteToolsBridgeClient({
          url: 'ws://evil.example.com',
          WebSocketCtor: MockWebSocket,
        }),
    ).toThrow()

    const initialDeadline = Date.now() + 300_000
    const client = new RemoteToolsBridgeClient({
      url: 'wss://bridge.claudeusercontent.com',
      token: 'tok-initial',
      tokenDeadlineMs: initialDeadline,
      maxFrameBytes: 256,
      keepaliveIntervalMs: 0,
      maxConsecutiveSlotContention: 2,
      initialReconnectDelayMs: 60_000,
      WebSocketCtor: MockWebSocket,
      onOpen: () => {
        openCount += 1
      },
      onFrame: frame => {
        receivedFrames.push(frame)
      },
      onClose: info => {
        closeInfos.push(info)
      },
    })

    expect(client.state).toBe('idle')
    expect(client[DEVICE_BRIDGE_TOKEN_DEADLINE_SYMBOL]).toBe(initialDeadline)
    // Sending before open returns false
    expect(client.sendFrame({ hello: 'not-open-yet' })).toBe(false)

    client.start()
    expect(client.state).toBe('connecting')
    expect(sockets).toHaveLength(1)

    const ws1 = sockets[0]!
    ws1.openNow()
    expect(client.state).toBe('open')
    expect(openCount).toBe(1)

    // P1-6: initial auth frame sent immediately on open when token is set
    expect(JSON.parse(String(ws1.sent[0]))).toEqual({
      type: 'auth',
      token: 'tok-initial',
    })

    // Send & receive frames
    expect(client.sendFrame({ type: 'tool_result', ok: true })).toBe(true)
    expect(JSON.parse(String(ws1.sent[1]))).toEqual({
      type: 'tool_result',
      ok: true,
    })

    ws1.emit('message', { data: JSON.stringify({ type: 'tool_call', id: 7 }) })
    expect(receivedFrames).toEqual([{ type: 'tool_call', id: 7 }])

    // Inbound ping auto-responds with pong without invoking onFrame
    ws1.emit('message', { data: JSON.stringify({ type: 'ping' }) })
    expect(receivedFrames).toHaveLength(1)
    expect(JSON.parse(String(ws1.sent[2]))).toMatchObject({ type: 'pong' })

    // Token update updates deadline symbol and notifies bridge
    const newDeadline = Date.now() + 600_000
    client.updateToken('tok-refreshed', newDeadline)
    expect(client.token).toBe('tok-refreshed')
    expect(client[DEVICE_BRIDGE_TOKEN_DEADLINE_SYMBOL]).toBe(newDeadline)
    expect(JSON.parse(String(ws1.sent[3]))).toEqual({
      type: 'token_update',
      token: 'tok-refreshed',
      deadlineMs: newDeadline,
    })

    // MAX_FRAME_BYTES enforcement
    expect(() => client.sendFrame({ oversized: 'x'.repeat(300) })).toThrow(
      /exceeds max size/,
    )

    // Slot contention tracking on close
    ws1.close(4009, 'slot contested')
    expect(client.consecutiveSlotContention).toBe(1)
    expect(closeInfos[0]).toEqual({
      code: 4009,
      reason: 'slot contested',
      willReconnect: true,
    })
    expect(client.state).toBe('reconnecting')

    // Idempotent dispose()
    client.dispose()
    client.dispose()
    expect(client.state).toBe('disposed')
    expect(client.sendFrame({ afterDispose: true })).toBe(false)
  })

  test('P1-6: isDesktopAppHostingTenant unifies launchOptions.desktopAppHostsTenant(), env, and explicit false override', () => {
    delete process.env.CLAUDE_CODE_REMOTE_TOOLS_DESKTOP_APP_HOST
    const embedded = createEmbeddedHost({ desktopAppHostsTenant: true })
    try {
      expect(isDesktopAppHostingTenant(embedded.host)).toBe(true)

      // Explicit false override takes precedence over launchOptions.desktopAppHostsTenant()
      setDesktopAppHostOverride(false, embedded.host)
      expect(isDesktopAppHostingTenant(embedded.host)).toBe(false)

      // Explicit false override also takes precedence over env var
      process.env.CLAUDE_CODE_REMOTE_TOOLS_DESKTOP_APP_HOST = '1'
      expect(isDesktopAppHostingTenant(embedded.host)).toBe(false)

      // Clearing override restores env + launchOptions evaluation
      setDesktopAppHostOverride(undefined, embedded.host)
      expect(isDesktopAppHostingTenant(embedded.host)).toBe(true)
    } finally {
      embedded.dispose()
    }
  })

  test('P1-6 & P2-4: expired token blocks WebSocket connect; oversized Uint8Array/ArrayBuffer/Blob rejected before TextDecoder/body decode', async () => {
    const sockets: Array<{
      emit: (type: string, event: unknown) => void
      openNow: () => void
    }> = []

    class TrackingWebSocket implements BridgeWebSocketLike {
      readyState = 0
      #listeners = new Map<string, Set<(event: unknown) => void>>()

      constructor(_url: string) {
        sockets.push(this)
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let set = this.#listeners.get(type)
        if (!set) {
          set = new Set()
          this.#listeners.set(type, set)
        }
        set.add(listener)
      }

      removeEventListener(
        type: string,
        listener: (event: unknown) => void,
      ): void {
        this.#listeners.get(type)?.delete(listener)
      }

      send(_data: string | Uint8Array | ArrayBuffer): void {}

      close(_code?: number, _reason?: string): void {
        this.readyState = 3
      }

      emit(type: string, event: unknown): void {
        for (const fn of [...(this.#listeners.get(type) ?? [])]) {
          fn(event)
        }
      }

      openNow(): void {
        this.readyState = 1
        this.emit('open', {})
      }
    }

    // 1. Expired token blocks #connect() and invokes onTokenExpired without constructing WebSocket
    let expiredCalls = 0
    const expiredClient = new RemoteToolsBridgeClient({
      url: 'wss://bridge.claudeusercontent.com',
      token: 'tok-expired',
      tokenDeadlineMs: Date.now() - 1_000,
      WebSocketCtor: TrackingWebSocket,
      onTokenExpired: () => {
        expiredCalls += 1
      },
    })
    expiredClient.start()
    expect(expiredCalls).toBe(1)
    expect(sockets).toHaveLength(0)
    expect(expiredClient.state).toBe('idle')
    expiredClient.dispose()

    // 2. Oversized Uint8Array / ArrayBuffer / Blob rejected BEFORE decoding
    const errors: Error[] = []
    const frames: unknown[] = []
    const client = new RemoteToolsBridgeClient({
      url: 'wss://bridge.claudeusercontent.com',
      maxFrameBytes: 64,
      keepaliveIntervalMs: 0,
      WebSocketCtor: TrackingWebSocket,
      onError: err => errors.push(err),
      onFrame: frame => frames.push(frame),
    })
    client.start()
    expect(sockets).toHaveLength(1)
    sockets[0]!.openNow()

    const decodeSpy = spyOn(TextDecoder.prototype, 'decode')
    try {
      const bigBytes = new Uint8Array(128).fill(65)
      sockets[0]!.emit('message', { data: bigBytes })
      sockets[0]!.emit('message', { data: bigBytes.buffer })
      const bigBlob = new Blob([bigBytes])
      sockets[0]!.emit('message', { data: bigBlob })

      expect(decodeSpy).not.toHaveBeenCalled()
      expect(errors).toHaveLength(3)
      for (const e of errors) {
        expect(e.message).toMatch(/oversized bridge frame/i)
      }

      // Valid-sized Uint8Array and Blob decode cleanly
      const smallBytes = new TextEncoder().encode(JSON.stringify({ ok: 1 }))
      sockets[0]!.emit('message', { data: smallBytes })
      const smallBlob = new Blob([JSON.stringify({ ok: 2 })])
      sockets[0]!.emit('message', { data: smallBlob })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(frames).toEqual([{ ok: 1 }, { ok: 2 }])
    } finally {
      decodeSpy.mockRestore()
      client.dispose()
    }
  })
})
