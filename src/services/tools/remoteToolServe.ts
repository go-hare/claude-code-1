/**
 * densable 2.1.289 inbound serve wrap — this machine as the announced worker.
 *
 * Gold SEA `/tmp/official-289/package/claude`:
 *   `Cle` @202407176 · `un` @206773509 · `fqo` @183229909 · `gqo` @183230623
 *   `Jo` @183223610 · `Yi` @183229678 · `Xi` @183230435 · `yu` @183216152
 *   `Z` @183226207 · `mIe` @183215526 · `Qo` @206814317 · `tr` @206816057
 *   `xn` @206813815 · `Se.serveSessionToolCall` @207290799
 *   `Se.servePlumbingCall` @207291875 · `Se.answerProbe` @207293069
 *   `V` reannounce @206819400 · `cn` @206773650 · `ie` @207295512
 *   `Ge` @207285899 · `Aqe` @203693815 · `_ho` @203690253
 *   `o2e`/`xer` @185494670 / @185493759 · `gte` @205776140
 *   `qoe` @183231639 · `Mqr` @183231317 · `sa` @183234036 · `as` @183231858
 *   `VO` @203704548 · `r2e` @185491704 · `er` @206815531
 *   leftover `servedSessionPlumbing` @207176929 · `D`/`R`/`j`/`I` @207179070
 *   gold ye deliver @206726603 `source==="worker"&&Lt` · leftover `Mre` @185930444
 *   `Be` @206773533 `dn=120000` · gold `cc-${nr()}` leftover `randomUUID`
 *   RSM `if(un(g))` @206751433 · `respondToServedChannelRequest` @206767294
 *   `wAt` @206817084 · `xn` binder on live RSM · `V` intercepts reannounce
 *
 * Print Host inbound of these subtypes stays reject (`is agent-originated`).
 * Do not add a print `case "remote_tool_call"`. NEVER `export function fqo`.
 * NEVER `export function qoe`. NEVER `export function r2e`. NEVER `export function er`.
 */

import { randomUUID } from 'crypto'
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { REMOTE_TOOL_ENVELOPE_KEY } from './remoteToolCall.js'

/** gold `Cle` @202407176 */
export const REMOTE_TOOLS_SERVED_SUBTYPES = [
  'remote_tool_call',
  'remote_plumbing_call',
  'remote_tools_probe',
  'remote_tools_reannounce',
] as const

export type RemoteToolsServedSubtype =
  (typeof REMOTE_TOOLS_SERVED_SUBTYPES)[number]

/** gold `un` @206773509 */
export function isRemoteToolsServedSubtype(
  subtype: string,
): subtype is RemoteToolsServedSubtype {
  return (REMOTE_TOOLS_SERVED_SUBTYPES as readonly string[]).includes(subtype)
}

/** gold `mIe` */
export const REMOTE_TOOL_CALL_INPUT_KEY = '__remote_tool_call'

/** gold `ap` / `Cje` */
export const REMOTE_TOOL_PROTOCOL_V = 1

/** gold `Se` host-name cap used by `yu(g, Se)` */
export const REMOTE_SERVE_HOST_CAP = 64

/** gold `Qt` tool name cap on `Yi` */
export const REMOTE_SERVE_TOOL_NAME_CAP = 256

/** gold plumbing `Xi` name cap */
export const REMOTE_SERVE_PLUMBING_NAME_CAP = 64

/** gold `lt` issued_at max */
export const REMOTE_SERVE_ISSUED_AT_MAX = 8_640_000_000_000_000

/** gold `Oe` deadline max */
export const REMOTE_SERVE_DEADLINE_MAX = 2_147_483_647

/** gold `Jt` call_id / tool_use_id */
export const REMOTE_SERVE_CALL_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/

/** gold `fIe` instance_id */
export const REMOTE_SERVE_INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** gold `re` @206736561 — request_id longer than this is left unanswered */
export const REMOTE_SERVE_REQUEST_ID_CAP = 256

/** gold `We` session-call extra window */
export const REMOTE_SERVE_SESSION_GRACE_MS = 30_000

/** gold `Ye` first-leg extra window */
export const REMOTE_SERVE_FIRST_LEG_GRACE_MS = 5_000

/** gold `Je` plumbing window */
export const REMOTE_SERVE_PLUMBING_GRACE_MS = 5_000

/** gold `or` reannounce rate limit */
export const REMOTE_SERVE_REANNOUNCE_RATE_MS = 10_000

/** gold `Ge` */
export const REMOTE_SERVE_NOT_HERE = 'not served here'

/** gold `_ho` */
export function remoteToolNotServedOn(
  toolName: string,
  targetName: string,
): string {
  return `${toolName} is not served on ${targetName}.`
}

/** gold `gte` @205776140 — leftover refuse copy for unknown control */
export const UNSUPPORTED_CONTROL_REQUEST_SUBTYPE =
  'Unsupported control request subtype'

/** gold `ie` @207295512 */
export function servedErrorResult(text: string): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
} {
  return { content: [{ type: 'text', text }], isError: true }
}

/** leftover gold `r2e` `je` @185491704 */
const SERVED_ATTESTATION_STATUSES = [
  'UNSPECIFIED',
  'ABSENT',
  'VERIFIED',
  'VERIFIED_BY_GATE',
  'INVALID',
  'UNCHECKED',
  'VERIFIED_KEYLESS_DEVICE',
  'SERVICE_VOUCHED',
  'SERVER_AUTHORED',
  'SERVER_REPLAYED',
  'TRANSITIVELY_VOUCHED',
] as const

/** leftover gold `r2e` `ze` numeric table */
const SERVED_ATTESTATION_BY_INDEX = [
  'UNSPECIFIED',
  'ABSENT',
  'VERIFIED',
  'VERIFIED_BY_GATE',
  'INVALID',
  'UNCHECKED',
] as const

/** leftover gold `r2e` `ge` */
const SERVED_ATTESTATION_PREFIX = 'DEVICE_ATTESTATION_STATUS_'

/**
 * leftover gold `r2e` @185491704. Gold `Lt` does
 * `r2e(typeof r==="string"?r.toUpperCase():r)`.
 */
export function normalizeServedAttestationStatus(e: unknown): string {
  if (e === undefined || e === null) return 'UNSPECIFIED'
  if (typeof e === 'number') {
    return SERVED_ATTESTATION_BY_INDEX[e] ?? 'UNSPECIFIED'
  }
  if (typeof e !== 'string') return 'UNSPECIFIED'
  if (e === 'server_authored') return 'SERVER_AUTHORED'
  if (e === 'server_replayed') return 'SERVER_REPLAYED'
  if (e === 'transitively_vouched') return 'TRANSITIVELY_VOUCHED'
  const r = e.startsWith(SERVED_ATTESTATION_PREFIX)
    ? e.slice(SERVED_ATTESTATION_PREFIX.length)
    : e
  return (
    SERVED_ATTESTATION_STATUSES.find(status => status === r) ?? 'UNSPECIFIED'
  )
}

