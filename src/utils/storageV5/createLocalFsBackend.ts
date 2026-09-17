/**
 * densable createLocalFsBackend (hb @207543077).
 * Leftover FS peel of leftover-used + write/lease/subscribe surface.
 * `readRecords` = official `al` @207401286 (`Ve`→`su`/`Ap`, else `La`).
 * `listEntries` = official `za` @207418794 (`Yn`/`At`/`Mt`/`zt`/`Xt`).
 * `listRecursive` = leftover `Xa` @207425816 (`_y`/`Ql`).
 * `resolveKey`/`resolveKeys` = leftover `Fc`/`ds` @207445806.
 * `copy`/`move`/`moveScope` = leftover `pf`/`yf`/`kf`.
 * `update`/`updateText` = leftover `Ds` @207517338.
 * `replaceRecords` = leftover `km` @207521788.
 * `writeFromFile`/`writeFromStream` = leftover `Jf`/`Zf`.
 * `stagingScopeBeside`/`Within` = leftover `Pf`/`Lf`.
 * `hostFiles` = leftover `$c` @207455722.
 * `deleteScope` = leftover `tc` @207427137 (`ic` / `wy`/`Ry`).
 * `ensureScope` = leftover `yc` @207443798 validators.
 * `delete` = leftover `$l` @207417461 validators.
 * `write` = official `zl` @207412582; `append` = official `Xu` @207387311.
 * Lease = leftover `Sb`/`vd`/`rs`/`Lt` in `storageLease.ts`.
 * Subscribe = leftover `Fb`/`Lt`/`Mu` in `storageSubscribe.ts`.
 * streamEntries = leftover `Ob` @207547246 (`or`→`Ou`, else `Ot`).
 * statStream = leftover `Qu` @207396685 (`Ve`→`lu`/`wp`, else `Ot`).
 * readValue framed = leftover `Pb`→`Ki`→`fu`/`uu`.
 * read/readText = leftover `Kl`/`ry` @207405200 (`Ty` + `Jg`/`ey`/`Qg`/`Zg` +
 * `I&&Ve`→`gu`/`kr`; value `Pl`/`se`).
 */

import { createHash, randomUUID } from 'crypto'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
  utimes,
} from 'fs/promises'
import { basename, dirname, join, relative, resolve } from 'path'
import { isENOENT } from '../errors.js'
import {
  tombstoneDigestRecords,
  readDigestRecords,
  observeDigestIndexState,
  getLogHeadStats,
  isFramedDigestStreamKey,
  readFramedStreamFu,
  readFramedRangeGu,
  FRAMED_VIEW_BUDGET_BYTES,
  readValueRangePl,
  readValueWholeSe,
  storageAppendRecords,
  publishValidatedStorageFile,
  purgeTombstonedDigestLog,
  digestStringifyCanonKey,
  type DigestHost,
} from './digestLog.js'
import { defaultLockUnconditionalPublishes } from './storageLock.js'
import { listScopeEntries } from './listEntriesZa.js'
import { listRecursiveXa } from './listRecursiveXa.js'
import { createLeaseApi } from './storageLease.js'
import {
  DEFAULT_SUBSCRIPTION_TIMING,
  closeStorageSubscriptions,
  subscribeStorage,
  type SubscribeBackend,
  type SubscribeStore,
  type SubscriptionTiming,
} from './storageSubscribe.js'
import {
  acquireStorageWatchBus,
  announceStorageChange,
  withStorageWatchExpect,
} from './storageWatchBus.js'
import {
  copyPf,
  decodeUpdateTextView,
  identityUpdateView,
  moveScopeKf,
  moveYf,
  replaceRecordsKm,
  resolveKeyFc,
  resolveKeysDs,
  stagingScopeBesidePf,
  stagingScopeWithinLf,
  updateDs,
  writeFromFileJf,
  writeFromStreamZf,
  type ResolveKeyHit,
  type ResolveKeyOpts,
  type StorageV5EditCurrent,
  type StorageV5EditDecision,
  type HbMutateHost,
} from './storageHbMutate.js'
import { isValidStoragePathSegment } from '../sessionNameJobSidecar.js'
import {
  getReadSymlinkClass,
  isStreamNamespaceKey,
  validateBridgeSpawnRoot,
  validateMarketplaceCacheReadOnly,
  validateMarketplaceCacheSymlinks,
  validateStorageKey,
  validateStorageScope,
} from './writeValidate.js'
import {
  createLocalHostFiles,
  resolveHostStoreRootsMb,
  snapshotHostStoreRootsAb,
  type LocalHostFiles,
} from './createLocalHostFiles.js'

export type StorageV5Result<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: { code: string; argument?: string; telemetryCode?: string }
    }

/**
 * densable leftover `Ty` @207435065 — bare key is `whole`; `{key,offset}` is
 * `range`; `{key,tail}` is `tail`. Do not widen missing offset to MAX.
 */
export type StorageV5ReadReq =
  | { key: unknown; offset: number; length?: number }
  | { key: unknown; tail: number }
  | Record<string, unknown>

/** densable leftover `Kl` opts — `Jg` @207406085. */
export type StorageV5ReadOpts = {
  hardened?: true
  symlinks?: 'follow' | 'refuse'
}

export type StorageV5ScopeKind = {
  kind: 'absent' | 'directory' | 'other' | 'link'
  linkResolves?: boolean
}

export type CreateLocalFsBackendOptions = {
  configHome: string
  globalConfigFile: string
  bridgeSpawnRoot?: string
  hostFilesServe?: unknown
  clock?: () => number
  nativeWatch?: boolean
  subscriptionTiming?: Partial<SubscriptionTiming>
  /** densable hb — default windows. */
  lockUnconditionalPublishes?: boolean
}

export type StorageV5LeaseHandle = {
  expiresAtMs: number
  holder: string
  renew: (ttlMs: number) => Promise<StorageV5Result<{ expiresAtMs: number }>>
  release: () => Promise<StorageV5Result<void>>
}

export type StorageV5RecordItem = {
  seq: number
  data: Uint8Array
  byteLength?: number
  endSeq?: number
  recordId?: string
  truncated?: boolean
  tombstoned?: boolean
}

export type StorageV5ListEntry = {
  kind: 'key' | 'scope'
  key?: Record<string, unknown>
  scope?: Record<string, unknown>
  size?: number
  mtimeMs?: number
}

