import { LRUCache } from 'lru-cache'
import { normalize } from 'path'

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
  // Also set on resume rehydrate when the Read result was token-cap truncated
  // (densable isPartialView on Woo extract).
  isPartialView?: boolean
  /**
   * densable contentHash (Bun.hash → base36). When present, stale content
   * equality (xOe) compares hashes instead of full strings.
   */
  contentHash?: string
  /**
   * densable contentNotInModelContext — true when cache holds disk bytes the
   * model never saw (e.g. Edit pre-image, auto-injected strip). H1e/already_read
   * must re-read so @-mention is not empty after file-modifying hooks/tools.
   */
  contentNotInModelContext?: boolean
  /**
   * densable contentLength — optional; empty content is only "full enough" when
   * contentLength is 0 (truly empty file), not when content was stripped.
   */
  contentLength?: number
  /**
   * 2.1.323 #1982 (SEA `keepContent`): when true, retain inline `content` even
   * above `MAX_INLINE_FILE_STATE_BYTES` instead of keeping hash-only metadata.
   */
  keepContent?: boolean
  /**
   * Official 2.1.327 (#413): true when the cache entry was refreshed behind
   * the model's back and must not be retained as a pre-compaction read.
   */
  refreshedBehindModel?: boolean
  /**
   * Persisted result of evaluating whether this read covered the full file
   * before large inline `content` (>4 KiB) is stripped to `''`.
   */
  fullFileRead?: boolean
}

/**
 * 2.1.323 #1982 (SEA `b = 4096`): files larger than 4 KiB keep only their
 * contentHash + contentLength in FileStateCache unless `keepContent: true`,
 * preventing memory spikes and multi-MB diffing on the next prompt after
 * Claude changes a very large file.
 */
export const MAX_INLINE_FILE_STATE_BYTES = 4096

/**
 * Official 2.1.326 (#241) `Qno`: normalize CRLF/CR line endings to LF before
 * hashing/comparing so Windows CRLF files match cached reads cleanly without
 * triggering redundant re-reads or expensive diffs.
 */
