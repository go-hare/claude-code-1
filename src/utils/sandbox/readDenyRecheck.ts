/**
 * Official 2.1.292 #201 (`Lpe` / `Fpe` / `Bpe` / `Ppe`):
 * Re-check trusted (managed/flag/user) read-deny paths before every sandboxed
 * command. When a read-deny path appears or re-points mid-session (e.g. via a
 * symlink inside a writable directory), drop any project/local `allowRead` or
 * `allowWrite` grants that now lie inside it, and narrow any masked
 * credential file entries it covers (`injectHosts: []`) to end credential
 * injection.
 */
import { realpathSync } from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { logForDebugging } from '../debug.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'

export type ForwardedUntrustedGrant = {
  literal: string
  list: 'allowRead' | 'allowWrite'
  resolvedAtBuild?: string
}

export type TrustedDenyRootSnapshot = {
  literal: string
  resolvedAtBuild: string | undefined
}

type CredentialFileEntry = {
  path: string
  mode: string
  injectHosts?: string[]
  [key: string]: unknown
}

type ReadDenyRecheckHostState = {
  trustedDenyRoots: TrustedDenyRootSnapshot[]
  forwardedUntrustedGrants: ForwardedUntrustedGrant[]
}

const recheckStateByHost = new HostSlot<ReadDenyRecheckHostState>(() => ({
  trustedDenyRoots: [],
  forwardedUntrustedGrants: [],
}))

function getRecheckState(): ReadDenyRecheckHostState {
  return recheckStateByHost.of(getBootstrapSessionHost())
}

function tryRealpath(p: string): string | undefined {
  try {
    return realpathSync(p)
  } catch {
    return undefined
  }
}

function normalizePathForCompare(p: string): string {
  const resolved = resolve(p)
  const direct = tryRealpath(resolved)
  if (direct !== undefined) return direct
  // Official 2.1.299 (#672): for glob entries (e.g. `/dir/**` or `/dir/*.txt`),
  // `resolved` itself does not exist on disk — walk up to the deepest existing
  // ancestor directory so replacing that starting directory with a symlink is
  // detected on re-check.
  const trailingParts: string[] = []
  let cur = resolved
  while (true) {
    const parent = dirname(cur)
    if (parent === cur) return resolved
    trailingParts.push(basename(cur))
    cur = parent
    const realAncestor = tryRealpath(cur)
    if (realAncestor !== undefined) {
      return join(realAncestor, ...trailingParts.reverse())
    }
  }
}

function isSameOrChildPath(parent: string, candidate: string): boolean {
  const normParent = normalizePathForCompare(parent)
  const normCandidate = normalizePathForCompare(candidate)
  if (normParent === normCandidate) return true
  const prefix = normParent.endsWith(sep) ? normParent : normParent + sep
  return normCandidate.startsWith(prefix)
}

function isAlreadyClearedMask(entry: CredentialFileEntry): boolean {
  return (
    entry.mode === 'mask' &&
    Array.isArray(entry.injectHosts) &&
    entry.injectHosts.length === 0 &&
    Object.keys(entry).every(
      k => k === 'path' || k === 'mode' || k === 'injectHosts',
    )
  )
}

export function resetReadDenyRecheckState(): void {
  const recheckState = getRecheckState()
  recheckState.trustedDenyRoots = []
  recheckState.forwardedUntrustedGrants = []
}

export function recordReadDenyRecheckBaseline(params: {
  trustedDenyRoots: string[]
  forwardedUntrustedGrants: ForwardedUntrustedGrant[]
}): void {
  const recheckState = getRecheckState()
  recheckState.trustedDenyRoots = params.trustedDenyRoots.map(literal => ({
    literal,
    resolvedAtBuild: tryRealpath(literal),
  }))
  recheckState.forwardedUntrustedGrants = params.forwardedUntrustedGrants.map(
    grant => ({
      ...grant,
      resolvedAtBuild: normalizePathForCompare(grant.literal),
    }),
  )
}

export function getReadDenyRecheckBaseline(): {
  trustedDenyRoots: readonly TrustedDenyRootSnapshot[]
  forwardedUntrustedGrants: readonly ForwardedUntrustedGrant[]
} {
  const recheckState = getRecheckState()
  return {
    trustedDenyRoots: recheckState.trustedDenyRoots,
    forwardedUntrustedGrants: recheckState.forwardedUntrustedGrants,
  }
}

