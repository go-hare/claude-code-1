/**
 * densable `Km` / `ns` / `Dc` / `xc` / `Lc` / `dQe` / `oAn`.
 * Gold LLM stand-in for `type: agent` mock responders. Do not invent a mock LLM:
 * this calls `sideQuery` with querySource `plugin_eval_mock`.
 */

import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import { sideQuery } from '../../sideQuery.js'
import { getSmallFastModel } from '../../model/model.js'
import { logForDebugging } from '../../debug.js'
import { jsonStringify } from '../../slowOperations.js'
import { readPinnedRecording, recordingKey } from './replay.js'

export const MOCK_AGENT_FAILED = 'mock agent responder failed'
export const ABORT_PREFIX = 'ABORT:'
export const ERROR_PREFIX = 'ERROR:'
const HISTORY_TURNS = 40
const ARG_CHARS = 16_384
const RESULT_CHARS = 49_152
const HISTORY_CHARS = 240_000
const FILE_INTERPOLATE_CHARS = 16_384

export type MockRelayVerdict = {
  verdict: 'ok' | 'tool_error' | 'abort'
  text: string
  costUsd?: number
  replay?: 'hit' | 'miss'
}

export type AgentMockHistoryEntry = {
  server: string
  tool: string
  input: unknown
  verdict: string
  output: string
}

export type AgentMockResponder = {
  kind: 'agent'
  prompt: string
  abortWhen?: string | null
  expect?: Record<string, unknown> | null
  baseDir: string
  replay?: {
    mockHash: string
    replayDir?: string
    pinned?: Record<string, string>
  }
}

function clip(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}… [${text.length - max} more characters omitted]`
    : text
}

function lookup(input: unknown, path: string): unknown {
  let cur: unknown = input
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function valueKind(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null || value === undefined) return 'missing'
  if (typeof value === 'boolean') return 'bool'
  return typeof value
}

function asDisplay(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return jsonStringify(value) ?? String(value)
}

function equalsLiteral(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return value === expected
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value) === expected
  }
  return false
}

const TYPE_NAMES = new Set([
  'string',
  'number',
  'bool',
  'boolean',
  'object',
  'array',
])

function matchGuard(
  value: unknown,
  spec: unknown,
  path: string,
  root: unknown,
): string | null {
  if (Array.isArray(spec)) {
    return spec.some(s => typeof s === 'string' && equalsLiteral(value, s))
      ? null
      : `${path} = ${asDisplay(value)} is not one of [${spec.join(', ')}]`
  }
  if (typeof spec === 'object' && spec !== null) {
    return matchExpect(root, spec as Record<string, unknown>, path)
  }
  if (typeof spec !== 'string') {
    return `${path} = ${asDisplay(value)} is not "${String(spec)}"`
  }
  const re = /^\/(.+)\/([a-z]*)$/s.exec(spec)
  if (re) {
    const subject =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : null
    try {
      const rx = new RegExp(re[1] ?? '', re[2] ?? '')
      if (subject !== null && rx.test(subject)) return null
    } catch {
      return `${path}: ${spec} is not a usable guard (invalid regex)`
    }
    return `${path} = ${asDisplay(value)} does not match ${spec}`
  }
  if (TYPE_NAMES.has(spec)) {
    const want = spec === 'boolean' ? 'bool' : spec
    return valueKind(value) === want
      ? null
      : `${path} = ${asDisplay(value)} is not a ${spec}`
  }
  return equalsLiteral(value, spec)
    ? null
    : `${path} = ${asDisplay(value)} is not "${spec}"`
}

/** densable `dQe`. */
export function matchExpect(
  input: unknown,
  expect: Record<string, unknown>,
  prefix = '',
): string | null {
  for (const [key, spec] of Object.entries(expect)) {
    const path = prefix ? `${prefix}.${key}` : key
    const got = lookup(input, path)
    const problem = matchGuard(got, spec, path, input)
    if (problem !== null) return problem
  }
  return null
}

const PLAIN_SEGMENT = /^[A-Za-z0-9._-]+$/

function insideMockDir(baseDir: string, file: string): boolean {
  const rel = relative(baseDir, file)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** densable `oAn` — `{{input.field}}` / `{{file:…}}`. */
export async function interpolateMockPrompt(
  prompt: string,
  input: unknown,
  baseDir: string,
  maxChars = FILE_INTERPOLATE_CHARS,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  let fail: string | null = null
  const parts: Array<string | Promise<string>> = []
  let last = 0
  const re =
    /\{\{\s*(input\.[A-Za-z0-9_.-]+|file:(?:[^{}]|\{input\.[A-Za-z0-9_.-]+\})+?)\s*\}\}/g
  for (const match of prompt.matchAll(re)) {
    parts.push(prompt.slice(last, match.index))
    last = (match.index ?? 0) + match[0].length
    const inner = match[1] ?? ''
    if (inner.startsWith('input.')) {
      const value = lookup(input, inner.slice(6))
      const text =
        value === undefined
          ? ''
          : typeof value === 'string'
            ? value
            : (jsonStringify(value) ?? '')
      parts.push(clip(text, maxChars))
      continue
    }
    let fileSpec = inner.slice(5).trim()
    let bad: string | null = null
    fileSpec = fileSpec.replace(
      /\{input\.([A-Za-z0-9_.-]+)\}/g,
      (_m, field: string) => {
        const value = lookup(input, field)
        const text = value === undefined || value === null ? '' : String(value)
        if (!PLAIN_SEGMENT.test(text)) {
          bad = `{input.${field}} = ${asDisplay(value)} is not a plain file-name segment`
        }
        return text
      },
    )
    if (bad !== null) {
      fail ??= bad
      continue
    }
    const abs = resolve(baseDir, fileSpec)
    if (!insideMockDir(baseDir, abs)) {
      fail ??= `{{file:${fileSpec}}} names a path outside the mock's directory`
      continue
    }
    parts.push(
      readFile(abs, 'utf8').then(
        text => clip(text, maxChars),
        error => {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code)
              : undefined
          fail ??=
            code === 'ENOENT'
              ? `{{file:${fileSpec}}}: no such fixture`
              : `{{file:${fileSpec}}}: could not be read`
          return ''
        },
      ),
    )
  }
  parts.push(prompt.slice(last))
  const joined = (await Promise.all(parts)).join('')
  if (fail !== null) return { ok: false, reason: fail }
  return { ok: true, text: joined }
}

