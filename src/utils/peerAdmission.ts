/**
 * densable 2.1.289 `z2r` / At admit host — peer hopChain + rate/dedup guard.
 *
 * Gold zo = z2r({}, WUt); yr calls zo.checkHopChain / zo.admit.
 * Reuses udsOutboundPacer refill / tracked-map helpers (same Nhn limits).
 * Never export minify z2r|zo|At|yr|Ko|ds.
 */

import { createHmac, randomBytes } from 'crypto'
import type { PeerReceiptDropReason } from './peerReceipts.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'

export type { PeerReceiptDropReason }
import {
  type HarborKiteLimits,
  getHarborKiteLimits,
  getOrInsertTracked,
  hasToken,
  refillTokens,
  shouldSkipLocalHopCount,
} from './udsOutboundPacer.js'

/** Gold `y` / `zVt` — HMAC hex prefix and hop-chain cap. */
export const HOP_TOKEN_HEX_LEN = 24
export const HOP_CHAIN_CAP = 32

/** Gold `n=randomBytes(32)` process-local HMAC key for `cBe`/`F7o`. */
const hopHmacKey = randomBytes(32)

export type PeerAdmissionLimits = HarborKiteLimits

/** densable Nhn + Oe + 2.1.323 #2164 — mirror DEFAULT_HARBOR_KITE_LIMITS (incl. queue & same-machine caps). */
export const DEFAULT_PEER_ADMISSION_LIMITS: PeerAdmissionLimits = {
  bucketCapacity: 30,
  refillPerSecond: 0.5,
  dedupWindowMs: 30_000,
  maxSelfHops: 10,
  maxChainLength: 28,
  maxTrackedSenders: 256,
  maxQueuedPeerMessages: 50,
  maxDesktopForwards: 100_000,
  maxLocalRelays: 100_000,
  countLocalHops: false,
}

/**
 * Official 2.1.323 #2101: settle desktop/host busy state when a peer message
 * is dropped (duplicate, rate-limited, queue-full, hop-loop, hop-runaway) so
 * Claude Desktop does not stay stuck as busy waiting for a turn that will
 * never start.
 */
export function buildDroppedPeerMessageHoldFrame(input: {
  sessionId: string
  messageUuid?: string
  lane: 'bridge' | 'stdin' | 'socket'
  from: string
  outcome: PeerReceiptDropReason
}): {
  type: 'system'
  subtype: 'peer_message_hold'
  state: 'dropped'
  lane: 'bridge' | 'stdin' | 'socket'
  from: string
  outcome: PeerReceiptDropReason
  session_id: string
  message_uuid?: string
} {
  return {
    type: 'system',
    subtype: 'peer_message_hold',
    state: 'dropped',
    lane: input.lane,
    from: input.from,
    outcome: input.outcome,
    session_id: input.sessionId,
    ...(input.messageUuid !== undefined
      ? { message_uuid: input.messageUuid }
      : {}),
  }
}

export type PeerHopChainResult =
  | { admitted: false; reason: 'hop-loop' | 'hop-runaway' }
  | undefined

export type PeerAdmitInput = {
  senderKey: string
  body: string
  hopChain?: readonly string[]
  ownTokens: ReadonlySet<string>
  /** Official 2.1.328 (`chunk@319503157.js`) — verified same-machine peer exempt from local hop counting when countLocalHops is false. */
  verifiedLocal?: boolean
}

export type PeerAdmitResult =
  | { admitted: true }
  | {
      admitted: false
      reason: Exclude<PeerReceiptDropReason, 'queue-full'>
    }

export type PeerAdmissionGuard = {
  admit: (input: PeerAdmitInput) => PeerAdmitResult
  checkHopChain: (
    hopChain: readonly string[] | undefined,
    ownTokens: ReadonlySet<string>,
    opts?: { verifiedLocal?: boolean },
  ) => PeerHopChainResult
  trackedSenderCount: () => number
  reset: () => void
}

type SenderBucket = {
  tokens: number
  lastRefill: number
  lastBody: string | undefined
  lastBodyAt: number
}

