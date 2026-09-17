/**
 * densable hb `za` @207418794 — `Yn`/`Ar` @207259069, `At`/`hn` @207262243,
 * `Mt` @207269036, `zt`/`_a` @207299555, `Xt`/`It` @207300427.
 */

import type { Dirent } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { isValidStoragePathSegment } from '../sessionNameJobSidecar.js'

type Roots = {
  configHome: string
  globalConfigFile: string
  bridgeSpawnRoot?: string
}

export type StorageV5ListEntry = {
  kind: 'key' | 'scope'
  key?: Record<string, unknown>
  scope?: Record<string, unknown>
  size?: number
  mtimeMs?: number
  unlisted?: boolean
  viaSymlink?: true
}

type StorageV5Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string } }

const FN = '.jsonl'

function stripSuffix(
  name: string,
  suffix: string,
  map: (stem: string) => StorageV5ListEntry | undefined,
): StorageV5ListEntry | undefined {
  if (!name.endsWith(suffix) || name.length <= suffix.length) return
  return map(name.slice(0, -suffix.length))
}

/** densable leftover `Yn` / `Ar` — scope → `{directory,scope}` pages. */
export function resolveScopeListDirectories(
  roots: Roots,
  scope: Record<string, unknown>,
): Array<{ directory: string; scope: Record<string, unknown> }> {
  const r = roots.configHome
  const n = scope
  switch (n.namespace) {
    case 'transcript': {
      if (n.projectKey === undefined) {
        return [{ directory: join(r, 'projects'), scope: n }]
      }
      if (typeof n.projectKey !== 'string') return []
      if (n.sessionId === undefined) {
        return [{ directory: join(r, 'projects', n.projectKey), scope: n }]
      }
      if (typeof n.sessionId !== 'string') return []
      const t = join(r, 'projects', n.projectKey, n.sessionId)
      if (n.agentRelPath !== undefined) {
        const rel = Array.isArray(n.agentRelPath)
          ? n.agentRelPath.filter((p): p is string => typeof p === 'string')
          : []
        return [{ directory: join(t, 'subagents', ...rel), scope: n }]
      }
      return [
        { directory: t, scope: n },
        {
          directory: join(t, 'subagents'),
          scope: { ...n, agentRelPath: [] },
        },
      ]
    }
    case 'task':
      return n.listId === undefined
        ? [{ directory: join(r, 'tasks'), scope: n }]
        : [{ directory: join(r, 'tasks', String(n.listId)), scope: n }]
    case 'memory':
      return [
        {
          directory: join(
            r,
            'projects',
            String(n.projectKey ?? ''),
            'memory',
            ...(Array.isArray(n.relPath)
              ? n.relPath.filter((p): p is string => typeof p === 'string')
              : []),
          ),
          scope: n,
        },
      ]
    case 'pluginCache':
      return [
        {
          directory: join(
            r,
            'plugins',
            'cache',
            ...(n.marketplace === undefined ? [] : [String(n.marketplace)]),
            ...(n.plugin === undefined ? [] : [String(n.plugin)]),
            ...(n.version === undefined ? [] : [String(n.version)]),
            ...(Array.isArray(n.relPath)
              ? n.relPath.filter((p): p is string => typeof p === 'string')
              : []),
          ),
          scope: n,
        },
      ]
    case 'state':
      return [{ directory: join(r, 'state'), scope: n }]
    case 'plan':
      return [{ directory: join(r, 'plans'), scope: n }]
    case 'paste':
      return [{ directory: join(r, 'paste-cache'), scope: n }]
    case 'sidecar':
      return [
        {
          directory: join(
            r,
            'projects',
            String(n.projectKey ?? ''),
            String(n.sessionId ?? ''),
            ...(Array.isArray(n.relPath)
              ? n.relPath.filter((p): p is string => typeof p === 'string')
              : []),
          ),
          scope: n,
        },
      ]
    case 'scratch':
      return n.sessionId === undefined
        ? [{ directory: join(r, 'scratch'), scope: n }]
        : [
            {
              directory: join(
                r,
                'scratch',
                String(n.sessionId),
                ...(Array.isArray(n.relPath)
                  ? n.relPath.filter((p): p is string => typeof p === 'string')
                  : []),
              ),
              scope: n,
            },
          ]
    case 'fileHistory':
      return n.sessionId === undefined
        ? [{ directory: join(r, 'file-history'), scope: n }]
        : [
            {
              directory: join(r, 'file-history', String(n.sessionId)),
              scope: n,
            },
          ]
    case 'job':
      return n.jobId === undefined
        ? [{ directory: join(r, 'jobs'), scope: n }]
        : [
            {
              directory: join(
                r,
                'jobs',
                String(n.jobId),
                ...(Array.isArray(n.relPath)
                  ? n.relPath.filter((p): p is string => typeof p === 'string')
                  : []),
              ),
              scope: n,
            },
          ]
    case 'daemon':
      return [
        {
          directory: join(
            r,
            'daemon',
            ...(Array.isArray(n.relPath)
              ? n.relPath.filter((p): p is string => typeof p === 'string')
              : []),
          ),
          scope: n,
        },
      ]
    case 'jobsRoot':
      return [{ directory: join(r, 'jobs'), scope: n }]
    case 'session':
      return [{ directory: join(r, 'sessions'), scope: n }]
    case 'feedbackDraft':
      return [{ directory: join(r, 'feedback', 'drafts'), scope: n }]
    default:
      return []
  }
}