export type LeftoverServedEnvelope = {
  v?: typeof REMOTE_TOOL_PROTOCOL_V
  outcome:
    | 'completed'
    | 'refused'
    | 'failed'
    | 'in_progress'
    | 'needs_approval'
    | 'acknowledged'
  call_id?: string
  target: { name: string; working_dir: string }
  code?: string
  message?: string
  is_error?: boolean
}

export type LeftoverServedToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >
  structuredContent: { [REMOTE_TOOL_ENVELOPE_KEY]: Record<string, unknown> }
  isError: boolean
  _meta?: { [REMOTE_TOOL_ENVELOPE_KEY]: Record<string, unknown> }
}

function leftoverServedText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/**
 * leftover gold `Mqr` @183231317 + `sa` @183234036.
 */
function leftoverMapServedContent(
  content: unknown,
): LeftoverServedToolResult['content'] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (!Array.isArray(content)) {
    return [{ type: 'text', text: leftoverServedText(content) }]
  }
  return content.map(block => {
    const rec = asRecord(block)
    if (!rec) {
      return { type: 'text' as const, text: leftoverServedText(block) }
    }
    if (rec.type === 'text' && typeof rec.text === 'string') {
      return { type: 'text' as const, text: rec.text }
    }
    const source = asRecord(rec.source)
    if (
      rec.type === 'image' &&
      source?.type === 'base64' &&
      typeof source.media_type === 'string' &&
      typeof source.data === 'string'
    ) {
      return {
        type: 'image' as const,
        data: source.data,
        mimeType: source.media_type,
      }
    }
    return { type: 'text' as const, text: leftoverServedText(block) }
  })
}

/**
 * leftover gold `as` @183231858 — sanitize target / refused message.
 * No Oyr needs_approval elicitation fleet.
 */
function leftoverSanitizeServedEnvelope(
  envelope: LeftoverServedEnvelope,
): Record<string, unknown> {
  const target = {
    name: sanitizeRemoteServeText(envelope.target.name, REMOTE_SERVE_HOST_CAP),
    working_dir: sanitizeRemoteServeText(envelope.target.working_dir),
  }
  const out: Record<string, unknown> = {
    v: REMOTE_TOOL_PROTOCOL_V,
    outcome: envelope.outcome,
    target,
    ...(envelope.call_id !== undefined && { call_id: envelope.call_id }),
    ...(envelope.code !== undefined && { code: envelope.code }),
    ...(envelope.is_error !== undefined && { is_error: envelope.is_error }),
  }
  if (envelope.outcome === 'refused' || envelope.outcome === 'failed') {
    out.message = sanitizeRemoteServeText(envelope.message ?? '')
  }
  return out
}

/**
 * leftover gold `qoe` @183231639. NEVER `export function qoe`.
 */
export function leftoverServedToolResult(opts: {
  envelope: LeftoverServedEnvelope
  content: unknown
}): LeftoverServedToolResult {
  const envelope = leftoverSanitizeServedEnvelope(opts.envelope)
  const isError =
    opts.envelope.outcome === 'refused' ||
    opts.envelope.outcome === 'failed' ||
    (opts.envelope.outcome === 'completed' && opts.envelope.is_error === true)
  return {
    content: leftoverMapServedContent(opts.content),
    structuredContent: { [REMOTE_TOOL_ENVELOPE_KEY]: envelope },
    isError,
    ...(isError && {
      _meta: { [REMOTE_TOOL_ENVELOPE_KEY]: envelope },
    }),
  }
}

/** leftover gold `VO` @203704548 */
export function leftoverServedRefusedResult(opts: {
  targetName: string
  workingDir?: string
  callId?: string
  code: string
  message: string
}): LeftoverServedToolResult {
  return leftoverServedToolResult({
    envelope: {
      outcome: 'refused',
      ...(opts.callId !== undefined && { call_id: opts.callId }),
      target: { name: opts.targetName, working_dir: opts.workingDir ?? '' },
      code: opts.code,
      message: opts.message,
    },
    content: [{ type: 'text', text: opts.message }],
  })
}

/**
 * gold `xer` @185493759 + `o2e` @185494670 + `Aqe` @203693815
 */
export function remoteCommandUnattestedMessage(opts: {
  status: string
  subtype: string
  targetName: string
}): string {
  const what = `remote command (${opts.subtype})`
  const hint =
    opts.status === 'ABSENT' || opts.status === 'INVALID'
      ? ' Re-pair the sending device in Trusted Devices.'
      : ''
  return `This ${what} arrived without a valid device signature (attestation: ${opts.status}) and was ignored.${hint} Nothing was done for it on ${opts.targetName}. Sending it again will not change that: tell the user instead of retrying.`
}

/** gold `kv` @206736600 — printable request id clip */
export function clipServedRequestId(id: string): string {
  if (id.length > 80) {
    return `${id.slice(0, 80).replace(/[^\x20-\x7e]/g, '?')}…(+${id.length - 80})`
  }
  return id.replace(/[^\x20-\x7e]/g, '?')
}

/** gold `yu` @183216152 */
export function sanitizeRemoteServeText(value: string, cap = 8192): string {
  const s = value.replace(/[\p{Cc}\p{Cf}]/gu, r =>
    r === '\n' || r === '\t' ? r : '',
  )
  return s.length <= cap ? s : `${s.slice(0, cap - 1)}…`
}

/** gold `Z` @183226207 — strip Cc/Cf through JSON-shaped values */
export function stripRemoteServeControls(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/[\p{Cc}\p{Cf}]/gu, '')
  }
  if (Array.isArray(value)) {
    return value.map(stripRemoteServeControls)
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k.replace(/[\p{Cc}\p{Cf}]/gu, '')] = stripRemoteServeControls(v)
    }
    return out
  }
  return value
}

const remoteToolCallBodySchema = lazySchema(() =>
  z.object({
    instance_id: z.string().regex(REMOTE_SERVE_INSTANCE_ID),
    host: z.string().max(REMOTE_SERVE_HOST_CAP),
    name: z.string().min(1).max(REMOTE_SERVE_TOOL_NAME_CAP),
    input: z.record(z.string(), z.unknown()),
    envelope: z.unknown().optional(),
    tool_use_id: z.string().regex(REMOTE_SERVE_CALL_ID),
    issued_at: z.number().int().nonnegative().max(REMOTE_SERVE_ISSUED_AT_MAX),
    deadline_ms: z.number().int().positive().max(REMOTE_SERVE_DEADLINE_MAX),
  }),
)

const remotePlumbingCallBodySchema = lazySchema(() =>
  z.object({
    instance_id: z.string().regex(REMOTE_SERVE_INSTANCE_ID),
    host: z.string().max(REMOTE_SERVE_HOST_CAP),
    name: z.string().min(1).max(REMOTE_SERVE_PLUMBING_NAME_CAP),
    args: z.record(z.string(), z.unknown()),
    issued_at: z.number().int().nonnegative().max(REMOTE_SERVE_ISSUED_AT_MAX),
    deadline_ms: z.number().int().positive().max(REMOTE_SERVE_DEADLINE_MAX),
  }),
)

