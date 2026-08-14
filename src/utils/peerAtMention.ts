/**
 * densable 2.1.232 #2 — peer session `@` mention (spv / p4p / f4p / d4p / _mv).
 *
 * User types `@name` (or `@"name with spaces"` / `@name [ref]`) to address
 * another live Claude session; resolved attachments drive SendMessage bare name.
 *
 * Gate: densable `ig()` ≈ local `feature('UDS_INBOX')` (+ cross-session product).
 */

import { feature } from 'bun:bundle'
import { basename } from 'path'
import type { PeerCandidate } from '@claude-code/builtin-tools/tools/SendMessageTool/nameResolve.js'
import {
  buildPeerCandidates,
  normalizeAgentName,
} from '@claude-code/builtin-tools/tools/SendMessageTool/nameResolve.js'
import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { normalizeSessionNameKey } from './sessionNameUniqueness.js'

/** densable `tpv` — bare name max code points. */
export const PEER_MENTION_BARE_MAX = 128
/** densable `rpv` — quoted name max code points. */
export const PEER_MENTION_QUOTED_MAX = 200
/** densable `epv` — ask candidates shown. */
export const PEER_MENTION_ASK_CANDIDATES = 3
/** densable `Qdv` — typeahead cap. */
export const PEER_MENTION_TYPEAHEAD_CAP = 20

/** densable `s4p` — ref shape. */
export const PEER_REF_RE = /\[[0-9a-f]{6,12}\]/i
/** densable `c4p` — bare name charset. */
export const PEER_BARE_NAME_RE = /^[\w-]+$/

/**
 * densable `spv` — peer @-token.
 * Leading boundary: start / whitespace / CJK punct.
 * Quoted `"…"` or bare `[\w-]{1,128}` with densable trail rules; optional ` [hexref]`.
 */
export const PEER_AT_MENTION_RE =
  /(?:^|[\s。、？！])@(?:"([^"\n]{1,200})"|([\w-]{1,128})(?=$|[\s,;!?)\]}>'"”’。、？！]|[.:](?:$|\s)|\[[0-9a-f]{6,12}\]))(?:[ \t]*\[([0-9a-f]{6,12})\])?/gu

export type ParsedPeerMention = {
  name: string
  ref?: string
}

export type PeerMentionPool = {
  candidates: PeerMentionCandidate[]
  /** densable `inProcess` — kp keys of main/teammate/subagent + self name. */
  inProcess: Set<string>
  /** densable `defaultNamed` — auto cwd-derived names to hide from typeahead/resolve. */
  defaultNamed: Set<string>
}

export type PeerMentionCandidate = {
  kind: 'session' | 'bridge-session' | 'cloud-session'
  id: string
  name: string
  ref: string
  /** densable where: this-machine | remote-control | cloud */
  where: 'this-machine' | 'remote-control' | 'cloud'
  lastActive?: number
  /** SendMessage `to` token (bare name or name [ref]). */
  token: string
  address: string
}

export type PeerMentionResolved = {
  kind: 'resolved'
  mention: string
  candidate: { token: string; where: string }
}

export type PeerMentionAsk = {
  kind: 'ask'
  mention: string
  candidates: Array<{ token: string; where: string }>
  total: number
}

export type PeerMentionDecision = PeerMentionResolved | PeerMentionAsk

export type PeerMentionAttachment = {
  type: 'peer_mention'
  mention: string
  status: 'resolved' | 'ask'
  candidates: Array<{ token: string; where: string }>
  total: number
}

/** densable `ig()` — peer @mention product gate. */
export function isPeerAtMentionEnabled(): boolean {
  // bun:bundle: feature() only in if / ternary condition position
  return feature('UDS_INBOX') ? true : false
}

/**
 * densable `l4p` — reject quotes/angle/newlines/ref-shape/agent- prefixes.
 */
export function isValidPeerMentionName(name: string): boolean {
  const key = normalizeSessionNameKey(name)
  if (
    name.includes('"') ||
    key.includes('"') ||
    /[<>]/.test(name) ||
    /[<>]/.test(key) ||
    /[\n\r\u2028\u2029]/.test(name) ||
    PEER_REF_RE.test(name) ||
    PEER_REF_RE.test(key) ||
    key.startsWith('agent-') ||
    key.endsWith('(agent)') ||
    key.length === 0
  ) {
    return false
  }
  const codePoints = [...name].length
  if (PEER_BARE_NAME_RE.test(name)) {
    return codePoints <= PEER_MENTION_BARE_MAX
  }
  return codePoints <= PEER_MENTION_QUOTED_MAX
}

