/**
 * densable ip / jnt / Fee / _He / Jgl / Kgl — Artifact ownership probe (2.1.239).
 * Gold: gold-ip-owner / gold-jnt / gold-Fee / gold-Jgl / gold-Kgl / gold-He-probe.
 */
import type { ParsedArtifactUrl } from '../../utils/artifactUrl.js'
import { fetchFrameBoot } from './mint.js'
import {
  type ArtifactShareRole,
  type ArtifactShareStatus,
  type ProbeCachedBoot,
  un,
} from './store.js'

export type { ArtifactShareRole }

/** densable ip */
export function ip(slug: string): ArtifactShareStatus | undefined {
  return un().shareStatus.bySlug.get(slug)
}

/** densable jnt — confirmed owner. */
export function jnt(status: ArtifactShareStatus | undefined): boolean {
  return status !== undefined && !status.probeFailed && status.role === 'owner'
}

/** densable Tgr — confirmed non-owner collaborator. */
export function Tgr(status: ArtifactShareStatus | undefined): boolean {
  return (
    status !== undefined &&
    !status.probeFailed &&
    status.role !== undefined &&
    status.role !== 'unknown' &&
    status.role !== 'owner'
  )
}

/** densable Fee — pending share notice for slug. */
export function Fee(slug: string): boolean {
  return un().shareStatus.pendingNoticeSlugs.has(slug)
}

/**
 * densable Q_n — drop a cached probe boot for slug (invalidate).
 * Semantic name; do not export minify Q_n.
 */
export function clearProbeBoot(slug: string): void {
  un().shareStatus.probeBoots.delete(slug)
}

/**
 * densable probeBoots write site (~186933667) — cache non-lean boot when the
 * landed share status carries lastProbeToolUseId.
 */
export function rememberProbeBoot(
  slug: string,
  boot: ProbeCachedBoot,
  meta: { toolUseId?: string; issuedAt: number; agentPeer?: boolean },
): void {
  if (meta.agentPeer === true) return
  if (meta.toolUseId === undefined) return
  if (boot.data.lean === true) return
  const { probeBoots } = un().shareStatus
  const cur = probeBoots.get(slug)
  if (cur !== undefined && cur.issuedAt > meta.issuedAt) return
  probeBoots.set(slug, {
    toolUseId: meta.toolUseId,
    issuedAt: meta.issuedAt,
    boot: { ...boot, reused: undefined },
  })
}

/** densable account-boundary probeBoots.clear subset. */
export function clearAllProbeBoots(): void {
  un().shareStatus.probeBoots.clear()
}

/** densable zIe */
export function zIe(slug: string): void {
  un().shareStatus.pendingNoticeSlugs.add(slug)
}

/** densable Sqe */
export function Sqe(slug: string): void {
  un().shareStatus.pendingNoticeSlugs.delete(slug)
}

/**
 * densable YBe @186941021 — upload/reply ownership sentence.
 * Empty if status is missing; probeFailed/unknown role cannot confirm;
 * owner is silent; else approving writes someone else's artifact.
 */
export function YBe(
  status: ArtifactShareStatus | undefined,
  n = 'their database',
  r = 'write into',
): string {
  if (status === undefined) return ''
  if (
    status.probeFailed ||
    status.role === undefined ||
    status.role === 'unknown'
  ) {
    return " Couldn't confirm whether this artifact is yours."
  }
  return status.role === 'owner'
    ? ''
    : ` This artifact belongs to someone else — approving will ${r} ${n}.`
}

/** densable W0 ownership suffix for permission copy. */
export function ownershipSuffix(
  status: ArtifactShareStatus | undefined,
): string {
  if (status === undefined) return ''
  if (
    status.probeFailed ||
    status.role === undefined ||
    status.role === 'unknown'
  ) {
    return ' (ownership unconfirmed)'
  }
  return status.role === 'owner' ? '' : " (someone else's artifact)"
}

