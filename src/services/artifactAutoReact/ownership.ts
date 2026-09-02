/**
 * densable ip / jnt / Fee / _He / Jgl / Kgl — Artifact ownership probe (2.1.239).
 * Gold: gold-ip-owner / gold-jnt / gold-Fee / gold-Jgl / gold-Kgl / gold-He-probe.
 */
import type { ParsedArtifactUrl } from '../../utils/artifactUrl.js'
import { fetchFrameBoot } from './mint.js'
import {
  type ArtifactShareRole,
  type ArtifactShareStatus,
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

/** densable zIe */
export function zIe(slug: string): void {
  un().shareStatus.pendingNoticeSlugs.add(slug)
}

/** densable Sqe */
export function Sqe(slug: string): void {
  un().shareStatus.pendingNoticeSlugs.delete(slug)
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
function normalizeRole(role: unknown): ArtifactShareRole {
  if (role === 'owner' || role === 'writer' || role === 'reader') return role
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
    ...(cur?.lastProbeToolUseId
      ? { lastProbeToolUseId: cur.lastProbeToolUseId }
      : {}),
    ...(cur?.lastProbeAt !== undefined ? { lastProbeAt: cur.lastProbeAt } : {}),
    ...(cur?.lastProbeLandedAt !== undefined
      ? { lastProbeLandedAt: cur.lastProbeLandedAt }
      : {}),
    ...(cur?.lastProbeIssuedAt !== undefined
      ? { lastProbeIssuedAt: cur.lastProbeIssuedAt }
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
      title?: string
    }
  | { err: string; errorCode?: string }

/**
 * densable Jgl portable — ownership from frame boot perm.role.
 */
export async function Jgl(
  parsed: ParsedArtifactUrl,
  signal: AbortSignal,
): Promise<OwnershipProbeResult> {
  const boot = await fetchFrameBoot(parsed.slug, signal)
  if (boot.err !== null) {
    return { err: boot.err, errorCode: boot.errorCode }
  }
  const perm =
    boot.data.perm && typeof boot.data.perm === 'object'
      ? (boot.data.perm as Record<string, unknown>)
      : undefined
  const roleRaw = perm?.role
  const tokenless = boot.assetToken === undefined
  return {
    err: null,
    mode: tokenless
      ? 'public'
      : String(perm?.mode ?? boot.data.mode ?? 'owner'),
    shared: boot.data.shared,
    role: tokenless && roleRaw === 'owner' ? undefined : normalizeRole(roleRaw),
    cowritten: boot.data.cowritten === true,
    ...(typeof boot.data.title === 'string' ? { title: boot.data.title } : {}),
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
  const toolPin =
    meta.consumedByCheck && meta.toolUseId !== undefined
      ? { lastProbeToolUseId: meta.toolUseId }
      : {}
  if (result.err !== null) {
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
  Egr(slug, {
    ...share,
    role: normalizeRole(result.role),
    cowritten: ip(slug)?.cowritten === true || result.cowritten === true,
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
  if (
    opts.toolUseId !== undefined &&
    cur?.lastProbeToolUseId === opts.toolUseId
  ) {
    return cur
  }
  const issuedAt = Date.now()
  const result = await Jgl(parsed, opts.signal)
  Kgl(parsed.slug, result, {
    consumedByCheck: true,
    toolUseId: opts.toolUseId,
    issuedAt,
    debugLabel: opts.debugLabel,
  })
  return ip(parsed.slug)
}
