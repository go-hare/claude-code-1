/**
 * Official 2.1.331 Built-in Cross-Process Native-Tool Bridge:
 * Wires `registerRemoteNativeToolRunner` in production to live remote MCP HTTP
 * tool workers (including spawned child OS worker processes) with zero ALS
 * assumptions and full Bun + Node dual-runtime compatibility.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type {
  PermissionDecisionReason,
  PermissionResult,
} from '../../types/permissions.js'
import { isAbortError } from '../../utils/errors.js'
import {
  LOCAL_ONLY_NATIVE_TOOL_NAMES,
  NativeToolElsewhereError,
  REMOTE_CHECK_DOES_NOT_DECIDE,
  type RemoteNativeToolCheck,
  type RemoteNativeToolResult,
  type RemoteNativeToolRunner,
  type RemoteNativeToolSession,
  registerRemoteNativeToolRunner,
  sanitizeRemoteWireText,
} from '../../utils/toolCreateRuntime.js'

export type RemoteNativeToolRunnerResult = RemoteNativeToolResult

export type RemoteNativeToolBridgeCallOptions = {
  signal?: AbortSignal
  toolUseId?: string
  agentId?: string
}

export type RemoteNativeToolBridgeCheckOptions = {
  signal?: AbortSignal
  toolUseId?: string
}

export type RemoteNativeToolBridgeHandle = {
  readonly url: string
  readonly toolNames: readonly string[]
  attach(session: RemoteNativeToolSession): () => void
  callTool(
    toolName: string,
    input: Record<string, unknown>,
    opts?: RemoteNativeToolBridgeCallOptions,
  ): Promise<RemoteNativeToolRunnerResult>
  checkPermissions(
    toolName: string,
    input: Record<string, unknown>,
    opts?: RemoteNativeToolBridgeCheckOptions,
  ): Promise<PermissionResult | typeof REMOTE_CHECK_DOES_NOT_DECIDE>
  dispose(): Promise<void>
}

export type RemoteNativeToolFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type HttpRemoteNativeToolBridgeOptions = {
  url: string
  authToken?: string
  toolNames?: readonly string[]
  defaultTimeoutMs?: number
  enableRemotePermissionCheck?: boolean
  headers?: Record<string, string>
  fetchImpl?: RemoteNativeToolFetchImpl
}

export type SpawnRemoteNativeToolWorkerOptions = {
  cwd?: string
  port?: number
  runtimeBin?: string
  runtimeArgs?: readonly string[]
  cliPath?: string
  command?: string
  args?: readonly string[]
  env?: NodeJS.ProcessEnv
  startupTimeoutMs?: number
  shutdownGraceMs?: number
  toolNames?: readonly string[]
  defaultTimeoutMs?: number
  enableRemotePermissionCheck?: boolean
  headers?: Record<string, string>
  fetchImpl?: RemoteNativeToolFetchImpl
}

export type SpawnedRemoteNativeToolWorker = {
  readonly pid: number
  readonly url: string
  readonly authToken: string
  readonly bridge: RemoteNativeToolBridgeHandle
  attach(session: RemoteNativeToolSession): () => void
  dispose(): Promise<void>
}

const JSONRPC_INVALID_REQUEST = -32600
const JSONRPC_METHOD_NOT_FOUND = -32601
const JSONRPC_INVALID_PARAMS = -32602

const PRE_EXECUTION_HTTP_STATUSES = new Set([401, 403, 404, 405])
const UNSUPPORTED_CHECK_HTTP_STATUSES = new Set([404, 405, 501])
const PRE_CONNECT_SOCKET_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  // Bun's native fetch uses 'ConnectionRefused' for TCP connect refusal
  'ConnectionRefused',
])

const LISTENING_URL_RE = /MCP server listening on\s+(https?:\/\/\S+)/i
const AUTH_TOKEN_RE = /MCP server auth token:\s*(\S+)/i

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return typeof err === 'string' ? err : String(err)
}

function isPreConnectSocketError(err: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = err
  for (
    let depth = 0;
    depth < 8 && current !== null && current !== undefined;
    depth++
  ) {
    if (seen.has(current)) {
      break
    }
    seen.add(current)
    if (typeof current !== 'object') {
      break
    }
    const record = current as { code?: unknown; cause?: unknown }
    if (
      typeof record.code === 'string' &&
      PRE_CONNECT_SOCKET_ERROR_CODES.has(record.code)
    ) {
      return true
    }
    current = record.cause
  }
  return false
}

function isPreExecutionJsonRpcCode(code: unknown): boolean {
  return (
    code === JSONRPC_INVALID_REQUEST ||
    code === JSONRPC_METHOD_NOT_FOUND ||
    code === JSONRPC_INVALID_PARAMS
  )
}

function extractMcpTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  const parts: string[] = []
  for (const block of content) {
    if (
      isPlainRecord(block) &&
      block.type === 'text' &&
      typeof block.text === 'string'
    ) {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

function parseDecisionReason(
  raw: unknown,
): PermissionDecisionReason | undefined {
  if (!isPlainRecord(raw) || typeof raw.type !== 'string') {
    return undefined
  }
  if (raw.type === 'other' && typeof raw.reason === 'string') {
    return {
      type: 'other',
      reason: sanitizeRemoteWireText(raw.reason),
    }
  }
  if (raw.type === 'workingDir' && typeof raw.reason === 'string') {
    return {
      type: 'workingDir',
      reason: sanitizeRemoteWireText(raw.reason),
    }
  }
  if (
    raw.type === 'safetyCheck' &&
    typeof raw.reason === 'string' &&
    typeof raw.classifierApprovable === 'boolean'
  ) {
    return {
      type: 'safetyCheck',
      reason: sanitizeRemoteWireText(raw.reason),
      classifierApprovable: raw.classifierApprovable,
    }
  }
  if (raw.type === 'hook' && typeof raw.hookName === 'string') {
    return {
      type: 'hook',
      hookName: sanitizeRemoteWireText(raw.hookName),
      ...(typeof raw.hookSource === 'string'
        ? { hookSource: sanitizeRemoteWireText(raw.hookSource) }
        : {}),
      ...(typeof raw.reason === 'string'
        ? { reason: sanitizeRemoteWireText(raw.reason) }
        : {}),
    }
  }
  return undefined
}

function validateRemotePermissionResult(
  toolName: string,
  input: Record<string, unknown>,
  raw: unknown,
): PermissionResult | typeof REMOTE_CHECK_DOES_NOT_DECIDE {
  if (!isPlainRecord(raw)) {
    return {
      behavior: 'deny',
      message: `${toolName} was not run: remote permission check returned an unreadable result.`,
      decisionReason: {
        type: 'other',
        reason: 'invalid remote permission result',
      },
    }
  }
  if (raw.doesNotDecide === true) {
    return REMOTE_CHECK_DOES_NOT_DECIDE
  }
  const behavior = raw.behavior
  const parsedReason = parseDecisionReason(raw.decisionReason)

  if (behavior === 'passthrough') {
    const message = sanitizeRemoteWireText(
      typeof raw.message === 'string' && raw.message.trim().length > 0
        ? raw.message
        : `${toolName} permission check deferred by remote worker.`,
    )
    return {
      behavior: 'passthrough',
      message,
      ...(parsedReason !== undefined ? { decisionReason: parsedReason } : {}),
      ...(typeof raw.blockedPath === 'string'
        ? { blockedPath: sanitizeRemoteWireText(raw.blockedPath) }
        : {}),
    }
  }
  if (behavior === 'allow') {
    return {
      behavior: 'allow',
      updatedInput: isPlainRecord(raw.updatedInput) ? raw.updatedInput : input,
      ...(parsedReason !== undefined ? { decisionReason: parsedReason } : {}),
    }
  }
  if (behavior === 'deny') {
    const message = sanitizeRemoteWireText(
      typeof raw.message === 'string' && raw.message.trim().length > 0
        ? raw.message
        : `${toolName} was denied by remote worker.`,
    )
    return {
      behavior: 'deny',
      message,
      decisionReason: parsedReason ?? { type: 'other', reason: message },
      ...(typeof raw.blockedPath === 'string'
        ? { blockedPath: sanitizeRemoteWireText(raw.blockedPath) }
        : {}),
    }
  }
  if (behavior === 'ask') {
    const message = sanitizeRemoteWireText(
      typeof raw.message === 'string' && raw.message.trim().length > 0
        ? raw.message
        : `${toolName} requires permission on remote worker.`,
    )
    return {
      behavior: 'ask',
      message,
      ...(isPlainRecord(raw.updatedInput)
        ? { updatedInput: raw.updatedInput }
        : {}),
      ...(parsedReason !== undefined ? { decisionReason: parsedReason } : {}),
      ...(typeof raw.blockedPath === 'string'
        ? { blockedPath: sanitizeRemoteWireText(raw.blockedPath) }
        : {}),
    }
  }
  return {
    behavior: 'deny',
    message: `${toolName} was not run: remote permission check returned an unsupported decision.`,
    decisionReason: {
      type: 'other',
      reason: 'unsupported remote permission decision',
    },
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  ) {
    timer.unref()
  }
}

function createRequestSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): {
  signal: AbortSignal
  didTimeout: () => boolean
  cleanup: () => void
} {
  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason)
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }

  if (timeoutMs !== undefined && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('Remote native tool request timed out'))
    }, timeoutMs)
    unrefTimer(timeoutId)
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      externalSignal?.removeEventListener('abort', onExternalAbort)
    },
  }
}

/**
 * Create a production HTTP JSON-RPC 2.0 bridge to a remote MCP tool worker and
 * wire it onto sessions via `registerRemoteNativeToolRunner`.
 */
