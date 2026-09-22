/**
 * densable 2.1.248 #16 — PR-status cache load/persist that drops malformed
 * entries.
 *
 * GOLD: uXe @184559295 sha=47077b3550afa3f2
 *       K$n @184559595 sha=d5f332dda9cbcad7
 *       q$n @184558619 sha=bfeb4eac3fbfa629
 *       RJt schema after q$n.
 * Roster `#x` / `#E` leftover host is `src/screens/fleetView/prStatuses.ts`
 * (AgentView.refresh). Do not invent full `Fh()` / `V$n` / `rp`.
 */
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage } from './errors.js'
import { lazySchema } from './lazySchema.js'
import { getPrStatusShared } from './prStatusPoller.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import { isHoverRestOn } from './storageV5/hoverRestPin.js'

/** densable hXe — `Se.state("gh-pr-status-cache")`. */
export const PR_STATUS_CACHE_STATE_KEY = {
  namespace: 'state',
  id: 'gh-pr-status-cache',
} as const

/** densable gXe filename — `rJt(ge(), "gh-pr-status-cache.json")`. */
export const PR_STATUS_CACHE_FILENAME = 'gh-pr-status-cache.json'

/**
 * densable `e` on K$n / `t` on q$n — storageV5 `.read([hXe])` /
 * `.write(hXe, body, {mode})`.
 */
export type PrStatusCacheStorage = {
  read: (reqs: ReadonlyArray<unknown>) => Promise<
    | {
        ok: true
        value: {
          items: Array<{
            found?: boolean
            value?: Uint8Array | string
          }>
        }
      }
    | { ok: false; error: { code: string } }
  >
  write?: (
    key: unknown,
    value: string,
    opts?: { mode?: number },
  ) => Promise<{ ok: true } | { ok: false; error: { code: string } }>
}

/**
 * densable RJt
 * `w.object({number,title,state,checks,review,additions,deletions})`
 */
export const prStatusCacheEntrySchema = lazySchema(() =>
  z.object({
    number: z.number(),
    title: z.string(),
    state: z.enum(['OPEN', 'MERGED', 'CLOSED', 'DRAFT']),
    checks: z.object({
      passed: z.number(),
      failed: z.number(),
      pending: z.number(),
    }),
    review: z
      .enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])
      .nullable(),
    additions: z.number(),
    deletions: z.number(),
  }),
)

export type PrStatusCacheEntry = z.infer<
  ReturnType<typeof prStatusCacheEntrySchema>
>

/** densable gXe */
export function getPrStatusCachePath(): string {
  return join(getClaudeConfigHomeDir(), PR_STATUS_CACHE_FILENAME)
}

/**
 * densable uXe — parse cache JSON; drop malformed entries (do not throw).
 */
export function parsePrStatusCache(
  raw: string,
): Map<string, PrStatusCacheEntry> {
  const cache = new Map<string, PrStatusCacheEntry>()
  let parsed: unknown
  try {
    parsed = jsonParse(raw)
  } catch {
    return cache
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return cache
  }
  let dropped = 0
  for (const [key, value] of Object.entries(parsed)) {
    const parsedEntry = prStatusCacheEntrySchema().safeParse(value)
    if (parsedEntry.success) cache.set(key, parsedEntry.data)
    else dropped++
  }
  if (dropped > 0) {
    logForDebugging(
      `loadPrStatusCache: dropped ${dropped} malformed cache entries`,
    )
  }
  return cache
}

/**
 * densable K$n — load from storageV5 when provided, else the leftover file.
 * Call site gold requires: K$n → uXe. Not a fleet/footer product surface.
 */
export async function loadPrStatusCache(
  storage?: PrStatusCacheStorage | null,
): Promise<Map<string, PrStatusCacheEntry>> {
  if (storage) {
    let result: Awaited<ReturnType<PrStatusCacheStorage['read']>>
    try {
      result = await storage.read([PR_STATUS_CACHE_STATE_KEY])
    } catch (err) {
      logForDebugging(`loadPrStatusCache: ${errorMessage(err)}`)
      return new Map()
    }
    if (!result.ok) {
      logForDebugging(`loadPrStatusCache: ${result.error.code}`)
      return new Map()
    }
    const item = result.value.items[0]
    if (!item?.found) return new Map()
    let raw: string
    try {
      raw = Buffer.from(item.value as Uint8Array | string).toString('utf-8')
    } catch (err) {
      logForDebugging(`loadPrStatusCache: ${errorMessage(err)}`)
      return new Map()
    }
    return parsePrStatusCache(raw)
  }
  try {
    const raw = await readFile(getPrStatusCachePath(), 'utf8')
    return parsePrStatusCache(raw)
  } catch {
    return new Map()
  }
}

/**
 * densable q$n — persist cache JSON via storageV5 when D() && t, else the
 * leftover file. Empty `{}` and unchanged body (JE().notePersistedCacheBody)
 * are no-ops. Leftover write errors are swallowed.
 */
export function persistPrStatusCache(
  cache: ReadonlyMap<string, PrStatusCacheEntry | null | undefined>,
  storage?: PrStatusCacheStorage | null,
): Promise<void> {
  const bodyObj: Record<string, PrStatusCacheEntry> = {}
  for (const [key, value] of cache) {
    if (value) bodyObj[key] = value
  }
  const body = jsonStringify(bodyObj)
  if (body === '{}' || !getPrStatusShared().notePersistedCacheBody(body)) {
    return Promise.resolve()
  }
  const write = storage?.write
  if (isHoverRestOn() && write) {
    return Promise.resolve()
      .then(() =>
        write(PR_STATUS_CACHE_STATE_KEY, body, {
          mode: 438 & ~process.umask(),
        }),
      )
      .then(result => {
        if (!result.ok) {
          logForDebugging(`persistPrStatusCache: ${result.error.code}`)
        }
      })
      .catch(err => {
        logForDebugging(`persistPrStatusCache: ${errorMessage(err)}`)
      })
  }
  return writeFile(getPrStatusCachePath(), body).catch(() => {})
}