function systemPrompt(
  server: string,
  abortWhen: string | null | undefined,
): string {
  const lines = [
    `You are standing in for the MCP server "${server}" inside an automated evaluation of a coding-agent plugin. Each user turn is one tool call the agent under test just made; earlier calls this run and your answers to them are listed first as history. Reply with ONLY the tool's result content, exactly as the real server would return it (JSON when the server returns JSON) — no commentary, no markdown fences unless the real result would contain them. Stay consistent with your earlier answers this run.`,
    `To return an ordinary tool ERROR the agent should handle (bad arguments, not found, rate limited), reply with a single line starting "${ERROR_PREFIX} " followed by the error text.`,
  ]
  if (
    abortWhen !== null &&
    abortWhen !== undefined &&
    abortWhen.trim() !== ''
  ) {
    lines.push(
      `The evaluation author listed conditions under which this run must be STOPPED because the agent has gone off the rails. If — and only if — the current call meets one of them, reply with a single line starting "${ABORT_PREFIX} " followed by a short reason naming the condition. The conditions:\n${abortWhen.trim()}`,
    )
  } else {
    lines.push(`Never reply with a line starting "${ABORT_PREFIX}".`)
  }
  lines.push("The author's description of the server you are playing follows.")
  return lines.join('\n\n')
}

function userPrompt(
  tool: string,
  input: unknown,
  history: AgentMockHistoryEntry[],
): string {
  const recent = history.slice(-HISTORY_TURNS)
  const lines: string[] = []
  let used = 0
  const kept: string[] = []
  for (let i = recent.length - 1; i >= 0; i--) {
    const h = recent[i]!
    const arg =
      typeof h.input === 'string' ? h.input : (jsonStringify(h.input) ?? '')
    const row = `- ${h.tool}(${arg}) → ${h.verdict === 'ok' ? '' : `[${h.verdict}] `}${h.output}`
    if (used + row.length > HISTORY_CHARS) break
    kept.unshift(row)
    used += row.length
  }
  const omitted = history.length - kept.length
  if (kept.length > 0) {
    lines.push(
      `Earlier calls this run${omitted > 0 ? ` (${omitted} older omitted)` : ''}:\n${kept.join('\n')}`,
    )
  }
  lines.push(
    `Current call: ${tool}\nArguments:\n${clip(jsonStringify(input, null, 2) ?? 'null', ARG_CHARS)}`,
  )
  return lines.join('\n\n')
}