/** densable leftover `Mt` @207269036. */
function mapTranscriptListEntry(
  e: Record<string, unknown>,
  n: string,
  r: boolean,
): StorageV5ListEntry | undefined {
  if (e.projectKey === undefined) {
    return r
      ? { kind: 'scope', scope: { namespace: 'transcript', projectKey: n } }
      : undefined
  }
  if (e.sessionId !== undefined) {
    const o = e.projectKey
    const i = e.sessionId
    const l = e.agentRelPath
    if (l === undefined) {
      const d = r
        ? undefined
        : stripSuffix(n, FN, f =>
            isValidStoragePathSegment(f)
              ? {
                  kind: 'key',
                  key: {
                    namespace: 'transcript',
                    projectKey: o,
                    sessionId: i,
                    sessionJournal: f,
                  },
                }
              : undefined,
          )
      if (d !== undefined) return d
      return
    }
    const rel = Array.isArray(l)
      ? l.filter((p): p is string => typeof p === 'string')
      : []
    if (r) {
      return n.startsWith('.')
        ? undefined
        : { kind: 'scope', scope: { ...e, agentRelPath: [...rel, n] } }
    }
    if (n === 'journal.jsonl') {
      return rel.length > 0
        ? {
            kind: 'key',
            key: {
              namespace: 'transcript',
              projectKey: o,
              sessionId: i,
              agentRelPath: rel,
              journal: true,
            },
          }
        : undefined
    }
    return stripSuffix(n, FN, d =>
      d.startsWith('agent-') && d.length > 6
        ? {
            kind: 'key',
            key: {
              namespace: 'transcript',
              projectKey: o,
              sessionId: i,
              agentId: d.slice(6),
              ...(rel.length > 0 && { agentRelPath: rel }),
            },
          }
        : undefined,
    )
  }
  if (r) {
    return isValidStoragePathSegment(n)
      ? {
          kind: 'scope',
          scope: {
            namespace: 'transcript',
            projectKey: e.projectKey,
            sessionId: n,
          },
        }
      : undefined
  }
  const t = e.projectKey
  return stripSuffix(n, FN, o =>
    isValidStoragePathSegment(o)
      ? {
          kind: 'key',
          key: { namespace: 'transcript', projectKey: t, sessionId: o },
        }
      : undefined,
  )
}

