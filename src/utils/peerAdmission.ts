/**
 * densable 2.1.289 `z2r` / At admit host — peer hopChain + rate/dedup guard.
 *
 * Gold zo = z2r({}, WUt); yr calls zo.checkHopChain / zo.admit.
 * Reuses udsOutboundPacer refill / tracked-map helpers (same Nhn limits).
 * Never export minify z2r|zo|At|yr|Ko|ds.
 */

import { createHmac, randomBytes } from 'crypto'
import type { PeerReceiptDropReason } from './peerReceipts.js'
import {
  type HarborKiteLimits,
  getHarborKiteLimits,
  getOrInsertTracked,
  hasToken,
  refillTokens,
} from './udsOutboundPacer.js'

/** Gold `y` / `zVt` — HMAC hex prefix and hop-chain cap. */
export const HOP_TOKEN_HEX_LEN = 24
export const HOP_CHAIN_CAP = 32

/** Gold `n=randomBytes(32)` process-local HMAC key for `cBe`/`F7o`. */
const hopHmacKey = randomBytes(32)

export type PeerAdmissionLimits = HarborKiteLimits

/** densable Nhn + Oe — mirror DEFAULT_HARBOR_KITE_LIMITS (incl. queue cap). */
export const DEFAULT_PEER_ADMISSION_LIMITS: PeerAdmissionLimits = {
  bucketCapacity: 30,
  refillPerSecond: 0.5,
  dedupWindowMs: 30_000,
  maxSelfHops: 10,
  maxChainLength: 28,
  maxTrackedSenders: 256,
  maxQueuedPeerMessages: 50,
}

export type PeerHopChainResult =
  | { admitted: false; reason: 'hop-loop' | 'hop-runaway' }
  | undefined

export type PeerAdmitInput = {
  senderKey: string
  body: string
  hopChain?: readonly string[]
  ownTokens: ReadonlySet<string>
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
  ): PeerHopChainResult {
    const lim = current()
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
    const hop = checkHopChain(input.hopChain, input.ownTokens)
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

/** Process-wide zo — densable `zo = z2r({}, WUt)`. */
let sharedGuard: PeerAdmissionGuard | undefined

export function getPeerAdmissionGuard(): PeerAdmissionGuard {
  return (sharedGuard ??= createPeerAdmissionGuard({}, getPeerAdmissionLimits))
}

export function resetPeerAdmissionGuardForTests(): void {
  sharedGuard?.reset()
  sharedGuard = undefined
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
 * densable `q2r` / `jUt` / `spe` / `K2r`.
 * Test provider still replaces the whole set (hop-loop unit tests).
 */
let ownUdsHopToken: string | undefined
let ownBridgeHopResolver: (() => string | undefined) | undefined
let ownHopTokensProvider: (() => ReadonlySet<string>) | undefined

/** Gold `q2r(e)` — `e===void 0` clears; else `cBe(e)`. */
export function setOwnUdsHopAddress(address: string | undefined): void {
  ownUdsHopToken =
    address === undefined ? undefined : hashAddressToHopToken(address)
}

export function getOwnUdsHopToken(): string | undefined {
  return ownUdsHopToken
}

/**
 * Gold `jUt(Sjt)` — resolver returns `bridge:${session}` (Sjt/xEe/H_n).
 * `K2r` HMAC's the address. `undefined` clears (gold `jUt(void 0)`).
 */
export function setOwnBridgeHopAddressResolver(
  resolver: (() => string | undefined) | undefined,
): void {
  ownBridgeHopResolver = resolver
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
  ownHopTokensProvider = provider ?? undefined
  if (provider === null) {
    ownUdsHopToken = undefined
    ownBridgeHopResolver = undefined
  }
}

export function getOwnHopTokens(): ReadonlySet<string> {
  if (ownHopTokensProvider) return ownHopTokensProvider()
  const tokens = new Set<string>()
  if (ownUdsHopToken) tokens.add(ownUdsHopToken)
  const bridge = ownBridgeHopResolver?.()
  if (bridge) tokens.add(hashAddressToHopToken(bridge))
  const remote = remoteSessionHopAddress()
  if (remote) tokens.add(hashAddressToHopToken(remote))
  return tokens
}