const remoteToolsReannounceBodySchema = lazySchema(() =>
  z.object({
    subtype: z.literal('remote_tools_reannounce'),
    worker_epoch: z.number().int().min(1),
    deadline_ms: z.number().int().positive(),
  }),
)

const leftoverCallEnvelopeSchema = lazySchema(() =>
  z.object({
    v: z.literal(REMOTE_TOOL_PROTOCOL_V),
    op: z.literal('call').optional(),
    call_id: z.string().regex(REMOTE_SERVE_CALL_ID),
    caller: z.object({
      kind: z.enum(['ccr_container', 'local_process']),
      permission_mode: z
        .enum([
          'default',
          'acceptEdits',
          'plan',
          'auto',
          'bypassPermissions',
          'dontAsk',
        ])
        .optional(),
      is_bypass_available: z.boolean().optional(),
      instance_id: z.string().regex(REMOTE_SERVE_INSTANCE_ID).optional(),
    }),
    expires_in_ms: z.number().int().positive(),
    approval: z.unknown().optional(),
  }),
)

const leftoverOutcomeEnvelopeSchema = lazySchema(() =>
  z.object({
    v: z.literal(REMOTE_TOOL_PROTOCOL_V),
    op: z.literal('outcome_of'),
    call_id: z.string().regex(REMOTE_SERVE_CALL_ID),
  }),
)

export type ParsedRemoteEnvelope =
  | { ok: true; kind: 'call'; value: { call_id: string; approval?: unknown } }
  | {
      ok: true
      kind: 'outcome_query'
      value: { v: number; op: 'outcome_of'; call_id: string }
    }
  | { ok: false; why: 'missing' | 'malformed' | 'unsupported_protocol' }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** gold `ls` @183232742 — `v` present and not protocol 1 */
function envelopeUnsupportedProtocol(envelope: unknown): boolean {
  const v = asRecord(envelope)?.v
  return typeof v === 'number' && v !== REMOTE_TOOL_PROTOCOL_V
}

/**
 * gold `Jo` @183223610
 */
export function parseRemoteServeEnvelope(
  envelope: unknown,
): ParsedRemoteEnvelope {
  if (envelope === undefined || envelope === null) {
    return { ok: false, why: 'missing' }
  }
  if (envelopeUnsupportedProtocol(envelope)) {
    return { ok: false, why: 'unsupported_protocol' }
  }
  const rec = asRecord(envelope)
  if (!rec) return { ok: false, why: 'malformed' }
  if (rec.op === 'outcome_of') {
    const parsed = leftoverOutcomeEnvelopeSchema().safeParse(rec)
    return parsed.success
      ? {
          ok: true,
          kind: 'outcome_query',
          value: {
            v: REMOTE_TOOL_PROTOCOL_V,
            op: 'outcome_of',
            call_id: parsed.data.call_id,
          },
        }
      : { ok: false, why: 'malformed' }
  }
  const parsed = leftoverCallEnvelopeSchema().safeParse(rec)
  return parsed.success
    ? {
        ok: true,
        kind: 'call',
        value: {
          call_id: parsed.data.call_id,
          approval: parsed.data.approval,
        },
      }
    : { ok: false, why: 'malformed' }
}

export type ParsedRemoteToolCall = {
  instance_id: string
  host: string
  name: string
  input: Record<string, unknown>
  tool_use_id: string
  issued_at: number
  deadline_ms: number
  request: ParsedRemoteEnvelope
}

/**
 * gold `fqo` @183229909
 */
export function parseRemoteToolCallRequest(
  request: unknown,
): ParsedRemoteToolCall | undefined {
  const parsed = remoteToolCallBodySchema().safeParse(request)
  if (!parsed.success) return undefined
  const { envelope, input, host, name, ...rest } = parsed.data
  const { [REMOTE_TOOL_CALL_INPUT_KEY]: _dropped, ...wireInput } = input
  const strippedName = stripRemoteServeControls(name)
  if (typeof strippedName !== 'string' || strippedName === '') return undefined
  const requestEnv = parseRemoteServeEnvelope(envelope)
  const mismatched =
    requestEnv.ok && requestEnv.value.call_id !== rest.tool_use_id
      ? ({ ok: false, why: 'malformed' } as const)
      : requestEnv
  return {
    ...rest,
    host: sanitizeRemoteServeText(host, REMOTE_SERVE_HOST_CAP),
    name: strippedName,
    input: wireInput,
    request: mismatched,
  }
}

export type ParsedRemotePlumbingCall = {
  instance_id: string
  host: string
  name: string
  args: Record<string, unknown>
  issued_at: number
  deadline_ms: number
}

/**
 * gold `gqo` @183230623
 */
export function parseRemotePlumbingCallRequest(
  request: unknown,
): ParsedRemotePlumbingCall | undefined {
  const parsed = remotePlumbingCallBodySchema().safeParse(request)
  const name = parsed.success ? stripRemoteServeControls(parsed.data.name) : ''
  if (!parsed.success || typeof name !== 'string' || name === '') {
    return undefined
  }
  return {
    ...parsed.data,
    host: sanitizeRemoteServeText(parsed.data.host, REMOTE_SERVE_HOST_CAP),
    name,
    args: parsed.data.args,
  }
}

export function parseRemoteToolsReannounceRequest(request: unknown):
  | {
      worker_epoch: number
      deadline_ms: number
    }
  | undefined {
  const parsed = remoteToolsReannounceBodySchema().safeParse(request)
  return parsed.success
    ? {
        worker_epoch: parsed.data.worker_epoch,
        deadline_ms: parsed.data.deadline_ms,
      }
    : undefined
}

/** gold `de` inside `Ie` — dated against the service clock */
export function remoteServeArrivedInWindow(
  deadlineMs: number,
  ageMs: number | undefined,
  graceMs: number,
): boolean {
  return ageMs !== undefined && ageMs <= deadlineMs + graceMs
}

/** gold `le` — first call leg (no approval, not outcome_of) */
export function isRemoteServeFirstCallLeg(
  parsed: ParsedRemoteToolCall,
): boolean {
  return (
    parsed.request.ok &&
    parsed.request.kind === 'call' &&
    parsed.request.value.approval === undefined
  )
}

/** gold `uLe` @206798901 */
export function isRemoteServeBelowFloor(attestation?: {
  mode?: string
  verdict?: string
}): boolean {
  return (
    attestation?.mode === 'enforce' && attestation.verdict === 'below_floor'
  )
}

/**
 * leftover `iAe` — no Kyr fleet. A below-floor object or the
 * `sender_below_floor` marker is the only enforce+below_floor shape.
 */
export function judgeRemoteServeAttestation(
  status: unknown,
): { mode: string; verdict?: string; status: string } | undefined {
  if (status === undefined || status === null) return undefined
  if (typeof status === 'string') {
    const upper = status.toUpperCase()
    if (upper === 'BELOW_FLOOR' || status === 'sender_below_floor') {
      return { mode: 'enforce', verdict: 'below_floor', status: upper }
    }
    return { mode: 'observe', status: upper }
  }
  const rec = asRecord(status)
  if (!rec) return undefined
  return {
    mode: typeof rec.mode === 'string' ? rec.mode : 'observe',
    ...(typeof rec.verdict === 'string' && { verdict: rec.verdict }),
    status: typeof rec.status === 'string' ? rec.status : 'UNSPECIFIED',
  }
}