export function createHttpRemoteNativeToolBridge(
  options: HttpRemoteNativeToolBridgeOptions,
): RemoteNativeToolBridgeHandle {
  const url = options.url
  const authToken = options.authToken
  const toolNames: readonly string[] = Object.freeze([
    ...(options.toolNames ?? LOCAL_ONLY_NATIVE_TOOL_NAMES),
  ])
  const defaultTimeoutMs = options.defaultTimeoutMs
  const enableRemotePermissionCheck =
    options.enableRemotePermissionCheck ?? false
  const fetchFn = options.fetchImpl ?? globalThis.fetch

  let nextRequestId = 1
  let disposed = false
  const activeDetachers = new Set<() => void>()

  function buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(authToken !== undefined && authToken !== ''
        ? { Authorization: `Bearer ${authToken}` }
        : {}),
      ...(options.headers ?? {}),
    }
  }

  async function callTool(
    toolName: string,
    input: Record<string, unknown>,
    opts?: RemoteNativeToolBridgeCallOptions,
  ): Promise<RemoteNativeToolRunnerResult> {
    if (disposed) {
      throw new NativeToolElsewhereError(
        `${toolName} was not run: remote native-tool bridge has been disposed.`,
        'NOT_RUN',
      )
    }
    if (opts?.signal?.aborted) {
      throw new NativeToolElsewhereError(
        `${toolName} was not run: request was aborted before dispatch.`,
        'NOT_RUN',
      )
    }

    const id = nextRequestId++
    const meta: Record<string, unknown> = {}
    if (opts?.toolUseId !== undefined) {
      meta['claudecode/toolUseId'] = opts.toolUseId
    }
    if (opts?.agentId !== undefined) {
      meta['claudecode/agentId'] = opts.agentId
    }
    if (toolName === 'Edit') {
      meta['claudecode/editResult'] = '1'
    }

    const requestBody = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: input,
        ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
      },
    })

    const reqSignal = createRequestSignal(opts?.signal, defaultTimeoutMs)
    let response: Response
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: requestBody,
        signal: reqSignal.signal,
      })
    } catch (err) {
      reqSignal.cleanup()
      if (reqSignal.didTimeout()) {
        throw new NativeToolElsewhereError(
          `${toolName} timed out waiting for remote worker response.`,
        )
      }
      if (opts?.signal?.aborted || isAbortError(err)) {
        throw err instanceof Error
          ? err
          : new NativeToolElsewhereError(`${toolName} was aborted.`)
      }
      const code = isPreConnectSocketError(err) ? 'NOT_RUN' : undefined
      throw new NativeToolElsewhereError(
        sanitizeRemoteWireText(
          `${toolName} could not reach remote worker: ${extractErrorMessage(err)}`,
        ),
        code,
      )
    }

    let rawText: string
    try {
      rawText = await response.text()
    } catch (err) {
      if (reqSignal.didTimeout()) {
        throw new NativeToolElsewhereError(
          `${toolName} timed out reading remote worker response.`,
        )
      }
      if (opts?.signal?.aborted || isAbortError(err)) {
        throw err instanceof Error
          ? err
          : new NativeToolElsewhereError(`${toolName} was aborted.`)
      }
      // Post-send unreadable response body -> let dispatchRemoteNativeToolCall
      // fail output schema validation and raise ANSWER_LOST.
      return { output: undefined }
    } finally {
      reqSignal.cleanup()
    }

    let parsedBody: unknown
    let bodyIsJson = false
    if (rawText.trim().length > 0) {
      try {
        parsedBody = JSON.parse(rawText)
        bodyIsJson = true
      } catch {
        bodyIsJson = false
      }
    }

    if (!response.ok) {
      if (
        bodyIsJson &&
        isPlainRecord(parsedBody) &&
        isPlainRecord(parsedBody.error)
      ) {
        const rpcErr = parsedBody.error
        const msg =
          typeof rpcErr.message === 'string' && rpcErr.message.length > 0
            ? rpcErr.message
            : `Remote worker HTTP ${response.status}`
        const code =
          isPreExecutionJsonRpcCode(rpcErr.code) ||
          PRE_EXECUTION_HTTP_STATUSES.has(response.status)
            ? 'NOT_RUN'
            : undefined
        throw new NativeToolElsewhereError(sanitizeRemoteWireText(msg), code)
      }
      const detail = rawText.trim() || response.statusText || 'request failed'
      const code = PRE_EXECUTION_HTTP_STATUSES.has(response.status)
        ? 'NOT_RUN'
        : undefined
      throw new NativeToolElsewhereError(
        sanitizeRemoteWireText(
          `${toolName} remote worker HTTP ${response.status}: ${detail}`,
        ),
        code,
      )
    }

    if (!bodyIsJson || !isPlainRecord(parsedBody)) {
      return { output: undefined }
    }

    if (isPlainRecord(parsedBody.error)) {
      const rpcErr = parsedBody.error
      const msg =
        typeof rpcErr.message === 'string' && rpcErr.message.length > 0
          ? rpcErr.message
          : `${toolName} failed with remote JSON-RPC error.`
      const code = isPreExecutionJsonRpcCode(rpcErr.code)
        ? 'NOT_RUN'
        : undefined
      throw new NativeToolElsewhereError(sanitizeRemoteWireText(msg), code)
    }

    if (!isPlainRecord(parsedBody.result)) {
      return { output: undefined }
    }

    const result = parsedBody.result
    const resultMeta = isPlainRecord(result._meta) ? result._meta : undefined
    const subagentFrameResult = resultMeta?.['claudecode/editResult']
    const textContent = extractMcpTextContent(result.content)

    if (result.isError === true) {
      throw new NativeToolElsewhereError(
        sanitizeRemoteWireText(
          textContent || `${toolName} failed on remote worker.`,
        ),
      )
    }

    let output: unknown
    if (
      'structuredContent' in result &&
      result.structuredContent !== undefined
    ) {
      output = result.structuredContent
    } else if (textContent.length > 0) {
      try {
        output = JSON.parse(textContent)
      } catch {
        output = textContent
      }
    } else {
      output = undefined
    }

    return {
      output,
      ...(subagentFrameResult !== undefined ? { subagentFrameResult } : {}),
    }
  }

  async function checkPermissions(
    toolName: string,
    input: Record<string, unknown>,
    opts?: RemoteNativeToolBridgeCheckOptions,
  ): Promise<PermissionResult | typeof REMOTE_CHECK_DOES_NOT_DECIDE> {
    if (disposed) {
      return {
        behavior: 'deny',
        message: `${toolName} was not run: remote native-tool bridge has been disposed.`,
        decisionReason: {
          type: 'other',
          reason: 'bridge disposed',
        },
      }
    }

    const id = nextRequestId++
    const requestBody = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'claudecode/checkPermissions',
      params: {
        name: toolName,
        arguments: input,
        ...(opts?.toolUseId !== undefined ? { toolUseId: opts.toolUseId } : {}),
      },
    })

    const reqSignal = createRequestSignal(opts?.signal, defaultTimeoutMs)
    let response: Response
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: requestBody,
        signal: reqSignal.signal,
      })
    } catch (err) {
      reqSignal.cleanup()
      if (reqSignal.didTimeout()) {
        return {
          behavior: 'deny',
          message: `${toolName} was not run: remote permission check timed out.`,
          decisionReason: {
            type: 'other',
            reason: 'remote permission check timed out',
          },
        }
      }
      if (opts?.signal?.aborted || isAbortError(err)) {
        throw err
      }
      return {
        behavior: 'deny',
        message: sanitizeRemoteWireText(
          `${toolName} was not run: remote permission check failed: ${extractErrorMessage(err)}`,
        ),
        decisionReason: {
          type: 'other',
          reason: 'remote permission check unreachable',
        },
      }
    }

    let rawText: string
    try {
      rawText = await response.text()
    } catch (err) {
      if (reqSignal.didTimeout()) {
        return {
          behavior: 'deny',
          message: `${toolName} was not run: remote permission check timed out reading response.`,
          decisionReason: {
            type: 'other',
            reason: 'remote permission check timed out',
          },
        }
      }
      if (opts?.signal?.aborted || isAbortError(err)) {
        throw err
      }
      return {
        behavior: 'deny',
        message: sanitizeRemoteWireText(
          `${toolName} was not run: failed reading remote permission check response: ${extractErrorMessage(err)}`,
        ),
        decisionReason: {
          type: 'other',
          reason: 'remote permission check read failed',
        },
      }
    } finally {
      reqSignal.cleanup()
    }

    if (UNSUPPORTED_CHECK_HTTP_STATUSES.has(response.status)) {
      return REMOTE_CHECK_DOES_NOT_DECIDE
    }

    if (!response.ok) {
      return {
        behavior: 'deny',
        message: sanitizeRemoteWireText(
          `${toolName} was not run: remote permission check returned HTTP ${response.status}.`,
        ),
        decisionReason: {
          type: 'other',
          reason: `remote permission check HTTP ${response.status}`,
        },
      }
    }

    let parsedBody: unknown
    try {
      parsedBody = JSON.parse(rawText)
    } catch {
      return {
        behavior: 'deny',
        message: `${toolName} was not run: remote permission check returned unreadable JSON.`,
        decisionReason: {
          type: 'other',
          reason: 'unreadable remote permission response',
        },
      }
    }

    if (!isPlainRecord(parsedBody)) {
      return {
        behavior: 'deny',
        message: `${toolName} was not run: remote permission check returned an invalid envelope.`,
        decisionReason: {
          type: 'other',
          reason: 'invalid remote permission envelope',
        },
      }
    }

    if (isPlainRecord(parsedBody.error)) {
      if (parsedBody.error.code === JSONRPC_METHOD_NOT_FOUND) {
        return REMOTE_CHECK_DOES_NOT_DECIDE
      }
      const message = sanitizeRemoteWireText(
        typeof parsedBody.error.message === 'string' &&
          parsedBody.error.message.length > 0
          ? parsedBody.error.message
          : `${toolName} permission check failed on remote worker.`,
      )
      return {
        behavior: 'deny',
        message,
        decisionReason: {
          type: 'other',
          reason: message,
        },
      }
    }

    return validateRemotePermissionResult(toolName, input, parsedBody.result)
  }

  function attach(session: RemoteNativeToolSession): () => void {
    const runner: RemoteNativeToolRunner = async (
      toolName,
      input,
      signal,
      context,
    ) => {
      const recordInput = isPlainRecord(input) ? input : {}
      return callTool(toolName, recordInput, {
        signal,
        toolUseId: context.toolUseId,
        agentId: context.agentId,
      })
    }

    let remoteCheck: RemoteNativeToolCheck | undefined
    if (enableRemotePermissionCheck) {
      runner.checkPermissions = async (tool, input, context) => {
        const recordInput = isPlainRecord(input) ? input : {}
        const result = await checkPermissions(tool.name, recordInput, {
          signal: context.abortController?.signal,
          toolUseId: context.toolUseId,
        })
        return result === REMOTE_CHECK_DOES_NOT_DECIDE ? undefined : result
      }

      remoteCheck = async ({ tool, input, context, toolUseID }) => {
        const result = await checkPermissions(tool.name, input, {
          signal: context.abortController?.signal,
          toolUseId: toolUseID,
        })
        if (
          result === REMOTE_CHECK_DOES_NOT_DECIDE ||
          result.behavior === 'passthrough'
        ) {
          return REMOTE_CHECK_DOES_NOT_DECIDE
        }
        return result
      }
    }

    const unregisters = toolNames.map(name =>
      registerRemoteNativeToolRunner(session, name, runner, remoteCheck),
    )

    let detached = false
    const detach = () => {
      if (detached) return
      detached = true
      activeDetachers.delete(detach)
      for (const unregister of unregisters) {
        unregister()
      }
    }

    activeDetachers.add(detach)
    return detach
  }

  async function dispose(): Promise<void> {
    if (disposed) {
      return
    }
    disposed = true
    const detachers = [...activeDetachers]
    activeDetachers.clear()
    for (const detach of detachers) {
      detach()
    }
  }

  return {
    url,
    toolNames,
    attach,
    callTool,
    checkPermissions,
    dispose,
  }
}