export type StorageV5 = {
  roots: {
    configHome: string
    globalConfigFile: string
    bridgeSpawnRoot?: string
  }
  instanceId: string
  clock: () => number
  nativeWatch: boolean
  scopeKind: (
    scope: Record<string, unknown>,
    opts?: { resolveLink?: boolean },
  ) => Promise<StorageV5Result<StorageV5ScopeKind>>
  stat: (
    key: unknown,
  ) => Promise<StorageV5Result<{ size: number; mtimeMs: number }>>
  statMeta: (
    key: unknown,
  ) => Promise<
    StorageV5Result<{ size: number; mtimeMs?: number; createdMs?: number }>
  >
  read: (
    reqs: StorageV5ReadReq[],
    opts?: StorageV5ReadOpts,
  ) => Promise<
    StorageV5Result<{
      items: Array<{
        found: boolean
        totalBytes: number
        value?: Uint8Array
        version?: string
        mtimeMs?: number
      }>
    }>
  >
  readText: (
    reqs: StorageV5ReadReq[],
    opts?: StorageV5ReadOpts,
  ) => Promise<
    StorageV5Result<{
      items: Array<{
        found: boolean
        totalBytes: number
        value?: string
        version?: string
        mtimeMs?: number
      }>
    }>
  >
  write: (
    key: unknown,
    value: string | Uint8Array,
    opts?: {
      mode?: number
      parent?: string
      publishDiscipline?: string
      precondition?: { type?: string; version?: string }
    },
  ) => Promise<StorageV5Result<{ version: string }>>
  /**
   * densable hb `append:(d,c,f)=>Xu(s,d,c,f)` @207544200.
   * `Xr` framed → `Rg`; else digest `Eg`.
   */
  append: (
    key: unknown,
    records: Array<{ data: string | Uint8Array; recordId?: string }>,
    opts?: {
      singleName?: boolean
      precondition?: { type?: string; nonEmpty?: boolean }
    },
  ) => Promise<
    StorageV5Result<{
      acks: Array<{ seq: number; endSeq: number; recordId: string }>
    }>
  >
  delete: (key: unknown) => Promise<StorageV5Result<{ existed: boolean }>>
  acquireLease: (
    target: unknown,
    ttlMs: number,
    opts?: { holder?: string; meta?: unknown },
  ) => Promise<StorageV5Result<StorageV5LeaseHandle>>
  listLeases: (scope: unknown) => Promise<
    StorageV5Result<{
      items: Array<{
        target: unknown
        holder: string
        expiresAtMs: number
      }>
    }>
  >
  subscribe: (
    filter:
      | { target: 'key'; key: unknown }
      | { target: 'scope'; scope: unknown },
    _listener: (event: unknown) => void,
    opts?: { maxObservationLagMs?: number },
  ) => Promise<
    StorageV5Result<{
      unsubscribe: () => void
      observationLagMs: number
    }>
  >
  /**
   * densable hb `readRecords:(d,c)=>al(s,d,c)` @207544536.
   * Transcript/history: official `Ve` → `su`/`bp`/`Ap` jsonl (`or` namespace).
   */
  readRecords: (
    key: unknown,
    opts?: {
      order?: 'forward' | 'backward'
      maxBytes?: number
      limit?: number
      fromSeq?: number
      maxBytesPerRecord?: number
    },
  ) => Promise<
    StorageV5Result<{
      items: StorageV5RecordItem[]
      nextSeq?: number
    }>
  >
  /**
   * densable hb `listEntries:(d,c)=>za(s,d,c)` @207544143.
   * Leftover persist `R`/`bo` list transcript scopes.
   */
  listEntries: (
    scope: unknown,
    opts?: {
      cursor?: unknown
      skipKeyStats?: boolean
      skipScopeStats?: boolean
      suffix?: unknown
      links?: string
    },
  ) => Promise<
    StorageV5Result<{
      items: StorageV5ListEntry[]
      cursor?: unknown
    }>
  >
  /**
   * densable hb `listRecursive:(d,c)=>Xa(s,d,c)` @207425816.
   */
  listRecursive: (
    scope: unknown,
    opts?: {
      cursor?: unknown
      skipKeyStats?: boolean
      includeValue?: boolean
      suffix?: unknown
      links?: 'enter' | 'skip' | 'follow'
      maxLeaves?: number
      limit?: number
    },
  ) => Promise<
    StorageV5Result<{
      items: StorageV5ListEntry[]
      cursor?: unknown
    }>
  >
  /**
   * densable hb `resolveKey:(d,c)=>Fc(s,d,c)` @207445806.
   */
  resolveKey: (
    key: unknown,
    opts: ResolveKeyOpts,
  ) => Promise<StorageV5Result<ResolveKeyHit>>
  /**
   * densable hb `resolveKeys:(d,c)=>ds(s,d,c)` @207446172.
   */
  resolveKeys: (
    keys: unknown,
    opts: ResolveKeyOpts,
  ) => Promise<
    StorageV5Result<{ items: Array<StorageV5Result<ResolveKeyHit>> }>
  >
  /**
   * densable hb `copy:(d,c,f)=>pf(s,d,c,f)` @207462778.
   */
  copy: (
    from: unknown,
    to: unknown,
    opts?: {
      parent?: string
      share?: 'ifPossible' | 'require'
      mode?: number
      exactMode?: number
      requireMode?: boolean
      flush?: boolean
      precondition?: { type?: string; version?: string }
    },
  ) => Promise<StorageV5Result<{ version?: string; bytes: number }>>
  /**
   * densable hb `move:(d,c,f)=>yf(s,d,c,f)` @207464676.
   */
  move: (
    from: unknown,
    to: unknown,
    opts?: {
      parent?: string
      precondition?: { type?: string; version?: string }
    },
  ) => Promise<StorageV5Result<{ version?: string; bytes: number }>>
  /**
   * densable hb `moveScope:(d,c,f)=>kf(s,d,c,f)` @207465286.
   */
  moveScope: (
    from: unknown,
    to: unknown,
    opts?: { replace?: boolean },
  ) => Promise<StorageV5Result<{ moved: boolean }>>
  /**
   * densable hb `stagingScopeBeside:Pf` @207480971.
   */
  stagingScopeBeside: (scope: unknown) => Record<string, unknown>
  /**
   * densable hb `stagingScopeWithin:Lf` @207480654.
   */
  stagingScopeWithin: (scope: unknown) => Record<string, unknown>
  /**
   * densable hb `hostFiles:$c` @207455722.
   */
  hostFiles: LocalHostFiles
  /**
   * densable hb `replaceRecords:(d,c,f)=>km(s,d,c,f)` @207521788.
   */
  replaceRecords: (
    key: unknown,
    entries: unknown,
    opts?: {
      publishDiscipline?: 'atomic' | 'inPlace'
      parent?: string
      aliases?: unknown[]
      singleName?: boolean
      keepBefore?: number
      preserveFrom?: number
      precondition?: { type?: string; version?: string; seq?: number }
    },
  ) => Promise<StorageV5Result<{ bytes: number }>>
  /**
   * densable hb `writeFromFile:(d,c,f)=>Jf(s,d,c,f)` @207502320.
   */
  writeFromFile: (
    key: unknown,
    path: unknown,
    opts?: {
      parent?: string
      precondition?: { type?: string; version?: string }
      growth?: string
      consumeSource?: boolean
      copy?: true
      requireMode?: boolean
      flush?: boolean
      expect?: { singleName?: boolean; maxBytes?: number; within?: string }
    },
  ) => Promise<StorageV5Result<{ bytes: number; version?: string }>>
  /**
   * densable hb `writeFromStream:(d,c,f)=>Zf(s,d,c,f)` @207504036.
   */
  writeFromStream: (
    key: unknown,
    body: AsyncIterable<unknown>,
    opts: {
      maxBytes: number
      parent?: string
      precondition?: { type?: string }
      mode?: number
    },
  ) => Promise<StorageV5Result<{ bytes: number; version?: string }>>
  close: () => Promise<StorageV5Result<void>>
  touch: (key: unknown) => Promise<StorageV5Result<{ mtimeMs: number }>>
  setMode: (
    key: unknown,
    mode: number,
    opts?: { requireMode?: boolean; ifObject?: unknown },
  ) => Promise<StorageV5Result<{ applied: boolean; mode?: number }>>
  digest: (
    key: unknown,
    opts?: { maxBytes?: number; algorithm?: string },
  ) => Promise<
    StorageV5Result<{ digest: string; totalBytes: number; mtimeMs: number }>
  >
  /**
   * densable hb `update:(d,c,f)=>Ds(s,d,c,f,(p)=>p)` @207517338.
   * Edit is leftover `sm`/`Dv`: `{ write }` or `{ skip: true }`.
   */
  update: (
    key: unknown,
    edit: (
      current: StorageV5EditCurrent<Uint8Array> | undefined,
    ) => StorageV5EditDecision,
    opts?: {
      parent?: string
      publishDiscipline?: string
      acquireTimeoutMs?: number
      precondition?: { type?: string }
    },
  ) => Promise<
    StorageV5Result<{ written: boolean; found: boolean; version?: string }>
  >
  /**
   * densable hb `updateText:(d,c,f)=>Ds(s,d,c,f,(p)=>Yi.decode(p))`.
   */
  updateText: (
    key: unknown,
    edit: (
      current: StorageV5EditCurrent<string> | undefined,
    ) => StorageV5EditDecision,
    opts?: {
      parent?: string
      publishDiscipline?: string
      acquireTimeoutMs?: number
      precondition?: { type?: string }
    },
  ) => Promise<
    StorageV5Result<{ written: boolean; found: boolean; version?: string }>
  >
  ensureScope: (
    scope: unknown,
    opts?: { parent?: string },
  ) => Promise<StorageV5Result<{ created: boolean }>>
  deleteScope: (
    scope: unknown,
    opts?: { olderThanMs?: number },
  ) => Promise<
    StorageV5Result<{ deleted: number; skipped?: number; failed?: number }>
  >
  tombstone: (
    key: unknown,
    recordIds: string[],
  ) => Promise<StorageV5Result<{ matched: boolean[]; newly: string[] }>>
  applyTombstones: (
    key: unknown,
  ) => Promise<StorageV5Result<{ purged: number }>>
  statStream: (key: unknown) => Promise<
    StorageV5Result<{
      headSeq: number | null
      recordCount: number
      version?: string
      size?: number
      tornTailBytes?: number
    }>
  >
  readValue: (
    key: unknown,
  ) => Promise<
    | { bytes: Uint8Array; version: string; size: number; mtimeMs: number }
    | undefined
  >
  streamEntries: (
    key: unknown,
    stamp?: {
      generation: string | number
      size: number
      mtimeMs: number
    },
  ) => Promise<unknown>
  scopeKeys: (
    scope: unknown,
  ) => Promise<StorageV5Result<Array<Record<string, unknown>>>>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

/** densable leftover `Sy` @207441648 — `ic` fences. */
const DELETE_SCOPE_FENCED_SY = new Set([
  'session',
  'plan',
  'daemon',
  'paste',
  'globalConfig',
  'marketplaceCache',
])

function invalidArg(
  argument: string,
  _message?: string,
): StorageV5Result<never> {
  return { ok: false, error: { code: 'InvalidArgument', argument } }
}

/** densable leftover `wy` @207427200. */
function validateAgeSweepWy(
  scope: Record<string, unknown>,
  olderThanMs: unknown,
): StorageV5Result<never> | undefined {
  if (
    typeof olderThanMs !== 'number' ||
    !Number.isInteger(olderThanMs) ||
    olderThanMs < 0
  ) {
    return invalidArg('opts.olderThanMs')
  }
  if (scope.namespace === 'bridgeSpawn' && scope.dir === undefined) return
  return invalidArg('opts.olderThanMs')
}

/** densable leftover `xa` @207427180. */
function isOwnedUidXa(info: { uid: number | bigint }): boolean {
  const r = process.getuid?.()
  return r === undefined || Number(info.uid) === r
}

/** densable leftover `Ry` @207427400 — age-sweep the bridge-spawn root. */
async function deleteScopeOlderThanRy(
  root: string | undefined,
  olderThanMs: number,
  nowMs: number,
): Promise<
  StorageV5Result<{ deleted: number; skipped?: number; failed?: number }>
> {
  if (root === undefined) return { ok: true, value: { deleted: 0 } }
  let rootStat: Awaited<ReturnType<typeof lstat>>
  try {
    rootStat = await lstat(root, { bigint: true })
  } catch (error) {
    if (isENOENT(error)) return { ok: true, value: { deleted: 0 } }
    return { ok: false, error: { code: 'Failed' } }
  }
  if (rootStat.isSymbolicLink()) {
    return {
      ok: false,
      error: { code: 'Failed', telemetryCode: 'ELOOP' },
    }
  }
  if (!rootStat.isDirectory() || !isOwnedUidXa(rootStat)) {
    return { ok: true, value: { deleted: 0 } }
  }
  let rootReal: string
  try {
    rootReal = await realpath(root)
    const again = await lstat(rootReal, { bigint: true })
    if (
      !again.isDirectory() ||
      again.ino !== rootStat.ino ||
      again.dev !== rootStat.dev
    ) {
      return { ok: true, value: { deleted: 0 } }
    }
  } catch (error) {
    if (isENOENT(error)) return { ok: true, value: { deleted: 0 } }
    return { ok: false, error: { code: 'Failed' } }
  }
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isENOENT(error)) return { ok: true, value: { deleted: 0 } }
    return { ok: false, error: { code: 'Failed' } }
  }
  const cutoff = nowMs - olderThanMs
  let deleted = 0
  let skipped = 0
  let failed = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      skipped += 1
      continue
    }
    const child = join(root, entry.name)
    try {
      const childStat = await lstat(child, { bigint: true })
      if (
        !childStat.isDirectory() ||
        childStat.isSymbolicLink() ||
        Number(childStat.mtimeMs) >= cutoff
      ) {
        skipped += 1
        continue
      }
      if (!isOwnedUidXa(childStat)) {
        skipped += 1
        continue
      }
      const childReal = await realpath(child)
      if (childReal !== join(rootReal, entry.name)) {
        skipped += 1
        continue
      }
      await rm(child, { recursive: true, force: true })
      deleted += 1
    } catch (error) {
      if (!isENOENT(error)) failed += 1
    }
  }
  return {
    ok: true,
    value: {
      deleted,
      ...(skipped > 0 && { skipped }),
      ...(failed > 0 && { failed }),
    },
  }
}