/** Official `Fpe` — drop project/local grants whose path now falls under a denied root. */
export function dropProjectGrantsUnderDenyRoots(
  config: SandboxRuntimeConfig,
  untrustedGrants: readonly ForwardedUntrustedGrant[],
  denyRoots: readonly string[],
): { derived: SandboxRuntimeConfig; removed: number } | undefined {
  if (denyRoots.length === 0 || untrustedGrants.length === 0) {
    return undefined
  }
  const dropRead = new Set<string>()
  const dropWrite = new Set<string>()
  for (const grant of untrustedGrants) {
    if (denyRoots.some(root => isSameOrChildPath(root, grant.literal))) {
      if (grant.list === 'allowRead') {
        dropRead.add(grant.literal)
      } else {
        dropWrite.add(grant.literal)
      }
    }
  }
  const currentAllowRead = config.filesystem.allowRead ?? []
  const nextAllowRead = currentAllowRead.filter(p => !dropRead.has(p))
  const nextAllowWrite = config.filesystem.allowWrite.filter(
    p => !dropWrite.has(p),
  )
  const removed =
    currentAllowRead.length -
    nextAllowRead.length +
    (config.filesystem.allowWrite.length - nextAllowWrite.length)
  if (removed === 0) {
    return undefined
  }
  return {
    derived: {
      ...config,
      filesystem: {
        ...config.filesystem,
        allowRead: nextAllowRead,
        allowWrite: nextAllowWrite,
      },
    },
    removed,
  }
}

/** Official `Bpe` — end credential injection (`injectHosts: []`) for masked files covered by deny roots. */
export function narrowMaskedCredentialsUnderDenyRoots(
  config: SandboxRuntimeConfig,
  denyRoots: readonly string[],
): { derived: SandboxRuntimeConfig; reduced: number } | undefined {
  const credentials = (
    config as SandboxRuntimeConfig & {
      credentials?: { files?: CredentialFileEntry[] }
    }
  ).credentials
  const files = credentials?.files
  if (!files || files.length === 0 || denyRoots.length === 0) {
    return undefined
  }
  let reduced = 0
  const nextFiles = files.map(entry => {
    if (entry.mode !== 'mask' || isAlreadyClearedMask(entry)) {
      return entry
    }
    if (!denyRoots.some(root => isSameOrChildPath(root, entry.path))) {
      return entry
    }
    reduced++
    return { path: entry.path, mode: 'mask', injectHosts: [] }
  })
  if (reduced === 0) {
    return undefined
  }
  return {
    derived: {
      ...config,
      credentials: {
        ...credentials,
        files: nextFiles,
      },
    } as SandboxRuntimeConfig,
    reduced,
  }
}

/**
 * Official `Ppe` / `Lpe` / `z3` — re-check trusted read-deny paths before every
 * sandboxed command and narrow the active config if any appeared or re-pointed.
 */
export function recheckReadDenyAndCredentialMasksBeforeWrap(deps: {
  getConfig: () => SandboxRuntimeConfig | undefined
  updateConfig: (cfg: SandboxRuntimeConfig) => void
}): { movedCount: number; droppedGrants: number; narrowedMasks: number } {
  const config = deps.getConfig()
  if (!config || config.filesystem.disabled) {
    return { movedCount: 0, droppedGrants: 0, narrowedMasks: 0 }
  }
  const recheckState = getRecheckState()
  if (recheckState.trustedDenyRoots.length === 0) {
    return { movedCount: 0, droppedGrants: 0, narrowedMasks: 0 }
  }

  const movedRoots: string[] = []
  for (const snapshot of recheckState.trustedDenyRoots) {
    const currentResolved = tryRealpath(snapshot.literal)
    if (currentResolved !== snapshot.resolvedAtBuild) {
      snapshot.resolvedAtBuild = currentResolved
      movedRoots.push(snapshot.literal)
      if (currentResolved !== undefined) {
        movedRoots.push(currentResolved)
      }
    }
  }

  let grantsMoved = false
  for (const grant of recheckState.forwardedUntrustedGrants) {
    const currentGrantResolved = normalizePathForCompare(grant.literal)
    if (currentGrantResolved !== grant.resolvedAtBuild) {
      grant.resolvedAtBuild = currentGrantResolved
      grantsMoved = true
    }
  }

  if (movedRoots.length === 0 && !grantsMoved) {
    return { movedCount: 0, droppedGrants: 0, narrowedMasks: 0 }
  }

  const allEffectiveRoots = [
    ...movedRoots,
    ...recheckState.trustedDenyRoots.flatMap(r =>
      r.resolvedAtBuild ? [r.literal, r.resolvedAtBuild] : [r.literal],
    ),
  ]

  let nextConfig = config
  let droppedGrants = 0
  let narrowedMasks = 0

  const grantResult = dropProjectGrantsUnderDenyRoots(
    nextConfig,
    recheckState.forwardedUntrustedGrants,
    allEffectiveRoots,
  )
  if (grantResult) {
    nextConfig = grantResult.derived
    droppedGrants = grantResult.removed
  }

  const maskResult = narrowMaskedCredentialsUnderDenyRoots(
    nextConfig,
    allEffectiveRoots,
  )
  if (maskResult) {
    nextConfig = maskResult.derived
    narrowedMasks = maskResult.reduced
  }

  if (droppedGrants > 0 || narrowedMasks > 0) {
    deps.updateConfig(nextConfig)
    logForDebugging(
      `[sandbox] Re-checked ${recheckState.trustedDenyRoots.length} trusted read-deny path(s): ${movedRoots.length} resolved differently; dropped ${droppedGrants} project grant(s) and narrowed ${narrowedMasks} credential mask(s)`,
    )
  }

  return {
    movedCount: movedRoots.length,
    droppedGrants,
    narrowedMasks,
  }
}