/**
 * Convenience wrapper attaching a `RemoteNativeToolBridgeHandle` onto `session`
 * and returning its idempotent `detach()` callback.
 */
export function attachRemoteNativeToolBridge(
  session: RemoteNativeToolSession,
  bridge: RemoteNativeToolBridgeHandle,
): () => void {
  return bridge.attach(session)
}

function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true)
  }
  return new Promise<boolean>(resolve => {
    let settled = false
    const finish = (exited: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('close', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    unrefTimer(timer)
    child.once('exit', onExit)
    child.once('close', onExit)
  })
}

async function terminateChildProcess(
  child: ChildProcess,
  graceMs: number,
): Promise<void> {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return
  }
  let signaled = false
  try {
    signaled = child.kill('SIGTERM')
  } catch {
    return
  }
  if (!signaled) {
    return
  }
  const exitedGracefully = await waitForChildExit(child, graceMs)
  if (
    !exitedGracefully &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    try {
      child.kill('SIGKILL')
    } catch {
      return
    }
    await waitForChildExit(child, 2_000)
  }
}

/**
 * Spawn a real child OS process running an HTTP MCP native-tool worker, wait
 * for its `MCP server listening on <url>` and `MCP server auth token: <token>`
 * readiness banner on stdout, and return a connected `RemoteNativeToolBridgeHandle`
 * with clean lifecycle management.
 */
