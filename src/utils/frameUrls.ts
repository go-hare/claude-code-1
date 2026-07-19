/**
 * densable frameUrls residual (fuo / a7u / mgn / HSr open path).
 *
 * densable keeps a path-keyed map of live HTML frame/artifact URLs in AppState
 * for footer navigation + ctrl+] open. Local cloud-artifacts path synthesizes
 * the same map from transcript tool results via extractArtifacts.
 */
import type { Message } from '../types/message.js'
import { extractArtifacts } from '../commands/artifacts/scanner.js'

export type FrameUrlEntry = {
  url: string
  updatedAt: number
  title?: string
  favicon?: string
  capabilities?: Record<string, unknown>
  /** densable sessionMinted — live session frame (not reconstructed). */
  sessionMinted?: boolean
}

export type FrameUrlsMap = Record<string, FrameUrlEntry>

export type ArtifactReadVersions = Record<string, string>

export type ArtifactRef = {
  slug: string
  /** densable pin version string (semver-like); invalid/latest → undefined. */
  pin?: string
}

/** densable atr — sentinel "latest"/unset version; rejected by w1e. */
export const ARTIFACT_VERSION_LATEST = '0.0.0'

/**
 * densable C1e — pin version pattern
 * `^(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d{0,4})\\.(0|[1-9]\\d{0,5})$`
 */
const ARTIFACT_PIN_VERSION_RE =
  /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,5})$/

/**
 * densable w1e — validate pin string; null when not a usable pin version.
 */
export function normalizeArtifactPinVersion(
  version: unknown,
): string | null {
  if (typeof version !== 'string') return null
  if (version === ARTIFACT_VERSION_LATEST) return null
  if (!ARTIFACT_PIN_VERSION_RE.test(version)) return null
  return version
}

/**
 * densable Oit — set/delete one slug in artifactReadVersions.
 * `version === undefined` deletes the key.
 */
export function applyArtifactReadVersion(
  versions: ArtifactReadVersions | undefined,
  slug: string,
  version: string | undefined,
): ArtifactReadVersions {
  const prev = versions ?? {}
  if (version === undefined) {
    if (!Object.hasOwn(prev, slug)) return prev
    const { [slug]: _drop, ...rest } = prev
    return rest
  }
  if (prev[slug] === version) return prev
  return { ...prev, [slug]: version }
}

/**
 * densable Lit — move slug to front of artifactRefs, optionally updating pin.
 * pin arg: validated via w1e; if invalid/null, keep existing pin for that slug.
 * Stable when already first with same pin.
 */
export function promoteArtifactRef(
  refs: readonly ArtifactRef[] | undefined,
  slug: string,
  pinArg?: unknown,
): ArtifactRef[] {
  const list = refs ?? []
  const existing = list.find(l => l.slug === slug)
  const pin =
    normalizeArtifactPinVersion(pinArg) ?? existing?.pin
  if (list[0]?.slug === slug && list[0]?.pin === pin) {
    return list as ArtifactRef[]
  }
  const head: ArtifactRef =
    pin !== undefined ? { slug, pin } : { slug }
  return [head, ...list.filter(l => l.slug !== slug)]
}

/**
 * densable Mit — { targetSlug, pins } from current artifactRefs.
 */
export function getArtifactRefPinSnapshot(refs: readonly ArtifactRef[] | undefined): {
  targetSlug: string | undefined
  pins: Record<string, string>
} {
  const list = refs ?? []
  const pins: Record<string, string> = {}
  for (const n of list) {
    if (n.pin !== undefined) pins[n.slug] = n.pin
  }
  return { targetSlug: list[0]?.slug, pins }
}

export type FrameUrlsSnapshot = {
  frameUrls: FrameUrlsMap
  artifactReadVersions: ArtifactReadVersions
  artifactRefs: ArtifactRef[]
}

export const EMPTY_FRAME_URLS_SNAPSHOT: FrameUrlsSnapshot = {
  frameUrls: {},
  artifactReadVersions: {},
  artifactRefs: [],
}