/** densable `_e` — count of hop tokens that belong to this session. */
export function countOwnHopTokens(
  hopChain: readonly string[] | undefined,
  ownTokens: ReadonlySet<string>,
): number {
  if (!hopChain || ownTokens.size === 0) return 0
  let n = 0
  for (const token of hopChain) {
    if (ownTokens.has(token)) n++
  }
  return n
}

/**
 * densable `z2r` — create admit / checkHopChain host.
 * `base` overlays static defaults; `limits()` overlays per-call (gold WUt).
 */
export function createPeerAdmissionGuard(
  base: Partial<PeerAdmissionLimits> = {},
  limits?: () => Partial<PeerAdmissionLimits>,
  nowFn: () => number = Date.now,
): PeerAdmissionGuard {
  const staticLimits: PeerAdmissionLimits = {
    ...DEFAULT_PEER_ADMISSION_LIMITS,
    ...base,
  }

  const current = (): PeerAdmissionLimits =>
    limits ? { ...staticLimits, ...limits() } : staticLimits

  const senders = new Map<string, SenderBucket>()

  function touch(senderKey: string, lim: PeerAdmissionLimits): SenderBucket {
    return getOrInsertTracked(
      senders,
      senderKey,
      lim.maxTrackedSenders,
      () => ({
        tokens: lim.bucketCapacity,
        lastRefill: nowFn(),
        lastBody: undefined,
        lastBodyAt: 0,
      }),
    )
  }

  function checkHopChain(
    hopChain: readonly string[] | undefined,
    ownTokens: ReadonlySet<string>,
    opts?: { verifiedLocal?: boolean },
  ): PeerHopChainResult {
    const lim = current()
    if (shouldSkipLocalHopCount({ verifiedLocal: opts?.verifiedLocal }, lim)) {
      return undefined
    }
    if (hopChain !== undefined && hopChain.length > lim.maxChainLength) {
      return { admitted: false, reason: 'hop-runaway' }
    }
    if (countOwnHopTokens(hopChain, ownTokens) >= lim.maxSelfHops) {
      return { admitted: false, reason: 'hop-loop' }
    }
    return undefined
  }

  function admit(input: PeerAdmitInput): PeerAdmitResult {
    const lim = current()
    const now = nowFn()
    const hop = checkHopChain(input.hopChain, input.ownTokens, {
      verifiedLocal: input.verifiedLocal,
    })
    if (hop) return hop
    const bucket = touch(input.senderKey, lim)
    if (
      bucket.lastBody !== undefined &&
      bucket.lastBody === input.body &&
      now - bucket.lastBodyAt < lim.dedupWindowMs
    ) {
      return { admitted: false, reason: 'duplicate' }
    }
    bucket.tokens = refillTokens(
      bucket.tokens,
      bucket.lastRefill,
      now,
      lim.bucketCapacity,
      lim.refillPerSecond,
    )
    bucket.lastRefill = now
    if (!hasToken(bucket.tokens)) {
      return { admitted: false, reason: 'rate-limited' }
    }
    bucket.tokens -= 1
    bucket.lastBody = input.body
    bucket.lastBodyAt = now
    return { admitted: true }
  }

  return {
    admit,
    checkHopChain,
    trackedSenderCount: () => senders.size,
    reset: () => {
      senders.clear()
    },
  }
}

/** densable WUt — harbor kite limits including maxQueuedPeerMessages. */
export function getPeerAdmissionLimits(): PeerAdmissionLimits {
  return getHarborKiteLimits()
}

type PeerAdmissionHostState = {
  sharedGuard: PeerAdmissionGuard | undefined
  sharedDesktopForwardGuard: DesktopForwardGuard | undefined
  ownUdsHopToken: string | undefined
  ownBridgeHopResolver: (() => string | undefined) | undefined
  ownHopTokensProvider: (() => ReadonlySet<string>) | undefined
}

const peerAdmissionHostSlot = new HostSlot<PeerAdmissionHostState>(() => ({
  sharedGuard: undefined,
  sharedDesktopForwardGuard: undefined,
  ownUdsHopToken: undefined,
  ownBridgeHopResolver: undefined,
  ownHopTokensProvider: undefined,
}))