/** densable leftover `$r` @207276518. */
const PLUGIN_REGISTRY_FILENAMES: Record<string, string> = {
  installed: 'installed_plugins.json',
  marketplaces: 'known_marketplaces.json',
  flagged: 'flagged-plugins.json',
  catalog: 'plugin-catalog-cache.json',
  inUseSweep: '.last_inuse_sweep',
}

/** densable leftover `ge` @207273494. */
const PLUGIN_ASSET_CACHE_DIRNAME = 'asset-cache'

/** densable leftover `Vr` @207276881. */
const MARKETPLACE_INSTALL_PATH_SEGMENTS = ['.claude-plugin', 'marketplace.json']

/** densable leftover `tn` @207275798. */
const CACHE_ENTRY_PATH_ALIASES = new Map<string, string>([
  ['changelog/changelog.md', 'changelog.md'],
  [
    'org-memory-discovery/org-memory-discovery.json',
    'org-memory-discovery.json',
  ],
  ['gateway-models/gateway-models.json', 'gateway-models.json'],
  ['model-capabilities/model-capabilities.json', 'model-capabilities.json'],
  ['my-closed-issues/my-closed-issues.json', 'my-closed-issues.json'],
  ['team-discovery/team-discovery.json', 'team-discovery.json'],
])

/** densable leftover `en` @207274200. */
const STATE_ENTRY_FILENAMES = new Map<string, string>([
  ['daemon-status', 'daemon.status.json'],
  ['active-time-ledger', 'active-time.json'],
  ['last-cleanup', '.last-cleanup'],
  ['gh-pr-status-cache', 'gh-pr-status-cache.json'],
  ['server-sessions', 'server-sessions.json'],
  ['deep-link-register-failed', '.deep-link-register-failed'],
  ['keybindings', 'keybindings.json'],
  ['last-update-result', '.last-update-result.json'],
  ['scheduled-status', 'daemon.scheduled.status.json'],
  ['loop-file', 'loop.md'],
  ['computer-use-lock', 'computer-use.lock'],
  ['daemon-auth-cooldown', 'daemon-auth-cooldown'],
  ['daemon-auth-status', 'daemon-auth-status.json'],
  ['daemon-config', 'daemon.json'],
  ['daemon-lock', 'daemon.lock'],
  ['daemon-log', 'daemon.log'],
  ['hfi-auth', 'hfi-auth.json'],
  ['mcp-needs-auth-cache', 'mcp-needs-auth-cache.json'],
  ['npm-cache-cleanup', '.npm-cache-cleanup'],
  ['policy-limits', 'policy-limits.json'],
  ['remote-settings', 'remote-settings.json'],
  ['remote-settings-consent', 'remote-settings-consent.json'],
  ['remote-settings-helper-consent', 'remote-settings-helper-consent'],
  ['server-lock', 'server.lock'],
  ['session-log-cleanup', '.session-log-cleanup'],
  ['stats-cache', 'stats-cache.json'],
  ['update-lock', '.update.lock'],
  ['user-memory', 'CLAUDE.md'],
  ['version-cleanup', '.version-cleanup'],
])

/** densable leftover `jt` @207256900. */
function resolveSettingsFilePath(
  configHome: string,
  key: Record<string, unknown>,
): string | null {
  switch (key.layer) {
    case 'user':
      return join(configHome, 'settings.json')
    case 'project':
      return typeof key.projectKey === 'string'
        ? join(configHome, 'project-settings', key.projectKey, 'settings.json')
        : null
    case 'local':
      return typeof key.consentRootKey === 'string'
        ? join(
            configHome,
            'local-settings',
            key.consentRootKey,
            'settings.local.json',
          )
        : null
    default:
      return null
  }
}

function asSafePathSegment(value: unknown): string | null {
  return typeof value === 'string' && isValidStoragePathSegment(value)
    ? value
    : null
}

function asSafeRelPath(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const part of value) {
    if (typeof part !== 'string') continue
    if (!isValidStoragePathSegment(part)) return null
    out.push(part)
  }
  return out
}

