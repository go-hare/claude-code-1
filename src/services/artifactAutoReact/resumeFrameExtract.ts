/**
 * densable XXt / Iun — walk a resume transcript into an N9e frame seed
 * (2.1.289 gold @190191361 / @190201339).
 *
 * Hosted: Artifact tool_use / tool_result, delete forget, meta
 * artifact-deleted / artifact-attached tags, compact_boundary version carry.
 * KEEP: Mnr/Inr (other tools' artifactRead), Tnr pathPins (N9e continue
 * skips QXt), applyLinks zQ.
 */
import {
  parseArtifactUrl,
  parseArtifactUrlAnyCase,
} from '../../utils/artifactUrl.js'
import {
  emptyResumedArtifactFrameSeed,
  type ArtifactFrameUrlEntry,
  type ArtifactRefEntry,
  type ResumedArtifactFrameSeed,
} from './conversationBoundary.js'

const ARTIFACT_TOOL_NAME = 'Artifact'
const DELETED_TAG = /^<artifact-deleted url="([^"]+)"\/>/
const ATTACHED_TAG =
  /^<artifact-attached url="([^"]+)"(?: title="([^"]*)")?( own)?\/>/

type TranscriptMessage = {
  type?: string
  subtype?: string
  uuid?: string
  timestamp?: string
  remoteSourced?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  compactMetadata?: Record<string, unknown>
  message?: { content?: unknown }
  toolUseResult?: unknown
}

class YXt {
  order: string[] = []
  touch(slug: string): void {
    this.order = [slug, ...this.order.filter(s => s !== slug)]
  }
  forget(slug: string): void {
    this.order = this.order.filter(s => s !== slug)
  }
  refs(): ArtifactRefEntry[] {
    return this.order.map(slug => ({ slug }))
  }
}

function Pa(url: string): string | null {
  return (
    parseArtifactUrl(url)?.slug ?? parseArtifactUrlAnyCase(url)?.slug ?? null
  )
}

function viewerUrl(url: string): string {
  const parsed = parseArtifactUrl(url) ?? parseArtifactUrlAnyCase(url)
  if (parsed === null) return url
  return `https://claude.ai/code/artifact/${parsed.slug}`
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function setVersion(
  versions: Record<string, string>,
  slug: string,
  ver: string,
): boolean {
  if (ver === '' || ver.includes('\0')) return false
  delete versions[slug]
  versions[slug] = ver
  return true
}

function forgetSlug(
  slug: string,
  seed: {
    frameUrls: Record<string, ArtifactFrameUrlEntry>
    artifactReadVersions: Record<string, string>
    createdFromType: Record<string, unknown>
    pathPins: Map<string, Map<string, { seq?: number }>>
    target: YXt
  },
): void {
  for (const [key, entry] of Object.entries(seed.frameUrls)) {
    if (Pa(entry.url) === slug) delete seed.frameUrls[key]
  }
  for (const [key, entry] of Object.entries(seed.createdFromType)) {
    const row = entry as { slug?: string }
    if (row.slug === slug) delete seed.createdFromType[key]
  }
  delete seed.artifactReadVersions[slug]
  seed.pathPins.delete(slug)
  seed.target.forget(slug)
}

/** densable knr @190194610 — present only when the result is a delete. */
function slugFromDeleteResult(
  result: unknown,
): { slug: string | null } | undefined {
  if (result === null || typeof result !== 'object') return undefined
  const del = Reflect.get(result, 'artifact_delete')
  if (del === undefined) return undefined
  const url =
    del !== null && typeof del === 'object'
      ? Reflect.get(del, 'url')
      : undefined
  return { slug: typeof url === 'string' ? Pa(url) : null }
}

function slugFromErrorContent(content: unknown): string | null {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map(part =>
              typeof part === 'object' &&
              part !== null &&
              typeof Reflect.get(part, 'text') === 'string'
                ? String(Reflect.get(part, 'text'))
                : '',
            )
            .join('\n')
        : ''
  const url = DELETED_TAG.exec(
    text.replace(/^(?:<tool_use_error>)?(?:Error: )?/, ''),
  )?.[1]
  return url !== undefined ? Pa(url) : null
}

function recordAttached(
  content: string,
  timestamp: string | undefined,
  frameUrls: Record<string, ArtifactFrameUrlEntry>,
  target: YXt,
): void {
  const match = ATTACHED_TAG.exec(content)
  if (match === null) return
  const rawUrl = match[1] ?? ''
  const slug = Pa(rawUrl)
  if (slug === null) return
  let occupied = false
  let prior: ArtifactFrameUrlEntry | undefined
  for (const [key, entry] of Object.entries(frameUrls)) {
    if (Pa(entry.url) !== slug) continue
    if (key.startsWith('attached:') || key.startsWith('created:')) {
      prior = entry
      delete frameUrls[key]
    } else occupied = true
  }
  if (!occupied) {
    const title =
      match[2] !== undefined && match[2] !== '' ? match[2] : prior?.title
    frameUrls[`attached:${slug}`] = {
      url: viewerUrl(rawUrl),
      updatedAt: Date.parse(timestamp ?? '') || 0,
      ...(title !== undefined ? { title } : {}),
    }
  }
  if (match[3] !== undefined) target.touch(slug)
}

function recordToolResult(
  result: unknown,
  timestamp: string | undefined,
  frameUrls: Record<string, ArtifactFrameUrlEntry>,
  versions: Record<string, string>,
  target: YXt,
  createdFromType: Record<string, unknown>,
): void {
  if (result === null || typeof result !== 'object') return
  const row = result as Record<string, unknown>
  if (row.created_from_type === true) {
    const slug = typeof row.url === 'string' ? Pa(row.url) : null
    const typeUrl =
      row.type !== null && typeof row.type === 'object'
        ? Reflect.get(row.type, 'url')
        : undefined
    const typeSlug = typeof typeUrl === 'string' ? Pa(typeUrl) : null
    if (typeof row.path !== 'string') {
      if (slug !== null && typeof row.url === 'string') {
        const key = `created:${slug}`
        delete frameUrls[key]
        frameUrls[key] = {
          url: viewerUrl(row.url),
          updatedAt: Date.parse(timestamp ?? '') || 0,
          ...(typeof row.title === 'string' ? { title: row.title } : {}),
        }
        if (typeof row.version === 'string')
          setVersion(versions, slug, row.version)
        target.touch(slug)
      }
      return
    }
    if (slug !== null && typeSlug !== null && !row.path.includes('\0')) {
      createdFromType[row.path] = { slug, typeSlug }
    }
    return
  }
  const slug = typeof row.url === 'string' ? Pa(row.url) : null
  if (row.opened === true) {
    if (typeof row.url === 'string' && slug !== null) {
      const already = Object.values(frameUrls).some(e => Pa(e.url) === slug)
      if (!already) {
        const key = `opened:${slug}`
        delete frameUrls[key]
        frameUrls[key] = {
          url: viewerUrl(row.url),
          updatedAt: Date.parse(timestamp ?? '') || 0,
          ...(typeof row.title === 'string' ? { title: row.title } : {}),
        }
      }
    }
    return
  }
  // Gold wnr: no path → return (do not invent opened: / version).
  if (
    typeof row.url !== 'string' ||
    slug === null ||
    typeof row.path !== 'string' ||
    row.path.includes('\0')
  ) {
    return
  }
  for (const [key, entry] of Object.entries(frameUrls)) {
    if (key !== row.path && Pa(entry.url) === slug) delete frameUrls[key]
  }
  delete frameUrls[row.path]
  frameUrls[row.path] = {
    url: row.url,
    updatedAt: Date.parse(timestamp ?? '') || 0,
    ...(typeof row.title === 'string' ? { title: row.title } : {}),
  }
  if (typeof row.version === 'string') setVersion(versions, slug, row.version)
  target.touch(slug)
}

function applyCompactVersions(
  preserved: unknown,
  versions: Record<string, string>,
): number {
  if (!Array.isArray(preserved)) return 0
  for (const key of Object.keys(versions)) delete versions[key]
  let n = 0
  for (const row of preserved.slice(0, 32).reverse()) {
    if (row === null || typeof row !== 'object') continue
    const slug = Reflect.get(row, 'slug')
    const ver = Reflect.get(row, 'ver')
    if (typeof slug !== 'string' || typeof ver !== 'string') continue
    if (Pa(`https://claude.ai/code/artifact/${slug}`) !== slug) continue
    if (setVersion(versions, slug, ver)) n++
  }
  return n
}

/**
 * densable XXt portable — rebuild frame maps from a local transcript.
 */
export function extractArtifactFrameSeedFromTranscript(
  messages: readonly unknown[],
): ResumedArtifactFrameSeed {
  const artifactIds = new Set<string>()
  const remoteIds = new Set<string>()
  for (const raw of messages) {
    const msg = raw as TranscriptMessage
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) {
      continue
    }
    for (const block of msg.message.content) {
      if (
        typeof block !== 'object' ||
        block === null ||
        Reflect.get(block, 'type') !== 'tool_use'
      ) {
        continue
      }
      const id = Reflect.get(block, 'id')
      if (typeof id !== 'string') continue
      if (msg.remoteSourced === true) remoteIds.add(id)
      if (Reflect.get(block, 'name') !== ARTIFACT_TOOL_NAME) continue
      artifactIds.add(id)
    }
  }

  const frameUrls: Record<string, ArtifactFrameUrlEntry> = {}
  const versions: Record<string, string> = {}
  const createdFromType: Record<string, unknown> = {}
  const pathPins = new Map<string, Map<string, { seq?: number }>>()
  const target = new YXt()
  let compact:
    | {
        versions: unknown
        preserved: Set<string>
        lastKept: string | undefined
        lastKeptSeen: boolean
        summarySeen: boolean
        foreign: boolean
      }
    | undefined

  const flushCompact = (): void => {
    if (compact === undefined) return
    if (
      compact.summarySeen &&
      (compact.lastKept === undefined || compact.lastKeptSeen) &&
      !compact.foreign
    ) {
      applyCompactVersions(compact.versions, versions)
    }
    compact = undefined
  }

  for (const raw of messages) {
    const msg = raw as TranscriptMessage
    if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
      if (compact?.preserved.has(msg.uuid ?? '')) {
        if (msg.uuid === compact.lastKept) compact.lastKeptSeen = true
        continue
      }
      flushCompact()
      if (msg.remoteSourced !== true) {
        const meta = msg.compactMetadata ?? {}
        const preserved = meta.preservedMessages as
          | { allUuids?: unknown; uuids?: unknown }
          | undefined
        const uuids = stringList(preserved?.uuids)
        compact = {
          versions: meta.preCompactArtifactReadVersions,
          preserved: new Set([...stringList(preserved?.allUuids), ...uuids]),
          lastKept: uuids.at(-1),
          lastKeptSeen: false,
          summarySeen: false,
          foreign: false,
        }
      }
      continue
    }
    if (compact !== undefined) {
      if (compact.preserved.has(msg.uuid ?? '')) {
        if (msg.uuid === compact.lastKept) compact.lastKeptSeen = true
      } else if (msg.type === 'user' && msg.isCompactSummary === true) {
        compact.summarySeen = true
        compact.foreign = msg.remoteSourced === true
      } else if (msg.type === 'user' || msg.type === 'assistant') {
        flushCompact()
      }
    }
    if (msg.type !== 'user') continue
    if (msg.isMeta === true && typeof msg.message?.content === 'string') {
      const deleted = DELETED_TAG.exec(msg.message.content)?.[1]
      const slug = deleted !== undefined ? Pa(deleted) : null
      if (slug !== null) {
        forgetSlug(slug, {
          frameUrls,
          artifactReadVersions: versions,
          createdFromType,
          pathPins,
          target,
        })
      } else if (msg.remoteSourced !== true) {
        recordAttached(msg.message.content, msg.timestamp, frameUrls, target)
      }
      continue
    }
    if (!Array.isArray(msg.message?.content)) continue
    for (const block of msg.message.content) {
      if (
        typeof block !== 'object' ||
        block === null ||
        Reflect.get(block, 'type') !== 'tool_result'
      ) {
        continue
      }
      const toolUseId = Reflect.get(block, 'tool_use_id')
      if (typeof toolUseId !== 'string') continue
      if (!artifactIds.has(toolUseId)) continue
      const isError = Reflect.get(block, 'is_error') === true
      const errSlug = isError
        ? slugFromErrorContent(Reflect.get(block, 'content'))
        : null
      const deleted = slugFromDeleteResult(msg.toolUseResult)
      const forget = errSlug ?? deleted?.slug ?? null
      if (forget !== null) {
        forgetSlug(forget, {
          frameUrls,
          artifactReadVersions: versions,
          createdFromType,
          pathPins,
          target,
        })
      }
      if (forget !== null || deleted !== undefined) continue
      if (remoteIds.has(toolUseId) || msg.remoteSourced === true) continue
      recordToolResult(
        msg.toolUseResult,
        msg.timestamp,
        frameUrls,
        versions,
        target,
        createdFromType,
      )
    }
  }
  flushCompact()
  return {
    frameUrls,
    artifactReadVersions: versions,
    artifactRefs: target.refs(),
    createdFromType,
    pathPins,
  }
}

/**
 * densable DPe KEEP — gold is `!g()&&A()` (cobalt pair). Tip has no host;
 * local resume is seed-eligible because Artifact frames are hosted.
 */
export function isArtifactResumeSeedEligible(): boolean {
  return true
}

/** densable Iun @190201339 */
export function extractResumedArtifactFrameSeed(
  messages: readonly unknown[] | undefined,
  opts?: { origin?: string; seedEligible?: boolean },
): ResumedArtifactFrameSeed {
  if (opts?.origin !== 'local' || opts.seedEligible !== true) {
    return emptyResumedArtifactFrameSeed()
  }
  return extractArtifactFrameSeedFromTranscript(messages ?? [])
}