/** densable leftover `At` / `hn` @207262243. */
export function mapNamespaceListEntry(
  e: Record<string, unknown>,
  n: string,
  r: boolean,
): StorageV5ListEntry | undefined {
  switch (e.namespace) {
    case 'transcript':
      return mapTranscriptListEntry(e, n, r)
    case 'task':
      if (e.listId === undefined) {
        return r
          ? { kind: 'scope', scope: { namespace: 'task', listId: n } }
          : undefined
      }
      if (r) return
      return stripSuffix(n, '.json', o => ({
        kind: 'key',
        key: { namespace: 'task', listId: e.listId, taskId: o },
      }))
    case 'memory':
      return r
        ? {
            kind: 'scope',
            scope: {
              ...e,
              relPath: [
                ...(Array.isArray(e.relPath)
                  ? e.relPath.filter((p): p is string => typeof p === 'string')
                  : []),
                n,
              ],
            },
          }
        : {
            kind: 'key',
            key: {
              namespace: 'memory',
              projectKey: e.projectKey,
              relPath: [
                ...(Array.isArray(e.relPath)
                  ? e.relPath.filter((p): p is string => typeof p === 'string')
                  : []),
                n,
              ],
            },
          }
    case 'pluginCache':
      if (e.marketplace === undefined) {
        return r
          ? {
              kind: 'scope',
              scope: { namespace: 'pluginCache', marketplace: n },
            }
          : undefined
      }
      if (e.plugin === undefined) {
        return r
          ? {
              kind: 'scope',
              scope: {
                namespace: 'pluginCache',
                marketplace: e.marketplace,
                plugin: n,
              },
            }
          : undefined
      }
      if (e.version === undefined) {
        return r
          ? {
              kind: 'scope',
              scope: {
                namespace: 'pluginCache',
                marketplace: e.marketplace,
                plugin: e.plugin,
                version: n,
              },
            }
          : undefined
      }
      return r
        ? {
            kind: 'scope',
            scope: {
              ...e,
              relPath: [
                ...(Array.isArray(e.relPath)
                  ? e.relPath.filter((p): p is string => typeof p === 'string')
                  : []),
                n,
              ],
            },
          }
        : {
            kind: 'key',
            key: {
              namespace: 'pluginCache',
              marketplace: e.marketplace,
              plugin: e.plugin,
              version: e.version,
              relPath: [
                ...(Array.isArray(e.relPath)
                  ? e.relPath.filter((p): p is string => typeof p === 'string')
                  : []),
                n,
              ],
            },
          }
    case 'state':
      return r
        ? undefined
        : stripSuffix(n, '.json', o => ({
            kind: 'key',
            key: { namespace: 'state', id: o },
          }))
    case 'plan':
      return r
        ? undefined
        : stripSuffix(n, '.md', o => ({
            kind: 'key',
            key: { namespace: 'plan', name: o },
          }))
    case 'paste':
      return r
        ? undefined
        : stripSuffix(n, '.txt', o => ({
            kind: 'key',
            key: { namespace: 'paste', id: o },
          }))
    case 'sidecar': {
      const rel = Array.isArray(e.relPath)
        ? e.relPath.filter((p): p is string => typeof p === 'string')
        : []
      if (r) {
        return { kind: 'scope', scope: { ...e, relPath: [...rel, n] } }
      }
      return {
        kind: 'key',
        key: {
          namespace: 'sidecar',
          projectKey: e.projectKey,
          sessionId: e.sessionId,
          relPath: [...rel, n],
        },
      }
    }
    case 'scratch':
      if (e.sessionId === undefined) {
        return r
          ? { kind: 'scope', scope: { namespace: 'scratch', sessionId: n } }
          : undefined
      }
      {
        const rel = Array.isArray(e.relPath)
          ? e.relPath.filter((p): p is string => typeof p === 'string')
          : []
        return r
          ? { kind: 'scope', scope: { ...e, relPath: [...rel, n] } }
          : {
              kind: 'key',
              key: {
                namespace: 'scratch',
                sessionId: e.sessionId,
                relPath: [...rel, n],
              },
            }
      }
    case 'fileHistory':
      if (e.sessionId === undefined) {
        return r && isValidStoragePathSegment(n)
          ? { kind: 'scope', scope: { namespace: 'fileHistory', sessionId: n } }
          : undefined
      }
      return r
        ? undefined
        : {
            kind: 'key',
            key: {
              namespace: 'fileHistory',
              sessionId: e.sessionId,
              backupFileName: n,
            },
          }
    case 'job':
      if (e.jobId === undefined) {
        return r && isValidStoragePathSegment(n)
          ? { kind: 'scope', scope: { namespace: 'job', jobId: n } }
          : undefined
      }
      {
        const rel = Array.isArray(e.relPath)
          ? e.relPath.filter((p): p is string => typeof p === 'string')
          : []
        if (r) return { kind: 'scope', scope: { ...e, relPath: [...rel, n] } }
        return {
          kind: 'key',
          key: { namespace: 'job', jobId: e.jobId, relPath: [...rel, n] },
        }
      }
    case 'daemon': {
      const rel = Array.isArray(e.relPath)
        ? e.relPath.filter((p): p is string => typeof p === 'string')
        : []
      return r
        ? { kind: 'scope', scope: { ...e, relPath: [...rel, n] } }
        : { kind: 'key', key: { namespace: 'daemon', relPath: [...rel, n] } }
    }
    case 'jobsRoot':
      if (r) return
      if (n === 'pins.json') {
        return { kind: 'key', key: { namespace: 'jobsRoot', file: 'pins' } }
      }
      return
    case 'session':
      return r
        ? undefined
        : { kind: 'key', key: { namespace: 'session', file: n } }
    case 'feedbackDraft':
      return r
        ? undefined
        : stripSuffix(n, '.json', o => ({
            kind: 'key',
            key: { namespace: 'feedbackDraft', draftId: o },
          }))
    default:
      return
  }
}

