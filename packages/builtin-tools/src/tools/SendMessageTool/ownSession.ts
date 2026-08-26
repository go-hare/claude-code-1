/**
 * densable 2.1.239 #50 — DHm / G1w / DEe / Qen / Zen / Jen.
 * DHm / Qen / Jen read `QV()` (`getRegisteredSessionName`), not session title.
 */
import { parseAddress } from 'src/utils/peerAddress.js'
import { MAIN_RECIPIENT_NAME } from 'src/utils/swarm/constants.js'
import {
  getUdsMessagingSocketPath,
  isLocalSocketAddress,
  messagingSocketsAreSame,
} from 'src/utils/udsMessaging.js'
import { sanitizeListingName } from '../ListPeersTool/teammatesListing.js'
import {
  normalizeAgentName,
  parseNameRef,
  pinDigest,
  shortPinRef,
} from './nameResolve.js'

/** densable sti — v_a refuses refs shorter than this. */
const SESSION_REF_MIN = 6

export type OwnSessionRef = {
  name: string
  token: string
  callerIsSubagent: boolean
}

/** densable iBr lite — name looks like a messaging address, not a label. */
function isAddressLikeOwnName(value: string): boolean {
  const norm = normalizeAgentName(value)
  return (
    parseAddress(value).scheme !== 'other' ||
    parseAddress(norm).scheme !== 'other'
  )
}

/** densable __a / MFn — ALe + addressable + not MAIN. */
export function sanitizeOwnSessionName(
  name: string | undefined | null,
): string | null {
  const cleaned = sanitizeListingName(name)
  if (cleaned === null) return null
  if (isAddressLikeOwnName(cleaned)) return null
  if (!isLocalSocketAddress(cleaned)) return null
  if (cleaned.includes('@') || cleaned === '*') return null
  if (normalizeAgentName(cleaned) === MAIN_RECIPIENT_NAME) return null
  return cleaned
}

/**
 * densable `g5` — caller is an in-process teammate or a non-main subagent.
 * `teammateContext` / `agentContext` are official tool-context fields; tip
 * maps them from ALS + `context.agentId`.
 */
export function callerIsSubagentFromContext(input: {
  teammateContext: unknown
  agentContext: { agentType?: string; isMainSession?: boolean } | undefined
}): boolean {
  if (input.teammateContext !== undefined) return true
  const agent = input.agentContext
  return (
    agent !== undefined &&
    agent.agentType === 'subagent' &&
    !agent.isMainSession
  )
}

/** densable DHm — `MFn(QV()?.name)` + socket pin; no inbox or no QV → null. */
export function describeOwnSession(
  callerIsSubagent = false,
): OwnSessionRef | null {
  const sock = getUdsMessagingSocketPath()
  if (!sock) return null
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getRegisteredSessionName } =
    require('src/utils/concurrentSessions.js') as typeof import('src/utils/concurrentSessions.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const name = sanitizeOwnSessionName(getRegisteredSessionName()?.name)
  if (name === null) return null
  return {
    name,
    token: `${name} [${shortPinRef('session', sock)}]`,
    callerIsSubagent,
  }
}

const ADDRESS_MAIN = `address the main conversation as "${MAIN_RECIPIENT_NAME}"`

/** densable Qen. */
export type OwnNameClass = 'no' | 'categorical' | 'note'

export function classifyOwnNameTarget(to: string): OwnNameClass {
  const sock = getUdsMessagingSocketPath()
  if (!sock || parseAddress(to).scheme !== 'other') return 'no'
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getHeldSessionNames, getRegisteredSessionName } =
    require('src/utils/concurrentSessions.js') as typeof import('src/utils/concurrentSessions.js')
  const { sessionNameState } =
    require('src/utils/sessionNameUniqueness.js') as typeof import('src/utils/sessionNameUniqueness.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const registered = getRegisteredSessionName()
  if (registered === undefined) return 'no'
  const parsed = parseNameRef(to)
  if (parsed) {
    if (parsed.ref.length < SESSION_REF_MIN) return 'no'
    if (!pinDigest('session', sock).startsWith(parsed.ref)) return 'no'
    if (
      normalizeAgentName(parsed.name) !== normalizeAgentName(registered.name)
    ) {
      const held = getHeldSessionNames().get(normalizeAgentName(parsed.name))
      if (held === undefined) return 'no'
      return held === 'derived' ? 'categorical' : 'note'
    }
  } else if (normalizeAgentName(to) !== normalizeAgentName(registered.name)) {
    return 'no'
  }
  return registered.source === 'derived' ||
    ((registered.source === 'user' || registered.source === 'collision') &&
      sessionNameState.userTypedName === registered.name)
    ? 'categorical'
    : 'note'
}

/** densable leftover closest同名 — Vu(closest.name) === Vu(WCe(to)?.name ?? to). */
export function leftoverClosestHasSameName(
  to: string,
  closest: Array<{ name: string }>,
): boolean {
  const queryName = normalizeAgentName(parseNameRef(to)?.name ?? to)
  return closest.some(c => normalizeAgentName(c.name) === queryName)
}