/** densable leftover `Ee` @207254171 — object / digest-log path. leftover `ot` for `Xa`. */
export function resolveKeyFilesystemPath(
  roots: StorageV5['roots'],
  key: unknown,
): string | null {
  const rec = asRecord(key)
  if (!rec || typeof rec.namespace !== 'string') return null
  if (rec.namespace === 'jobsRoot' && 'file' in rec) {
    return join(roots.configHome, 'jobs', 'pins.json')
  }
  if (rec.namespace === 'jobsRoot' && typeof rec.draftKey === 'string') {
    const draftKey = asSafePathSegment(rec.draftKey)
    return draftKey
      ? join(roots.configHome, 'jobs', `.draft-${draftKey}`)
      : null
  }
  if (rec.namespace === 'job') {
    const jobId = asSafePathSegment(rec.jobId)
    const rel = asSafeRelPath(rec.relPath)
    if (!jobId || rel === null) return null
    return join(roots.configHome, 'jobs', jobId, ...rel)
  }
  if (rec.namespace === 'session') {
    const file = asSafePathSegment(rec.file)
    return file ? join(roots.configHome, 'sessions', file) : null
  }
  if (rec.namespace === 'sidecar') {
    const projectKey = asSafePathSegment(rec.projectKey)
    const sessionId = asSafePathSegment(rec.sessionId)
    const rel = asSafeRelPath(rec.relPath)
    if (!projectKey || !sessionId || rel === null) return null
    return join(roots.configHome, 'projects', projectKey, sessionId, ...rel)
  }
  if (rec.namespace === 'state') {
    const id = asSafePathSegment(rec.id)
    if (!id) return null
    const mapped = STATE_ENTRY_FILENAMES.get(id)
    return mapped
      ? join(roots.configHome, mapped)
      : join(roots.configHome, 'state', `${id}.json`)
  }
  if (rec.namespace === 'settings') {
    return resolveSettingsFilePath(roots.configHome, rec)
  }
  if (rec.namespace === 'task') {
    const listId = asSafePathSegment(rec.listId)
    if (!listId) return null
    if ('meta' in rec) {
      return join(roots.configHome, 'tasks', listId, '.meta.json')
    }
    if ('highWaterMark' in rec) {
      return join(roots.configHome, 'tasks', listId, '.highwatermark')
    }
    const taskId = asSafePathSegment(rec.taskId)
    return taskId
      ? join(roots.configHome, 'tasks', listId, `${taskId}.json`)
      : null
  }
  if (rec.namespace === 'memory') {
    const projectKey = asSafePathSegment(rec.projectKey)
    const rel = asSafeRelPath(rec.relPath)
    if (!projectKey || rel === null) return null
    return join(roots.configHome, 'projects', projectKey, 'memory', ...rel)
  }
  if (rec.namespace === 'pluginRegistry' && typeof rec.file === 'string') {
    const mapped = PLUGIN_REGISTRY_FILENAMES[rec.file]
    return mapped ? join(roots.configHome, 'plugins', mapped) : null
  }
  if (rec.namespace === 'marketplaceCache') {
    const marketplace = asSafePathSegment(rec.marketplace)
    if (!marketplace) return null
    if ('relPath' in rec) {
      const rel = asSafeRelPath(rec.relPath)
      return rel === null
        ? null
        : join(roots.configHome, 'plugins', 'marketplaces', marketplace, ...rel)
    }
    return rec.form === 'catalog'
      ? join(roots.configHome, 'plugins', 'marketplaces', marketplace)
      : join(
          roots.configHome,
          'plugins',
          'marketplaces',
          marketplace,
          ...MARKETPLACE_INSTALL_PATH_SEGMENTS,
        )
  }
  if (rec.namespace === 'pluginAssetCache') {
    const digest = asSafePathSegment(rec.digest)
    return digest
      ? join(roots.configHome, 'plugins', PLUGIN_ASSET_CACHE_DIRNAME, digest)
      : null
  }
  if (rec.namespace === 'cache') {
    const store = asSafePathSegment(rec.store)
    const id = asSafePathSegment(rec.id)
    if (!store || !id) return null
    const aliased = CACHE_ENTRY_PATH_ALIASES.get(`${store}/${id}`)
    return join(roots.configHome, 'cache', aliased ?? join(store, id))
  }
  if (rec.namespace === 'paste') {
    const id = asSafePathSegment(rec.id)
    return id ? join(roots.configHome, 'paste-cache', `${id}.txt`) : null
  }
  if (rec.namespace === 'plan') {
    const name = asSafePathSegment(rec.name)
    return name ? join(roots.configHome, 'plans', `${name}.md`) : null
  }
  if (rec.namespace === 'feedbackDraft') {
    const draftId = asSafePathSegment(rec.draftId)
    return draftId
      ? join(roots.configHome, 'feedback', 'drafts', `${draftId}.json`)
      : null
  }
  if (rec.namespace === 'agentMemory') {
    const agentType = asSafePathSegment(rec.agentType)
    const rel = asSafeRelPath(rec.relPath)
    if (!agentType || rel === null) return null
    if (rec.layer === 'user') {
      return join(roots.configHome, 'agent-memory', agentType, ...rel)
    }
    const layer = asSafePathSegment(rec.layer)
    const projectKey = asSafePathSegment(rec.projectKey)
    if (!layer || !projectKey) return null
    return join(
      roots.configHome,
      `agent-memory-${layer}`,
      projectKey,
      agentType,
      ...rel,
    )
  }
  if (rec.namespace === 'identity') {
    return join(roots.configHome, 'antproto.json')
  }
  if (rec.namespace === 'team') {
    const team = asSafePathSegment(rec.team)
    return team ? join(roots.configHome, 'teams', team, 'config.json') : null
  }
  if (rec.namespace === 'scratch') {
    const sessionId = asSafePathSegment(rec.sessionId)
    const rel = asSafeRelPath(rec.relPath)
    if (!sessionId || rel === null) return null
    return join(roots.configHome, 'scratch', sessionId, ...rel)
  }
  if (rec.namespace === 'userConfigDir') {
    const dir = asSafePathSegment(rec.dir)
    const rel = asSafeRelPath(rec.relPath)
    if (!dir || rel === null) return null
    return join(roots.configHome, dir, ...rel)
  }
  if (rec.namespace === 'fileHistory') {
    const sessionId = asSafePathSegment(rec.sessionId)
    const backupFileName = asSafePathSegment(rec.backupFileName)
    if (!sessionId || !backupFileName) return null
    return join(roots.configHome, 'file-history', sessionId, backupFileName)
  }
  if (rec.namespace === 'daemon') {
    const rel = asSafeRelPath(rec.relPath)
    return rel === null ? null : join(roots.configHome, 'daemon', ...rel)
  }
  if (rec.namespace === 'bridgePointer') {
    const projectKey = asSafePathSegment(rec.projectKey)
    return projectKey
      ? join(roots.configHome, 'projects', projectKey, 'bridge-pointer.json')
      : null
  }
  if (rec.namespace === 'sessionAliases') {
    const projectKey = asSafePathSegment(rec.projectKey)
    return projectKey
      ? join(roots.configHome, 'projects', projectKey, '.session-aliases')
      : null
  }
  if (rec.namespace === 'dirSyncRecord') {
    const projectKey = asSafePathSegment(rec.projectKey)
    const sessionId = asSafePathSegment(rec.sessionId)
    if (!projectKey || !sessionId) return null
    return join(
      roots.configHome,
      'projects',
      projectKey,
      `${sessionId}.dir-sync.json`,
    )
  }
  if (rec.namespace === 'mailbox') {
    const team = asSafePathSegment(rec.team)
    const teammate = asSafePathSegment(rec.teammate)
    if (!team || !teammate) return null
    return join(roots.configHome, 'teams', team, 'inboxes', `${teammate}.json`)
  }
  if (rec.namespace === 'globalConfig') {
    // densable Ee @207254670: Ze = basename from path.
    if ('kind' in rec) {
      return join(
        roots.configHome,
        'backups',
        `${basename(roots.globalConfigFile)}.${rec.kind}.${rec.stamp}`,
      )
    }
    return roots.globalConfigFile
  }
  if (rec.namespace === 'transcript') {
    const projectKey = asSafePathSegment(rec.projectKey)
    const sessionId = asSafePathSegment(rec.sessionId)
    if (!projectKey || !sessionId) return null
    const rel = asSafeRelPath(rec.agentRelPath)
    if (rel === null) return null
    // densable Ee @207254171 — leftover persist keys (no journal/sessionJournal).
    if (rec.agentId === undefined) {
      return join(
        roots.configHome,
        'projects',
        projectKey,
        `${sessionId}.jsonl`,
      )
    }
    const agentId = asSafePathSegment(rec.agentId)
    if (!agentId) return null
    return join(
      roots.configHome,
      'projects',
      projectKey,
      sessionId,
      'subagents',
      ...rel,
      `agent-${agentId}.jsonl`,
    )
  }
  if (rec.namespace === 'history') {
    return join(roots.configHome, 'history.jsonl')
  }
  if (rec.namespace === 'log' && typeof rec.sessionId === 'string') {
    return resolveChannelLogFilePath(roots.configHome, rec)
  }
  if (rec.namespace === 'jobTimeline') {
    const jobId = asSafePathSegment(rec.jobId)
    return jobId
      ? join(roots.configHome, 'jobs', jobId, 'timeline.jsonl')
      : null
  }
  if (rec.namespace === 'recording') {
    const projectKey = asSafePathSegment(rec.projectKey)
    const sessionId = asSafePathSegment(rec.sessionId)
    const stamp = asSafePathSegment(rec.stamp)
    if (!projectKey || !sessionId || !stamp) return null
    return join(
      roots.configHome,
      'projects',
      projectKey,
      sessionId,
      `${stamp}.cast`,
    )
  }
  if (rec.namespace === 'sessionLog') {
    const projectKey = asSafePathSegment(rec.projectKey)
    const logName = asSafePathSegment(rec.logName)
    if (!projectKey || !logName) return null
    const dates: string[] = []
    for (const part of [rec.year, rec.month, rec.day]) {
      if (part === undefined) continue
      const safe = asSafePathSegment(part)
      if (!safe) return null
      dates.push(safe)
    }
    return join(
      roots.configHome,
      'projects',
      projectKey,
      'memory',
      'logs',
      ...dates,
      `${logName}.md`,
    )
  }
  if (rec.namespace === 'pluginCache') {
    const marketplace = asSafePathSegment(rec.marketplace)
    const plugin = asSafePathSegment(rec.plugin)
    const version = asSafePathSegment(rec.version)
    if (!marketplace || !plugin || !version) {
      return null
    }
    const rel = asSafeRelPath(rec.relPath)
    if (rel === null) return null
    return join(
      roots.configHome,
      'plugins',
      'cache',
      marketplace,
      plugin,
      version,
      ...rel,
    )
  }
  return null
}