/** densable `u4p` / `opv` — display token for a name. */
export function formatPeerMentionDisplay(name: string): string {
  return PEER_BARE_NAME_RE.test(name) ? `@${name}` : `@"${name}"`
}

/**
 * densable `p4p` — matchAll spv → {name, ref?}; bare same-name dropped when a
 * ref variant exists for that name.
 */
export function parsePeerMentions(text: string): ParsedPeerMention[] {
  const raw: ParsedPeerMention[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(PEER_AT_MENTION_RE)) {
    const name = m[1] ?? m[2]
    if (!name || !isValidPeerMentionName(name)) continue
    const ref = m[3]?.toLowerCase()
    const dedupeKey = `${normalizeSessionNameKey(name)}\0${ref ?? ''}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    raw.push(ref !== undefined ? { name, ref } : { name })
  }
  const namedWithRef = new Set(
    raw
      .filter(p => p.ref !== undefined)
      .map(p => normalizeSessionNameKey(p.name)),
  )
  return raw.filter(
    p =>
      p.ref !== undefined || !namedWithRef.has(normalizeSessionNameKey(p.name)),
  )
}

function isDefaultNamed(
  pool: PeerMentionPool,
  c: PeerMentionCandidate,
): boolean {
  return pool.defaultNamed.has(
    `${c.kind}\0${c.id}\0${normalizeSessionNameKey(c.name)}`,
  )
}

/** densable `$Ca` */
export function toPeerMentionCandidateView(c: PeerMentionCandidate): {
  token: string
  where: string
} {
  return { token: c.token, where: formatPeerWhere(c.where) }
}

/** densable `mMo` lite */
export function formatPeerWhere(where: PeerMentionCandidate['where']): string {
  switch (where) {
    case 'this-machine':
      return 'this machine'
    case 'remote-control':
      return 'Remote Control'
    case 'cloud':
      return 'cloud'
  }
}

/**
 * densable `f4p` — resolve parsed mentions against pool.
 * unique bare → resolved; multi → ask; ref exact → resolved/not_found.
 */
export function resolvePeerMentions(
  parsed: ParsedPeerMention[],
  pool: PeerMentionPool,
): PeerMentionDecision[] {
  const out: PeerMentionDecision[] = []
  for (const { name, ref } of parsed) {
    const key = normalizeSessionNameKey(name)
    if (pool.inProcess.has(key)) continue

    const sameName = pool.candidates.filter(
      c => normalizeSessionNameKey(c.name) === key,
    )
    const eligible = sameName.filter(c => !isDefaultNamed(pool, c))
    const display = formatPeerMentionDisplay(name)
    const mention = ref === undefined ? display : `${display} [${ref}]`

    if (ref !== undefined) {
      const hit = sameName.find(c => c.ref === ref)
      if (hit) {
        out.push({
          kind: 'resolved',
          mention,
          candidate: toPeerMentionCandidateView(hit),
        })
        logPeerMentionAnalytics('success')
      } else {
        logPeerMentionAnalytics('not_found')
      }
      continue
    }

    if (eligible.length === 0) continue

    // densable: unique among eligible AND unique among sameName
    if (eligible.length === 1 && sameName.length === 1) {
      out.push({
        kind: 'resolved',
        mention,
        candidate: toPeerMentionCandidateView(eligible[0]!),
      })
      logPeerMentionAnalytics('success')
      continue
    }

    out.push({
      kind: 'ask',
      mention,
      candidates: sameName
        .slice(0, PEER_MENTION_ASK_CANDIDATES)
        .map(toPeerMentionCandidateView),
      total: sameName.length,
    })
    logPeerMentionAnalytics('ask')
  }
  return out
}

function logPeerMentionAnalytics(
  outcome: 'success' | 'ask' | 'not_found',
): void {
  try {
    logEvent(`tengu_at_mention_peer_${outcome}`, {})
  } catch {
    // analytics optional in tests
  }
}

/**
 * densable `d4p` — typeahead rows.
 * id: `dm-peer-${kind}-${ref}-${nameKey}` · display `@name` · desc `message session · where`.
 */
export function buildPeerMentionTypeahead(
  pool: PeerMentionPool,
  queryPrefix: string,
  now = Date.now(),
): Array<{ id: string; displayText: string; description: string }> {
  if (queryPrefix === '') return []
  const prefix = normalizeSessionNameKey(queryPrefix)
  const rows: Array<{ id: string; displayText: string; description: string }> =
    []
  for (const c of pool.candidates) {
    if (rows.length >= PEER_MENTION_TYPEAHEAD_CAP) break
    const key = normalizeSessionNameKey(c.name)
    if (pool.inProcess.has(key) || isDefaultNamed(pool, c)) continue
    if (!key.startsWith(prefix) || !isValidPeerMentionName(c.name)) continue
    const active =
      c.lastActive === undefined
        ? ''
        : ` · active ${formatRelativeActive(Math.max(0, now - c.lastActive))} ago`
    rows.push({
      id: `dm-peer-${c.kind}-${c.ref}-${key}`,
      displayText: formatPeerMentionDisplay(c.name),
      description: `message session · ${formatPeerWhere(c.where)}${active}`,
    })
  }
  return rows
}

function formatRelativeActive(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

/**
 * densable `npv` subset — fold UDS + bridge PeerCandidates into mention pool.
 * `inProcessKeys` = main/self/teammate/subagent name keys to skip.
 * `defaultNamedKeys` = densable defaultNamed composite keys.
 */
export function buildPeerMentionPool(args: {
  peerCandidates: PeerCandidate[]
  inProcessKeys?: Iterable<string>
  defaultNamedKeys?: Iterable<string>
  lastActiveById?: Map<string, number>
}): PeerMentionPool {
  const candidates: PeerMentionCandidate[] = args.peerCandidates.map(c => {
    const where: PeerMentionCandidate['where'] =
      c.kind === 'bridge-session' ? 'remote-control' : 'this-machine'
    const token =
      args.peerCandidates.filter(o => normalizeAgentName(o.name) === c.key)
        .length > 1
        ? `${c.name} [${c.ref}]`
        : c.name
    return {
      kind: c.kind,
      id: c.id,
      name: c.name,
      ref: c.ref,
      where,
      lastActive: args.lastActiveById?.get(c.id),
      token,
      address: c.address,
    }
  })
  // Prefer this-machine, then lastActive desc (densable npv sort)
  candidates.sort((a, b) => {
    const w =
      Number(b.where === 'this-machine') - Number(a.where === 'this-machine')
    if (w !== 0) return w
    return (b.lastActive ?? 0) - (a.lastActive ?? 0)
  })
  // Dedupe kind\0id\0name
  const seen = new Set<string>()
  const deduped = candidates.filter(c => {
    const k = `${c.kind}\0${c.id}\0${normalizeSessionNameKey(c.name)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return {
    candidates: deduped,
    inProcess: new Set(
      [...(args.inProcessKeys ?? [])].map(normalizeSessionNameKey),
    ),
    defaultNamed: new Set(args.defaultNamedKeys ?? []),
  }
}

/**
 * densable `_mv` — attachment pipeline.
 * Filters tokens that already resolved as file paths; builds pool; resolves.
 */
export async function processPeerMentions(
  preExpansionInput: string,
  filePathTokens: Iterable<string>,
  deps?: {
    listUdsPeers?: () => Promise<
      Array<{
        name?: string
        cwd?: string
        messagingSocketPath?: string
        bridgeSessionId?: string | null
        kind?: string
        startedAt?: number
      }>
    >
    listBridgePeers?: () => Promise<
      Array<{ address: string; name?: string; cwd?: string }>
    >
    selfNameKeys?: () => Iterable<string>
  },
): Promise<PeerMentionAttachment[]> {
  if (!isPeerAtMentionEnabled()) return []

  const fileSet = new Set(
    [...filePathTokens].map(t => t.trim()).filter(Boolean),
  )
  const parsed = parsePeerMentions(preExpansionInput).filter(
    p => p.ref !== undefined || !fileSet.has(p.name),
  )
  if (parsed.length === 0) return []

  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const listUds =
      deps?.listUdsPeers ??
      (() =>
        (
          require('./udsClient.js') as typeof import('./udsClient.js')
        ).listPeers())
    const listBridge =
      deps?.listBridgePeers ??
      (() =>
        (
          require('../bridge/peerSessions.js') as typeof import('../bridge/peerSessions.js')
        ).listBridgePeers())
    /* eslint-enable @typescript-eslint/no-require-imports */

    const [udsPeers, bridgePeers] = await Promise.all([listUds(), listBridge()])

    // densable defaultNamed: unnamed sessions whose basename(cwd) slug is used
    const namedSockKeys = new Set<string>()
    for (const p of udsPeers) {
      if (p.name && p.messagingSocketPath) {
        namedSockKeys.add(
          `session\0${p.messagingSocketPath}\0${normalizeSessionNameKey(p.name)}`,
        )
      }
    }
    const defaultNamed = new Set<string>()
    for (const p of udsPeers) {
      if (p.name || !p.cwd || !p.messagingSocketPath) continue
      const slug = normalizeSessionNameKey(basename(p.cwd))
      if (!slug) continue
      const key = `session\0${p.messagingSocketPath}\0${slug}`
      if (!namedSockKeys.has(key)) defaultNamed.add(key)
    }

    // Ensure default-named sessions still appear in candidate list with cwd slug
    // only when they have a real messaging socket (already filtered by listPeers).
    const peersForBuild = udsPeers.map(p => {
      if (p.name?.trim()) return p
      if (p.cwd) {
        const slug = basename(p.cwd)
        if (slug) return { ...p, name: slug }
      }
      return p
    })

    const peerCandidates = buildPeerCandidates({
      udsPeers: peersForBuild,
      bridgePeers,
    })

    const lastActiveById = new Map<string, number>()
    for (const p of udsPeers) {
      if (p.messagingSocketPath && p.startedAt !== undefined) {
        lastActiveById.set(p.messagingSocketPath, p.startedAt)
      }
    }

    const inProcess = new Set<string>([...(deps?.selfNameKeys?.() ?? [])])
    // Always exclude empty
    inProcess.delete('')

    const pool = buildPeerMentionPool({
      peerCandidates,
      inProcessKeys: inProcess,
      defaultNamedKeys: defaultNamed,
      lastActiveById,
    })

    return resolvePeerMentions(parsed, pool).map(d =>
      d.kind === 'resolved'
        ? {
            type: 'peer_mention' as const,
            mention: d.mention,
            status: 'resolved' as const,
            candidates: [d.candidate],
            total: 1,
          }
        : {
            type: 'peer_mention' as const,
            mention: d.mention,
            status: 'ask' as const,
            candidates: d.candidates,
            total: d.total,
          },
    )
  } catch (err) {
    logForDebugging(
      `[peerAtMention] processPeerMentions failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}

/**
 * densable d4p entry for typeahead UI — list peers and filter by prefix.
 * `excludeNames` = teammate/subagent names already listed (avoid duplicate rows).
 */
export async function processPeerMentionsTypeahead(
  queryPrefix: string,
  excludeNames: Iterable<string> = [],
  deps?: {
    listUdsPeers?: () => Promise<
      Array<{
        name?: string
        cwd?: string
        messagingSocketPath?: string
        bridgeSessionId?: string | null
        kind?: string
        startedAt?: number
      }>
    >
    listBridgePeers?: () => Promise<
      Array<{ address: string; name?: string; cwd?: string }>
    >
  },
): Promise<Array<{ id: string; displayText: string; description: string }>> {
  if (!isPeerAtMentionEnabled() || queryPrefix === '') return []
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const listUds =
      deps?.listUdsPeers ??
      (() =>
        (
          require('./udsClient.js') as typeof import('./udsClient.js')
        ).listPeers())
    const listBridge =
      deps?.listBridgePeers ??
      (() =>
        (
          require('../bridge/peerSessions.js') as typeof import('../bridge/peerSessions.js')
        ).listBridgePeers())
    /* eslint-enable @typescript-eslint/no-require-imports */
    const [udsPeers, bridgePeers] = await Promise.all([listUds(), listBridge()])
    const peersForBuild = udsPeers.map(p => {
      if (p.name?.trim()) return p
      if (p.cwd) {
        const slug = basename(p.cwd)
        if (slug) return { ...p, name: slug }
      }
      return p
    })
    const peerCandidates = buildPeerCandidates({
      udsPeers: peersForBuild,
      bridgePeers,
    })
    const lastActiveById = new Map<string, number>()
    for (const p of udsPeers) {
      if (p.messagingSocketPath && p.startedAt !== undefined) {
        lastActiveById.set(p.messagingSocketPath, p.startedAt)
      }
    }
    const exclude = new Set(
      [...excludeNames].map(n => normalizeSessionNameKey(n)),
    )
    const pool = buildPeerMentionPool({
      peerCandidates,
      inProcessKeys: exclude,
      lastActiveById,
    })
    return buildPeerMentionTypeahead(pool, queryPrefix)
  } catch (err) {
    logForDebugging(
      `[peerAtMention] typeahead failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}

/** Re-export nameResolve helpers for tests that build raw candidates. */
export {
  assignUniqueRefs,
  buildPeerCandidates,
  normalizeAgentName,
} from '@claude-code/builtin-tools/tools/SendMessageTool/nameResolve.js'