/** densable not-found DEe: Qen==="categorical" && !closest同名 && Zen. */
export function leftoverNotFoundIsSelfSend(
  qen: OwnNameClass,
  to: string,
  closest: Array<{ name: string }>,
  zen: boolean,
): boolean {
  return (
    qen === 'categorical' && !leftoverClosestHasSameName(to, closest) && zen
  )
}

/** densable ambiguous DEe: Qen==="categorical" && matchedBy==="prefix" && Zen. */
export function leftoverAmbiguousIsSelfSend(
  qen: OwnNameClass,
  matchedBy: 'exact' | 'prefix' | undefined,
  zen: boolean,
): boolean {
  return qen === 'categorical' && matchedBy === 'prefix' && zen
}

/** densable leftover Zen — missing unavailable flags mean available. */
export function isOwnNameSearchComplete(opts: {
  searchTruncated?: boolean
  pinnedIdentityClaimedLocally?: string
  cloudUnavailable?: boolean
  bridgeUnavailable?: boolean
  localUnavailable?: boolean
}): boolean {
  return (
    !opts.cloudUnavailable &&
    !opts.bridgeUnavailable &&
    !opts.localUnavailable &&
    !opts.searchTruncated &&
    !opts.pinnedIdentityClaimedLocally
  )
}

/** densable Jen */
export function formatOwnNameAlsoNote(
  to: string,
  callerIsSubagent = false,
): string {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getRegisteredSessionName } =
    require('src/utils/concurrentSessions.js') as typeof import('src/utils/concurrentSessions.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const name = sanitizeOwnSessionName(getRegisteredSessionName()?.name)
  const label = name === null ? 'this session' : `this session ("${name}")`
  if (callerIsSubagent) {
    return `\n('${to}' also addresses ${label} — this process's main session; to reach the main conversation from inside it, ${ADDRESS_MAIN}.)`
  }
  return `\n('${to}' also addresses ${label} itself — if you meant yourself, there is no one to send to.)`
}

/** densable G1w */
export function formatOwnSessionListing(
  self: OwnSessionRef | null,
): string | null {
  if (!self) return null
  if (self.callerIsSubagent) {
    return `This process's main session is ${self.token} — the name OTHER sessions use to message it (it is not listed below; from inside this process, address the main conversation as "${MAIN_RECIPIENT_NAME}").`
  }
  return `This session is ${self.token} — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).`
}

/** densable DEe */
export function formatSelfSendMessage(
  to: string,
  registeredName: string | null,
  callerIsSubagent = false,
): string {
  if (callerIsSubagent) {
    const hint = registeredName
      ? ` ("${registeredName}" is the name OTHER sessions use for it)`
      : ''
    return `'${to}' is this process's own main session${hint} — from inside it, ${ADDRESS_MAIN} instead.`
  }
  if (registeredName) {
    return `'${to}' is this session itself — "${registeredName}" is the name other sessions use to message YOU; there is no one else by that name to send to.`
  }
  return `'${to}' is this session itself — there is no one else at that address to send to.`
}

/** densable sWt */
export function formatOwnNameNotSentDisplay(to: string): string {
  return `Not sent — '${to}' is this session's own name.`
}

/** densable vWi */
export const SELF_SEND_ERROR_CLASS =
  'target is this session itself — there is no one else to send to'

export function isOwnSessionTarget(
  to: string,
  self: OwnSessionRef | null,
): boolean {
  if (!self) return false
  const parsed = to.trim()
  if (parsed === self.token) return true
  return normalizeAgentName(parsed) === normalizeAgentName(self.name)
}

/** densable lRw — `to` is name [ref] whose ref hashes to this inbox. */
export function isOwnSessionNameRefToken(to: string): boolean {
  const own = getUdsMessagingSocketPath()
  if (own === undefined) return false
  const parsed = parseNameRef(to)
  if (parsed === null || parsed.ref.length < SESSION_REF_MIN) return false
  return pinDigest('session', own).startsWith(parsed.ref)
}

/** densable Jio — own name [ref], but candidate socket is not HFn-ours. */
export function isImpersonatingOwnSession(
  to: string,
  candidateSocket: string,
): boolean {
  const own = getUdsMessagingSocketPath()
  if (own === undefined) return false
  return (
    isOwnSessionNameRefToken(to) &&
    !messagingSocketsAreSame(candidateSocket, own)
  )
}

/** densable Zio */
export function formatImpersonationMessage(to: string): string {
  return `'${to}' is the name-and-ref token this session advertises for ITSELF, yet a different session record on this machine claims it — not sent. A record impersonating this session is suspicious: ask the user. (If you meant yourself, there is no one to send to.)`
}

/** densable Kwm */
export function formatImpersonationDisplay(to: string): string {
  return `Not sent — '${to}' is this session's own name and ref, but another session record on this machine claims it.`
}