function readReqKey(req: unknown): unknown {
  const rec = asRecord(req)
  return rec && 'key' in rec ? rec.key : req
}

/**
 * densable leftover `Ty` @207435065 — `z`/`re` then whole / tail / range.
 */
function normalizeReadReqTy(
  roots: StorageV5['roots'],
  req: unknown,
  index: number,
):
  | {
      kind: 'whole' | 'range' | 'tail'
      key: unknown
      offset?: number
      length?: number
      tail?: number
    }
  | { code: string; argument?: string } {
  const key = readReqKey(req)
  const rec = asRecord(key)
  const invalid =
    rec === null
      ? { code: 'InvalidArgument', argument: `entries[${index}].key` }
      : (validateStorageKey(rec) ?? validateBridgeSpawnRoot(roots, rec))
  if (invalid !== undefined) {
    return {
      ...invalid,
      argument: `entries[${index}].${invalid.argument ?? 'key'}`,
    }
  }
  const item = asRecord(req)
  if (!item || !('key' in item)) {
    return { kind: 'whole', key }
  }
  if ('tail' in item) {
    return Number.isInteger(item.tail) &&
      typeof item.tail === 'number' &&
      item.tail >= 0
      ? { kind: 'tail', key, tail: item.tail }
      : {
          code: 'InvalidArgument',
          argument: `entries[${index}].tail`,
        }
  }
  if (!Number.isInteger(item.offset) || Number(item.offset) < 0) {
    return {
      code: 'InvalidArgument',
      argument: `entries[${index}].offset`,
    }
  }
  if (
    item.length !== undefined &&
    (!Number.isInteger(item.length) || Number(item.length) < 0)
  ) {
    return {
      code: 'InvalidArgument',
      argument: `entries[${index}].length`,
    }
  }
  return {
    kind: 'range',
    key,
    offset: item.offset as number,
    length: item.length as number | undefined,
  }
}

type NormalizedReadReq = Exclude<
  ReturnType<typeof normalizeReadReqTy>,
  { code: string }
>

/** densable leftover `Jg` @207406085. */
function validateReadOptsJg(
  opts: StorageV5ReadOpts | undefined,
): { code: string; argument?: string } | undefined {
  if (opts?.hardened !== undefined && opts.hardened !== true) {
    return { code: 'InvalidArgument', argument: 'opts.hardened' }
  }
  if (
    opts?.symlinks !== undefined &&
    opts.symlinks !== 'follow' &&
    opts.symlinks !== 'refuse'
  ) {
    return { code: 'InvalidArgument', argument: 'opts.symlinks' }
  }
}

/** densable leftover `ey` @207406787. */
function rejectHardenedStreamKeysEy(
  items: Array<NormalizedReadReq | { code: string }>,
): { code: string; argument?: string } | undefined {
  const r = items.findIndex(
    n =>
      !('code' in n) &&
      asRecord(n.key) !== null &&
      isStreamNamespaceKey(asRecord(n.key)!),
  )
  return r === -1
    ? undefined
    : { code: 'InvalidArgument', argument: 'opts.hardened' }
}

/** densable leftover `Qg` @207406592. */
function rejectFollowOnRefuseClassQg(
  items: Array<NormalizedReadReq | { code: string }>,
): { code: string; argument?: string } | undefined {
  const r = items.findIndex(n => {
    if ('code' in n) return false
    const rec = asRecord(n.key)
    return rec !== null && getReadSymlinkClass(rec) === 'refuse'
  })
  return r === -1
    ? undefined
    : { code: 'InvalidArgument', argument: 'opts.symlinks' }
}

/**
 * densable leftover `$i`=`Xa`=`r9c` @207253787 — hardened realpath root.
 */
function hardenedReadRootXa(
  roots: StorageV5['roots'],
  key: Record<string, unknown>,
): string {
  switch (key.namespace) {
    case 'memory':
      return join(roots.configHome, 'projects', String(key.projectKey))
    case 'marketplaceCache':
      return 'relPath' in key
        ? join(
            roots.configHome,
            'plugins',
            'marketplaces',
            String(key.marketplace),
          )
        : roots.configHome
    case 'globalConfig':
      return 'kind' in key ? roots.configHome : dirname(roots.globalConfigFile)
    default:
      return roots.configHome
  }
}

/**
 * densable leftover `Zg` @207406327 — cache `realpath($i)` then
 * `join(real, relative(root, V()))`.
 */
function createHardenedPathResolverZg(roots: StorageV5['roots']) {
  const cache = new Map<string, Promise<string | undefined>>()
  return async (key: Record<string, unknown>): Promise<string | undefined> => {
    const t = hardenedReadRootXa(roots, key)
    let pending = cache.get(t)
    if (pending === undefined) {
      pending = realpath(t)
        .then(value => value)
        .catch(error => (isENOENT(error) ? undefined : Promise.reject(error)))
      cache.set(t, pending)
    }
    const real = await pending
    if (real === undefined) return
    const file = resolveKeyFilesystemPath(roots, key)
    if (!file) return
    return join(real, relative(t, file))
  }
}

/**
 * densable leftover `Kl` @207405200 — `Jg`/`ey`/`Qg`/`Zg` then `ry`.
 */
async function readStorageBatchKl<T>(
  host: DigestHost,
  roots: StorageV5['roots'],
  reqs: StorageV5ReadReq[],
  opts: StorageV5ReadOpts | undefined,
  decode: (bytes: Uint8Array) => T,
): Promise<StorageV5Result<{ items: Array<ReadItem<T>> }>> {
  const gated = validateReadOptsJg(opts)
  if (gated !== undefined) return { ok: false, error: { code: gated.code } }
  const parsed = reqs.map((req, index) => normalizeReadReqTy(roots, req, index))
  const invalid =
    parsed.find(item => 'code' in item) ??
    (opts?.hardened === true
      ? rejectHardenedStreamKeysEy(parsed)
      : undefined) ??
    (opts?.symlinks === 'follow'
      ? rejectFollowOnRefuseClassQg(parsed)
      : undefined)
  if (invalid && 'code' in invalid) {
    return { ok: false, error: { code: invalid.code } }
  }
  const resolveHardened =
    opts?.hardened === true ? createHardenedPathResolverZg(roots) : undefined
  const items = await Promise.all(
    parsed.map(item => {
      const rec = asRecord((item as NormalizedReadReq).key)
      const policy =
        opts?.symlinks === 'refuse'
          ? 'refuse'
          : rec
            ? getReadSymlinkClass(rec)
            : 'refuse'
      return readStorageItemRy(
        host,
        roots,
        item as NormalizedReadReq,
        decode,
        policy,
        resolveHardened,
      )
    }),
  )
  const failed = items.find(item => 'code' in item)
  if (failed && 'code' in failed) {
    return { ok: false, error: { code: failed.code } }
  }
  return { ok: true, value: { items: items as Array<ReadItem<T>> } }
}

type ReadItem<T> = {
  found: boolean
  totalBytes: number
  value?: T
  version?: string
  mtimeMs?: number
}

/**
 * densable leftover `ry` @207406953 — `kind!=="whole" && I && Ve` → `gu`/`kr`;
 * value keys `Pl`/`se` via leftover `Me`.
 */