export async function spawnRemoteNativeToolWorker(
  options: SpawnRemoteNativeToolWorkerOptions,
): Promise<SpawnedRemoteNativeToolWorker> {
  let command: string
  let args: string[]

  if (options.command !== undefined) {
    command = options.command
    args = [...(options.args ?? [])]
  } else {
    const cliPath = options.cliPath ?? process.argv[1]
    if (!cliPath) {
      throw new Error(
        'spawnRemoteNativeToolWorker requires either `command` or `cliPath`',
      )
    }
    command = options.runtimeBin ?? process.execPath
    args = [
      ...(options.runtimeArgs ?? []),
      cliPath,
      'mcp',
      'serve',
      '--transport',
      'http',
      '--port',
      String(options.port ?? 0),
      '--result-format',
      'raw',
    ]
  }

  const startupTimeoutMs =
    options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
  const shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (!child.stdout || !child.stderr) {
    await terminateChildProcess(child, shutdownGraceMs)
    throw new Error('Failed to open stdout/stderr pipes for remote tool worker')
  }

  let stderrBuf = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (stderrBuf.length < 16_384) {
      stderrBuf += chunk
    }
  })

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })

  let resolvedUrl: string | undefined
  let resolvedToken: string | undefined

  const ready = await new Promise<{ url: string; authToken: string }>(
    (resolve, reject) => {
      let settled = false

      const cleanupStartup = () => {
        clearTimeout(timer)
        rl.off('line', onLine)
        child.off('error', onError)
        child.off('exit', onExit)
      }

      const fail = (err: Error) => {
        if (settled) return
        settled = true
        cleanupStartup()
        reject(err)
      }

      const maybeFinish = () => {
        if (
          !settled &&
          resolvedUrl !== undefined &&
          resolvedToken !== undefined
        ) {
          settled = true
          cleanupStartup()
          resolve({ url: resolvedUrl, authToken: resolvedToken })
        }
      }

      const onLine = (line: string) => {
        const urlMatch = LISTENING_URL_RE.exec(line)
        if (urlMatch?.[1]) {
          resolvedUrl = urlMatch[1]
        }
        const tokenMatch = AUTH_TOKEN_RE.exec(line)
        if (tokenMatch?.[1]) {
          resolvedToken = tokenMatch[1]
        }
        maybeFinish()
      }

      const onError = (err: Error) => {
        fail(
          new Error(
            `Remote native-tool worker failed to spawn: ${err.message}${stderrBuf ? `\nstderr: ${stderrBuf}` : ''}`,
          ),
        )
      }

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        fail(
          new Error(
            `Remote native-tool worker exited before ready (code=${code}, signal=${signal})${stderrBuf ? `\nstderr: ${stderrBuf}` : ''}`,
          ),
        )
      }

      const timer = setTimeout(() => {
        fail(
          new Error(
            `Remote native-tool worker timed out after ${startupTimeoutMs}ms waiting for listening URL and auth token${stderrBuf ? `\nstderr: ${stderrBuf}` : ''}`,
          ),
        )
      }, startupTimeoutMs)
      unrefTimer(timer)

      rl.on('line', onLine)
      child.once('error', onError)
      child.once('exit', onExit)
    },
  ).catch(async err => {
    rl.close()
    await terminateChildProcess(child, shutdownGraceMs)
    throw err
  })

  const bridge = createHttpRemoteNativeToolBridge({
    url: ready.url,
    authToken: ready.authToken,
    toolNames: options.toolNames,
    defaultTimeoutMs: options.defaultTimeoutMs,
    enableRemotePermissionCheck: options.enableRemotePermissionCheck,
    headers: options.headers,
    fetchImpl: options.fetchImpl,
  })

  const attachedDetachers = new Set<() => void>()
  let disposePromise: Promise<void> | undefined

  function attach(session: RemoteNativeToolSession): () => void {
    const rawDetach = bridge.attach(session)
    const detach = () => {
      attachedDetachers.delete(detach)
      rawDetach()
    }
    attachedDetachers.add(detach)
    return detach
  }

  function dispose(): Promise<void> {
    if (disposePromise !== undefined) {
      return disposePromise
    }
    disposePromise = (async () => {
      const detachers = [...attachedDetachers]
      attachedDetachers.clear()
      for (const detach of detachers) {
        detach()
      }
      await bridge.dispose()
      rl.close()
      await terminateChildProcess(child, shutdownGraceMs)
    })()
    return disposePromise
  }

  return {
    pid: child.pid ?? 0,
    url: ready.url,
    authToken: ready.authToken,
    bridge,
    attach,
    dispose,
  }
}