function getPeerAdmissionHostState(): PeerAdmissionHostState {
  return peerAdmissionHostSlot.of(getBootstrapSessionHost())
}

/** Per-host zo — densable `zo = z2r({}, WUt)`. */
export function getPeerAdmissionGuard(): PeerAdmissionGuard {
  const hostState = getPeerAdmissionHostState()
  return (hostState.sharedGuard ??= createPeerAdmissionGuard(
    {},
    getPeerAdmissionLimits,
  ))
}

export function resetPeerAdmissionGuardForTests(): void {
  const hostState = getPeerAdmissionHostState()
  hostState.sharedGuard?.reset()
  hostState.sharedGuard = undefined
}

export type DesktopForwardCheckResult =
  | { admitted: true }
  | { admitted: false; reason: 'loop-paused'; forwards: number }

export type DesktopForwardGuard = {
  /** Official `Fea` (`chunk@305735424.js @1358`) — increment & enforce `maxDesktopForwards` per prompt index. */
  checkForward: (promptIndex: number) => DesktopForwardCheckResult
  /** Official `Nea` (`chunk@305735424.js @1358`) — reset counter when a human prompt starts a turn. */
  resetForNewPrompt: () => void
  getForwardsSincePrompt: () => number
}

/**
 * Official 2.1.328 (`Fea` / `Nea` in `chunk@305735424.js @1358`) — bound
 * desktop message forwards per user prompt using `maxDesktopForwards`.
 */
export function createDesktopForwardGuard(
  limits?: () => Partial<PeerAdmissionLimits>,
): DesktopForwardGuard {
  let promptIndexSeen = -1
  let forwardsSincePrompt = 0

  const currentMax = (): number =>
    limits?.().maxDesktopForwards ?? getPeerAdmissionLimits().maxDesktopForwards

  return {
    checkForward(promptIndex: number): DesktopForwardCheckResult {
      if (promptIndex !== promptIndexSeen) {
        promptIndexSeen = promptIndex
        forwardsSincePrompt = 0
      }
      forwardsSincePrompt++
      if (forwardsSincePrompt > currentMax()) {
        return {
          admitted: false,
          reason: 'loop-paused',
          forwards: forwardsSincePrompt - 1,
        }
      }
      return { admitted: true }
    },
    resetForNewPrompt(): void {
      forwardsSincePrompt = 0
    },
    getForwardsSincePrompt(): number {
      return forwardsSincePrompt
    },
  }
}

export function getDesktopForwardGuard(): DesktopForwardGuard {
  const hostState = getPeerAdmissionHostState()
  return (hostState.sharedDesktopForwardGuard ??= createDesktopForwardGuard(
    getPeerAdmissionLimits,
  ))
}

export function resetDesktopForwardGuardForTests(): void {
  getPeerAdmissionHostState().sharedDesktopForwardGuard = undefined
}

/**
 * densable `cBe`/`F7o` — HMAC-SHA256 hex[:24] of `uds:${path}` / `bridge:…`.
 * Never export minify `cBe`/`F7o`.
 */
export function hashAddressToHopToken(address: string): string {
  return createHmac('sha256', hopHmacKey)
    .update(address)
    .digest('hex')
    .slice(0, HOP_TOKEN_HEX_LEN)
}

/** densable `Tkn` — append own token, cap at zVt. */
export function appendHopChain(
  existing: readonly string[] | undefined,
  token: string | undefined,
): string[] | undefined {
  const next = existing ? [...existing] : []
  if (token) next.push(token)
  if (next.length === 0) return undefined
  return next.length > HOP_CHAIN_CAP
    ? next.slice(next.length - HOP_CHAIN_CAP)
    : next
}

/**
 * densable `Tkn` @180508768 — `if (e === void 0) return;` else append own
 * hop token and cap at `HOP_CHAIN_CAP`.
 */
export function advancePeerHopChain(
  inboundHopChain: readonly string[] | undefined,
  ownToken: string | undefined,
): string[] | undefined {
  if (inboundHopChain === undefined) return undefined
  return appendHopChain(inboundHopChain, ownToken)
}