type Ranked = {
  entry: StorageV5ListEntry
  position: { body: string; kind: 'key' | 'scope' }
}

function stableStringifyRecord(rec: Record<string, unknown>): string {
  const r: Record<string, unknown> = {}
  for (const n of Object.keys(rec).sort()) r[n] = rec[n]
  return JSON.stringify(r)
}

function buildEntrySortPosition(e: StorageV5ListEntry): {
  body: string
  kind: 'key' | 'scope'
} {
  return e.kind === 'key'
    ? { body: stableStringifyRecord(e.key ?? {}), kind: 'key' }
    : { body: stableStringifyRecord(e.scope ?? {}), kind: 'scope' }
}

function compareSortBodies(e: string, r: string): number {
  const n = e.localeCompare(r)
  if (n !== 0) return n
  return e < r ? -1 : e > r ? 1 : 0
}

function compareSortPositions(
  e: { body: string; kind: string },
  r: { body: string; kind: string },
): number {
  const n = compareSortBodies(e.body, r.body)
  if (n !== 0) return n
  return e.kind === r.kind ? 0 : e.kind === 'key' ? -1 : 1
}

/** densable leftover `zt` / `_a` @207299555. */
export function rankListEntriesForSort(items: StorageV5ListEntry[]): Ranked[] {
  return items
    .map(r => ({ entry: r, position: buildEntrySortPosition(r) }))
    .sort((r, n) => compareSortPositions(r.position, n.position))
}

/** densable leftover `Xt` / `It` @207300427. */
export function sliceRankedListPage(
  ranked: Ranked[],
  opts?: { cursor?: unknown; limit?: number },
): { items: StorageV5ListEntry[]; cursor?: unknown } {
  const t = typeof opts?.cursor === 'number' ? opts.cursor : 0
  const o =
    opts?.limit === undefined
      ? ranked.length
      : Math.min(ranked.length, t + opts.limit)
  const u = ranked.slice(t, o)
  const s = u.map(m => m.entry)
  if (o >= ranked.length) return { items: s }
  return { items: s, cursor: o }
}

/**
 * densable leftover `za` @207418794.
 * `absent` dir → skip. `skipKeyStats` / `skipScopeStats` as official hy.
 */
export async function listScopeEntries(
  roots: Roots,
  scope: Record<string, unknown>,
  opts?: {
    cursor?: unknown
    skipKeyStats?: boolean
    skipScopeStats?: boolean
    limit?: number
  },
): Promise<StorageV5Result<{ items: StorageV5ListEntry[]; cursor?: unknown }>> {
  const i: StorageV5ListEntry[] = []
  for (const { directory: s, scope: l } of resolveScopeListDirectories(
    roots,
    scope,
  )) {
    let names: Dirent[]
    try {
      names = await readdir(s, { withFileTypes: true })
    } catch (error) {
      if (isAbsent(error)) continue
      return { ok: false, error: { code: 'Failed' } }
    }
    for (const h of names) {
      const mapped = mapNamespaceListEntry(l, h.name, h.isDirectory())
      if (mapped === undefined || (mapped as { unlisted?: boolean }).unlisted) {
        continue
      }
      if (mapped.kind === 'key' && opts?.skipKeyStats === true) {
        i.push(mapped)
        continue
      }
      if (mapped.kind === 'scope' && opts?.skipScopeStats === true) {
        i.push(mapped)
        continue
      }
      try {
        const info = await stat(join(s, h.name))
        i.push({ ...mapped, size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        i.push(mapped)
      }
    }
  }
  return {
    ok: true,
    value: sliceRankedListPage(rankListEntriesForSort(i), opts),
  }
}

function isAbsent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