function parseModelText(
  text: string,
  abortEnabled: boolean,
): { verdict: 'ok' | 'tool_error' | 'abort'; text: string } {
  if (text.startsWith(ABORT_PREFIX)) {
    const reason =
      text.slice(ABORT_PREFIX.length).trim() || 'abort_when condition met'
    return abortEnabled
      ? { verdict: 'abort', text: reason }
      : { verdict: 'tool_error', text: reason }
  }
  if (text.startsWith(ERROR_PREFIX)) {
    return {
      verdict: 'tool_error',
      text: text.slice(ERROR_PREFIX.length).trim() || 'error',
    }
  }
  return { verdict: 'ok', text }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block =>
      typeof block === 'object' &&
      block !== null &&
      'text' in block &&
      typeof (block as { text: unknown }).text === 'string'
        ? (block as { text: string }).text
        : '',
    )
    .join('')
}

function failNs(
  kind: string,
  detail: string,
  costUsd: number,
): MockRelayVerdict {
  logForDebugging(`plugin eval: agent mock responder ${kind}: ${detail}`, {
    level: 'warn',
  })
  return {
    verdict: 'tool_error',
    text: `${MOCK_AGENT_FAILED} (${kind}) — see the eval debug log`,
    costUsd,
  }
}

/** densable `ns`. */
export async function callAgentMockModel(params: {
  server: string
  tool: string
  responder: AgentMockResponder
  prompt: string
  input: unknown
  history: AgentMockHistoryEntry[]
  model?: string
  signal: AbortSignal
}): Promise<MockRelayVerdict> {
  const started = Date.now()
  try {
    const system = [
      systemPrompt(params.server, params.responder.abortWhen),
      params.prompt,
    ].join('\n\n')
    const user = userPrompt(params.tool, params.input, params.history)
    const model = params.model?.trim() || getSmallFastModel()
    const message = await sideQuery({
      querySource: 'plugin_eval_mock',
      model,
      system,
      messages: [{ role: 'user', content: user }],
      signal: params.signal,
      skipSystemPromptPrefix: true,
    })
    const text = extractText(message.content).trim()
    const parsed = parseModelText(
      text,
      Boolean(params.responder.abortWhen?.trim()),
    )
    return {
      ...parsed,
      text: clip(parsed.text, RESULT_CHARS),
      costUsd: (Date.now() - started) / 1000,
    }
  } catch (error) {
    return failNs(
      'exception',
      error instanceof Error ? error.message : String(error),
      (Date.now() - started) / 1000,
    )
  }
}

export function replayKey(params: {
  server: string
  tool: string
  input: unknown
  mockHash: string
  prompt: string
  history: AgentMockHistoryEntry[]
}): string {
  const hist = createHash('sha256')
    .update(
      params.history
        .map(
          h =>
            jsonStringify([
              h.tool,
              jsonStringify(h.input) ?? '',
              h.verdict,
              h.output,
            ]) ?? '',
        )
        .join('\n'),
    )
    .digest('hex')
  const promptHash = createHash('sha256')
    .update(params.prompt.replaceAll('\r\n', '\n'))
    .digest('hex')
  return createHash('sha256')
    .update(
      [
        params.server,
        params.tool,
        jsonStringify(params.input) ?? 'null',
        params.mockHash,
        promptHash,
        hist,
      ].join(' '),
    )
    .digest('hex')
}

/** densable `Km`. */
export async function answerAgentMock(params: {
  server: string
  tool: string
  input: unknown
  responder: AgentMockResponder
  history: AgentMockHistoryEntry[]
  model?: string
  signal: AbortSignal
}): Promise<MockRelayVerdict> {
  if (params.responder.expect != null) {
    const violation = matchExpect(params.input, params.responder.expect)
    if (violation !== null) {
      return { verdict: 'abort', text: `input violates expect: ${violation}` }
    }
  }
  const interpolated = await interpolateMockPrompt(
    params.responder.prompt,
    params.input,
    params.responder.baseDir,
    FILE_INTERPOLATE_CHARS,
  )
  if (!interpolated.ok) {
    return {
      verdict: 'tool_error',
      text: interpolated.reason,
      replay: 'miss',
    }
  }
  const replay = params.responder.replay
  if (replay !== undefined) {
    const key = recordingKey({
      server: params.server,
      tool: params.tool,
      input: params.input,
      mockHash: replay.mockHash,
      prompt: interpolated.text,
      history: params.history,
    })
    const hit = await readPinnedRecording(
      replay.replayDir,
      params.tool,
      key,
      replay.pinned,
    )
    if (hit !== null) return { ...hit, replay: 'hit' }
  }
  return callAgentMockModel({
    server: params.server,
    tool: params.tool,
    responder: params.responder,
    prompt: interpolated.text,
    input: params.input,
    history: params.history,
    model: params.model,
    signal: params.signal,
  })
}
