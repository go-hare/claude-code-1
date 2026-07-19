import { LRUCache } from 'lru-cache'
import { normalize } from 'path'

/**
 * densable ACg — keep body content for entries ≤ this many UTF-8 bytes, or
 * when keepContent is set (CLAUDE.md seeds). Larger non-kept entries store
 * content:"" + contentHash so ALe equality still works without RAM bloat.
 */
export const FILE_STATE_KEEP_CONTENT_MAX_BYTES = 4096

export type FileState = {
  content: string
  timestamp: number
  offset: number | undefined
  limit: number | undefined
  // True when this entry was populated by auto-injection (e.g. CLAUDE.md) and
  // the injected content did not match disk (stripped HTML comments, stripped
  // frontmatter, truncated MEMORY.md). The model has only seen a partial view;
  // Edit/Write must require an explicit Read first. `content` here holds the
  // RAW disk bytes (for getChangedFiles diffing), not what the model saw.
  isPartialView?: boolean
  /**
   * densable seededFromContext — entry was auto-seeded into the parent context
   * (CLAUDE.md / nested memory), not an explicit model Read. createSubagentContext
   * clones strip this flag (qwe stripSeededFromContext) so subagent Edit/Write
   * does not inherit "already read" from parent seed alone.
   */
  seededFromContext?: boolean
  /**
   * densable keepContent — never strip body for large files (seeded CLAUDE.md).
   * Sticky across set() when not re-specified (t.keepContent ?? prior).
   */
  keepContent?: boolean
  /** densable contentHash — Bun.hash(content).toString(36) for ALe equality. */
  contentHash?: string
  /** densable contentLength — original content.length before optional strip. */
  contentLength?: number
}

/** densable nyu — stable content fingerprint for FileState equality. */
export function hashFileStateContent(content: string): string {
  return Bun.hash(content).toString(36)
}

/**
 * densable ALe — content equality using contentHash when present, else raw
 * string compare. Used by Edit/Write stale-mtime fallback + getChangedFiles.
 */
export function fileStateContentMatches(
  state: Pick<FileState, 'content' | 'contentHash'>,
  content: string,
): boolean {
  if (state.contentHash !== undefined) {
    return state.contentHash === hashFileStateContent(content)
  }
  return state.content === content
}

// Default max entries for read file state caches
export const READ_FILE_STATE_CACHE_SIZE = 100

// Default size limit for file state caches (25MB)
// This prevents unbounded memory growth from large file contents
const DEFAULT_MAX_CACHE_SIZE_BYTES = 25 * 1024 * 1024

/**
 * A file state cache that normalizes all path keys before access.
 * This ensures consistent cache hits regardless of whether callers pass
 * relative vs absolute paths with redundant segments (e.g. /foo/../bar)
 * or mixed path separators on Windows (/ vs \).
 */
export class FileStateCache {
  private cache: LRUCache<string, FileState>

  constructor(maxEntries: number, maxSizeBytes: number) {
    this.cache = new LRUCache<string, FileState>({
      max: maxEntries,
      maxSize: maxSizeBytes,
      sizeCalculation: value => {
        const c = value.content
        const s =
          typeof c === 'string'
            ? c
            : c === null || c === undefined
              ? ''
              : typeof c === 'object'
                ? JSON.stringify(c)
                : String(c)
        return Math.max(1, Buffer.byteLength(s, 'utf8'))
      },
    })
  }

  get(key: string): FileState | undefined {
    return this.cache.get(normalize(key))
  }

  /**
   * densable oyu.set — normalize path; sticky keepContent; auto contentHash /
   * contentLength; optionally strip large non-kept bodies to "" (hash remains).
   * Re-set with empty content + same hash + keepContent restores prior body.
   */
  set(key: string, value: FileState): this {
    const normalized = normalize(key)
    const prior = this.cache.get(normalized)
    const keepContent = value.keepContent ?? prior?.keepContent
    // Defensive: some tests/callers may pass non-string content; coerce for hash.
    const rawContent =
      typeof value.content === 'string'
        ? value.content
        : value.content == null
          ? ''
          : String(value.content)
    const contentHash =
      value.contentHash ?? hashFileStateContent(rawContent)
    const contentLength = value.contentLength ?? rawContent.length
    let body =
      keepContent &&
      rawContent === '' &&
      contentHash === prior?.contentHash &&
      prior.content
        ? prior.content
        : rawContent
    if (
      !(
        keepContent ||
        Buffer.byteLength(body, 'utf8') <= FILE_STATE_KEEP_CONTENT_MAX_BYTES
      )
    ) {
      body = ''
    }
    this.cache.set(normalized, {
      ...value,
      keepContent,
      contentHash,
      contentLength,
      content: body,
    })
    return this
  }

  has(key: string): boolean {
    return this.cache.has(normalize(key))
  }

  delete(key: string): boolean {
    return this.cache.delete(normalize(key))
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }

  get max(): number {
    return this.cache.max
  }

  get maxSize(): number {
    return this.cache.maxSize
  }

  get calculatedSize(): number {
    return this.cache.calculatedSize
  }

  keys(): Generator<string> {
    return this.cache.keys()
  }

  entries(): Generator<[string, FileState]> {
    return this.cache.entries()
  }

  dump(): ReturnType<LRUCache<string, FileState>['dump']> {
    return this.cache.dump()
  }

  load(entries: ReturnType<LRUCache<string, FileState>['dump']>): void {
    this.cache.load(entries)
  }
}

/**
 * Factory function to create a size-limited FileStateCache.
 * Uses LRUCache's built-in size-based eviction to prevent memory bloat.
 * Note: Images are not cached (see FileReadTool) so size limit is mainly
 * for large text files, notebooks, and other editable content.
 */
export function createFileStateCacheWithSizeLimit(
  maxEntries: number,
  maxSizeBytes: number = DEFAULT_MAX_CACHE_SIZE_BYTES,
): FileStateCache {
  return new FileStateCache(maxEntries, maxSizeBytes)
}

// Helper function to convert cache to object (used by compact.ts)
export function cacheToObject(
  cache: FileStateCache,
): Record<string, FileState> {
  return Object.fromEntries(cache.entries())
}

// Helper function to get all keys from cache (used by several components)
export function cacheKeys(cache: FileStateCache): string[] {
  return Array.from(cache.keys())
}

/**
 * densable qwe — clone FileStateCache, optionally clearing seededFromContext
 * on every entry (createSubagentContext always uses stripSeededFromContext:!0).
 */
export function cloneFileStateCache(
  cache: FileStateCache,
  options?: { stripSeededFromContext?: boolean },
): FileStateCache {
  const cloned = createFileStateCacheWithSizeLimit(cache.max, cache.maxSize)
  const entries = cache.dump()
  if (options?.stripSeededFromContext) {
    for (const entry of entries) {
      const value = entry[1].value
      if (value?.seededFromContext) {
        entry[1].value = { ...value, seededFromContext: false }
      }
    }
  }
  cloned.load(entries)
  return cloned
}

// Merge two file state caches, with more recent entries (by timestamp) overriding older ones
export function mergeFileStateCaches(
  first: FileStateCache,
  second: FileStateCache,
): FileStateCache {
  const merged = cloneFileStateCache(first)
  for (const [filePath, fileState] of second.entries()) {
    const existing = merged.get(filePath)
    // Only override if the new entry is more recent
    if (!existing || fileState.timestamp > existing.timestamp) {
      merged.set(filePath, fileState)
    }
  }
  return merged
}