export type ServedChannelAnswer = { result: unknown }

export type ServedChannelRequest = {
  requestId: string
  subtype: string
  request: Record<string, unknown>
  signal: AbortSignal
  ageMs?: number
  workerEpoch?: number
  attestationStatus?: unknown
  modeStamp?: unknown
}

export type ServingContext = {
  instanceId: string
  serveSessionToolCall: (
    parsed: ParsedRemoteToolCall,
    ctx: {
      signal: AbortSignal
      requestId: string
      ageMs?: number
      workerEpoch?: number
      attestationStatus?: unknown
      modeStamp?: unknown
    },
  ) => Promise<ServedChannelAnswer | undefined>
  servePlumbingCall: (
    parsed: ParsedRemotePlumbingCall,
    ctx: {
      signal: AbortSignal
      requestId: string
      ageMs?: number
      attestationStatus?: unknown
    },
  ) => Promise<ServedChannelAnswer | undefined>
  answerProbe: () => ServedChannelAnswer | undefined
}

export type ServingContextSeams = {
  instanceId: string
  owner?: boolean
  disposed?: () => boolean
  /** gold `a.kit.deps.sessions.epoch` */
  epoch?: number
  targetName?: string
  runSessionToolCall?: (
    parsed: ParsedRemoteToolCall,
    signal: AbortSignal,
  ) => Promise<unknown>
  plumbing?: {
    names: () => string[]
    serve: (
      parsed: ParsedRemotePlumbingCall,
      signal: AbortSignal,
    ) => Promise<ServedChannelAnswer>
    heldBack?: (
      name: string,
      message: string,
    ) => ServedChannelAnswer | undefined
  }
}

/**
 * leftover `qn` kit @207071604 — not gold Oyr. Empty `{}` is not a kit.
 */
export type LeftoverServedToolsKit = {
  epoch?: number
  targetName?: string
  owner?: boolean
  plumbing?: ServingContextSeams['plumbing']
  runSessionToolCall?: ServingContextSeams['runSessionToolCall']
}

export function isLeftoverServedToolsKit(
  value: unknown,
): value is LeftoverServedToolsKit {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const rec = value as Record<string, unknown>
  return (
    typeof rec.runSessionToolCall === 'function' ||
    typeof rec.plumbing === 'object' ||
    typeof rec.epoch === 'number' ||
    typeof rec.targetName === 'string' ||
    rec.owner === true
  )
}

/** gold `qn` wood-off */
export const SERVED_TOOLS_UNAVAILABLE_FLAG_OFF = 'flag_off'

/**
 * leftover `qn` @207071604. Wood off → `{servedToolsUnavailable:"flag_off"}`.
 * No Oyr; kit is the leftover seam.
 */
export function leftoverQnServedTools(opts: {
  woodOn: boolean
  kit?: LeftoverServedToolsKit
}): {
  servedTools?: LeftoverServedToolsKit
  servedToolsUnavailable?: string
} {
  if (!opts.woodOn) {
    return { servedToolsUnavailable: SERVED_TOOLS_UNAVAILABLE_FLAG_OFF }
  }
  if (opts.kit === undefined) {
    return { servedToolsUnavailable: SERVED_TOOLS_UNAVAILABLE_FLAG_OFF }
  }
  return { servedTools: opts.kit }
}

function leftoverAlreadyQoe(value: unknown): boolean {
  const rec = asRecord(value)
  return (
    asRecord(rec?.structuredContent)?.[REMOTE_TOOL_ENVELOPE_KEY] !== undefined
  )
}

function leftoverCoerceToolCallContent(raw: unknown): {
  content: unknown
  isError: boolean
} {
  const rec = asRecord(raw)
  if (rec && Array.isArray(rec.content)) {
    return { content: rec.content, isError: rec.isError === true }
  }
  if (typeof raw === 'string') {
    return { content: raw, isError: false }
  }
  return {
    content: [{ type: 'text', text: leftoverServedText(raw) }],
    isError: false,
  }
}

/**
 * leftover `Oyr`/`qgo` runner. No admission kit. Missing tool → gold `_ho`
 * then leftover `qoe`. A listed local tool is called with a leftover
 * abort-only context; the return is leftover-`qoe` wrapped.
 */