/** densable mgn — index of frameNavPath in entries, else last. */
export function selectFrameNavIndex(
  entries: readonly [string, FrameUrlEntry][],
  frameNavPath: string | null | undefined,
): number {
  if (entries.length === 0) return 0
  if (frameNavPath != null) {
    const r = entries.findIndex(([n]) => n === frameNavPath)
    if (r !== -1) return r
  }
  return entries.length - 1
}

/** densable Object.values(frameUrls).at(-1)?.url — insertion-order latest. */
export function latestFrameUrl(
  frameUrls: FrameUrlsMap | undefined | null,
): string | undefined {
  if (!frameUrls) return undefined
  return Object.values(frameUrls).at(-1)?.url
}

/**
 * densable cG cycle — step frameNavPath by delta among map keys.
 * Collapses frameExpanded when nav path changes.
 */
export function cycleFrameNavPath(
  frameUrls: FrameUrlsMap,
  frameNavPath: string | null | undefined,
  frameExpanded: boolean,
  delta: 1 | -1,
): { frameNavPath: string | null; frameExpanded: boolean } | null {
  const keys = Object.keys(frameUrls)
  if (keys.length <= 1) return null
  const entries = Object.entries(frameUrls) as [string, FrameUrlEntry][]
  const ui = selectFrameNavIndex(entries, frameNavPath)
  const next = keys[(ui + delta + keys.length) % keys.length] ?? null
  if (next === frameNavPath && !frameExpanded) return null
  return { frameNavPath: next, frameExpanded: false }
}

/**
 * densable a7u equality gate — whether applying snapshot would change state
 * (ignores transient nav flags: resets nav when applying).
 */
export function frameUrlsSnapshotEquals(
  prev: {
    frameUrls: FrameUrlsMap
    artifactReadVersions?: ArtifactReadVersions
    artifactRefs?: ArtifactRef[]
    frameNavPath?: string | null
    frameExpanded?: boolean
  },
  next: FrameUrlsSnapshot,
): boolean {
  const s = Object.keys(prev.frameUrls)
  const a = Object.keys(next.frameUrls)
  const c = prev.artifactReadVersions ?? {}
  const l = Object.keys(next.artifactReadVersions)
  const u = prev.artifactRefs ?? []
  const o = next.artifactRefs
  if (s.length !== a.length) return false
  if (
    !s.every(d => {
      const L = prev.frameUrls[d]
      const R = next.frameUrls[d]
      return L?.url === R?.url && L?.updatedAt === R?.updatedAt
    })
  ) {
    return false
  }
  if (l.length !== Object.keys(c).length) return false
  if (!l.every(d => c[d] === next.artifactReadVersions[d])) return false
  if (u.length !== o.length) return false
  if (!u.every((d, p) => d.slug === o[p]?.slug && d.pin === undefined)) {
    return false
  }
  if (prev.frameNavPath != null) return false
  if (prev.frameExpanded) return false
  return true
}

/**
 * densable a7u patch — merge snapshot and reset nav when content changes.
 */
export function applyFrameUrlsSnapshot<
  T extends {
    frameUrls: FrameUrlsMap
    artifactReadVersions?: ArtifactReadVersions
    artifactRefs?: ArtifactRef[]
    frameNavPath?: string | null
    frameExpanded?: boolean
  },
>(prev: T, next: FrameUrlsSnapshot): T {
  if (frameUrlsSnapshotEquals(prev, next)) return prev
  return {
    ...prev,
    frameUrls: next.frameUrls,
    artifactReadVersions: next.artifactReadVersions,
    artifactRefs: next.artifactRefs,
    frameNavPath: null,
    frameExpanded: false,
  }
}

/**
 * densable fuo (local residual): rebuild frameUrls + artifactRefs from
 * transcript artifact tool results. Paths key the map; later successes
 * overwrite same path; duplicate slug URLs collapse to latest path (wQg).
 * artifactRefs: unique hash/slugs, newest first (densable i7u.refs).
 * artifactReadVersions stays empty without densable frame-tool version pins.
 */