/**
 * densable `TWe` @180509950 — walk messages backwards for the latest
 * non-tool-result, non-compact-summary user message; if its origin is `peer`,
 * return `origin.hopChain ?? []`, otherwise `undefined`.
 */
export function extractInboundPeerHopChain(
  messages:
    | ReadonlyArray<{
        type?: string
        toolUseResult?: unknown
        isCompactSummary?: boolean
        origin?: { kind?: string; hopChain?: readonly string[] }
      }>
    | undefined,
): readonly string[] | undefined {
  if (!messages) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (
      !msg ||
      msg.type !== 'user' ||
      msg.toolUseResult ||
      msg.isCompactSummary
    ) {
      continue
    }
    return msg.origin?.kind === 'peer' ? (msg.origin.hopChain ?? []) : undefined
  }
  return undefined
}

const HOST_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/

/**
 * densable `Orr` @182140060 — hostSessionId stamped as `from-session` on UDS
 * envelopes when running non-interactively outside nested child/CLAUDECODE.
 */
export function resolveHostSessionIdForCrossSession(): string | undefined {
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_CHILD_SESSION) {
    return undefined
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getIsNonInteractiveSession } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    if (!getIsNonInteractiveSession()) return undefined
  } catch {
    return undefined
  }
  const raw = process.env.CLAUDE_CODE_HOST_SESSION_ID
  if (typeof raw !== 'string' || !HOST_SESSION_ID_RE.test(raw)) return undefined
  return raw
}

/**
 * densable `q2r` / `jUt` / `spe` / `K2r`.
 * Test provider still replaces the whole set (hop-loop unit tests).
 */

/** Gold `q2r(e)` — `e===void 0` clears; else `cBe(e)`. */
export function setOwnUdsHopAddress(address: string | undefined): void {
  getPeerAdmissionHostState().ownUdsHopToken =
    address === undefined ? undefined : hashAddressToHopToken(address)
}

export function getOwnUdsHopToken(): string | undefined {
  return getPeerAdmissionHostState().ownUdsHopToken
}

/**
 * Gold `jUt(Sjt)` — resolver returns `bridge:${session}` (Sjt/xEe/H_n).
 * `K2r` HMAC's the address. `undefined` clears (gold `jUt(void 0)`).
 */
export function setOwnBridgeHopAddressResolver(
  resolver: (() => string | undefined) | undefined,
): void {
  getPeerAdmissionHostState().ownBridgeHopResolver = resolver
}

/** Gold `spe` — remote session id → `bridge:${id}` then HMAC in K2r. */
function remoteSessionHopAddress(): string | undefined {
  try {
    const { isRemoteEnvEnabled } =
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    if (!isRemoteEnvEnabled()) return undefined
  } catch {
    if (process.env.CLAUDE_CODE_REMOTE !== 'true') return undefined
  }
  const id = process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? ''
  if (!(id.startsWith('session_') || id.startsWith('cse_'))) return undefined
  if (id.length === 0) return undefined
  return `bridge:${id}`
}

export function setOwnHopTokensProviderForTests(
  provider: (() => ReadonlySet<string>) | null,
): void {
  const hostState = getPeerAdmissionHostState()
  hostState.ownHopTokensProvider = provider ?? undefined
  if (provider === null) {
    hostState.ownUdsHopToken = undefined
    hostState.ownBridgeHopResolver = undefined
  }
}

export function getOwnHopTokens(): ReadonlySet<string> {
  const hostState = getPeerAdmissionHostState()
  if (hostState.ownHopTokensProvider) return hostState.ownHopTokensProvider()
  const tokens = new Set<string>()
  if (hostState.ownUdsHopToken) tokens.add(hostState.ownUdsHopToken)
  const bridge = hostState.ownBridgeHopResolver?.()
  if (bridge) tokens.add(hashAddressToHopToken(bridge))
  const remote = remoteSessionHopAddress()
  if (remote) tokens.add(hashAddressToHopToken(remote))
  return tokens
}