/** densable zem */
/** densable K */
function normalizeRole(role: unknown): ArtifactShareRole | undefined {
  if (role === undefined || role === '') return undefined
  if (
    role === 'owner' ||
    role === 'writer' ||
    role === 'reader' ||
    role === 'commenter' ||
    role === 'viewer'
  ) {
    return role
  }
  return 'unknown'
}

/** densable Hto portable */
function shareModeFromBoot(
  mode: unknown,
  shared: unknown,
): { mode: string; isSharedLive: boolean } {
  if (mode === undefined || mode === '' || mode === 'owner') {
    return { mode: 'owner', isSharedLive: false }
  }
  if (mode === 'users' || mode === 'org') {
    return { mode: String(mode), isSharedLive: (shared ?? '') === '' }
  }
  if (mode === 'public') return { mode: 'public', isSharedLive: true }
  return { mode: 'unknown', isSharedLive: true }
}

const PROBE_SHARED_WITH_CAP = 256

/**
 * Official 2.1.325 #2312 (SEA `zBe` @286618701):
 * True when `toolUseId` is either the latest probe caller or shared an
 * overlapping/reused probe on this slug.
 */
export function hasSharedProbeToolUseId(
  status:
    | Pick<ArtifactShareStatus, 'lastProbeToolUseId' | 'probeSharedWith'>
    | undefined,
  toolUseId: string | undefined,
): boolean {
  return (
    toolUseId !== undefined &&
    status !== undefined &&
    (status.lastProbeToolUseId === toolUseId ||
      status.probeSharedWith?.includes(toolUseId) === true)
  )
}

/**
 * Official 2.1.325 #2312 (SEA `mFo` @286618701):
 * Merge `toolUseId` with any previous overlapping probe's `lastProbeToolUseId`
 * and `probeSharedWith` list (capped at 256).
 */
export function mergeProbeToolUseIds(
  prev:
    | Pick<ArtifactShareStatus, 'lastProbeToolUseId' | 'probeSharedWith'>
    | undefined,
  toolUseId: string,
  shareWithPrev: boolean,
): { lastProbeToolUseId: string; probeSharedWith: string[] } {
  const shared =
    shareWithPrev && prev?.lastProbeToolUseId !== undefined
      ? [...(prev.probeSharedWith ?? []), prev.lastProbeToolUseId]
      : []
  return {
    lastProbeToolUseId: toolUseId,
    probeSharedWith: shared
      .filter(id => id !== toolUseId)
      .slice(-PROBE_SHARED_WITH_CAP),
  }
}

/** densable Egr portable merge */
export function Egr(
  slug: string,
  patch: Partial<ArtifactShareStatus> & {
    mode?: string
    isSharedLive?: boolean
  },
): void {
  const cur = ip(slug)
  un().shareStatus.bySlug.set(slug, {
    mode: patch.mode ?? cur?.mode ?? 'owner',
    isSharedLive: patch.isSharedLive ?? cur?.isSharedLive ?? false,
    ...(cur?.role !== undefined ? { role: cur.role } : {}),
    ...(cur?.cowritten !== undefined ? { cowritten: cur.cowritten } : {}),
    ...(cur?.title !== undefined ? { title: cur.title } : {}),
    ...(cur?.probeFailed ? { probeFailed: true } : {}),
    ...(cur?.probeErrorCode !== undefined
      ? { probeErrorCode: cur.probeErrorCode }
      : {}),
    ...(cur?.artifactKind !== undefined
      ? { artifactKind: cur.artifactKind }
      : {}),
    ...(cur?.outsideAudience !== undefined
      ? { outsideAudience: cur.outsideAudience }
      : {}),
    ...(cur?.lastProbeToolUseId
      ? { lastProbeToolUseId: cur.lastProbeToolUseId }
      : {}),
    ...(cur?.probeSharedWith !== undefined
      ? { probeSharedWith: cur.probeSharedWith }
      : {}),
    ...(cur?.lastProbeAt !== undefined ? { lastProbeAt: cur.lastProbeAt } : {}),
    ...(cur?.lastProbeLandedAt !== undefined
      ? { lastProbeLandedAt: cur.lastProbeLandedAt }
      : {}),
    ...(cur?.lastProbeIssuedAt !== undefined
      ? { lastProbeIssuedAt: cur.lastProbeIssuedAt }
      : {}),
    ...(cur?.capabilities !== undefined
      ? { capabilities: cur.capabilities }
      : {}),
    ...(cur?.capabilitiesUnknown ? { capabilitiesUnknown: true } : {}),
    ...(cur?.lastCapsReadAt !== undefined
      ? { lastCapsReadAt: cur.lastCapsReadAt }
      : {}),
    ...(cur?.lastCapsLandedAt !== undefined
      ? { lastCapsLandedAt: cur.lastCapsLandedAt }
      : {}),
    ...(cur?.lastCapsIssuedAt !== undefined
      ? { lastCapsIssuedAt: cur.lastCapsIssuedAt }
      : {}),
    ...(cur?.lastCapsReadToolUseId
      ? { lastCapsReadToolUseId: cur.lastCapsReadToolUseId }
      : {}),
    ...patch,
  })
}

