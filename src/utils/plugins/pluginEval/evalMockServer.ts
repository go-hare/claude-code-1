/**
 * densable `$3o` / `be` / `ye` / `sAn` / `w3t` — `--eval-mock-server` stdio
 * stand-in. Gold cli.tsx: `argv[2]==="--eval-mock-server"` then
 * `runEvalMockServer(argv[3], argv[4])`.
 */
import { constants as fsConstants } from 'fs'
import { open } from 'fs/promises'
import { createConnection } from 'net'
import { basename, dirname } from 'path'
import { z } from 'zod/v4'
import { Server } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { getPlatform } from '../../platform.js'
import { EVAL_ABORTED_BY_MOCK } from './constants.js'
import { interpolateMockPrompt, matchExpect } from './agentMock.js'
import { hashEvalMockSpecJson, prefixMockAbortOutput } from './mockKeys.js'
import { vetPluginEvalPath } from './pathVet.js'

export { hashEvalMockSpecJson } from './mockKeys.js'

const SPEC_MAX_BYTES = 4_194_304
const OUTPUT_CLIP = 16_384
const FIXTURE_MAX_BYTES = 16_384

const toolListingSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
})

const fixedResponderSchema = z.object({
  kind: z.literal('fixed'),
  body: z.string().optional(),
  prompt: z.string().optional(),
  isError: z.boolean().optional(),
  expect: z.record(z.string(), z.unknown()).nullable().optional(),
  baseDir: z.string().optional(),
})

const agentResponderSchema = z.object({
  kind: z.literal('agent'),
  prompt: z.string().optional(),
  abortWhen: z.string().nullable().optional(),
  expect: z.record(z.string(), z.unknown()).nullable().optional(),
  baseDir: z.string().optional(),
})

const specSchema = z.object({
  registeredName: z.string(),
  server: z.string(),
  nonce: z.string(),
  callLogPath: z.string(),
  tools: z.array(z.union([z.string(), toolListingSchema])),
  responders: z.record(
    z.string(),
    z.union([fixedResponderSchema, agentResponderSchema]),
  ),
  agent: z
    .object({
      socketPath: z.string(),
      token: z.string(),
    })
    .nullable()
    .optional(),
})

export type EvalMockSpec = z.infer<typeof specSchema>

function clipOutput(text: string): string {
  return text.length > OUTPUT_CLIP
    ? `${text.slice(0, OUTPUT_CLIP)}…[truncated]`
    : text
}

function clipInput(input: unknown): unknown {
  try {
    const json = JSON.stringify(input) ?? ''
    return json.length > OUTPUT_CLIP ? clipOutput(json) : input
  } catch {
    return input
  }
}