async function readStorageItemRy<T>(
  host: DigestHost,
  roots: StorageV5['roots'],
  req: NormalizedReadReq,
  decode: (bytes: Uint8Array) => T,
  policy: 'follow' | 'refuse',
  resolveHardened?: (
    key: Record<string, unknown>,
  ) => Promise<string | undefined>,
): Promise<ReadItem<T> | { code: string }> {
  const rec = asRecord(req.key)
  const path = rec ? resolveKeyFilesystemPath(roots, rec) : null
  if (!rec || !path) return { found: false, totalBytes: 0 }
  const screened = await validateMarketplaceCacheSymlinks(
    roots,
    rec,
    'singleRead',
  )
  if (screened !== undefined) return { code: screened.code }
  let hardened: string | undefined
  if (resolveHardened !== undefined && !isStreamNamespaceKey(rec)) {
    try {
      hardened = await resolveHardened(rec)
    } catch {
      return { code: 'Failed' }
    }
    if (hardened === undefined) return { found: false, totalBytes: 0 }
  }
  if (isFramedDigestStreamKey(rec) && req.kind !== 'whole') {
    const ranged = await readFramedRangeGu(
      host,
      rec,
      path,
      req,
      FRAMED_VIEW_BUDGET_BYTES,
    )
    if (!ranged.ok) {
      if (ranged.error.kind === 'absent') return { found: false, totalBytes: 0 }
      return { code: 'Failed' }
    }
    return {
      found: true,
      value: decode(ranged.value.bytes),
      version: ranged.value.version,
      totalBytes: ranged.value.totalBytes,
      mtimeMs: ranged.value.mtimeMs,
    }
  }
  if (isFramedDigestStreamKey(rec)) {
    const whole = await readFramedStreamFu(host, rec, path)
    if (whole === undefined) return { found: false, totalBytes: 0 }
    return {
      found: true,
      value: decode(whole.bytes),
      version: whole.version,
      totalBytes: whole.bytes.byteLength,
      mtimeMs: whole.mtimeMs,
    }
  }
  const valued =
    req.kind === 'whole'
      ? await readValueWholeSe(path, policy, hardened)
      : await readValueRangePl(path, policy, req, hardened)
  if (!valued.ok) {
    if (valued.error.kind === 'absent') return { found: false, totalBytes: 0 }
    return { code: 'Failed' }
  }
  return {
    found: true,
    value: decode(valued.value.bytes),
    totalBytes: valued.value.size,
    ...(valued.value.version !== undefined && {
      version: valued.value.version,
    }),
    mtimeMs: valued.value.mtimeMs,
  }
}

/** densable leftover `Gn`/`kt` @207257590. */
function mapLogChannelDirectory(channel: unknown): string | undefined {
  switch (channel) {
    case 'debug':
      return 'debug'
    case 'telemetry':
      return 'telemetry'
    case 'apiDump':
      return 'api-dumps'
    default:
      return
  }
}

function resolveChannelLogFilePath(
  configHome: string,
  key: Record<string, unknown>,
): string | null {
  const channel = mapLogChannelDirectory(key.channel)
  const sessionId = asSafePathSegment(key.sessionId)
  if (channel === undefined || !sessionId) return null
  const parts = [configHome, channel]
  if (key.agentId !== undefined) {
    const agentId = asSafePathSegment(key.agentId)
    if (!agentId) return null
    parts.push('agents', agentId)
  }
  if (key.runId !== undefined) {
    const runId = asSafePathSegment(key.runId)
    if (!runId) return null
    parts.push('runs', runId)
  }
  parts.push(sessionId)
  const r = join(...parts)
  switch (key.channel) {
    case 'debug':
      return `${r}.txt`
    case 'telemetry':
      return `${r}.json`
    case 'apiDump':
      return `${r}.apidump.jsonl`
    default:
      return null
  }
}

/** densable leftover `or(namespace)` @207334280. */
function isTranscriptOrHistoryNamespace(namespace: unknown): boolean {
  return namespace === 'history' || namespace === 'transcript'
}

/** densable leftover `Oi`/`Xr` @207334334 — framed streams also `Ve`. */
function getKeyFramingDescriptor(
  key: Record<string, unknown>,
): { framing: string } | undefined {
  switch (key.namespace) {
    case 'log':
      return key.channel === 'debug' ? { framing: 'text' } : undefined
    case 'sessionLog':
    case 'recording':
      return { framing: 'text' }
    case 'jobTimeline':
      return { framing: 'jsonl' }
    case 'transcript':
    case 'history':
      return { framing: 'jsonl' }
    default:
      return
  }
}

/** densable leftover `Ve` @207334334. */
function usesLineDelimitedRecordReader(key: Record<string, unknown>): boolean {
  return (
    isTranscriptOrHistoryNamespace(key.namespace) ||
    getKeyFramingDescriptor(key) !== undefined
  )
}

/**
 * densable leftover-used `su`/`bp`/`Ap` @207334960 / @207345024.
 * `cn.seq` = byte offset. `fromSeq` includes the anchor line (xeo).
 */
function parseLineDelimitedRecords(
  buf: Buffer,
  opts?: {
    order?: 'forward' | 'backward'
    maxBytes?: number
    limit?: number
    fromSeq?: number
    maxBytesPerRecord?: number
  },
): { items: StorageV5RecordItem[]; nextSeq?: number } {
  const entries: Array<{ seq: number; data: Buffer }> = []
  let start = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) {
      entries.push({ seq: start, data: buf.subarray(start, i + 1) })
      start = i + 1
    }
  }
  if (start < buf.length) {
    entries.push({ seq: start, data: buf.subarray(start) })
  }
  const backward = opts?.order !== 'forward'
  let list = backward ? [...entries].reverse() : entries
  if (opts?.fromSeq !== undefined) {
    const fromSeq = opts.fromSeq
    list = backward
      ? list.filter(e => e.seq <= fromSeq)
      : list.filter(e => e.seq >= fromSeq)
  }
  if (opts?.limit !== undefined) {
    list = list.slice(0, Math.max(0, opts.limit))
  }
  if (opts?.maxBytes !== undefined) {
    const maxBytes = opts.maxBytes
    const out: typeof list = []
    let acc = 0
    for (const e of list) {
      const n =
        opts.maxBytesPerRecord === undefined
          ? e.data.length
          : Math.min(e.data.length, opts.maxBytesPerRecord)
      if (out.length > 0 && acc + n > maxBytes) break
      out.push(e)
      acc += n
    }
    list = out
  }
  const items: StorageV5RecordItem[] = list.map(e => {
    const raw =
      opts?.maxBytesPerRecord === undefined
        ? e.data
        : e.data.subarray(0, Math.min(e.data.length, opts.maxBytesPerRecord))
    return {
      seq: e.seq,
      data: new Uint8Array(raw),
      recordId: String(e.seq),
      endSeq: e.seq + e.data.length,
      tombstoned: false,
      ...(opts?.maxBytesPerRecord !== undefined &&
        e.data.length > opts.maxBytesPerRecord && { truncated: true }),
    }
  })
  if (items.length === 0) return { items }
  const edge = backward ? items[items.length - 1]! : items[0]!
  const idx = entries.findIndex(e => e.seq === edge.seq)
  if (backward) {
    if (idx > 0) return { items, nextSeq: entries[idx - 1]!.seq }
  } else if (idx >= 0 && idx < entries.length - 1) {
    return { items, nextSeq: entries[idx + 1]!.seq }
  }
  return { items }
}

/**
 * densable hb — constructs the local FS storageV5 handle.
 */