export type OwnershipProbeResult =
  | {
      err: null
      mode?: string
      shared?: unknown
      role?: ArtifactShareRole
      cowritten?: boolean
      outsideAudience?: boolean
      title?: string
      /** densable a.boot — non-err frame boot for probeBoots write. */
      boot?: ProbeCachedBoot
    }
  | { err: string; errorCode?: string }

function parseBoolFlag(v: unknown): boolean | undefined {
  return v === true ? true : v === false ? false : undefined
}

function deriveOutsideAudienceFromProbeFields(
  mode: unknown,
  role: unknown,
): boolean | undefined {
  if (mode === 'public' || mode === 'external') return true
  if (mode === 'owner' || mode === 'org') return false
  if ((mode === undefined || mode === '') && role === 'owner') return false
  return undefined
}

function deriveOutsideAudienceFromBoot(
  data: Record<string, unknown>,
  perm: Record<string, unknown> | undefined,
  tokenless: boolean,
): boolean | undefined {
  const explicit =
    parseBoolFlag(data.outsideAudience) ??
    parseBoolFlag(perm?.outsideAudience) ??
    parseBoolFlag(data.outside_audience) ??
    parseBoolFlag(perm?.outside_audience)
  if (explicit !== undefined) return explicit
  const modeRaw = perm?.mode ?? data.mode
  if (
    tokenless ||
    modeRaw === 'public' ||
    modeRaw === 'external' ||
    data.mode === 'public' ||
    data.mode === 'external' ||
    data.kind === 'public'
  ) {
    return true
  }
  if (data.lean === true) return undefined
  return deriveOutsideAudienceFromProbeFields(modeRaw, perm?.role)
}

/**
 * densable Jgl portable — ownership from frame boot perm.role.
 * Bare Jgl (no probeToolUseId) skips probeBoots reuse intentionally —
 * ownership-only probes that omit toolUseId must not populate or hit the
 * cache. verify/delete go through probeArtifactOwnership, which forwards
 * toolUseId when present.
 */
export async function Jgl(
  parsed: ParsedArtifactUrl,
  signal: AbortSignal,
  opts?: { probeToolUseId?: string; readBack?: boolean },
): Promise<OwnershipProbeResult> {
  const boot = await fetchFrameBoot(parsed.slug, signal, {
    kind: 'probe',
    probe: true,
    ...(opts?.probeToolUseId !== undefined
      ? { probeToolUseId: opts.probeToolUseId }
      : {}),
    ...(opts?.readBack === true ? { readBack: true } : {}),
  })
  if (boot.err !== null) {
    return { err: boot.err, errorCode: boot.errorCode }
  }
  const perm =
    boot.data.perm && typeof boot.data.perm === 'object'
      ? (boot.data.perm as Record<string, unknown>)
      : undefined
  const roleRaw = perm?.role
  const tokenless = boot.assetToken === undefined
  const outsideAudience = deriveOutsideAudienceFromBoot(
    boot.data,
    perm,
    tokenless,
  )
  return {
    err: null,
    mode: tokenless
      ? 'public'
      : String(perm?.mode ?? boot.data.mode ?? 'owner'),
    shared: boot.data.shared,
    role: tokenless && roleRaw === 'owner' ? undefined : normalizeRole(roleRaw),
    cowritten: boot.data.cowritten === true,
    ...(outsideAudience !== undefined ? { outsideAudience } : {}),
    ...(typeof boot.data.title === 'string' ? { title: boot.data.title } : {}),
    boot: {
      err: null,
      data: boot.data,
      ver: boot.ver,
      assetToken: boot.assetToken,
      ...(boot.route !== undefined ? { route: boot.route } : {}),
    },
  }
}