export function extractFrameUrlsSnapshot(
  messages: readonly Message[],
): FrameUrlsSnapshot {
  const artifacts = extractArtifacts(messages as Message[])
  // extractArtifacts is newest-first; walk oldest→newest so last write wins.
  const chronological = [...artifacts].reverse()
  const frameUrls: FrameUrlsMap = {}
  const bySlugPath = new Map<string, string>()
  // Stable updatedAt from message order so a7u equality can no-op across
  // re-renders (Date.now() would thrash AppState every effect run).
  let seq = 0

  for (const a of chronological) {
    if (!a.url || a.isError) continue
    const path = a.filePath
    // Drop other paths that previously pointed at the same hash/slug url host path
    if (a.hash) {
      const prevPath = bySlugPath.get(a.hash)
      if (prevPath !== undefined && prevPath !== path) {
        delete frameUrls[prevPath]
      }
      bySlugPath.set(a.hash, path)
    }
    seq += 1
    frameUrls[path] = {
      url: a.url,
      updatedAt: seq,
      title: a.basename,
    }
  }

  // Newest first for artifactRefs (matches densable targetSlug = refs[0]).
  const refOrder: string[] = []
  const seenSlug = new Set<string>()
  for (const a of artifacts) {
    if (!a.url || a.isError || !a.hash) continue
    if (seenSlug.has(a.hash)) continue
    seenSlug.add(a.hash)
    refOrder.push(a.hash)
  }

  return {
    frameUrls,
    artifactReadVersions: {},
    artifactRefs: refOrder.map(slug => ({ slug })),
  }
}

/** densable AppState slice needed by Oit/Lit/Mit factories. */
export type ArtifactAppStateSlice = {
  artifactReadVersions?: ArtifactReadVersions
  artifactRefs?: ArtifactRef[]
}

/**
 * densable Oit — factory: setAppState → (slug, version?) updater.
 * `version === undefined` deletes the slug from artifactReadVersions.
 *
 * Accepts AppState setAppState via a thin wrapper so callers do not need
 * casts (setAppState is contravariant on the updater parameter).
 */
export function createSetArtifactReadVersion(
  setAppState: (
    f: (prev: ArtifactAppStateSlice) => ArtifactAppStateSlice,
  ) => void,
): (slug: string, version: string | undefined) => void {
  return (slug, version) => {
    setAppState(prev => {
      const nextVersions = applyArtifactReadVersion(
        prev.artifactReadVersions,
        slug,
        version,
      )
      if (nextVersions === prev.artifactReadVersions) return prev
      return { ...prev, artifactReadVersions: nextVersions }
    })
  }
}

/**
 * densable Lit — factory: setAppState → (slug, pinArg?) promote to front.
 */
export function createSetArtifactContractTarget(
  setAppState: (
    f: (prev: ArtifactAppStateSlice) => ArtifactAppStateSlice,
  ) => void,
): (slug: string, pinArg?: unknown) => void {
  return (slug, pinArg) => {
    setAppState(prev => {
      const nextRefs = promoteArtifactRef(prev.artifactRefs, slug, pinArg)
      if (nextRefs === prev.artifactRefs) return prev
      return { ...prev, artifactRefs: nextRefs }
    })
  }
}

/**
 * densable Mit — factory: getAppState → () => { targetSlug, pins }.
 */
export function createGetArtifactContractTarget(
  getAppState: () => ArtifactAppStateSlice,
): () => { targetSlug: string | undefined; pins: Record<string, string> } {
  return () => getArtifactRefPinSnapshot(getAppState().artifactRefs)
}

/**
 * Bind densable Oit/Lit/Mit factories to a full AppState store.
 * Wrapper keeps AppState identity so setAppState typechecks without casts.
 */
export function bindArtifactContractHandlers<S extends ArtifactAppStateSlice>(
  getAppState: () => S,
  setAppState: (f: (prev: S) => S) => void,
): {
  setArtifactReadVersion: (slug: string, version: string | undefined) => void
  setArtifactContractTarget: (slug: string, pinArg?: unknown) => void
  getArtifactContractTarget: () => {
    targetSlug: string | undefined
    pins: Record<string, string>
  }
} {
  const wrap = (
    f: (prev: ArtifactAppStateSlice) => ArtifactAppStateSlice,
  ): void => {
    setAppState(prev => f(prev) as S)
  }
  return {
    setArtifactReadVersion: createSetArtifactReadVersion(wrap),
    setArtifactContractTarget: createSetArtifactContractTarget(wrap),
    getArtifactContractTarget: createGetArtifactContractTarget(getAppState),
  }
}