async function readCappedFile(
  path: string,
  label: string,
  maxBytes: number,
): Promise<Buffer> {
  await vetPluginEvalPath(dirname(path), basename(path), label)
  const flags =
    fsConstants.O_RDONLY |
    (getPlatform() === 'windows' ? 0 : fsConstants.O_NONBLOCK)
  const handle = await open(path, flags)
  try {
    const st = await handle.stat()
    if (!st.isFile()) {
      throw new Error(
        label === 'mock spec'
          ? 'spec path is not a regular file — refusing to read it'
          : `${label} is not a regular file`,
      )
    }
    if (st.size > maxBytes) {
      throw new Error(
        label === 'mock spec'
          ? 'spec file is over the size limit the harness writes — refusing to read it'
          : `${label} is ${st.size} bytes, over the ${maxBytes}-byte fixture limit`,
      )
    }
    const buf = Buffer.alloc(st.size)
    let offset = 0
    while (offset < st.size) {
      const { bytesRead } = await handle.read({
        buffer: buf,
        offset,
        position: offset,
      })
      if (bytesRead <= 0) break
      offset += bytesRead
    }
    return buf.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

async function appendCallLog(path: string, line: string): Promise<boolean> {
  try {
    const flags =
      fsConstants.O_WRONLY |
      fsConstants.O_APPEND |
      fsConstants.O_CREAT |
      (getPlatform() === 'windows' ? 0 : fsConstants.O_NONBLOCK)
    const handle = await open(path, flags, 0o600)
    try {
      if (!(await handle.stat()).isFile()) return false
      const buf = Buffer.from(`${line}\n`, 'utf8')
      let offset = 0
      while (offset < buf.length) {
        const { bytesWritten } = await handle.write(buf, offset)
        if (bytesWritten <= 0) return false
        offset += bytesWritten
      }
      return true
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

async function askAgentRelay(
  agent: { socketPath: string; token: string },
  registeredName: string,
  tool: string,
  input: unknown,
  signal: AbortSignal,
): Promise<{ verdict: 'ok' | 'tool_error' | 'abort'; text: string }> {
  return await new Promise(resolve => {
    const socket = createConnection(agent.socketPath)
    let buf = Buffer.alloc(0)
    let done = false
    const finish = (verdict: 'ok' | 'tool_error' | 'abort', text: string) => {
      if (done) return
      done = true
      socket.destroy()
      resolve({ verdict, text })
    }
    const onAbort = () => finish('abort', 'run ended')
    if (signal.aborted) {
      finish('abort', 'run ended')
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    socket.setTimeout(30_000, () =>
      finish(
        'tool_error',
        'agent mock responder called without a harness relay',
      ),
    )
    socket.on('error', () =>
      finish(
        'tool_error',
        'agent mock responder called without a harness relay',
      ),
    )
    socket.on('connect', () => {
      socket.write(
        `${JSON.stringify({
          token: agent.token,
          registeredName,
          tool,
          input,
        })}\n`,
      )
    })
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, Buffer.from(chunk)])
      const nl = buf.indexOf(10)
      if (nl === -1) return
      try {
        const parsed = JSON.parse(buf.subarray(0, nl).toString('utf8')) as {
          verdict?: string
          text?: string
        }
        const verdict =
          parsed.verdict === 'ok' ||
          parsed.verdict === 'tool_error' ||
          parsed.verdict === 'abort'
            ? parsed.verdict
            : 'tool_error'
        finish(verdict, typeof parsed.text === 'string' ? parsed.text : '')
      } catch {
        finish(
          'tool_error',
          'agent mock responder called without a harness relay',
        )
      }
    })
    socket.on('end', () => {
      if (!done) {
        finish(
          'tool_error',
          'agent mock responder called without a harness relay',
        )
      }
    })
  })
}

async function answerFixed(
  responder: z.infer<typeof fixedResponderSchema>,
  input: unknown,
): Promise<{ verdict: 'ok' | 'tool_error' | 'abort'; text: string }> {
  const body = responder.body ?? responder.prompt ?? ''
  const interpolated = await interpolateMockPrompt(
    body,
    input,
    responder.baseDir ?? process.cwd(),
    FIXTURE_MAX_BYTES,
  )
  if (!interpolated.ok)
    return { verdict: 'tool_error', text: interpolated.reason }
  return {
    verdict: responder.isError ? 'tool_error' : 'ok',
    text: interpolated.text,
  }
}

export function parseEvalMockSpec(raw: string): EvalMockSpec {
  return specSchema.parse(JSON.parse(raw))
}

/**
 * densable `$3o(specPath, expectedHash?)`.
 */
export async function runEvalMockServer(
  specPath: string | undefined,
  expectedHash?: string,
): Promise<void> {
  if (!specPath) throw new Error('missing spec path')
  const raw = (
    await readCappedFile(specPath, 'mock spec', SPEC_MAX_BYTES)
  ).toString('utf8')
  if (
    expectedHash !== undefined &&
    hashEvalMockSpecJson(raw) !== expectedHash
  ) {
    throw new Error(
      'spec file does not match the hash the harness launched this stand-in with — refusing to serve it',
    )
  }
  const spec = parseEvalMockSpec(raw)
  const abort = new AbortController()
  if (
    !(await appendCallLog(
      spec.callLogPath,
      JSON.stringify({ ready: spec.nonce, server: spec.server }),
    ))
  ) {
    throw new Error(
      'could not write the identity line to the run call log — refusing to serve unidentified',
    )
  }
  const listings = spec.tools.map(tool =>
    typeof tool === 'string'
      ? {
          name: tool,
          description: '',
          inputSchema: { type: 'object' as const, additionalProperties: true },
        }
      : {
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: {
            type: 'object' as const,
            ...(tool.inputSchema ?? { additionalProperties: true }),
          },
        },
  )
  const server = new Server(
    { name: `eval-mock/${spec.server}`, version: '1' },
    { capabilities: { tools: {} } },
  )
  ;(server as { onclose?: () => void }).onclose = () => abort.abort()
  server.setRequestHandler('tools/list', async () => ({ tools: listings }))
  let chain: Promise<unknown> = Promise.resolve()
  let seq = 0
  server.setRequestHandler('tools/call', request => {
    const next = chain.then(() =>
      handleCall(
        spec,
        (
          request as {
            params?: { name?: string; arguments?: Record<string, unknown> }
          }
        ).params,
        abort.signal,
        seq++,
      ),
    )
    chain = next.catch(() => {})
    return next
  })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stdin.on('end', () => void server.close())
  process.stdin.on('error', () => void server.close())
}

async function handleCall(
  spec: EvalMockSpec,
  params: { name?: string; arguments?: Record<string, unknown> } | undefined,
  signal: AbortSignal,
  seq: number,
): Promise<{
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}> {
  const name = params?.name ?? ''
  const args = params?.arguments ?? {}
  const started = Date.now()
  const responder = Object.hasOwn(spec.responders, name)
    ? spec.responders[name]
    : undefined
  const result =
    responder === undefined
      ? {
          verdict: 'tool_error' as const,
          text: `no mock for ${spec.server}/${name}`,
        }
      : await dispatchResponder(spec, responder, args, name, signal)
  const record = {
    nonce: spec.nonce,
    seq,
    server: spec.server,
    tool: name,
    responder: responder?.kind ?? 'fixed',
    input: clipInput(args),
    verdict: result.verdict,
    output: clipOutput(result.text),
    ms: Date.now() - started,
    ...(result.replay ? { replay: result.replay } : {}),
  }
  const wrote = await appendCallLog(spec.callLogPath, JSON.stringify(record))
  if (!wrote && result.verdict === 'abort') {
    process.stderr.write(
      'eval mock stand-in: could not write the abort record to the call log\n',
    )
  }
  const text = prefixMockAbortOutput(result.text)
  if (result.verdict === 'ok') {
    return { content: [{ type: 'text', text }] }
  }
  if (result.verdict === 'tool_error') {
    return { content: [{ type: 'text', text }], isError: true }
  }
  return {
    content: [
      {
        type: 'text',
        text: `${EVAL_ABORTED_BY_MOCK} ${spec.nonce}: ${spec.server}/${name} — ${result.text}`,
      },
    ],
    isError: true,
  }
}

async function dispatchResponder(
  spec: EvalMockSpec,
  responder:
    | z.infer<typeof fixedResponderSchema>
    | z.infer<typeof agentResponderSchema>,
  args: Record<string, unknown>,
  tool: string,
  signal: AbortSignal,
): Promise<{
  verdict: 'ok' | 'tool_error' | 'abort'
  text: string
  replay?: 'hit' | 'miss'
}> {
  if (responder.expect != null) {
    const problem = matchExpect(args, responder.expect)
    if (problem !== null) {
      return { verdict: 'abort', text: `input violates expect: ${problem}` }
    }
  }
  if (responder.kind === 'agent') {
    if (spec.agent == null) {
      return {
        verdict: 'tool_error',
        text: 'agent mock responder called without a harness relay',
      }
    }
    return askAgentRelay(spec.agent, spec.registeredName, tool, args, signal)
  }
  return answerFixed(responder, args)
}