/**
 * densable Kgl portable — apply probe into shareStatus.bySlug.
 */
export function Kgl(
  slug: string,
  result: OwnershipProbeResult,
  meta: {
    consumedByCheck?: boolean
    toolUseId?: string
    issuedAt: number
    debugLabel?: string
  },
): void {
  const now = Date.now()
  const prev = ip(slug)
  const overlapped =
    prev?.lastProbeLandedAt !== undefined &&
    meta.issuedAt <= prev.lastProbeLandedAt
  const toolPin =
    meta.consumedByCheck && meta.toolUseId !== undefined
      ? mergeProbeToolUseIds(prev, meta.toolUseId, overlapped)
      : {}
  if (result.err !== null) {
    // densable Uht/Q_n — failed probe invalidates any cached probeBoot for slug.
    clearProbeBoot(slug)
    Egr(slug, {
      mode: ip(slug)?.mode ?? 'owner',
      isSharedLive: ip(slug)?.isSharedLive ?? false,
      probeFailed: true,
      ...(result.errorCode !== undefined
        ? { probeErrorCode: result.errorCode }
        : {}),
      ...toolPin,
      lastProbeAt: now,
      lastProbeLandedAt: now,
      lastProbeIssuedAt: meta.issuedAt,
    })
    return
  }
  const share = shareModeFromBoot(result.mode, result.shared)
  const bootPerm =
    result.boot?.data.perm && typeof result.boot.data.perm === 'object'
      ? (result.boot.data.perm as Record<string, unknown>)
      : undefined
  const outsideAudience =
    result.outsideAudience !== undefined
      ? result.outsideAudience
      : result.boot !== undefined
        ? deriveOutsideAudienceFromBoot(
            result.boot.data,
            bootPerm,
            result.boot.assetToken === undefined,
          )
        : deriveOutsideAudienceFromProbeFields(result.mode, result.role)
  Egr(slug, {
    ...share,
    role: normalizeRole(result.role),
    cowritten: ip(slug)?.cowritten === true || result.cowritten === true,
    outsideAudience,
    ...(result.title !== undefined ? { title: result.title } : {}),
    ...toolPin,
    probeFailed: false,
    lastProbeAt: now,
    lastProbeLandedAt: now,
    lastProbeIssuedAt: meta.issuedAt,
  })
}

/**
 * densable _He — probe once per toolUseId, store via Kgl.
 */
export async function probeArtifactOwnership(
  parsed: ParsedArtifactUrl,
  opts: {
    signal: AbortSignal
    toolUseId?: string
    debugLabel?: string
  },
): Promise<ArtifactShareStatus | undefined> {
  const cur = ip(parsed.slug)
  if (hasSharedProbeToolUseId(cur, opts.toolUseId)) {
    return cur
  }
  const issuedAt = Date.now()
  const result = await Jgl(parsed, opts.signal, {
    ...(opts.toolUseId !== undefined ? { probeToolUseId: opts.toolUseId } : {}),
  })
  Kgl(parsed.slug, result, {
    consumedByCheck: true,
    toolUseId: opts.toolUseId,
    issuedAt,
    debugLabel: opts.debugLabel,
  })
  // densable Uht write site: boot && !lean && lastProbeToolUseId
  if (result.err === null && result.boot !== undefined) {
    const status = ip(parsed.slug)
    rememberProbeBoot(parsed.slug, result.boot, {
      toolUseId: status?.lastProbeToolUseId ?? opts.toolUseId,
      issuedAt,
    })
  }
  return ip(parsed.slug)
}