export async function leftoverRunSessionToolCall(
  parsed: ParsedRemoteToolCall,
  signal: AbortSignal,
): Promise<unknown> {
  const { findToolByName } = await import('../../Tool.js')
  const { getAllBaseTools } = await import('../../tools.js')
  const tool = findToolByName(getAllBaseTools(), parsed.name)
  const target = parsed.host || 'this-machine'
  if (!tool) {
    return leftoverServedRefusedResult({
      targetName: target,
      callId: parsed.tool_use_id,
      code: 'not_served',
      message: remoteToolNotServedOn(parsed.name, target),
    })
  }
  const abort = new AbortController()
  const onAbort = (): void => abort.abort()
  if (signal.aborted) abort.abort()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    const raw = await tool.call(
      parsed.input,
      {
        abortController: abort,
      } as unknown as import('../../Tool.js').ToolUseContext,
      async (_t, input) => ({
        behavior: 'allow' as const,
        updatedInput: input,
      }),
      {
        type: 'assistant',
        message: { content: [] },
      } as unknown as import('../../types/message.js').AssistantMessage,
    )
    if (leftoverAlreadyQoe(raw)) return raw
    const coerced = leftoverCoerceToolCallContent(raw)
    return leftoverServedToolResult({
      envelope: {
        outcome: coerced.isError ? 'failed' : 'completed',
        call_id: parsed.tool_use_id,
        target: { name: target, working_dir: '' },
        ...(coerced.isError && {
          code: 'failed',
          message: leftoverServedText(coerced.content),
        }),
        ...(coerced.isError && { is_error: true }),
      },
      content: coerced.content,
    })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** leftover gold `sync_files` `f` @207176929 */
export const LEFTOVER_SYNC_FILES = 'sync_files'
/** leftover gold `O` */
const LEFTOVER_SYNC_FILES_WAIT_DEFAULT_MS = 15_000
/** leftover gold `F` */
const LEFTOVER_SYNC_FILES_WAIT_CAP_MS = 20_000

export type LeftoverSyncFilesArgs = {
  upTo: number
  upload: boolean
  waitMs: number
  job?: string
}

/**
 * leftover gold `R` @207176929. No `Suo` offer schema (leftover omit).
 */
export function parseLeftoverSyncFilesArgs(
  args: Record<string, unknown>,
): LeftoverSyncFilesArgs {
  const upTo =
    typeof args.up_to === 'number' &&
    Number.isSafeInteger(args.up_to) &&
    args.up_to >= 0
      ? args.up_to
      : 0
  const waitMs =
    typeof args.wait_ms === 'number' &&
    Number.isFinite(args.wait_ms) &&
    args.wait_ms >= 0
      ? Math.min(args.wait_ms, LEFTOVER_SYNC_FILES_WAIT_CAP_MS)
      : LEFTOVER_SYNC_FILES_WAIT_DEFAULT_MS
  const job =
    typeof args.job === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(args.job)
      ? args.job
      : undefined
  return {
    upTo,
    upload: args.upload === true,
    waitMs,
    ...(job !== undefined && { job }),
  }
}

/**
 * leftover gold `j`/`T`/`I` @207176929. No laptop FS engine — gold `e()`
 * undefined → `no_engine`; unknown job id → `unknown_job`. NEVER invent
 * catchUp/syncPoint.
 */
export async function leftoverServeSyncFiles(
  parsed: ParsedRemotePlumbingCall,
  _signal: AbortSignal,
): Promise<ServedChannelAnswer> {
  if (parsed.name !== LEFTOVER_SYNC_FILES) {
    return {
      result: {
        content: [
          {
            type: 'text',
            text: `Unknown plumbing tool: ${sanitizeRemoteServeText(parsed.name, 64)}`,
          },
        ],
        isError: true,
      },
    }
  }
  const args = parseLeftoverSyncFilesArgs(parsed.args)
  const started = Date.now()
  const state =
    args.job !== undefined
      ? { state: 'refused' as const, reason: 'unknown_job' }
      : { state: 'refused' as const, reason: 'no_engine' }
  try {
    logEvent('tengu_dir_sync_device_sync_files', {
      transport:
        'session' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      upload: args.upload,
      rejoined: args.job !== undefined,
      state:
        'refused' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      refused:
        state.reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      duration_ms: Date.now() - started,
    })
  } catch {
    // leftover Xe: logging must not throw out of serve
  }
  return {
    result: {
      content: [{ type: 'text', text: leftoverServedText(state) }],
      structuredContent: state,
      isError: true,
    },
  }
}

/**
 * leftover gold `Mre` @185930444 `return FG()===void 0`.
 * Leftover only `CLAUDE_CODE_DIR_SYNC_ENGINE` none/off/0/false/no.
 * KEEP FG windows/muted/home/mount/profile. NEVER `export function Mre`.
 */
export function leftoverDirSyncPlumbingListed(): boolean {
  const raw = process.env.CLAUDE_CODE_DIR_SYNC_ENGINE
  if (raw === undefined || raw.trim() === '') return true
  const off = new Set(['none', 'off', '0', 'false', 'no'])
  return !raw
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .some(w => off.has(w))
}

/**
 * leftover gold `ae`/`x` @207179070. Gold `x(){return Mre()?[f]:[]}`.
 * heldBack is empty.
 */
export function leftoverServedSessionPlumbing(): NonNullable<
  ServingContextSeams['plumbing']
> {
  return {
    names: () => (leftoverDirSyncPlumbingListed() ? [LEFTOVER_SYNC_FILES] : []),
    serve: leftoverServeSyncFiles,
    heldBack: () => undefined,
  }
}

/** leftover `qn` E — owner/epoch + leftover runner (no Oyr fleet). */
export function leftoverServedToolsKit(): LeftoverServedToolsKit {
  return {
    owner: true,
    epoch: 0,
    runSessionToolCall: leftoverRunSessionToolCall,
    plumbing: leftoverServedSessionPlumbing(),
  }
}

/**
 * leftover `Me`/`kt` stamp onto a delivered control_request so RSM can read
 * `ageMs` / `attestationStatus` / `modeStamp` (gold handleControlRequest extra).
 */
export function stampServeControlRequest(
  payload: Record<string, unknown>,
  meta: Record<string, unknown>,
): Record<string, unknown> {
  if (payload.type !== 'control_request') return payload
  return {
    ...payload,
    ...(typeof meta.ageMs === 'number' && { ageMs: meta.ageMs }),
    ...(meta.attestationStatus !== undefined && {
      attestationStatus: meta.attestationStatus,
    }),
    ...(meta.modeStamp !== undefined && { modeStamp: meta.modeStamp }),
    ...(typeof meta.replayed === 'boolean' && { replayed: meta.replayed }),
    ...(meta.resumed === true && { resumed: true }),
  }
}

/** gold `Nt` @206716330 — Ne replayed uses connectedSince + 2000 */
export const SERVE_INBOUND_REPLAY_GRACE_MS = 2000

/**
 * leftover gold `Ne` @206716334 without serviceClock `Kt`.
 * `ageMs` is wall now − created_at.
 */
function leftoverInboundReplayExtras(
  envelope: Record<string, unknown>,
  connectedSince: number,
  now: number,
): Record<string, unknown> {
  const sentAt =
    typeof envelope.created_at === 'string'
      ? Date.parse(envelope.created_at)
      : Number.NaN
  if (Number.isNaN(sentAt)) return { replayed: true }
  return {
    sentAt,
    replayed: sentAt < connectedSince + SERVE_INBOUND_REPLAY_GRACE_MS,
    ageMs: Math.max(0, now - sentAt),
  }
}

/**
 * leftover gold `Lt` @206716524 — hook_callback / Cle subtypes stamp
 * attestationStatus / modeStamp from the wrapper envelope.
 */
function leftoverInboundAttestationExtras(
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  const payload = asRecord(envelope.payload) ?? envelope
  if (payload.type !== 'control_request') return {}
  const request = asRecord(payload.request)
  const subtype = request?.subtype
  if (
    !(
      subtype === 'hook_callback' ||
      (typeof subtype === 'string' && isRemoteToolsServedSubtype(subtype))
    )
  ) {
    return {}
  }
  const status = envelope.device_attestation_status
  const gate = payload.remote_tool_gate
  const modeStamp =
    gate === undefined || gate === null
      ? undefined
      : gate === 'caller_reauthored'
        ? 'present'
        : 'other'
  return {
    ...(status !== undefined &&
      status !== null && {
        attestationStatus: normalizeServedAttestationStatus(
          typeof status === 'string' ? status.toUpperCase() : status,
        ),
      }),
    ...(modeStamp !== undefined && { modeStamp }),
  }
}

/**
 * gold `ye` unwrap: `{payload, created_at, source, device_attestation_status}`
 * → `onMessage(payload, extras)`. Bare SDK messages stay as-is.
 */
export function serveInboundSessionFrame(
  raw: unknown,
  opts: { connectedSince: number; now: number },
): { message: unknown; extras: Record<string, unknown> } {
  const rec = asRecord(raw)
  if (!rec) return { message: raw, extras: {} }
  const payload = asRecord(rec.payload)
  if (payload && typeof payload.type === 'string') {
    return {
      message: payload,
      extras: {
        ...(typeof rec.source === 'string' && { source: rec.source }),
        ...leftoverInboundReplayExtras(rec, opts.connectedSince, opts.now),
        // gold ye deliver @206726603: `...a.source==="worker"&&Lt(a)`
        ...(rec.source === 'worker'
          ? leftoverInboundAttestationExtras(rec)
          : {}),
      },
    }
  }
  return { message: raw, extras: {} }
}

/** gold `Ze` — one in-flight answer per request_id */
function createAnswerCoalescer(): {
  answer: (
    requestId: string | undefined,
    run: () => Promise<ServedChannelAnswer>,
  ) => Promise<ServedChannelAnswer>
} {
  const inflight = new Map<string, Promise<ServedChannelAnswer>>()
  return {
    answer(requestId, run) {
      if (requestId === undefined) return run()
      const existing = inflight.get(requestId)
      if (existing !== undefined) return existing
      const next = run().finally(() => inflight.delete(requestId))
      inflight.set(requestId, next)
      return next
    },
  }
}

/**
 * leftover `Ie` / `Se` factory. No Oyr admission kit — `runSessionToolCall`
 * is the seam. Missing kit → gold `I===void 0` (leave unanswered).
 */
export function createServingContext(
  seams: ServingContextSeams,
): ServingContext {
  const coalescer = createAnswerCoalescer()
  const targetName = seams.targetName ?? seams.instanceId
  const admits = (parsed: { instance_id: string }): boolean =>
    seams.disposed?.() !== true &&
    seams.owner !== false &&
    parsed.instance_id === seams.instanceId

  return {
    instanceId: seams.instanceId,
    async serveSessionToolCall(parsed, ctx) {
      if (!admits(parsed)) {
        return undefined
      }
      const run = seams.runSessionToolCall ?? leftoverRunSessionToolCall
      const first = isRemoteServeFirstCallLeg(parsed)
      const grace = first
        ? REMOTE_SERVE_FIRST_LEG_GRACE_MS
        : REMOTE_SERVE_SESSION_GRACE_MS
      const dated = remoteServeArrivedInWindow(
        parsed.deadline_ms,
        ctx.ageMs,
        grace,
      )
      const outcomeQuery =
        parsed.request.ok && parsed.request.kind === 'outcome_query'
      // gold `xe` is passed into Oyr as `stale`; leftover has no kit, so a
      // dated miss is still served. Plumbing is the path that returns.
      if (!dated && !outcomeQuery && ctx.ageMs !== undefined) {
        logForDebugging(
          `[remote-tools] a ${parsed.name} call delivered ${ctx.ageMs} ms after it was stored, past its ${parsed.deadline_ms} ms window`,
        )
      }
      const attestation = judgeRemoteServeAttestation(ctx.attestationStatus)
      if (isRemoteServeBelowFloor(attestation)) {
        const message = remoteCommandUnattestedMessage({
          status: attestation?.status ?? 'UNSPECIFIED',
          subtype: 'remote_tool_call',
          targetName,
        })
        return coalescer.answer(ctx.requestId, async () => ({
          result: servedErrorResult(message),
        }))
      }
      return coalescer.answer(ctx.requestId, async () => {
        try {
          const result = await run(parsed, ctx.signal)
          return { result }
        } catch (err) {
          logForDebugging(
            `session serving: served call ${parsed.tool_use_id} threw`,
            { level: 'error' },
          )
          const message = `${targetName} could not serve this call (internal error); nothing is known to have run.`
          return {
            result: leftoverServedToolResult({
              envelope: {
                outcome: 'failed',
                call_id: parsed.tool_use_id,
                target: { name: targetName, working_dir: '' },
                code: 'internal_error',
                message,
              },
              content: [{ type: 'text', text: message }],
            }),
          }
        }
      })
    },
    async servePlumbingCall(parsed, ctx) {
      if (!admits(parsed)) return undefined
      const plumbing = seams.plumbing
      const listed =
        plumbing !== undefined && plumbing.names().includes(parsed.name)
      const logPlumbing = (
        outcome: string,
        extra?: Record<string, unknown>,
      ): void => {
        try {
          logEvent('tengu_remote_plumbing_call', {
            transport:
              'session' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            outcome:
              outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            name_hash:
              parsed.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            ...extra,
          })
        } catch {
          // leftover Xe: logging must not throw out of serve
        }
      }
      if (!listed || plumbing === undefined) {
        logPlumbing('not_served')
        return coalescer.answer(ctx.requestId, async () => ({
          result: servedErrorResult(`${parsed.name}: ${REMOTE_SERVE_NOT_HERE}`),
        }))
      }
      if (
        !remoteServeArrivedInWindow(
          parsed.deadline_ms,
          ctx.ageMs,
          REMOTE_SERVE_PLUMBING_GRACE_MS,
        )
      ) {
        logForDebugging(
          ctx.ageMs === undefined
            ? `[remote-tools] a ${parsed.name} plumbing call could not be dated against the service clock (no Date header on this stream) and was not served`
            : `[remote-tools] a ${parsed.name} plumbing call delivered ${ctx.ageMs} ms after it was stored, past its ${parsed.deadline_ms} ms window, was not served`,
        )
        logPlumbing('stale', { dated: ctx.ageMs !== undefined })
        return undefined
      }
      const attestation = judgeRemoteServeAttestation(ctx.attestationStatus)
      if (isRemoteServeBelowFloor(attestation)) {
        const message = remoteCommandUnattestedMessage({
          status: attestation?.status ?? 'UNSPECIFIED',
          subtype: 'remote_plumbing_call',
          targetName,
        })
        logPlumbing('held_back')
        const prefixed = `${parsed.name}: ${message}`
        return coalescer.answer(ctx.requestId, async () => ({
          result:
            plumbing.heldBack?.(parsed.name, prefixed) ??
            servedErrorResult(prefixed),
        }))
      }
      return coalescer.answer(ctx.requestId, () =>
        Promise.resolve()
          .then(() => plumbing.serve(parsed, ctx.signal))
          .then(result => {
            logPlumbing('served')
            return result
          })
          .catch(err => {
            logForDebugging(
              `session serving: plumbing call ${parsed.name} threw: ${errorMessage(err)}`,
              { level: 'error' },
            )
            logPlumbing('threw')
            return {
              result: servedErrorResult(
                `${parsed.name}: could not be served (internal error)`,
              ),
            }
          }),
      )
    },
    answerProbe: () =>
      seams.disposed?.() === true || seams.owner === false
        ? undefined
        : { result: { epoch: seams.epoch ?? 0 } },
  }
}

/**
 * gold `tr` @206816057
 */
export async function routeServedChannelRequest(
  request: ServedChannelRequest,
  serving: ServingContext,
  parsedToolCall?: ParsedRemoteToolCall,
): Promise<ServedChannelAnswer | undefined> {
  const ctx = {
    signal: request.signal,
    requestId: request.requestId,
    ageMs: request.ageMs,
    workerEpoch: request.workerEpoch,
    attestationStatus: request.attestationStatus,
    modeStamp: request.modeStamp,
  }
  switch (request.subtype) {
    case 'remote_tool_call':
      return parsedToolCall === undefined
        ? undefined
        : serving.serveSessionToolCall(parsedToolCall, ctx)
    case 'remote_plumbing_call': {
      const parsed = parseRemotePlumbingCallRequest(request.request)
      return parsed === undefined
        ? undefined
        : serving.servePlumbingCall(parsed, ctx)
    }
    case 'remote_tools_probe':
      return request.request.instance_id === serving.instanceId
        ? serving.answerProbe()
        : undefined
    case 'remote_tools_reannounce':
      return undefined
    default:
      return undefined
  }
}

/** gold `er` post listener bag @206815531 */
export type ServedChannelPostOutcome = {
  outcome: string
  signMs?: number
  postMs?: number
}

export type ServedChannelReplyBag = {
  callId: string
  leg: 1 | 2 | 'outcome_of'
  approval: string
}

export type ServedChannelManager = {
  respondToServedChannelRequest: (
    requestId: string,
    answer: ServedChannelAnswer,
    onPosted?: (posted: ServedChannelPostOutcome, replyMs: number) => void,
  ) => boolean
  releaseServedChannelRequest: (requestId: string) => void
  /** gold `markServing` — leftover optional */
  markServing?: (serving: boolean) => void
}

/**
 * leftover gold `er` @206815531. NEVER `export function er`.
 */
export function leftoverServedReplyPosted(
  bag: ServedChannelReplyBag,
  serveMs: number,
  posted: ServedChannelPostOutcome,
  replyMs: number,
): void {
  if (bag.leg === 'outcome_of') return
  try {
    logEvent('tengu_remote_tool_serve', {
      op: 'reply' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      call_id:
        bag.callId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      transport:
        'session' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      second_leg: bag.leg === 2,
      approval_decision:
        bag.approval as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      serve_ms: serveMs,
      reply_ms: replyMs,
      ...(posted.outcome === 'accepted' &&
        posted.signMs !== undefined && { reply_sign_ms: posted.signMs }),
      ...(posted.outcome === 'accepted' &&
        posted.postMs !== undefined && { reply_post_ms: posted.postMs }),
      reply_accepted: posted.outcome === 'accepted',
    })
  } catch {
    // leftover er: telemetry must not throw out of Qo
  }
}

/**
 * gold `Qo` @206814317
 */
export async function dispatchServedChannelRequest(
  request: ServedChannelRequest,
  serving: () => ServingContext | null,
  manager: () => ServedChannelManager | undefined,
): Promise<void> {
  const notAnswered = (why: string): void => {
    logForDebugging(
      `[servedChannel] ${request.subtype} ${clipServedRequestId(request.requestId)} not answered here: ${why}`,
    )
    manager()?.releaseServedChannelRequest(request.requestId)
  }
  const current = serving()
  if (current === null) {
    notAnswered('nothing serving')
    return
  }
  const parsed =
    request.subtype === 'remote_tool_call'
      ? parseRemoteToolCallRequest(request.request)
      : undefined
  const started = performance.now()
  const replyBag: ServedChannelReplyBag | undefined =
    parsed?.request.ok === true && parsed.instance_id === current.instanceId
      ? {
          callId: parsed.request.value.call_id,
          leg:
            parsed.request.kind === 'outcome_query'
              ? 'outcome_of'
              : parsed.request.kind === 'call' &&
                  parsed.request.value.approval !== undefined
                ? 2
                : 1,
          approval:
            parsed.request.kind === 'outcome_query'
              ? 'none'
              : parsed.request.kind === 'call'
                ? String(
                    asRecord(parsed.request.value.approval)?.decision ?? 'none',
                  )
                : 'none',
        }
      : undefined
  let answer: ServedChannelAnswer | undefined
  try {
    answer = await routeServedChannelRequest(request, current, parsed)
  } finally {
    // gold `At(()=>v?.observer.legAnswered(...))` — leftover has no observer
  }
  if (answer === undefined) {
    notAnswered("not this client's to answer")
    return
  }
  if (request.signal.aborted) return
  const serveMs = Math.round(performance.now() - started)
  const posted = manager()?.respondToServedChannelRequest(
    request.requestId,
    answer,
    replyBag === undefined
      ? undefined
      : (outcome, replyMs) =>
          leftoverServedReplyPosted(replyBag, serveMs, outcome, replyMs),
  )
  if (posted !== true) {
    logForDebugging(
      `[servedChannel] ${request.subtype} ${clipServedRequestId(request.requestId)} answered after it was withdrawn — result dropped`,
    )
  }
}

/**
 * gold `xn` @206813815
 */
export function createServedChannelBinder(opts: {
  serving: () => ServingContext | null
  manager: () => ServedChannelManager | undefined
}): {
  onServedChannelRequest: (request: ServedChannelRequest) => void
  onServedChannelRequestCancelled: () => void
  abandonInHand: () => void
} {
  const inflight = new Map<string, AbortController>()
  return {
    onServedChannelRequest(request) {
      const abort = new AbortController()
      inflight.set(request.requestId, abort)
      const next: ServedChannelRequest = {
        ...request,
        signal: AbortSignal.any([request.signal, abort.signal]),
      }
      void dispatchServedChannelRequest(next, opts.serving, opts.manager)
        .catch(err => {
          logForDebugging(errorMessage(err), { level: 'error' })
          opts.manager()?.releaseServedChannelRequest(request.requestId)
        })
        .finally(() => inflight.delete(request.requestId))
    },
    onServedChannelRequestCancelled: () => {},
    abandonInHand() {
      for (const [id, abort] of inflight) {
        abort.abort()
        opts.manager()?.releaseServedChannelRequest(id)
      }
      inflight.clear()
    },
  }
}

/**
 * leftover gold `nr` used by `wAt` `cc-${nr()}` @206817107.
 * Gold `nr` is `crypto.randomUUID`. NEVER `export function nr`.
 */
export function leftoverServedInstanceToken(): string {
  return randomUUID()
}

/** gold `cc-${nr()}` — leftover mint; no fleet `nr`. */
export function mintServedInstanceId(): string {
  return `cc-${leftoverServedInstanceToken()}`
}

/**
 * leftover gold `G` @206817084. Logs only — do not invent En announce fleet.
 */
export function leftoverRequestAnnounce(
  reason: string,
  opts?: { workerEpoch?: number },
): void {
  logForDebugging(
    opts?.workerEpoch !== undefined
      ? `[servedChannel] ${reason} worker_epoch=${opts.workerEpoch}`
      : `[servedChannel] ${reason}`,
  )
}

export type BindServedChannelOpts = {
  sessionId: string
  manager: () => ServedChannelManager | undefined
  serving?: ServingContext | (() => ServingContext | null)
  viewerOnly?: boolean
  /** gold `Yf()` — omit to skip the wood gate (tests / already-checked callers). */
  woodOn?: boolean
  /**
   * gold `h.servedTools` / `n.servedTools`. Undefined → do not open the
   * channel. Leftover empty pack is `{}`.
   */
  servedTools?: unknown
  /** gold `Ze` `n.bound`. Explicit false → not_bound (no channel). */
  bound?: boolean
  onReannounceHonoured?: (workerEpoch: number) => void
}

export type BoundServedChannel = {
  instanceId: string
  callbacks: {
    onServedChannelRequest: (request: ServedChannelRequest) => void
    onServedChannelRequestCancelled: () => void
  }
  close: () => void
  /** leftover gold `G` — logs only, no En fleet. */
  requestAnnounce: (reason: string, opts?: { workerEpoch?: number }) => void
}

/**
 * leftover `wAt` @206817084. Gold also owns En announce / markServing.
 * Leftover binds `xn` + `V` reannounce intercept onto the live RSM
 * callbacks. Gold `Ol` @208599454: `h.servedTools===void 0||h.viewerOnly||!Yf()`.
 * Gold `Ze` @206959784: `!n.bound` → not_bound; `n.servedTools===void 0` →
 * unavailable. Empty leftover pack is `{}` (same as createCloudToolsPack).
 */
export function bindServedChannel(
  opts: BindServedChannelOpts,
): BoundServedChannel | null {
  if (opts.viewerOnly === true || opts.woodOn === false) return null
  if (opts.servedTools === undefined) return null
  if (opts.bound === false) return null
  let closed = false
  const provided = opts.serving
  const kit = isLeftoverServedToolsKit(opts.servedTools)
    ? opts.servedTools
    : undefined
  const instanceId =
    typeof provided === 'object' && provided !== null
      ? provided.instanceId
      : mintServedInstanceId()
  const fallback =
    typeof provided === 'function' || provided === undefined
      ? createServingContext({
          instanceId,
          ...(kit?.epoch !== undefined && { epoch: kit.epoch }),
          ...(kit?.targetName !== undefined && { targetName: kit.targetName }),
          ...(kit?.owner !== undefined && { owner: kit.owner }),
          ...(kit?.plumbing !== undefined && { plumbing: kit.plumbing }),
          ...(kit?.runSessionToolCall !== undefined && {
            runSessionToolCall: kit.runSessionToolCall,
          }),
        })
      : provided
  const serving = (): ServingContext | null => {
    if (closed) return null
    if (typeof provided === 'function') return provided()
    return fallback
  }
  const binder = createServedChannelBinder({
    serving,
    manager: opts.manager,
  })
  let lastHonoured: { epoch: number; at: number } | undefined
  let newestWorkerEpoch: number | undefined
  const requestAnnounce = leftoverRequestAnnounce
  return {
    instanceId,
    callbacks: {
      onServedChannelRequest(request) {
        if (request.subtype === 'remote_tools_reannounce') {
          // gold `V`: release first, then honour, then G("worker_asked")
          opts.manager()?.releaseServedChannelRequest(request.requestId)
          const honour = honourRemoteToolsReannounce(request, {
            newestWorkerEpoch,
            lastHonoured,
          })
          if (!honour.honour || honour.workerEpoch === undefined) return
          lastHonoured = { epoch: honour.workerEpoch, at: Date.now() }
          newestWorkerEpoch = honour.workerEpoch
          requestAnnounce('worker_asked', {
            workerEpoch: honour.workerEpoch,
          })
          opts.onReannounceHonoured?.(honour.workerEpoch)
          return
        }
        binder.onServedChannelRequest({
          ...request,
          workerEpoch: request.workerEpoch ?? newestWorkerEpoch,
        })
      },
      onServedChannelRequestCancelled: binder.onServedChannelRequestCancelled,
    },
    requestAnnounce,
    close() {
      if (closed) return
      closed = true
      opts.manager()?.markServing?.(false)
      binder.abandonInHand()
    },
  }
}

export type ReannounceHonour = {
  honour: boolean
  workerEpoch?: number
}

/**
 * gold `V` @206819400 — leftover honour gate. Caller still owns announce.
 * Unreadable / undated / past wait / below-floor / older worker / already
 * answered / rate-limited / announce already out → not honoured.
 */
export function honourRemoteToolsReannounce(
  request: ServedChannelRequest,
  state: {
    newestWorkerEpoch?: number
    lastHonoured?: { epoch: number; at: number }
    announceOutstanding?: boolean
    now?: number
  } = {},
): ReannounceHonour {
  const parsed = parseRemoteToolsReannounceRequest(request.request)
  const now = state.now ?? Date.now()
  const attestation = judgeRemoteServeAttestation(request.attestationStatus)
  const reject =
    parsed === undefined ||
    request.ageMs === undefined ||
    request.ageMs > parsed.deadline_ms ||
    isRemoteServeBelowFloor(attestation) ||
    (state.newestWorkerEpoch !== undefined &&
      parsed.worker_epoch < state.newestWorkerEpoch) ||
    state.lastHonoured?.epoch === parsed.worker_epoch ||
    (state.lastHonoured !== undefined &&
      now - state.lastHonoured.at < REMOTE_SERVE_REANNOUNCE_RATE_MS) ||
    state.announceOutstanding === true
  if (parsed === undefined || reject) {
    logForDebugging(
      '[servedChannel] remote_tools_reannounce not honoured: unreadable, undated, past its wait, from a sender held back, from an older worker, already answered, rate limited, or an announce is already out',
    )
    return { honour: false }
  }
  return { honour: true, workerEpoch: parsed.worker_epoch }
}

const SERVED_RESULT_FLOOR_BYTES = 65_536
const SERVED_RESULT_CEILING_BYTES = 33_554_432
const SERVED_RESULT_DEFAULT_BYTES = 5_242_880
const SERVED_RESULT_HEADROOM_BYTES = 65_536

/**
 * leftover `kst` — GrowthBook `tengu_synthetic_fog` is off here; use the
 * gold default `l - _` (5_242_880 − 65_536).
 */
export function servedChannelResultLimitBytes(): number {
  return SERVED_RESULT_DEFAULT_BYTES - SERVED_RESULT_HEADROOM_BYTES
}

export function clampServedChannelResultLimit(bytes: number): number {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < SERVED_RESULT_FLOOR_BYTES ||
    bytes > SERVED_RESULT_CEILING_BYTES
  ) {
    return SERVED_RESULT_DEFAULT_BYTES
  }
  return bytes
}

/** gold `Be` @206773533 `dn` @206736940 */
export const SERVED_CHANNEL_TOOL_REPLY_TIMEOUT_MS = 120_000

/**
 * leftover gold `Be` @206773533. Probe uses `null` → `{}`. Tool →
 * `{timeoutMs:120000}`. NEVER `export function Be`.
 */
export function leftoverServedSendOpts(kind: 'tool' | null): {
  timeoutMs?: number
} {
  return kind === 'tool'
    ? { timeoutMs: SERVED_CHANNEL_TOOL_REPLY_TIMEOUT_MS }
    : {}
}

/**
 * gold `cn` @206773650
 */
export function wrapServedResultForChannel(
  answer: unknown,
  limitBytes = servedChannelResultLimitBytes(),
): unknown {
  const n = Buffer.byteLength(JSON.stringify(answer), 'utf8')
  if (n <= limitBytes) return answer
  return {
    result: {
      content: [
        {
          type: 'text',
          text: `(the result was too large to return: ${n} bytes, over the ${limitBytes}-byte limit)`,
        },
      ],
      isError: true,
    },
  }
}