export function normalizeLineEndingsForHash(content: string): string {
  if (!content.includes('\r')) return content
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** densable DAu — content fingerprint for xOe. */
export function fileStateContentHash(content: string): string {
  return Bun.hash(normalizeLineEndingsForHash(content)).toString(36)
}

/**
 * densable HOe — true when the cached read is "full enough" for content-based
 * stale bypass: offset starts at file start, not a partial view, and either
 * no limit was applied or the returned content is shorter than the limit
 * (so the whole file was returned).
 */
export function isFullEnoughFileRead(state: FileState): boolean {
  // densable H1e = mGe(e) && !e.contentNotInModelContext
  if (state.contentNotInModelContext || state.refreshedBehindModel) {
    return false
  }
  if ((state.offset ?? 1) > 1 || state.isPartialView) {
    return false
  }
  if (state.limit === undefined) {
    return true
  }
  if (state.fullFileRead !== undefined) {
    return state.fullFileRead
  }
  if (state.content === '') {
    return false
  }
  // densable Tu(content, "\n") + 1 < limit
  let newlines = 0
  for (let i = 0; i < state.content.length; i++) {
    if (state.content.charCodeAt(i) === 10) newlines++
  }
  return newlines + 1 < state.limit
}

/**
 * densable xOe — content equality against disk, preferring contentHash when set.
 */
export function fileStateContentMatches(
  state: FileState,
  diskContent: string,
): boolean {
  if (state.contentHash !== undefined) {
    return state.contentHash === fileStateContentHash(diskContent)
  }
  return (
    normalizeLineEndingsForHash(state.content) ===
    normalizeLineEndingsForHash(diskContent)
  )
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
function normalizeCacheKey(key: string): string {
  const normalized = normalize(key)
  // Official 2.1.326 (#241): lowercase Windows drive letter so `C:\foo` and
  // `c:\foo` hit the same cache slot without extra stat/realpath round-trips.
  if (
    normalized.length >= 2 &&
    normalized.charCodeAt(1) === 58 &&
    normalized.charCodeAt(0) >= 65 &&
    normalized.charCodeAt(0) <= 90
  ) {
    return normalized[0]!.toLowerCase() + normalized.slice(1)
  }
  return normalized
}

export class FileStateCache {
  private cache: LRUCache<string, FileState>
  private readsBeforeCompaction: LRUCache<string, FileState> | undefined
  private everHeld = new Set<string>()
  private startOnly = new Set<string>()

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
    return this.cache.get(normalizeCacheKey(key))
  }

  markStartOnly(key: string): void {
    this.startOnly.add(normalizeCacheKey(key))
  }

  startOnlyPaths(): string[] {
    return [...this.startOnly]
  }

  holdsOnlyStartOf(key: string): boolean {
    const normalized = normalizeCacheKey(key)
    const entry = this.cache.get(normalized)
    return (
      this.startOnly.has(normalized) && !(entry && isFullEnoughFileRead(entry))
    )
  }

  set(key: string, value: FileState): this {
    const normalized = normalizeCacheKey(key)
    const prev = this.cache.get(normalized)
    if (typeof value.content !== 'string') {
      this.cache.set(normalized, value)
      this.remember(normalized)
      return this
    }
    const keepContent = value.keepContent ?? prev?.keepContent
    const contentHash = value.contentHash ?? fileStateContentHash(value.content)
    const contentLength = value.contentLength ?? value.content.length
    const effectiveContent =
      keepContent &&
      value.content === '' &&
      contentHash === prev?.contentHash &&
      prev.content
        ? prev.content
        : value.content
    const fullFileRead =
      value.fullFileRead ??
      isFullEnoughFileRead({ ...value, content: effectiveContent })
    const storedContent =
      keepContent ||
      Buffer.byteLength(effectiveContent, 'utf8') <= MAX_INLINE_FILE_STATE_BYTES
        ? effectiveContent
        : ''
    const nextEntry: FileState = {
      ...value,
      ...(keepContent !== undefined ? { keepContent } : {}),
      contentHash,
      contentLength,
      fullFileRead,
      content: storedContent,
    }
    this.cache.set(normalized, nextEntry)
    if (fullFileRead) {
      this.readsBeforeCompaction?.delete(normalized)
    }
    this.remember(normalized)
    return this
  }

  private remember(normalizedKey: string): void {
    this.everHeld.delete(normalizedKey)
    this.everHeld.add(normalizedKey)
    if (this.everHeld.size > this.cache.max) {
      for (const oldest of this.everHeld) {
        this.everHeld.delete(oldest)
        break
      }
    }
  }

  has(key: string): boolean {
    return this.cache.has(normalizeCacheKey(key))
  }

  delete(key: string): boolean {
    const normalized = normalizeCacheKey(key)
    this.readsBeforeCompaction?.delete(normalized)
    return this.cache.delete(normalized)
  }

  clear(): void {
    this.cache.clear()
    this.readsBeforeCompaction = undefined
  }

  /**
   * Official 2.1.326 (#241): preserve hash-only metadata for previously read
   * files across compaction so post-compact reads/edits avoid slow full diffs.
   */
  clearForCompaction(): void {
    const retained =
      this.readsBeforeCompaction ??
      new LRUCache<string, FileState>({ max: this.cache.max })
    for (const [k, entry] of this.cache.dump()) {
      const val = entry.value
      if (!val.isPartialView && !val.refreshedBehindModel && !retained.has(k)) {
        retained.set(k, { ...val, content: '' })
      }
    }
    this.clear()
    this.readsBeforeCompaction = retained
  }

  readBeforeCompaction(key: string): FileState | undefined {
    return this.readsBeforeCompaction?.peek(normalizeCacheKey(key))
  }

  renewReadBeforeCompaction(key: string): void {
    const normalized = normalizeCacheKey(key)
    const entry = this.cache.peek(normalized)
    if (entry !== undefined && !entry.refreshedBehindModel) {
      this.readsBeforeCompaction?.set(normalized, { ...entry, content: '' })
    }
  }

  forgetReadsBeforeCompaction(): void {
    this.readsBeforeCompaction = undefined
  }

  copyReadsBeforeCompactionFrom(other: FileStateCache): void {
    if (other.readsBeforeCompaction !== undefined) {
      this.readsBeforeCompaction = new LRUCache<string, FileState>({
        max: this.cache.max,
      })
      this.readsBeforeCompaction.load(other.readsBeforeCompaction.dump())
    }
  }

  everHeldPaths(): Set<string> {
    return new Set([...this.everHeld, ...this.cache.keys()])
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

// Helper function to clone a FileStateCache
// Preserves size limit configuration from the source cache
export function cloneFileStateCache(cache: FileStateCache): FileStateCache {
  const cloned = createFileStateCacheWithSizeLimit(cache.max, cache.maxSize)
  cloned.load(cache.dump())
  cloned.copyReadsBeforeCompactionFrom(cache)
  for (const p of cache.startOnlyPaths()) {
    cloned.markStartOnly(p)
  }
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