export function createLocalFsBackend(
  options: CreateLocalFsBackendOptions,
): StorageV5 {
  const roots = {
    configHome: resolve(options.configHome),
    globalConfigFile: resolve(options.globalConfigFile),
    ...(options.bridgeSpawnRoot !== undefined && {
      bridgeSpawnRoot: resolve(options.bridgeSpawnRoot),
    }),
  }
  const clock = options.clock ?? Date.now
  const instanceId = randomUUID()
  let closed = false
  const timing = {
    ...DEFAULT_SUBSCRIPTION_TIMING,
    ...options.subscriptionTiming,
  }
  const bus = acquireStorageWatchBus(
    roots.configHome,
    timing.unannouncedGraceMs,
  )
  const store: SubscribeStore = {
    closed: false,
    roots,
    subscriptions: new Set(),
    unlisten: bus.addListener((change, sourceInstanceId) => {
      for (const sub of store.subscriptions) {
        sub.deliverLocal(change, sourceInstanceId)
      }
    }),
  }

  const refuse = (): StorageV5Result<never> => ({
    ok: false,
    error: { code: 'Unavailable' },
  })

  const digestHost: DigestHost = {
    get closed() {
      return closed
    },
    roots,
    bus,
    instanceId,
    timing: { echoDeadlineMs: DEFAULT_SUBSCRIPTION_TIMING.echoDeadlineMs },
    resolvePath: (hostRoots, key) => resolveKeyFilesystemPath(hostRoots, key),
    lockUnconditionalPublishes:
      options.lockUnconditionalPublishes ?? defaultLockUnconditionalPublishes(),
    indexCache: new Map(),
    verifiedCache: new Set(),
    scanFilesCache: new Map(),
    scanCountCache: new Map(),
    screenedSessionLogs: new Map(),
  }

  const leases = createLeaseApi({
    roots,
    clock,
    isClosed: () => closed,
    resolvePath: key => resolveKeyFilesystemPath(roots, key),
  })

  const mutateHost: HbMutateHost = {
    get closed() {
      return closed
    },
    roots,
    digestHost,
    resolvePath: key => resolveKeyFilesystemPath(roots, key),
  }

  return {
    roots,
    instanceId,
    clock,
    nativeWatch: options.nativeWatch ?? true,
    async scopeKind(scope, opts) {
      if (closed) return refuse()
      const dir = resolveKeyFilesystemPath(roots, scope)
      if (!dir) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      try {
        const info = await lstat(dir)
        if (info.isDirectory()) {
          return { ok: true, value: { kind: 'directory' } }
        }
        if (!info.isSymbolicLink()) {
          return { ok: true, value: { kind: 'other' } }
        }
        if (opts?.resolveLink !== true) {
          return { ok: true, value: { kind: 'link' } }
        }
        try {
          await stat(dir)
          return { ok: true, value: { kind: 'link', linkResolves: true } }
        } catch {
          return { ok: true, value: { kind: 'link', linkResolves: false } }
        }
      } catch (error) {
        if (isENOENT(error)) {
          return { ok: true, value: { kind: 'absent' } }
        }
        return { ok: false, error: { code: 'Failed' } }
      }
    },
    async stat(key) {
      if (closed) return refuse()
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      try {
        const info = await stat(path)
        return {
          ok: true,
          value: { size: info.size, mtimeMs: info.mtimeMs },
        }
      } catch (error) {
        if (isENOENT(error)) {
          return { ok: false, error: { code: 'NotFound' } }
        }
        return { ok: false, error: { code: 'Failed' } }
      }
    },
    async statMeta(key) {
      if (closed) return refuse()
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      try {
        const info = await stat(path)
        // densable leftover-used `ql` @207410510 — size + mtimeMs + createdMs.
        return {
          ok: true,
          value: {
            size: info.size,
            mtimeMs: info.mtimeMs,
            createdMs: info.birthtimeMs,
          },
        }
      } catch (error) {
        if (isENOENT(error)) {
          return { ok: false, error: { code: 'NotFound' } }
        }
        return { ok: false, error: { code: 'Failed' } }
      }
    },
    async read(reqs, opts) {
      if (closed) return refuse()
      return readStorageBatchKl(digestHost, roots, reqs, opts, bytes => bytes)
    },
    async readText(reqs, opts) {
      if (closed) return refuse()
      return readStorageBatchKl(digestHost, roots, reqs, opts, bytes =>
        Buffer.from(bytes).toString('utf8'),
      )
    },
    async write(key, value, opts) {
      // densable leftover `zl` @207412582 — `ja` `Q` + `oy`/`sy`/`uy` `K`.
      if (closed) return refuse()
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      const rec = asRecord(key)
      if (!rec) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      return publishValidatedStorageFile(
        roots,
        rec,
        path,
        value,
        opts,
        digestHost,
      )
    },
    async append(key, records, opts) {
      // densable leftover `Xu` @207387311 — `Q(e,r,()=>Xr?Rg:Eg)` then `K`.
      if (closed) return refuse()
      const rec = asRecord(key)
      if (!rec) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      return storageAppendRecords(digestHost, rec, records, path, opts)
    },
    async delete(key) {
      // densable leftover `$l` @207417461 — `Q` then `ly`; existed → `K` deleted.
      if (closed) return refuse()
      const rec = asRecord(key)
      if (!rec) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      const invalid =
        validateStorageKey(rec) ??
        validateBridgeSpawnRoot(roots, rec) ??
        validateMarketplaceCacheReadOnly(rec)
      if (invalid !== undefined) {
        return {
          ok: false,
          error: {
            code: invalid.code,
            ...(invalid.argument && { argument: invalid.argument }),
          },
        }
      }
      const links = await validateMarketplaceCacheSymlinks(roots, rec, 'always')
      if (links !== undefined) {
        return {
          ok: false,
          error: {
            code: links.code,
            ...(links.argument && { argument: links.argument }),
          },
        }
      }
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      const expectId = digestStringifyCanonKey(rec) ?? JSON.stringify(rec)
      return withStorageWatchExpect(bus, [expectId], async () => {
        try {
          await unlink(path)
          announceStorageChange(
            {
              bus,
              instanceId,
              roots,
              timing: {
                echoDeadlineMs: DEFAULT_SUBSCRIPTION_TIMING.echoDeadlineMs,
              },
              resolvePath: (hostRoots, key) =>
                resolveKeyFilesystemPath(hostRoots, key),
              keyId: key => digestStringifyCanonKey(key) ?? JSON.stringify(key),
            },
            {
              kind: 'deleted',
              key: rec,
            },
          )
          return { ok: true as const, value: { existed: true } }
        } catch (error) {
          if (isENOENT(error)) {
            return { ok: true as const, value: { existed: false } }
          }
          return { ok: false as const, error: { code: 'Failed' } }
        }
      })
    },
    async acquireLease(target, ttlMs, opts) {
      return leases.acquireLease(target, ttlMs, opts)
    },
    async readRecords(key, opts) {
      // densable leftover `al` @207401286 — `Ve`→`su`/`Ap`, else `La`.
      if (closed) return refuse()
      const rec = asRecord(key)
      if (!rec) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      if (usesLineDelimitedRecordReader(rec)) {
        const path = resolveKeyFilesystemPath(roots, key)
        if (!path) {
          return { ok: false, error: { code: 'InvalidArgument' } }
        }
        try {
          const buf = await readFile(path)
          return { ok: true, value: parseLineDelimitedRecords(buf, opts) }
        } catch (error) {
          if (isENOENT(error)) {
            return { ok: false, error: { code: 'NotFound' } }
          }
          return { ok: false, error: { code: 'Failed' } }
        }
      }
      // densable leftover `La` @207401528 — Re/sl/Ot digest-log.
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      return readDigestRecords(digestHost, rec, path, opts)
    },
    async listEntries(scope, opts) {
      if (closed) return refuse()
      const rec = asRecord(scope)
      if (!rec) {
        return { ok: false, error: { code: 'InvalidArgument' } }
      }
      return listScopeEntries(roots, rec, opts)
    },
    async listRecursive(scope, opts) {
      return listRecursiveXa(
        {
          closed,
          roots,
          resolvePath: key => resolveKeyFilesystemPath(roots, key),
        },
        scope,
        opts,
      )
    },
    async resolveKey(key, opts) {
      return resolveKeyFc(mutateHost, key, opts)
    },
    async resolveKeys(keys, opts) {
      return resolveKeysDs(mutateHost, keys, opts)
    },
    async copy(from, to, opts) {
      return copyPf(mutateHost, from, to, opts)
    },
    async move(from, to, opts) {
      return moveYf(mutateHost, from, to, opts)
    },
    async moveScope(from, to, opts) {
      return moveScopeKf(mutateHost, from, to, opts)
    },
    stagingScopeBeside(scope) {
      return stagingScopeBesidePf(scope)
    },
    stagingScopeWithin(scope) {
      return stagingScopeWithinLf(scope)
    },
    hostFiles: createLocalHostFiles({
      refuse: () => (closed ? { code: 'Unavailable' } : undefined),
      store: {
        roots: snapshotHostStoreRootsAb(roots),
        resolved: resolveHostStoreRootsMb(roots),
      },
      ...(options.hostFilesServe !== undefined && {
        serve:
          options.hostFilesServe as import('./createLocalHostFiles.js').HostFilesServeMap,
      }),
    }),
    async replaceRecords(key, entries, opts) {
      return replaceRecordsKm(mutateHost, key, entries, opts)
    },
    async writeFromFile(key, path, opts) {
      return writeFromFileJf(mutateHost, key, path, opts)
    },
    async writeFromStream(key, body, opts) {
      return writeFromStreamZf(mutateHost, key, body, opts)
    },
    async listLeases(scope) {
      return leases.listLeases(scope)
    },
    async subscribe(filter, listener, opts) {
      if (closed) return refuse()
      const backend: SubscribeBackend = {
        roots,
        instanceId,
        nativeWatch: options.nativeWatch ?? true,
        timing,
        bus,
        clockNow: clock,
        resolvePath: key => resolveKeyFilesystemPath(roots, key),
        readValue: key => this.readValue(key),
        streamEntries: (key, stamp) => this.streamEntries(key, stamp),
        scopeKeys: scope => this.scopeKeys(scope),
      }
      return subscribeStorage(store, backend, filter, listener, opts)
    },
    async touch(key) {
      if (closed) return refuse()
      const rec = asRecord(key)
      if (!rec) return { ok: false, error: { code: 'InvalidArgument' } }
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) return { ok: false, error: { code: 'InvalidArgument' } }
      try {
        const now = new Date()
        await utimes(path, now, now)
        const info = await stat(path)
        return { ok: true, value: { mtimeMs: info.mtimeMs } }
      } catch (error) {
        if (isENOENT(error)) return { ok: false, error: { code: 'NotFound' } }
        return { ok: false, error: { code: 'Failed' } }
      }
    },
    async setMode(key, mode, opts) {
      if (closed) return refuse()
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) return { ok: false, error: { code: 'InvalidArgument' } }
      try {
        if (process.platform === 'win32') {
          return {
            ok: true,
            value:
              opts?.requireMode === true
                ? { applied: false }
                : { applied: false },
          }
        }
        await chmod(path, mode)
        const info = await stat(path)
        const applied = (info.mode & 511) === (mode & 511)
        return { ok: true, value: { applied, mode: info.mode & 511 } }
      } catch (error) {
        if (isENOENT(error)) return { ok: false, error: { code: 'NotFound' } }
        return { ok: false, error: { code: 'Failed' } }
      }
    },
    async digest(key, opts) {
      if (closed) return refuse()
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) return { ok: false, error: { code: 'InvalidArgument' } }
      try {
        const buf = await readFile(path)
        const max = opts?.maxBytes ?? Number.MAX_SAFE_INTEGER
        if (buf.length > max) {
          return { ok: false, error: { code: 'Failed' } }
        }
        const algo = opts?.algorithm === 'sha1' ? 'sha1' : 'sha256'
        const info = await stat(path)
        return {
          ok: true,
          value: {
            digest: createHash(algo).update(buf).digest('hex'),
            totalBytes: buf.length,
            mtimeMs: info.mtimeMs,
          },
        }
      } catch (error) {
        if (isENOENT(error)) return { ok: false, error: { code: 'NotFound' } }
        return { ok: false, error: { code: 'Failed' } }
      }
    },
    async update(key, edit, opts) {
      return updateDs(mutateHost, key, edit, opts, identityUpdateView)
    },
    async updateText(key, edit, opts) {
      return updateDs(mutateHost, key, edit, opts, decodeUpdateTextView)
    },
    async ensureScope(scope, opts) {
      // densable leftover `yc` @207443798 — `ke`/`Oe`/parent.
      if (closed) return refuse()
      const rec = asRecord(scope)
      const t =
        validateStorageScope(rec ?? scope) ??
        (rec ? validateBridgeSpawnRoot(roots, rec, 'scope') : undefined) ??
        (opts?.parent !== undefined &&
        opts.parent !== 'create' &&
        opts.parent !== 'mustExist'
          ? { code: 'InvalidArgument', argument: 'opts.parent' }
          : undefined)
      if (t !== undefined) {
        return {
          ok: false,
          error: { code: t.code, ...(t.argument && { argument: t.argument }) },
        }
      }
      if (!rec) return { ok: false, error: { code: 'InvalidArgument' } }
      const path = resolveKeyFilesystemPath(roots, rec)
      if (!path) return { ok: false, error: { code: 'InvalidArgument' } }
      try {
        const info = await stat(path)
        if (info.isDirectory()) return { ok: true, value: { created: false } }
        return { ok: false, error: { code: 'Failed' } }
      } catch (error) {
        if (!isENOENT(error)) return { ok: false, error: { code: 'Failed' } }
      }
      if (opts?.parent === 'mustExist') {
        try {
          await stat(dirname(path))
        } catch (error) {
          if (isENOENT(error)) return { ok: false, error: { code: 'NotFound' } }
          return { ok: false, error: { code: 'Failed' } }
        }
      }
      await mkdir(path, { recursive: true })
      return { ok: true, value: { created: true } }
    },
    async deleteScope(scope, opts) {
      // densable leftover `tc` @207427137 — `ic` or `wy`/`Ry`.
      if (closed) return refuse()
      const rec = asRecord(scope)
      if (opts?.olderThanMs !== undefined) {
        const gate =
          rec === null
            ? invalidArg('scope')
            : (() => {
                const t =
                  validateStorageScope(rec) ??
                  validateBridgeSpawnRoot(roots, rec, 'scope')
                if (t !== undefined) {
                  return {
                    ok: false as const,
                    error: {
                      code: t.code,
                      ...(t.argument && { argument: t.argument }),
                    },
                  }
                }
                return validateAgeSweepWy(rec, opts.olderThanMs)
              })()
        if (gate !== undefined) return gate
        return deleteScopeOlderThanRy(
          roots.bridgeSpawnRoot,
          opts.olderThanMs,
          clock(),
        )
      }
      if (!rec) return { ok: false, error: { code: 'InvalidArgument' } }
      const invalid =
        validateStorageScope(rec) ??
        validateBridgeSpawnRoot(roots, rec, 'scope')
      if (invalid !== undefined) {
        return {
          ok: false,
          error: {
            code: invalid.code,
            ...(invalid.argument && { argument: invalid.argument }),
          },
        }
      }
      if (DELETE_SCOPE_FENCED_SY.has(String(rec.namespace))) {
        return invalidArg('scope')
      }
      if (rec.namespace === 'bridgeSpawn' && rec.dir === undefined) {
        return invalidArg('scope.dir')
      }
      if (rec.namespace === 'pluginCache' && rec.version === undefined) {
        return invalidArg('scope.version')
      }
      const path = resolveKeyFilesystemPath(roots, rec)
      if (!path) return { ok: false, error: { code: 'InvalidArgument' } }
      try {
        await rm(path, { recursive: true, force: false })
        return { ok: true, value: { deleted: 1 } }
      } catch (error) {
        if (isENOENT(error)) return { ok: true, value: { deleted: 0 } }
        return { ok: false, error: { code: 'Failed' } }
      }
    },
    async tombstone(key, recordIds) {
      if (closed) return refuse()
      const rec = asRecord(key)
      if (!rec) return { ok: false, error: { code: 'InvalidArgument' } }
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) return { ok: false, error: { code: 'InvalidArgument' } }
      return tombstoneDigestRecords(digestHost, rec, path, recordIds)
    },
    async applyTombstones(key) {
      if (closed) return refuse()
      const rec = asRecord(key)
      if (!rec) return { ok: false, error: { code: 'InvalidArgument' } }
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) return { ok: false, error: { code: 'InvalidArgument' } }
      return purgeTombstonedDigestLog(digestHost, rec, path)
    },
    async statStream(key) {
      if (closed) return refuse()
      const rec = asRecord(key)
      if (!rec) return { ok: false, error: { code: 'InvalidArgument' } }
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) return { ok: false, error: { code: 'InvalidArgument' } }
      return getLogHeadStats(digestHost, rec, path)
    },
    async readValue(key) {
      if (closed) return undefined
      const rec = asRecord(key)
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) return undefined
      if (rec && isFramedDigestStreamKey(rec)) {
        return readFramedStreamFu(digestHost, rec, path)
      }
      try {
        const buf = await readFile(path)
        const info = await stat(path)
        return {
          bytes: new Uint8Array(buf),
          version: createHash('sha256').update(buf).digest('hex').slice(0, 16),
          size: info.size,
          mtimeMs: info.mtimeMs,
        }
      } catch {
        return undefined
      }
    },
    async streamEntries(key, stamp) {
      if (closed) return { unobservable: { code: 'Unavailable' } }
      const rec = asRecord(key)
      if (!rec) return { unobservable: { code: 'InvalidArgument' } }
      const path = resolveKeyFilesystemPath(roots, key)
      if (!path) return { unobservable: { code: 'InvalidArgument' } }
      return observeDigestIndexState(digestHost, rec, path, stamp)
    },
    async scopeKeys(scope) {
      if (closed) return refuse()
      const listed = await this.listEntries(scope, {
        skipKeyStats: true,
        skipScopeStats: true,
      })
      if (!listed.ok) return listed
      return {
        ok: true,
        value: listed.value.items.flatMap(i =>
          i.kind === 'key' && i.key ? [i.key] : [],
        ),
      }
    },
    async close() {
      closed = true
      return closeStorageSubscriptions(store)
    },
  }
}
