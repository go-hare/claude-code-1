/**
 * densable hb digest-log leftover: Re/vi/Xm @207398662 / @207316484,
 * sl/Ot/el/La/Ea @207402947 / @207398752 / @207401528,
 * Xu/Eg/Rg @207387311, zl @207412582.
 * Index lives at {configHome}/storage-v2/streams/{sha256(W(key))}/index.jsonl.
 * Log bytes live at Ee(key). Lock is stream.lock; apply.marker trips sl.
 */

import { createHash, randomUUID } from 'crypto'
import { constants as fsConstants } from 'fs'
import {
  access,
  appendFile,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { logForDebugging } from '../debug.js'
import { getErrnoCode, isENOENT } from '../errors.js'
import {
  announceStorageChange,
  withStorageWatchExpect,
  type StorageAnnounceHost,
  type StorageWatchBus,
} from './storageWatchBus.js'
import {
  openRegularFile,
  atomicWriteFileWithMode,
  isUnsupportedFsOperation,
  atomicWriteFile,
  MODE_OWNER_RW,
  MODE_ALL_RW,
} from './atomicWrite.js'
import type { StorageV5Result } from './createLocalFsBackend.js'
import {
  acquireLockfile,
  isColocatedValueLockKey,
  runSerializedByPath,
  withStorageLock,
  withValuePublishLock,
} from './storageLock.js'
import {
  resolveWriteOpts,
  shouldMakeParentDir,
  validateMarketplaceCacheSymlinks,
  getStreamFraming,
  validateAppendOpts,
  validateJsonlStreamEntries,
  isMkdirParentDiscipline,
  validateLineAppendStreamEntries,
  validateAppendEntries,
  getDebugLogRotationConfig,
  validateStorageKey,
  validateWriteRequest,
  type ResolvedWriteOpts,
} from './writeValidate.js'

/** densable leftover `pe` @207273474. */
const PE = 'storage-v2'
/** densable leftover `Je` — index.jsonl line delimiter. */
const JE = '\n'
/** densable leftover `Kg` @207405042. */
const KG = 3
/** densable leftover `Fg` @207401166. */
const FG = 256
/** densable leftover `gt` @207274080. */
const GT = 4
/** densable leftover `L`/`U`/`_`/`j`/`De` @207233806. */
const MODE_L = 384
const MODE_U = 438
const MODE_PRIV = 448
const MODE_J = 511
const MODE_DE = 493

export type DigestStorageRoots = {
  configHome: string
  globalConfigFile: string
  bridgeSpawnRoot?: string
}

export type DigestLogIdentity = {
  device: number | bigint
  inode: number | bigint
}

export type DigestIndexEntry = {
  seq: number
  recordId: string
  offset: number
  length: number
  digest: string
  tombstoned: boolean
}

export type DigestIndex = {
  applyGeneration: number
  logIdentity: DigestLogIdentity | undefined
  entries: DigestIndexEntry[]
  byId: Map<string, DigestIndexEntry>
  committedEnd: number
  headSeq: number | null
  issuedSeq: number | null
  indexBytes: number
  headerValid: boolean
  rejectedLines: number
  unbridgedVerificationRejection: boolean
  pendingTombstones: Set<string>
  predecessor?: {
    applyGeneration: number
    indexBytes: number
    logSize: number
    logIdentity?: DigestLogIdentity
  }
}

export type DigestStreamLayout = {
  log: string
  index: string
  marker: string
  directory: string
  createMode: number | undefined
  directoryMode: number | undefined
}

export type DigestIndexCacheEntry = {
  identity: string
  verifiedAgainst?: DigestLogIdentity
  index: DigestIndex
}

/** densable leftover `wp` cache row — `Jd` / `Sp`. */
export type ScanCountCacheEntry = {
  device: bigint
  inode: bigint
  sizeAt: number
  mtimeAt: number
  countedLiveBytes: number
  lines: number
  lastLineStart: number | null
  tailHash: string
}

export type DigestHost = {
  closed: boolean
  roots: DigestStorageRoots
  /**
   * densable hb store `bus`/`instanceId` — leftover `Ot`=`K` / `At`=`Q`.
   */
  bus?: StorageWatchBus
  instanceId?: string
  /**
   * densable hb `timing.echoDeadlineMs` (`Wu` @207386649) for leftover `Ot`.
   */
  timing?: { echoDeadlineMs: number }
  /**
   * densable leftover `Qe`/`Ee` @207254171 — `Ot` `Qe(e.roots, r.key)`.
   */
  resolvePath?: (
    roots: DigestStorageRoots,
    key: Record<string, unknown>,
  ) => string | null
  /**
   * densable hb `lockUnconditionalPublishes ?? ar()==="windows"`.
   * When true, value publish (`oy`) uses Kt/En forgoIf lock instead of he-only.
   */
  lockUnconditionalPublishes: boolean
  indexCache: Map<string, DigestIndexCacheEntry>
  verifiedCache: Set<string>
  scanFilesCache: Map<
    string,
    { files: DigestStreamLayout; lockIdentity: string }
  >
  scanCountCache: Map<string, ScanCountCacheEntry>
  screenedSessionLogs: Map<string, DigestLogIdentity>
}

export type DigestRecordInput = {
  data: string | Uint8Array
  recordId?: string
}

type ParsedHeader = {
  applyGeneration: number
  headSeq: number | null
  logIdentity: DigestLogIdentity | undefined
  predecessor: DigestIndex['predecessor'] | undefined
}

type ParsedOps = {
  headerValid: boolean
  applyGeneration: number
  headSeq: number | null
  logIdentity: DigestLogIdentity | undefined
  predecessor: DigestIndex['predecessor'] | undefined
  operations: Array<
    | {
        kind: 'append'
        operation: {
          priorLogEnd: number
          entries: Array<{
            seq: number
            recordId: string
            offset: number
            length: number
            digest: string
          }>
        }
      }
    | { kind: 'tombstone'; recordIds: string[] }
  >
  operationText: string
  bytes: number
}

function ok<T>(value: T): StorageV5Result<T> {
  return { ok: true, value }
}

function err(
  code: string,
  extra?: { telemetryCode?: string },
): StorageV5Result<never> {
  return { ok: false, error: { code, ...extra } }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

function digestJsonStringify(value: unknown): string {
  return JSON.stringify(value)
}

/** densable leftover `R`/`W` @206343614 / @206342226. */
export function digestCanonStorageKey(key: Record<string, unknown>): unknown {
  switch (key.namespace) {
    case 'transcript':
      if (key.journal === true) {
        return [
          key.namespace,
          key.projectKey,
          key.sessionId,
          null,
          key.agentRelPath,
          'journal',
        ]
      }
      if (key.sessionJournal !== undefined) {
        return [
          key.namespace,
          key.projectKey,
          key.sessionId,
          null,
          null,
          key.sessionJournal,
        ]
      }
      return [
        key.namespace,
        key.projectKey,
        key.sessionId,
        key.agentId ?? null,
        key.agentRelPath ?? null,
      ]
    case 'history':
    case 'identity':
      return [key.namespace]
    case 'globalConfig':
      return 'kind' in key
        ? [key.namespace, key.kind, key.stamp]
        : [key.namespace]
    case 'settings':
      if (key.layer === 'user') return [key.namespace, key.layer]
      if (key.layer === 'project') {
        return [key.namespace, key.layer, key.projectKey]
      }
      return [key.namespace, key.layer, key.consentRootKey]
    case 'task':
      if ('meta' in key) return [key.namespace, key.listId, key.meta]
      if ('highWaterMark' in key) {
        return [key.namespace, key.listId, ['highWaterMark']]
      }
      return [key.namespace, key.listId, key.taskId]
    case 'memory':
      return [key.namespace, key.projectKey, key.relPath]
    case 'pluginRegistry':
      return [key.namespace, key.file]
    case 'marketplaceCache':
      return 'relPath' in key
        ? [key.namespace, key.marketplace, key.relPath]
        : [key.namespace, key.marketplace, key.form]
    case 'pluginCache':
      return [
        key.namespace,
        key.marketplace,
        key.plugin,
        key.version,
        key.relPath,
      ]
    case 'cache':
      return [key.namespace, key.store, key.id]
    case 'paste':
      return [key.namespace, key.id]
    case 'pluginAssetCache':
      return [key.namespace, key.digest]
    case 'state':
      return [key.namespace, key.id]
    case 'plan':
      return [key.namespace, key.name]
    case 'feedbackDraft':
      return [key.namespace, key.draftId]
    case 'agentMemory':
      return [
        key.namespace,
        key.layer,
        key.layer === 'user' ? null : key.projectKey,
        key.agentType,
        key.relPath,
      ]
    case 'team':
      return [key.namespace, key.team]
    case 'sidecar':
      return [key.namespace, key.projectKey, key.sessionId, key.relPath]
    case 'scratch':
      return [key.namespace, key.sessionId, key.relPath]
    case 'userConfigDir':
      return [key.namespace, key.dir, key.relPath]
    case 'fileHistory':
      return [key.namespace, key.sessionId, key.backupFileName]
    case 'job':
      return [key.namespace, key.jobId, key.relPath]
    case 'daemon':
      return [key.namespace, key.relPath]
    case 'jobsRoot':
      return 'file' in key
        ? [key.namespace, key.file]
        : [key.namespace, 'draft', key.draftKey]
    case 'session':
      return [key.namespace, key.file]
    case 'bridgePointer':
    case 'sessionAliases':
      return [key.namespace, key.projectKey]
    case 'dirSyncRecord':
      return [key.namespace, key.projectKey, key.sessionId]
    case 'mailbox':
      return [key.namespace, key.team, key.teammate]
    case 'log':
      return [
        key.namespace,
        key.sessionId,
        key.channel,
        key.agentId ?? null,
        key.runId ?? null,
      ]
    case 'jobTimeline':
      return [key.namespace, key.jobId]
    case 'recording':
      return [key.namespace, key.projectKey, key.sessionId, key.stamp]
    case 'sessionLog':
      return [
        key.namespace,
        key.projectKey,
        key.year,
        key.month,
        key.day,
        key.logName,
      ]
    default:
      return
  }
}

export function digestStringifyCanonKey(
  key: Record<string, unknown>,
): string | undefined {
  const canon = digestCanonStorageKey(key)
  if (canon === undefined) return
  return digestJsonStringify(canon)
}

/** densable leftover `ue(key)` for `Au.expect` / `Ot` — not the fs-error `ue`. */
function storageWatchKeyId(key: Record<string, unknown>): string {
  return digestStringifyCanonKey(key) ?? JSON.stringify(key)
}

function announceHost(
  host: DigestHost | undefined,
): StorageAnnounceHost | undefined {
  if (host?.bus === undefined || host.instanceId === undefined) return
  return {
    bus: host.bus,
    instanceId: host.instanceId,
    roots: host.roots,
    timing: host.timing ?? { echoDeadlineMs: 2000 },
    resolvePath: (roots, key) => host.resolvePath?.(roots, key) ?? null,
    keyId: storageWatchKeyId,
  }
}

/** densable leftover `At`/`en` @207296396 — `e.bus.expect(ue(key))`. */
async function withDigestKeyExpect<T>(
  host: DigestHost | undefined,
  key: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const ah = announceHost(host)
  if (!ah) return run()
  return withStorageWatchExpect(ah.bus, [storageWatchKeyId(key)], run)
}

function announceDigestChange(
  host: DigestHost | undefined,
  change: Record<string, unknown>,
): void {
  const ah = announceHost(host)
  if (!ah) return
  announceStorageChange(ah, change)
}

/** densable leftover `vbd`/`J` — sha256 hex of W(key). */
export function digestSha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** densable leftover `es` @207258138. */
export function digestResolveStreamPath(
  roots: DigestStorageRoots,
  key: Record<string, unknown>,
): string | undefined {
  const w = digestStringifyCanonKey(key)
  if (w === undefined) return
  return join(roots.configHome, PE, 'streams', digestSha256Hex(w))
}

/**
 * densable leftover `Je`/`ns`/`Tt` @207258199 — value-publish lockfile path.
 * Colocated keys: `${Ee(key)}.lock`; else `storage-v2/locks/${J(W(key))}.lock`.
 */
export function resolveValuePublishLockPath(
  roots: DigestStorageRoots,
  key: Record<string, unknown>,
  filePath: string,
): string {
  if (isColocatedValueLockKey(key)) {
    return `${filePath}.lock`
  }
  const w = digestStringifyCanonKey(key)
  if (w === undefined) {
    return `${filePath}.lock`
  }
  return join(roots.configHome, PE, 'locks', `${digestSha256Hex(w)}.lock`)
}

/** densable leftover `Za` @207257391. */
export function digestLogFileCreateMode(
  key: Record<string, unknown>,
): number | undefined {
  switch (key.namespace) {
    case 'jobTimeline':
    case 'log':
      return MODE_U
    case 'transcript':
      return key.journal === true || key.sessionJournal !== undefined
        ? MODE_U
        : MODE_L
    case 'history':
    case 'recording':
    case 'sessionLog':
      return MODE_L
    default:
      return
  }
}

/** densable leftover `Oa`/`nn` @207235738. */
export function digestStreamDirMode(
  key: Record<string, unknown>,
): number | undefined {
  switch (key.namespace) {
    case 'cache':
    case 'feedbackDraft':
    case 'fileHistory':
    case 'jobsRoot':
    case 'mailbox':
    case 'marketplaceCache':
    case 'memory':
    case 'paste':
    case 'plan':
    case 'pluginRegistry':
    case 'task':
    case 'team':
      return MODE_J
    case 'pluginCache':
      return Array.isArray(key.relPath) && key.relPath[0] === 'bin'
        ? MODE_DE
        : MODE_J
    case 'agentMemory':
      return 'layer' in key && key.layer === 'user' ? MODE_J : MODE_PRIV
    case 'globalConfig':
      return 'kind' in key ? MODE_J : MODE_PRIV
    case 'log':
      return key.channel === 'debug' || key.channel === 'telemetry'
        ? MODE_J
        : MODE_PRIV
    case 'bridgePointer':
    case 'bridgeSpawn':
    case 'daemon':
    case 'history':
    case 'identity':
    case 'job':
    case 'jobTimeline':
    case 'pluginAssetCache':
    case 'recording':
      return MODE_PRIV
    default:
      return
  }
}

/** densable leftover `Xm` @207316484. */
export function buildDigestStreamLayout(
  log: string,
  directory: string,
  createMode: number | undefined,
  directoryMode: number | undefined,
): DigestStreamLayout {
  return {
    log,
    index: join(directory, 'index.jsonl'),
    marker: join(directory, 'apply.marker'),
    directory,
    createMode,
    directoryMode,
  }
}

/** densable leftover `vi` @207316614. */
export function buildDigestLayoutForKey(
  roots: DigestStorageRoots,
  key: Record<string, unknown>,
  logPath: string,
): DigestStreamLayout | undefined {
  const directory = digestResolveStreamPath(roots, key)
  if (directory === undefined) return
  return buildDigestStreamLayout(
    logPath,
    directory,
    digestLogFileCreateMode(key),
    digestStreamDirMode(key),
  )
}

/** densable leftover `Re` @207398662. */
export function resolveDigestStreamLayout(
  host: DigestHost,
  key: Record<string, unknown>,
  logPath: string,
): DigestStreamLayout | undefined {
  return buildDigestLayoutForKey(host.roots, key, logPath)
}

/** densable leftover `zr` @207316899. */
export function computeRecordDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url').slice(0, 22)
}

/** densable leftover `Wo` @207316700. */
export function createEmptyDigestIndex(
  applyGeneration = 0,
  logIdentity?: DigestLogIdentity,
): DigestIndex {
  return {
    applyGeneration,
    logIdentity,
    entries: [],
    byId: new Map(),
    committedEnd: 0,
    headSeq: null,
    issuedSeq: null,
    indexBytes: 0,
    headerValid: true,
    rejectedLines: 0,
    unbridgedVerificationRejection: false,
    pendingTombstones: new Set(),
  }
}

/** densable leftover `He` @207325390. */
export function digestStreamLockPath(layout: DigestStreamLayout): string {
  return join(layout.directory, 'stream.lock')
}

function toDigestLogIdentity(info: {
  dev: number | bigint
  ino: number | bigint
}): DigestLogIdentity {
  // densable leftover `ce` + bigint stat (`Ee`/`dl` use `{bigint:!0}`).
  // Callers MUST pass a bigint stat: plain `stat()` returns `ino` as a JS
  // number, and NTFS FileIndex values routinely exceed Number.MAX_SAFE_INTEGER
  // so `BigInt(number)` would already have lost low bits — defeating the
  // replaced-file guard that compares these identities.
  return { device: BigInt(info.dev), inode: BigInt(info.ino) }
}

async function digestLogIdentityAtPath(
  path: string,
): Promise<DigestLogIdentity> {
  return toDigestLogIdentity(await stat(path, { bigint: true }))
}

function isSameDigestLogIdentity(
  left: DigestLogIdentity | undefined,
  right: DigestLogIdentity | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.device === right.device &&
    left.inode === right.inode
  )
}

function digestInvalidateIndexCache(host: DigestHost, directory: string): void {
  host.indexCache.delete(directory)
}

function digestInvalidateVerifiedCache(
  host: DigestHost,
  directory: string,
): void {
  host.verifiedCache.delete(directory)
}

function normalizeRecordBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? Buffer.from(data) : data
}

function digestNextIssueSeq(index: DigestIndex): number {
  return index.issuedSeq === null ? 0 : index.issuedSeq + 1
}

function digestAllocateRecordId(
  index: DigestIndex,
  pending: Set<string>,
): string {
  for (let n = 0; n < 8; n++) {
    const id = randomUUID()
    if (!index.byId.has(id) && !pending.has(id)) return id
  }
  return `${randomUUID()}${randomUUID()}`
}

/** densable leftover `Ho` @207320293. */
export function formatDigestIndexHeaderLine(
  applyGeneration: number,
  logIdentity: DigestLogIdentity | undefined,
  headSeq: number | null,
  predecessor: DigestIndex['predecessor'] | undefined,
): string {
  return (
    digestJsonStringify({
      v: 3,
      applyGeneration,
      ...(headSeq !== null && { headSeq }),
      ...(logIdentity !== undefined && {
        logDev: String(logIdentity.device),
        logIno: String(logIdentity.inode),
      }),
      ...(predecessor !== undefined && {
        predecessor: {
          applyGeneration: predecessor.applyGeneration,
          indexBytes: predecessor.indexBytes,
          logSize: predecessor.logSize,
          ...(predecessor.logIdentity !== undefined && {
            logDev: String(predecessor.logIdentity.device),
            logIno: String(predecessor.logIdentity.inode),
          }),
        },
      }),
    }) + JE
  )
}

/** densable leftover `Nd` @207320800. */
export function formatDigestTombstoneOpLine(recordIds: string[]): string {
  return digestJsonStringify({ op: 'tombstone', recordIds }) + JE
}

export function formatDigestAppendOpLine(
  priorLogEnd: number,
  entries: DigestIndexEntry[],
): string {
  return (
    digestJsonStringify({
      op: 'append',
      priorLogEnd,
      entries: entries.map(e => ({
        seq: e.seq,
        recordId: e.recordId,
        offset: e.offset,
        length: e.length,
        digest: e.digest,
      })),
    }) + JE
  )
}

function parseDigestIndexHeaderLine(line: string): ParsedHeader | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return
  }
  if (typeof parsed !== 'object' || parsed === null) return
  const rec = parsed as Record<string, unknown>
  if (rec.v !== 3 || typeof rec.applyGeneration !== 'number') return
  const logIdentity =
    rec.logDev !== undefined && rec.logIno !== undefined
      ? {
          device: BigInt(String(rec.logDev)),
          inode: BigInt(String(rec.logIno)),
        }
      : undefined
  let predecessor: DigestIndex['predecessor']
  if (typeof rec.predecessor === 'object' && rec.predecessor !== null) {
    const pred = rec.predecessor as Record<string, unknown>
    if (
      typeof pred.applyGeneration === 'number' &&
      typeof pred.indexBytes === 'number' &&
      typeof pred.logSize === 'number'
    ) {
      predecessor = {
        applyGeneration: pred.applyGeneration,
        indexBytes: pred.indexBytes,
        logSize: pred.logSize,
        ...(pred.logDev !== undefined &&
          pred.logIno !== undefined && {
            logIdentity: {
              device: BigInt(String(pred.logDev)),
              inode: BigInt(String(pred.logIno)),
            },
          }),
      }
    }
  }
  return {
    applyGeneration: rec.applyGeneration,
    headSeq: typeof rec.headSeq === 'number' ? rec.headSeq : null,
    logIdentity,
    predecessor,
  }
}

/** densable leftover `Qe` @207316950. */
export function parseDigestIndexText(text: string): ParsedOps {
  const r = text.endsWith(JE) ? text : text.slice(0, text.lastIndexOf(JE) + 1)
  const n = r.length === 0 ? [] : r.slice(0, -1).split(JE)
  const [t, ...i] = n
  const header = t === undefined ? undefined : parseDigestIndexHeaderLine(t)
  const a: ParsedOps = {
    headerValid: header !== undefined,
    applyGeneration: 0,
    headSeq: null,
    logIdentity: undefined,
    predecessor: undefined,
    operations: [],
    operationText: '',
    bytes: Buffer.byteLength(r),
  }
  const s = a.headerValid ? i : n
  a.operationText = s.length === 0 ? '' : `${s.join(JE)}${JE}`
  if (header !== undefined) {
    a.applyGeneration = header.applyGeneration
    a.headSeq = header.headSeq
    a.logIdentity = header.logIdentity
    a.predecessor = header.predecessor
  }
  for (const line of s) {
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const rec = parsed as Record<string, unknown>
    if (rec.op === 'append' && typeof rec.priorLogEnd === 'number') {
      const entries = Array.isArray(rec.entries) ? rec.entries : []
      const mapped: Array<{
        seq: number
        recordId: string
        offset: number
        length: number
        digest: string
      }> = []
      for (const raw of entries) {
        if (typeof raw !== 'object' || raw === null) continue
        const e = raw as Record<string, unknown>
        if (
          typeof e.seq !== 'number' ||
          typeof e.recordId !== 'string' ||
          typeof e.offset !== 'number' ||
          typeof e.length !== 'number' ||
          typeof e.digest !== 'string'
        ) {
          continue
        }
        mapped.push({
          seq: e.seq,
          recordId: e.recordId,
          offset: e.offset,
          length: e.length,
          digest: e.digest,
        })
      }
      a.operations.push({
        kind: 'append',
        operation: { priorLogEnd: rec.priorLogEnd, entries: mapped },
      })
      continue
    }
    if (rec.op === 'tombstone' && Array.isArray(rec.recordIds)) {
      a.operations.push({
        kind: 'tombstone',
        recordIds: rec.recordIds.filter(
          (id): id is string => typeof id === 'string',
        ),
      })
    }
  }
  return a
}

/** densable leftover `Jm` @207319970. */
export function isValidDigestAppendBatch(
  entries: Array<{
    seq: number
    recordId: string
    offset: number
    length: number
  }>,
  index: DigestIndex,
): boolean {
  if (entries.length === 0) return false
  if (
    new Set(entries.map(o => o.recordId)).size !== entries.length ||
    entries.some(o => index.byId.has(o.recordId))
  ) {
    return false
  }
  const t = entries[0]?.seq ?? -1
  if (
    t < (index.headSeq === null ? 0 : index.headSeq + 1) ||
    entries.some((o, a) => o.seq !== t + a)
  ) {
    return false
  }
  let pos = index.committedEnd
  for (const e of entries) {
    if (e.offset !== pos) return false
    pos += e.length
  }
  return true
}

async function applyDigestIndexOperations(
  index: DigestIndex,
  parsed: ParsedOps,
  logSize: number,
  verify: (entries: DigestIndexEntry[]) => Promise<StorageV5Result<boolean>>,
): Promise<StorageV5Result<void>> {
  index.indexBytes += parsed.bytes
  for (const i of parsed.operations) {
    if (i.kind === 'tombstone') {
      for (const id of i.recordIds) {
        const f = index.byId.get(id)
        if (f === undefined) index.pendingTombstones.add(id)
        else f.tombstoned = true
      }
      continue
    }
    const { priorLogEnd: o, entries: a } = i.operation
    for (const c of a) {
      index.issuedSeq = Math.max(index.issuedSeq ?? -1, c.seq)
    }
    if (o !== index.committedEnd || !isValidDigestAppendBatch(a, index)) {
      index.rejectedLines += 1
      continue
    }
    const s = a.map(c => ({ ...c, tombstoned: false }))
    const inRange = a.every(c => c.offset + c.length <= logSize)
    const d = inRange ? await verify(s) : ok(false)
    if (!d.ok) return d
    if (!d.value) {
      index.rejectedLines += 1
      index.unbridgedVerificationRejection = true
      index.headSeq = Math.max(index.headSeq ?? -1, ...a.map(c => c.seq))
      continue
    }
    index.unbridgedVerificationRejection = false
    for (const c of s) {
      if (index.pendingTombstones.delete(c.recordId)) c.tombstoned = true
      index.entries.push(c)
      index.byId.set(c.recordId, c)
    }
    index.headSeq = Math.max(index.headSeq ?? -1, ...s.map(c => c.seq))
    index.committedEnd = s.reduce(
      (c, f) => Math.max(c, f.offset + f.length),
      index.committedEnd,
    )
  }
  if (parsed.headSeq !== null) {
    index.headSeq = Math.max(index.headSeq ?? -1, parsed.headSeq)
  }
  return ok(undefined)
}

/** densable leftover `Hr` @207318032. */
export async function buildDigestIndexFromParsed(
  parsed: ParsedOps,
  logSize: number,
  verify: (entries: DigestIndexEntry[]) => Promise<StorageV5Result<boolean>>,
): Promise<StorageV5Result<DigestIndex>> {
  const t = createEmptyDigestIndex(parsed.applyGeneration, parsed.logIdentity)
  t.headerValid = parsed.headerValid
  t.predecessor = parsed.predecessor
  const i = await applyDigestIndexOperations(t, parsed, logSize, verify)
  if (!i.ok) return i
  return ok(t)
}

/** densable leftover `Hn` / `tr` @207321103. */
export function queryDigestIndexEntries(
  entries: DigestIndexEntry[],
  opts?: {
    includeTombstoned?: boolean
    seqs?: number[]
    order?: 'forward' | 'backward'
    fromSeq?: number
    limit?: number
    maxBytes?: number
    maxBytesPerRecord?: number
  },
): { entries: DigestIndexEntry[]; nextSeq?: number } {
  const n = opts?.includeTombstoned === true
  const i = [...entries.filter(v => n || !v.tombstoned)].sort(
    (v, b) => v.seq - b.seq,
  )
  const o = opts?.seqs
  if (o !== undefined) {
    const v = new Set(o)
    return { entries: i.filter(b => v.has(b.seq)) }
  }
  const a = opts?.order === 'backward'
  const s = a ? [...i].reverse() : i
  const l = opts?.fromSeq
  const d = l === undefined ? s : s.filter(v => (a ? v.seq <= l : v.seq >= l))
  const c = limitDigestEntriesByBytes(
    d,
    opts?.limit,
    opts?.maxBytes,
    opts?.maxBytesPerRecord,
  )
  const f = c.at(-1)
  const g =
    c.length < d.length && f !== undefined
      ? a
        ? f.seq - 1
        : f.seq + 1
      : undefined
  return { entries: c, ...(g !== undefined && g >= 0 && { nextSeq: g }) }
}

function limitDigestEntriesByBytes(
  e: DigestIndexEntry[],
  r: number | undefined,
  n: number | undefined,
  t: number | undefined,
): DigestIndexEntry[] {
  const i: DigestIndexEntry[] = []
  let o = n ?? Number.POSITIVE_INFINITY
  for (const a of e) {
    if (r !== undefined && i.length >= r) break
    const s = t === undefined ? a.length : Math.min(a.length, t)
    if (i.length > 0 && s > o) break
    i.push(a)
    o -= s
  }
  return i
}

/** densable leftover `Xr` / `Oi` — framed streams go `Rg`, else `Eg`. */
export function isFramedDigestStreamKey(key: Record<string, unknown>): boolean {
  switch (key.namespace) {
    case 'log':
      return key.channel === 'debug'
    case 'sessionLog':
    case 'recording':
    case 'jobTimeline':
    case 'transcript':
    case 'history':
      return true
    default:
      return false
  }
}

async function digestHasApplyMarker(
  layout: DigestStreamLayout,
): Promise<boolean> {
  try {
    await stat(layout.marker)
    return true
  } catch {
    return false
  }
}

async function readDigestIndexFileIdentity(
  layout: DigestStreamLayout,
): Promise<DigestLogIdentity | undefined> {
  try {
    return await digestLogIdentityAtPath(layout.index)
  } catch {
    return
  }
}

async function digestIndexIdentityChanged(
  layout: DigestStreamLayout,
  snap: DigestLogIdentity | undefined,
): Promise<boolean> {
  if (snap === undefined) return false
  const n = await readDigestIndexFileIdentity(layout)
  return n !== undefined && !isSameDigestLogIdentity(n, snap)
}

/** densable leftover `qg` @207405042. */
export function digestIndexMatchesLogIdentity(
  index: DigestIndex,
  identity: DigestLogIdentity,
): boolean {
  if (index.logIdentity === undefined) return index.entries.length === 0
  return isSameDigestLogIdentity(index.logIdentity, identity)
}

async function readDigestIndexFile(
  layout: DigestStreamLayout,
): Promise<StorageV5Result<string | 'missing'>> {
  try {
    return ok(await readFile(layout.index, 'utf8'))
  } catch (error) {
    if (isENOENT(error)) return ok('missing')
    return err('Failed')
  }
}

async function readDigestLogFileIdentity(
  logPath: string,
): Promise<StorageV5Result<DigestLogIdentity | undefined>> {
  try {
    return ok(await digestLogIdentityAtPath(logPath))
  } catch (error) {
    if (isENOENT(error)) return ok(undefined)
    return err('Failed')
  }
}

async function readDigestLogFileSize(
  logPath: string,
): Promise<StorageV5Result<number>> {
  try {
    return ok((await stat(logPath)).size)
  } catch (error) {
    if (isENOENT(error)) return ok(0)
    return err('Failed')
  }
}

async function readDigestLogByteRanges(
  logPath: string,
  ranges: Array<{ offset: number; length: number }>,
): Promise<StorageV5Result<Uint8Array[]>> {
  try {
    const buf = await readFile(logPath)
    return ok(
      ranges.map(
        t => new Uint8Array(buf.subarray(t.offset, t.offset + t.length)),
      ),
    )
  } catch (error) {
    if (isENOENT(error)) return err('NotFound')
    return err('Failed')
  }
}

function verifyRecordDigestsMatch(
  chunks: Uint8Array[],
  entries: DigestIndexEntry[],
): boolean {
  return entries.every((n, t) => {
    const i = chunks[t]
    return (
      i !== undefined &&
      i.byteLength === n.length &&
      computeRecordDigest(i) === n.digest
    )
  })
}

async function verifyDigestEntriesAgainstLog(
  logPath: string,
  entries: DigestIndexEntry[],
): Promise<StorageV5Result<boolean>> {
  const n = await readDigestLogByteRanges(
    logPath,
    entries.map(({ offset, length }) => ({ offset, length })),
  )
  if (!n.ok) return n
  return ok(verifyRecordDigestsMatch(n.value, entries))
}

async function rewriteDigestIndexWithHeader(
  layout: DigestStreamLayout,
  parsed: ParsedOps,
  identity: DigestLogIdentity,
): Promise<StorageV5Result<void>> {
  const t =
    formatDigestIndexHeaderLine(
      parsed.applyGeneration,
      identity,
      parsed.headSeq,
      parsed.predecessor,
    ) + parsed.operationText
  try {
    await mkdir(layout.directory, {
      recursive: true,
      ...(layout.directoryMode !== undefined && {
        mode: layout.directoryMode,
      }),
    })
    await writeFile(layout.index, t, {
      ...(layout.createMode !== undefined && { mode: layout.createMode }),
    })
    return ok(undefined)
  } catch {
    return err('Failed')
  }
}

async function ensureDigestStreamDirectory(
  layout: DigestStreamLayout,
): Promise<StorageV5Result<void>> {
  try {
    await mkdir(layout.directory, {
      recursive: true,
      ...(layout.directoryMode !== undefined && {
        mode: layout.directoryMode,
      }),
    })
    return ok(undefined)
  } catch {
    return err('Failed')
  }
}

async function repairDigestIndexHeader(
  host: DigestHost,
  layout: DigestStreamLayout,
): Promise<StorageV5Result<void>> {
  const n = await readDigestIndexFile(layout)
  if (!n.ok || n.value === 'missing') {
    return n.ok ? ok(undefined) : n
  }
  const t = parseDigestIndexText(n.value)
  if (t.headerValid) return ok(undefined)
  const i = await readDigestLogFileIdentity(layout.log)
  if (!i.ok) return i
  digestInvalidateVerifiedCache(host, layout.directory)
  if (i.value === undefined) return ok(undefined)
  return rewriteDigestIndexWithHeader(layout, t, i.value)
}

/** densable leftover `_g` @207403236. */
export async function reconcileDigestIndexLogIdentity(
  host: DigestHost,
  layout: DigestStreamLayout,
): Promise<StorageV5Result<void>> {
  const n = await readDigestIndexFile(layout)
  if (!n.ok || n.value === 'missing') {
    return n.ok ? ok(undefined) : n
  }
  const t = parseDigestIndexText(n.value)
  const i = await readDigestLogFileIdentity(layout.log)
  if (!i.ok) return i
  if (
    i.value === undefined ||
    isSameDigestLogIdentity(t.logIdentity, i.value)
  ) {
    return ok(undefined)
  }
  const a = await readDigestLogFileSize(layout.log)
  if (!a.ok) return a
  const s = await buildDigestIndexFromParsed(t, a.value, d =>
    verifyDigestEntriesAgainstLog(layout.log, d),
  )
  if (!s.ok) return s
  if (t.logIdentity !== undefined && s.value.unbridgedVerificationRejection) {
    return err('Failed')
  }
  digestInvalidateVerifiedCache(host, layout.directory)
  if (i.value === undefined) return ok(undefined)
  return rewriteDigestIndexWithHeader(layout, t, i.value)
}

/**
 * densable leftover `ne`/`Be` @207293555 — ALS reentrant + Ke + proper-lockfile.
 *
 * `Lock` 后缀消歧：官方 `ne`（本函数）与 `Ne`（`atomicWrite` 的 errno 判定，本文件
 * 第 31 行导入、2283/2292 使用）只差大小写，`leftover` 前缀会把两者压成同名。
 */
export async function digestWithStreamLock<T>(
  layout: DigestStreamLayout,
  run: () => Promise<StorageV5Result<T>>,
): Promise<StorageV5Result<T>> {
  return withStorageLock(layout.index, () => run(), {
    lockfilePath: digestStreamLockPath(layout),
    parentMode: layout.directoryMode,
    ifReentrant: () => ok(undefined),
    ifContended: () => err('Unavailable'),
  })
}

/** densable leftover `sl` @207402947. */
export async function syncDigestStream(
  host: DigestHost,
  layout: DigestStreamLayout,
): Promise<StorageV5Result<void>> {
  const t = await digestWithStreamLock(layout, async () => {
    const i = await ensureDigestStreamDirectory(layout)
    if (!i.ok) return i
    const o = await repairDigestIndexHeader(host, layout)
    if (!o.ok) return o
    return reconcileDigestIndexLogIdentity(host, layout)
  })
  if (!t.ok) return t
  digestInvalidateIndexCache(host, layout.directory)
  digestInvalidateVerifiedCache(host, layout.directory)
  return ok(undefined)
}

async function loadDigestIndexFromDisk(
  layout: DigestStreamLayout,
): Promise<StorageV5Result<DigestIndex | 'missing'>> {
  const n = await readDigestIndexFile(layout)
  if (!n.ok) return n
  if (n.value === 'missing') return ok('missing')
  const t = await readDigestLogFileSize(layout.log)
  if (!t.ok) return t
  return buildDigestIndexFromParsed(parseDigestIndexText(n.value), t.value, d =>
    verifyDigestEntriesAgainstLog(layout.log, d),
  )
}

/** densable leftover `el` @207398800. */
export async function getCachedDigestIndex(
  host: DigestHost,
  layout: DigestStreamLayout,
  logIdentity?: DigestLogIdentity,
): Promise<StorageV5Result<{ index: DigestIndex } | 'missing'>> {
  let indexStat: { dev: number; ino: number; size: number; mtimeMs: number }
  try {
    const info = await stat(layout.index)
    indexStat = {
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      mtimeMs: info.mtimeMs,
    }
  } catch (error) {
    if (isENOENT(error)) return ok('missing')
    return err('Failed')
  }
  if (logIdentity === undefined) {
    try {
      await stat(layout.log)
    } catch (error) {
      if (isENOENT(error)) {
        digestInvalidateIndexCache(host, layout.directory)
        return ok('missing')
      }
      return err('Failed')
    }
  }
  const a = `${indexStat.dev}:${indexStat.ino}:${indexStat.size}:${indexStat.mtimeMs}`
  const s = host.indexCache.get(layout.directory)
  if (
    s !== undefined &&
    s.identity === a &&
    (logIdentity === undefined ||
      isSameDigestLogIdentity(s.verifiedAgainst, logIdentity))
  ) {
    return ok({ index: s.index })
  }
  const l = await loadDigestIndexFromDisk(layout)
  if (!l.ok) return l
  if (l.value === 'missing') return ok('missing')
  host.indexCache.set(layout.directory, {
    identity: a,
    verifiedAgainst: logIdentity,
    index: l.value,
  })
  return ok({ index: l.value })
}

/** densable leftover `Ot` @207398752. */
export async function loadDigestIndex(
  host: DigestHost,
  layout: DigestStreamLayout,
  logIdentity?: DigestLogIdentity,
): Promise<StorageV5Result<DigestIndex | 'missing'>> {
  const t = await getCachedDigestIndex(host, layout, logIdentity)
  if (!t.ok) return t
  return ok(t.value === 'missing' ? 'missing' : t.value.index)
}

async function readDigestRecordsWithRetry(
  host: DigestHost,
  key: Record<string, unknown>,
  logPath: string,
  opts:
    | {
        order?: 'forward' | 'backward'
        maxBytes?: number
        limit?: number
        fromSeq?: number
        maxBytesPerRecord?: number
      }
    | undefined,
  t: number,
): Promise<
  StorageV5Result<{
    items: Array<{
      seq: number
      endSeq: number
      recordId: string
      data: Uint8Array
      truncated?: boolean
      tombstoned: boolean
    }>
    nextSeq?: number
  }>
> {
  if (t >= KG) return err('Unavailable')
  const layout = resolveDigestStreamLayout(host, key, logPath)
  if (!layout) return err('InvalidArgument')
  digestInvalidateIndexCache(host, layout.directory)
  const i = await syncDigestStream(host, layout)
  if (!i.ok) return i
  return readDigestRecords(host, key, logPath, opts, t + 1)
}

/** densable leftover `La` @207401528. */
export async function readDigestRecords(
  host: DigestHost,
  key: Record<string, unknown>,
  logPath: string,
  opts?: {
    order?: 'forward' | 'backward'
    maxBytes?: number
    limit?: number
    fromSeq?: number
    maxBytesPerRecord?: number
  },
  retry = 0,
): Promise<
  StorageV5Result<{
    items: Array<{
      seq: number
      endSeq: number
      recordId: string
      data: Uint8Array
      truncated?: boolean
      tombstoned: boolean
    }>
    nextSeq?: number
  }>
> {
  const i = resolveDigestStreamLayout(host, key, logPath)
  if (!i) return err('InvalidArgument')
  if (await digestHasApplyMarker(i)) {
    const d = await syncDigestStream(host, i)
    if (!d.ok) return d
  }
  const o = await readDigestIndexFileIdentity(i)
  let logIdentity: DigestLogIdentity | undefined
  try {
    logIdentity = await digestLogIdentityAtPath(i.log)
  } catch (error) {
    if (!isENOENT(error)) return err('Failed')
  }
  const s = await loadDigestIndex(host, i, logIdentity)
  if (!s.ok) return s
  if (s.value === 'missing') return err('NotFound')
  const l = s.value
  if (logIdentity === undefined) {
    return readDigestRecordsWithRetry(host, key, logPath, opts, retry)
  }
  if (!digestIndexMatchesLogIdentity(l, logIdentity)) {
    return readDigestRecordsWithRetry(host, key, logPath, opts, retry)
  }
  if (
    (await digestHasApplyMarker(i)) ||
    (await digestIndexIdentityChanged(i, o))
  ) {
    return readDigestRecordsWithRetry(host, key, logPath, opts, retry)
  }
  const d = queryDigestIndexEntries(l.entries, opts)
  const c = d.entries.map(g => ({
    offset: g.offset,
    length:
      opts?.maxBytesPerRecord === undefined
        ? g.length
        : Math.min(g.length, opts.maxBytesPerRecord),
  }))
  const f =
    c.length === 0
      ? ok([] as Uint8Array[])
      : await readDigestLogByteRanges(i.log, c)
  if (!f.ok) return f
  const p: Array<{
    seq: number
    endSeq: number
    recordId: string
    data: Uint8Array
    truncated?: boolean
    tombstoned: boolean
  }> = []
  for (const [g, v] of d.entries.entries()) {
    const b = f.value[g] ?? new Uint8Array()
    const h =
      opts?.maxBytesPerRecord !== undefined && v.length > opts.maxBytesPerRecord
    if (!h && computeRecordDigest(b) !== v.digest) {
      logForDebugging(
        `storage record failed digest verification and was not served: ${v.recordId}`,
        { level: 'warn' },
      )
      continue
    }
    p.push({
      seq: v.seq,
      endSeq: v.seq + 1,
      recordId: v.recordId,
      data: b,
      ...(h && { truncated: h }),
      tombstoned: v.tombstoned,
    })
  }
  return ok({
    items: p,
    ...(d.nextSeq !== undefined && { nextSeq: d.nextSeq }),
  })
}

async function appendDigestLogBytes(
  layout: DigestStreamLayout,
  bytes: Uint8Array,
  create: boolean,
): Promise<StorageV5Result<{ position: number }>> {
  try {
    await mkdir(dirname(layout.log), {
      recursive: true,
      ...(layout.directoryMode !== undefined && {
        mode: layout.directoryMode,
      }),
    })
    let position = 0
    try {
      position = (await stat(layout.log)).size
    } catch (error) {
      if (!isENOENT(error)) return err('Failed')
      if (!create) return err('NotFound')
    }
    await appendFile(layout.log, Buffer.from(bytes), {
      ...(layout.createMode !== undefined && { mode: layout.createMode }),
    })
    return ok({ position })
  } catch {
    return err('Failed')
  }
}

async function appendDigestIndexOpLine(
  layout: DigestStreamLayout,
  opText: string,
): Promise<StorageV5Result<void>> {
  try {
    await appendFile(layout.index, `${JE}${opText}`)
    return ok(undefined)
  } catch {
    return err('Failed')
  }
}

async function initOrAppendDigestIndex(
  layout: DigestStreamLayout,
  opText: string,
  applyGeneration: number,
): Promise<StorageV5Result<void>> {
  const i = Buffer.from(
    formatDigestIndexHeaderLine(applyGeneration, undefined, null, undefined) +
      opText,
  )
  try {
    await mkdir(layout.directory, {
      recursive: true,
      ...(layout.directoryMode !== undefined && {
        mode: layout.directoryMode,
      }),
    })
    try {
      await writeFile(layout.index, i, {
        flag: 'wx',
        ...(layout.createMode !== undefined && { mode: layout.createMode }),
      })
      return ok(undefined)
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'EEXIST'
      ) {
        return appendDigestIndexOpLine(layout, opText)
      }
      return err('Failed')
    }
  } catch {
    return err('Failed')
  }
}

function assignDigestEntryOffsets(
  fresh: Array<{ entry: DigestIndexEntry; bytes: Uint8Array }>,
  position: number,
): Array<{ entry: DigestIndexEntry; bytes: Uint8Array }> {
  const n: Array<{ entry: DigestIndexEntry; bytes: Uint8Array }> = []
  let t = position
  for (const i of fresh) {
    n.push({ entry: { ...i.entry, offset: t }, bytes: i.bytes })
    t += i.entry.length
  }
  return n
}

async function prepareDigestWriteBatch(
  layout: DigestStreamLayout,
  index: DigestIndex,
  records: DigestRecordInput[],
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
    fresh: Array<{ entry: DigestIndexEntry; bytes: Uint8Array }>
  }>
> {
  const i: Array<{ seq: number; endSeq: number; recordId: string }> = []
  const o: Array<{ entry: DigestIndexEntry; bytes: Uint8Array }> = []
  const a = new Set<string>()
  let s = digestNextIssueSeq(index)
  for (const l of records) {
    const d = normalizeRecordBytes(l.data)
    const c = l.recordId === undefined ? undefined : index.byId.get(l.recordId)
    if (c !== undefined) {
      if (!(c.length === d.byteLength && c.digest === computeRecordDigest(d))) {
        return err('InvalidArgument')
      }
      const g = await verifyDigestEntriesAgainstLog(layout.log, [c])
      if (!g.ok) return g
      if (!g.value) return err('Unavailable')
      i.push({ seq: c.seq, endSeq: c.seq + 1, recordId: c.recordId })
      continue
    }
    if (s > Number.MAX_SAFE_INTEGER) return err('Unavailable')
    const f = l.recordId ?? digestAllocateRecordId(index, a)
    if (a.has(f)) return err('InvalidArgument')
    a.add(f)
    o.push({
      entry: {
        seq: s,
        recordId: f,
        offset: 0,
        length: d.byteLength,
        digest: computeRecordDigest(d),
        tombstoned: false,
      },
      bytes: d,
    })
    i.push({ seq: s, endSeq: s + 1, recordId: f })
    s += 1
  }
  return ok({ acks: i, fresh: o })
}

async function digestPrepareAppendIndex(
  host: DigestHost,
  layout: DigestStreamLayout,
): Promise<
  StorageV5Result<{
    index: DigestIndex
    createdStream: boolean
  }>
> {
  const loaded = await loadDigestIndex(host, layout)
  if (!loaded.ok) return loaded
  if (loaded.value === 'missing') {
    return ok({ index: createEmptyDigestIndex(0), createdStream: true })
  }
  return ok({ index: loaded.value, createdStream: false })
}

/** densable leftover `Eg` @207388795. */
export async function digestAppendRecordsLocked(
  host: DigestHost,
  key: Record<string, unknown>,
  records: DigestRecordInput[],
  logPath: string,
  opts?: { singleName?: boolean; precondition?: unknown },
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
    createdStream?: boolean
    fresh?: Array<{ entry: DigestIndexEntry }>
  }>
> {
  if (host.closed) return err('Unavailable')
  const i =
    validateStorageKey(key) ??
    validateAppendEntries(key, records) ??
    validateAppendOpts(opts)
  if (i !== undefined) return { ok: false, error: { code: i.code } }
  if (opts?.precondition !== undefined) {
    return err('InvalidArgument')
  }
  const o = resolveDigestStreamLayout(host, key, logPath)
  if (!o) return err('InvalidArgument')
  await ensureDigestStreamDirectory(o)
  const a = await withStorageLock(
    o.index,
    async l => {
      const d = await digestPrepareAppendIndex(host, o)
      if (!d.ok) return d
      const { index: c, createdStream: f } = d.value
      const g = await prepareDigestWriteBatch(o, c, records)
      if (!g.ok) return g
      if (g.value.fresh.length === 0) {
        return ok({ acks: g.value.acks, createdStream: false })
      }
      const v = Buffer.concat(g.value.fresh.map(O => Buffer.from(O.bytes)))
      const b = await appendDigestLogBytes(o, new Uint8Array(v), f)
      if (!b.ok) return b
      const h = assignDigestEntryOffsets(g.value.fresh, b.value.position)
      const E = formatDigestAppendOpLine(
        c.committedEnd,
        h.map(O => O.entry),
      )
      const R = f
        ? await initOrAppendDigestIndex(o, E, c.applyGeneration)
        : await appendDigestIndexOpLine(o, E)
      if (!R.ok) return R
      digestInvalidateIndexCache(host, o.directory)
      digestInvalidateVerifiedCache(host, o.directory)
      const S = await loadDigestIndex(host, o)
      if (!S.ok) return S
      const L = S.value === 'missing' ? undefined : S.value
      if (
        !(
          L !== undefined &&
          h.every(O => {
            const M = L.byId.get(O.entry.recordId)
            return (
              M !== undefined &&
              M.offset === O.entry.offset &&
              M.length === O.entry.length &&
              M.digest === O.entry.digest
            )
          })
        )
      ) {
        digestInvalidateVerifiedCache(host, o.directory)
        digestInvalidateIndexCache(host, o.directory)
        return err('Unavailable')
      }
      if (l.suspect()) return err('Unavailable')
      return ok({
        acks: g.value.acks,
        createdStream: f,
        fresh: h.map(O => ({ entry: O.entry })),
      })
    },
    {
      lockfilePath: digestStreamLockPath(o),
      parentMode: o.directoryMode,
      ifReentrant: () => ok(undefined),
      ifContended: () => err('Unavailable'),
    },
  )
  digestInvalidateIndexCache(host, o.directory)
  if (a.ok && a.value !== undefined && Array.isArray(a.value.acks)) {
    announceEgAppend(host, key, a.value)
  }
  return a
}

/** densable leftover `Eg` K @207390240 — created vs appended-fresh. */
function announceEgAppend(
  host: DigestHost,
  key: Record<string, unknown>,
  result: {
    createdStream?: boolean
    fresh?: Array<{ entry: DigestIndexEntry }>
  },
): void {
  if (result.createdStream) {
    announceDigestChange(host, {
      kind: 'created',
      key,
      records: (result.fresh ?? []).map(l => [l.entry.seq, l.entry.recordId]),
    })
    return
  }
  for (const l of result.fresh ?? []) {
    announceDigestChange(host, {
      kind: 'appended',
      key,
      seq: l.entry.seq,
      recordId: l.entry.recordId,
    })
  }
}

/** densable leftover `et` @207388441. */
export function digestResolveCachedLayout(
  host: DigestHost,
  key: Record<string, unknown>,
  logPath: string,
): [DigestStreamLayout, string] | undefined {
  const n = digestStringifyCanonKey(key)
  if (n === undefined) return
  const t = host.scanFilesCache.get(n)
  if (t !== undefined) return [t.files, t.lockIdentity]
  const i = resolveDigestStreamLayout(host, key, logPath)
  if (!i) return
  const o = {
    files: i,
    lockIdentity:
      key.namespace === 'history'
        ? `${resolve(i.log)}.lock`
        : resolve(digestStreamLockPath(i)),
  }
  host.scanFilesCache.set(n, o)
  if (host.scanFilesCache.size > FG) {
    const a = host.scanFilesCache.keys().next()
    if (!a.done) host.scanFilesCache.delete(a.value)
  }
  return [i, o.lockIdentity]
}

/** densable leftover `Fu` @207356800. */
export function logPackRecordsBlock(
  e: DigestRecordInput[],
  r: number,
): {
  block: string | Buffer
  acks: Array<{ seq: number; endSeq: number; recordId: string }>
  ends: number[]
  end: number
} {
  const n: Array<{ seq: number; endSeq: number; recordId: string }> = []
  const t: number[] = []
  const i = e.every(d => typeof d.data === 'string')
  let o = ''
  const a: Buffer[] = []
  let s = r
  for (const d of e) {
    let c: number
    if (i && typeof d.data === 'string') {
      o += d.data
      c = Buffer.byteLength(d.data)
    } else {
      const f = Buffer.from(normalizeRecordBytes(d.data))
      a.push(f)
      c = f.byteLength
    }
    n.push({ seq: s, endSeq: s + c, recordId: String(s) })
    s += c
    t.push(s)
  }
  const l = a.length === 1 ? a[0] : undefined
  return { block: i ? o : (l ?? Buffer.concat(a)), acks: n, ends: t, end: s }
}

/** densable leftover `Wd` @207325448. */
export async function logRenameWithReplace(
  e: string,
  r: string,
): Promise<void> {
  try {
    await rename(e, r)
    return
  } catch (error) {
    if (isENOENT(error)) return
  }
  await unlink(r).catch(() => undefined)
  try {
    await rename(e, r)
  } catch (error) {
    if (!isENOENT(error)) await unlink(e).catch(() => undefined)
  }
}

/** densable leftover `Xo`/`tp` @207324270 / @207325094. */
export async function logAppendBytes(
  e: string,
  r: string | Buffer,
  makeParent: boolean,
  createMode: number | undefined,
  directoryMode: number | undefined,
  create = true,
): Promise<StorageV5Result<void>> {
  try {
    if (makeParent) {
      await mkdir(dirname(e), {
        recursive: true,
        ...(directoryMode !== undefined && { mode: directoryMode }),
      })
    }
    await appendFile(e, typeof r === 'string' ? r : new Uint8Array(r), {
      ...(createMode !== undefined && { mode: createMode }),
      // densable leftover Xo: create=false must refuse a missing log (ifExists).
      // String flag 'a' always creates; use O_APPEND without O_CREAT so ENOENT
      // reaches the NotFound branch below instead of resurrecting a removed stream.
      flag: create
        ? fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT
        : fsConstants.O_WRONLY | fsConstants.O_APPEND,
    })
    return ok(undefined)
  } catch (error) {
    if (isENOENT(error) && !makeParent) return err('NotFound')
    return err('Failed')
  }
}

/** densable leftover `jp` @207356034. */
export async function logStatAsFileOrAbsent(
  logPath: string,
): Promise<StorageV5Result<'absent' | 'file'>> {
  try {
    const n = await stat(logPath)
    if (n.isFile()) return ok('file')
    return err('Failed')
  } catch (error) {
    if (isENOENT(error)) return ok('absent')
    return err('Failed')
  }
}

/** densable leftover `Qd` @207356200. */
export async function historyAcquireAppendLock(
  logPath: string,
): Promise<StorageV5Result<() => Promise<void>>> {
  try {
    const release = await acquireLockfile(logPath, {
      stale: 1e4,
      retries: { retries: 3, minTimeout: 50 },
      onCompromised: r => {
        logForDebugging(
          `storage history append lock compromised: ${String(r)}`,
          {
            level: 'error',
          },
        )
      },
    })
    return ok(release)
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ELOCKED'
    ) {
      return err('Unavailable')
    }
    return err('Failed')
  }
}

/** densable leftover `Ru` @207356400. */
export async function logAppendPackedViaAppendFile(
  layout: DigestStreamLayout,
  records: DigestRecordInput[],
  opts: {
    rotation?: { maxBytes: number; rotatedPath: string }
    makeParent: boolean
    ifExists?: boolean
    nonEmpty?: boolean
    singleName?: boolean
  },
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
    ends: number[]
    createdStream: boolean
  }>
> {
  let size = 0
  let absent = false
  try {
    const l = await stat(layout.log)
    if (!l.isFile()) return err('Failed')
    size = l.size
    if (opts.ifExists && opts.nonEmpty === true && size === 0) {
      return err('NotFound')
    }
  } catch (error) {
    if (!isENOENT(error)) return err('Failed')
    if (opts.ifExists) return err('NotFound')
    absent = true
  }
  const packed = logPackRecordsBlock(records, absent ? 0 : size)
  const b = await logAppendBytes(
    layout.log,
    packed.block,
    opts.makeParent && !opts.ifExists,
    layout.createMode,
    layout.directoryMode,
    !opts.ifExists,
  )
  if (!b.ok) {
    if (b.error.code === 'NotFound' && opts.ifExists) return err('NotFound')
    return b
  }
  if (opts.rotation !== undefined && packed.end > opts.rotation.maxBytes) {
    await logRenameWithReplace(layout.log, opts.rotation.rotatedPath)
  }
  return ok({
    acks: packed.acks,
    ends: packed.ends,
    createdStream: absent,
  })
}

/** densable leftover `Np` @207353389. */
export async function historyAppendWithFileLock(
  layout: DigestStreamLayout,
  records: DigestRecordInput[],
  singleName: boolean,
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
    createdStream?: boolean
  }>
> {
  const i = await logStatAsFileOrAbsent(layout.log)
  if (!i.ok) return i
  let o = await historyAcquireAppendLock(layout.log)
  let a = false
  if (!o.ok && i.value === 'absent') {
    const s = await logAppendBytes(
      layout.log,
      Buffer.alloc(0),
      true,
      layout.createMode,
      layout.directoryMode,
    )
    if (!s.ok) return s
    a = true
    o = await historyAcquireAppendLock(layout.log)
  }
  if (!o.ok) return o
  try {
    const s = await logAppendPackedViaAppendFile(layout, records, {
      makeParent: true,
      singleName,
    })
    if (!s.ok || !a) return s
    return ok({ ...s.value, createdStream: true })
  } finally {
    await o.value().catch(s => {
      logForDebugging(
        `storage history append lock release failed: ${String(s)}`,
        {
          level: 'warn',
        },
      )
    })
  }
}

type LogExclusiveHandle = {
  handle: Awaited<ReturnType<typeof open>>
  identity: DigestLogIdentity
  nlink: number
  size: number
}

type PathEnsureKind = { kind: string }

/** densable leftover `Ba` @207246025. */
export function splitPathHomeAndHops(e: string): {
  home: string
  hops: string[]
} {
  const n: string[] = []
  let r = dirname(e)
  for (let t = 0; t < GT; t++) {
    n.unshift(r)
    r = dirname(r)
  }
  return { home: r, hops: n }
}

/** densable leftover `Zd` @207355200. */
function classifyLstatEnsureKind(
  e: string,
  r: { isSymbolicLink(): boolean; isDirectory(): boolean },
): PathEnsureKind | undefined {
  if (r.isSymbolicLink()) return { kind: 'fs' }
  return r.isDirectory() ? undefined : { kind: 'fs' }
}

/** densable leftover `_p` @207354800. */
async function ensureDirSegmentKind(
  e: string,
  r: { mode?: number; home?: string } | undefined,
): Promise<PathEnsureKind | undefined> {
  try {
    return classifyLstatEnsureKind(e, await lstat(e))
  } catch (error) {
    if (!isENOENT(error) || r === undefined) {
      return { kind: isENOENT(error) ? 'absent' : 'fs' }
    }
  }
  if (r.home !== undefined) {
    try {
      await mkdir(r.home, {
        recursive: true,
        ...(r.mode !== undefined && { mode: r.mode }),
      })
    } catch {
      return { kind: 'fs' }
    }
  }
  try {
    await mkdir(e, {
      recursive: false,
      ...(r.mode !== undefined && { mode: r.mode }),
    })
    return
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'EEXIST'
    ) {
      try {
        return classifyLstatEnsureKind(e, await lstat(e))
      } catch {
        return { kind: 'fs' }
      }
    }
    return { kind: 'fs' }
  }
}

/** densable leftover `wu` @207354400. */
async function ensureDirectoryHopChain(
  hops: string[],
  r: { home: string; mode: number | undefined } | undefined,
  n: boolean,
): Promise<PathEnsureKind | undefined> {
  for (const [t, i] of hops.entries()) {
    const o = await ensureDirSegmentKind(
      i,
      r && { mode: r.mode, home: t === 0 ? r.home : undefined },
    )
    if (o !== undefined) {
      if (o.kind !== 'absent' || r !== undefined) return o
      return n ? { kind: 'fs' } : undefined
    }
  }
}

/** densable leftover `$r` @207353990. */
export async function ensureDirectoryTreeForPath(
  e: string,
  r: number | undefined,
  n: boolean,
): Promise<PathEnsureKind | undefined> {
  const { home, hops } = splitPathHomeAndHops(e)
  return ensureDirectoryHopChain(
    hops,
    r === undefined ? undefined : { home, mode: r },
    n,
  )
}

/** densable leftover `_n` @207323378. */
export async function openLogExclusiveAppend(
  e: string,
  create: boolean,
  mode?: number,
): Promise<
  StorageV5Result<LogExclusiveHandle> & {
    error?: { code: string; kind?: string; fsCode?: string }
  }
> {
  const t =
    fsConstants.O_WRONLY |
    fsConstants.O_APPEND |
    (create ? fsConstants.O_CREAT | fsConstants.O_EXCL : 0)
  try {
    const handle = await open(e, t, mode)
    const st = await handle.stat()
    if (!st.isFile()) {
      await handle.close()
      return { ok: false, error: { code: 'Failed', kind: 'fs' } }
    }
    return ok({
      handle,
      // Identity needs the bigint stat; st.ino is a rounded double. The handle
      // pins the inode, so this second stat observes the same file.
      identity: toDigestLogIdentity(await handle.stat({ bigint: true })),
      nlink: st.nlink,
      size: st.size,
    })
  } catch (error) {
    if (isENOENT(error)) {
      return { ok: false, error: { code: 'NotFound', kind: 'absent' } }
    }
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'EEXIST'
    ) {
      return {
        ok: false,
        error: { code: 'Failed', kind: 'fs', fsCode: 'EEXIST' },
      }
    }
    return { ok: false, error: { code: 'Failed', kind: 'fs' } }
  }
}

/** densable leftover `Eu` @207358463. */
export async function writePackedRecordsToHandle(
  opened: LogExclusiveHandle,
  records: DigestRecordInput[],
  created: boolean,
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
    ends: number[]
    createdStream: boolean
  }>
> {
  const { block, acks, ends } = logPackRecordsBlock(
    records,
    created ? 0 : opened.size,
  )
  try {
    await opened.handle.write(
      typeof block === 'string' ? Buffer.from(block) : block,
    )
    await opened.handle.close()
    return ok({ acks, ends, createdStream: created })
  } catch {
    await opened.handle.close().catch(() => undefined)
    return err('Failed')
  }
}

function isScreenedLogIdentity(
  screened: Map<string, DigestLogIdentity>,
  path: string,
  identity: DigestLogIdentity,
): boolean {
  const got = screened.get(path)
  return got !== undefined && isSameDigestLogIdentity(got, identity)
}

/** densable leftover `Lu` @207358747 leftover-used. */
async function validateOpenedLogAgainstPath(
  path: string,
  opened: LogExclusiveHandle,
  screened: Map<string, DigestLogIdentity> | undefined,
): Promise<PathEnsureKind | undefined> {
  const t = await ensureDirectoryTreeForPath(path, undefined, true)
  if (t !== undefined) return t
  try {
    const i = await digestLogIdentityAtPath(path)
    if (!isSameDigestLogIdentity(opened.identity, i)) return { kind: 'fs' }
    if (screened !== undefined && opened.nlink === 1) {
      screened.set(path, opened.identity)
    }
    return
  } catch {
    return { kind: 'fs' }
  }
}

async function closeOpenLogAsFailed(
  opened: LogExclusiveHandle,
): Promise<StorageV5Result<never>> {
  await opened.handle.close().catch(() => undefined)
  return err('Failed')
}

/** densable leftover `qp` @207358120. */
export async function createOrAppendExclusiveLog(
  path: string,
  records: DigestRecordInput[],
  screened: Map<string, DigestLogIdentity> | undefined,
  createMode: number | undefined,
  singleName: boolean,
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
    ends?: number[]
    createdStream?: boolean
  }>
> {
  let a = await openLogExclusiveAppend(path, true, createMode)
  const created = a.ok
  if (!a.ok) {
    if (a.error.kind !== 'fs' || a.error.fsCode !== 'EEXIST') return a
    a = await openLogExclusiveAppend(path, false, createMode)
    if (!a.ok) return a
  }
  const d = await validateOpenedLogAgainstPath(path, a.value, screened)
  if (d !== undefined) return closeOpenLogAsFailed(a.value)
  if (singleName && a.value.nlink > 1) return closeOpenLogAsFailed(a.value)
  return writePackedRecordsToHandle(a.value, records, created)
}

/** densable leftover `Up` @207357548. */
export async function sessionLogAppendExclusive(
  layout: DigestStreamLayout,
  records: DigestRecordInput[],
  opts: {
    makeParent: boolean
    screened?: Map<string, DigestLogIdentity>
    singleName?: boolean
  },
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
    createdStream?: boolean
  }>
> {
  const a = layout.log
  const s = opts.makeParent ? layout.directoryMode : undefined
  const screened = opts.screened
  const l = screened !== undefined && screened.has(a)
  if (!l) {
    const f = await ensureDirectoryTreeForPath(a, s, false)
    if (f !== undefined) return err('Failed')
  }
  const d = await openLogExclusiveAppend(a, false, layout.createMode)
  if (!d.ok) {
    screened?.delete(a)
    if (d.error.kind !== 'absent') return d
    if (l) {
      const f = await ensureDirectoryTreeForPath(a, s, false)
      if (f !== undefined) return err('Failed')
    }
    return createOrAppendExclusiveLog(
      a,
      records,
      screened,
      layout.createMode,
      opts.singleName === true,
    )
  }
  const c = d.value
  if (
    !(screened !== undefined && isScreenedLogIdentity(screened, a, c.identity))
  ) {
    screened?.delete(a)
    const f = await validateOpenedLogAgainstPath(a, c, screened)
    if (f !== undefined) return closeOpenLogAsFailed(c)
  }
  if (opts.singleName === true && c.nlink > 1) return closeOpenLogAsFailed(c)
  return writePackedRecordsToHandle(c, records, false)
}

/** densable leftover `bu` @207353107. */
export async function appendRecordsByNamespace(
  key: Record<string, unknown>,
  layout: DigestStreamLayout,
  lockIdentity: string,
  records: DigestRecordInput[],
  rotation: { maxBytes: number; rotatedPath: string } | undefined,
  makeParent: boolean,
  screened: Map<string, DigestLogIdentity>,
  opts?: { ifExists?: boolean; nonEmpty?: boolean; singleName?: boolean },
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
    ends?: number[]
    createdStream?: boolean
  }>
> {
  return runSerializedByPath(lockIdentity, () =>
    key.namespace === 'history'
      ? historyAppendWithFileLock(layout, records, opts?.singleName === true)
      : key.namespace === 'sessionLog'
        ? sessionLogAppendExclusive(layout, records, {
            makeParent,
            screened,
            singleName: opts?.singleName === true,
          })
        : logAppendPackedViaAppendFile(layout, records, {
            rotation,
            makeParent,
            ifExists: opts?.ifExists,
            nonEmpty: opts?.nonEmpty,
            singleName: opts?.singleName,
          }),
  )
}

async function mkdirLogParentDir(logPath: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true })
}

/** densable leftover `Rg` @207387311. */
export async function plainLogAppendRecords(
  host: DigestHost,
  key: Record<string, unknown>,
  records: DigestRecordInput[],
  logPath: string,
  opts?: {
    singleName?: boolean
    precondition?: { type?: string; nonEmpty?: boolean }
  },
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
  }>
> {
  if (host.closed) return err('Unavailable')
  const i =
    validateStorageKey(key) ??
    validateAppendEntries(key, records) ??
    validateAppendOpts(opts) ??
    (getStreamFraming(key) === 'jsonl'
      ? validateJsonlStreamEntries(records)
      : validateLineAppendStreamEntries(records))
  if (i !== undefined) return { ok: false, error: { code: i.code } }
  const o = opts?.precondition?.type === 'ifExists'
  const a = opts?.precondition?.nonEmpty === true
  if (o && (key.namespace === 'history' || key.namespace === 'sessionLog')) {
    return err('InvalidArgument')
  }
  const pair = digestResolveCachedLayout(host, key, logPath)
  if (!pair) return err('InvalidArgument')
  const [layout, lockIdentity] = pair
  if (records.length > 0 && !o && shouldMakeParentDir(key)) {
    await mkdirLogParentDir(layout.log)
  }
  const l =
    records.length === 0
      ? ok({
          acks: [] as Array<{ seq: number; endSeq: number; recordId: string }>,
          ends: [] as number[],
          createdStream: false,
        })
      : await appendRecordsByNamespace(
          key,
          layout,
          lockIdentity,
          records,
          getDebugLogRotationConfig(host.roots, key, layout.log),
          shouldMakeParentDir(key),
          host.screenedSessionLogs,
          { ifExists: o, nonEmpty: a, singleName: opts?.singleName === true },
        )
  if (!l.ok) return l
  announceRgAppend(host, key, l.value)
  return ok({ acks: l.value.acks })
}

/** densable leftover `Rg` K @207388073 — created vs per-ack appended. */
function announceRgAppend(
  host: DigestHost,
  key: Record<string, unknown>,
  result: {
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
    ends?: number[]
    createdStream?: boolean
  },
): void {
  const d = result.ends?.at(-1)
  if (result.createdStream) {
    announceDigestChange(host, {
      kind: 'created',
      key,
      records: result.acks.map(f => [f.seq, f.recordId]),
      ...(d !== undefined && { end: d }),
    })
    return
  }
  for (const [f, p] of result.acks.entries()) {
    const g = result.ends?.[f]
    announceDigestChange(host, {
      kind: 'appended',
      key,
      seq: p.seq,
      recordId: p.recordId,
      ...(g !== undefined && { end: g }),
    })
  }
}

/** densable leftover `Xu` @207387311 — official `Q(e,r,()=>Xr?Rg:Eg)`. */
export async function storageAppendRecords(
  host: DigestHost,
  key: Record<string, unknown>,
  records: DigestRecordInput[],
  logPath: string,
  opts?: {
    singleName?: boolean
    precondition?: { type?: string; nonEmpty?: boolean }
  },
): Promise<
  StorageV5Result<{
    acks: Array<{ seq: number; endSeq: number; recordId: string }>
  }>
> {
  return withDigestKeyExpect(host, key, async () => {
    const result = isFramedDigestStreamKey(key)
      ? await plainLogAppendRecords(host, key, records, logPath, opts)
      : await digestAppendRecordsLocked(host, key, records, logPath, opts)
    if (!result.ok) return result
    return ok({ acks: result.value.acks })
  })
}

/** densable leftover `S` @207282858. */
function hashContentVersion(value: string | Uint8Array): string {
  const hash = (
    Bun.hash as typeof Bun.hash & {
      xxHash64: (input: string | Uint8Array) => bigint
    }
  ).xxHash64(value)
  return hash.toString(16).padStart(16, '0')
}

/** densable leftover `Fr` @207287802. */
async function writeAllBytesToHandle(
  handle: FileHandle,
  bytes: Uint8Array,
  position: number | null,
): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      position === null ? null : position + offset,
    )
    if (bytesWritten <= 0) {
      throw Object.assign(Error('write made no progress'), { code: 'EIO' })
    }
    offset += bytesWritten
  }
}

/** densable leftover `Ae` @207286901. */
async function chmodHandleIgnoreUnsupported(
  handle: FileHandle,
  mode: number,
): Promise<void> {
  try {
    await handle.chmod(mode)
  } catch (error) {
    if (!isUnsupportedFsOperation(error)) throw error
  }
}

/** densable leftover `Te` @207286901. */
async function fsyncHandleIgnoreUnsupported(handle: FileHandle): Promise<void> {
  try {
    await handle.sync()
  } catch (error) {
    if (!isUnsupportedFsOperation(error)) throw error
  }
}

/** densable leftover `Pr` @207287802. */
function canApplyExactFileMode(
  stats: { mode: number; uid: number },
  mode: number,
): boolean {
  if ((stats.mode & 4095) === mode) return true
  if (typeof process.geteuid !== 'function') return true
  const euid = process.geteuid()
  return euid === 0 || stats.uid === euid
}

type AtomicDisciplineWriteOpts = {
  keepMode?: boolean
  exactMode?: number
  createMode?: number
  flush?: boolean
  parentMode?: number
}

/**
 * densable leftover `Ur`=`R6c`=`Wn` @207286302.
 * `_`=`Pt` / `Le`=`Dt`. Default mode `B`=`L`=384.
 */
export async function atomicWriteStagedRename(
  logPath: string,
  value: string | Uint8Array,
  mode: number | undefined,
  makeParent: boolean,
  opts?: AtomicDisciplineWriteOpts,
): Promise<StorageV5Result<{ version: string }>> {
  let exact = opts?.exactMode
  if (exact === undefined && opts?.keepMode === true) {
    try {
      const st = await lstat(logPath)
      if (st.isFile()) exact = st.mode & 511
    } catch (error) {
      if (!isENOENT(error)) return err('Failed')
    }
  }
  const flush = opts?.flush === true
  const createMode = opts?.createMode
  const writeMode = mode ?? MODE_OWNER_RW
  const run = (): Promise<void> => {
    if (createMode !== undefined && exact === undefined) {
      return atomicWriteFile(logPath, value, { createMode, flush })
    }
    if (exact === undefined && !flush) {
      return atomicWriteFileWithMode(logPath, value, writeMode)
    }
    return atomicWriteFile(logPath, value, {
      mode: writeMode,
      exactMode: exact,
      flush,
    })
  }
  try {
    await run()
    return ok({ version: hashContentVersion(value) })
  } catch (error) {
    if (!isENOENT(error)) return err('Failed')
    if (!makeParent) return err('NotFound')
    try {
      await mkdir(dirname(logPath), {
        recursive: true,
        ...(opts?.parentMode !== undefined && { mode: opts.parentMode }),
      })
      await run()
      return ok({ version: hashContentVersion(value) })
    } catch (retryError) {
      if (isENOENT(retryError)) return err('NotFound')
      return err('Failed')
    }
  }
}

/**
 * densable leftover `Ol`=`S6c`=`$n` @207286901.
 * `ke`=`lr` on refuse; `te`=`open` + `ee`=0 on follow.
 */
export async function inPlaceWriteOpenTruncate(
  logPath: string,
  value: string | Uint8Array,
  symlinks: 'follow' | 'refuse' = 'follow',
  mode: number | undefined = MODE_ALL_RW,
  opts?: { exactMode?: number; flush?: boolean },
): Promise<StorageV5Result<{ version: string }>> {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value
  const exact = opts?.exactMode
  const createMode = exact ?? mode ?? MODE_ALL_RW
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT
  let handle: FileHandle | undefined
  try {
    if (symlinks === 'refuse') {
      const opened = await openRegularFile(logPath, flags, createMode)
      if (!opened.ok) {
        return opened.error.kind === 'absent' ? err('NotFound') : err('Failed')
      }
      handle = opened.value
    } else {
      handle = await open(logPath, flags, createMode)
    }
    const st = await handle.stat()
    if (!st.isFile() && !st.isCharacterDevice()) return err('Failed')
    const isFile = st.isFile()
    if (isFile && exact !== undefined && !canApplyExactFileMode(st, exact)) {
      return err('Failed')
    }
    await writeAllBytesToHandle(handle, bytes, isFile ? 0 : null)
    if (isFile && exact !== undefined)
      await chmodHandleIgnoreUnsupported(handle, exact)
    if (isFile && (st.size > bytes.byteLength || bytes.byteLength === 0)) {
      await handle.truncate(bytes.byteLength)
    }
    if (opts?.flush === true) await fsyncHandleIgnoreUnsupported(handle)
    return ok({ version: hashContentVersion(bytes) })
  } catch (error) {
    if (isENOENT(error)) return err('NotFound')
    return err('Failed')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/** densable leftover `Rr` @207288407 leftover-used `fr`/`yr`/`D`. */
async function resolveRealpathFallback(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * densable leftover `hr` @207288742. `_`=`Pt`.
 */
async function symlinkAwareStagedWrite(
  logPath: string,
  value: string | Uint8Array,
  symlinks: 'follow' | 'refuse',
  mode: number | undefined,
  flush: boolean,
  exactMode: number | undefined,
  refuseUnwritable: boolean,
): Promise<StorageV5Result<{ version: string }>> {
  let target = logPath
  if (symlinks === 'refuse') {
    try {
      const st = await lstat(logPath)
      if (st.isSymbolicLink()) return err('Failed')
    } catch (error) {
      if (!isENOENT(error)) return err('Failed')
    }
  } else {
    target = await resolveRealpathFallback(logPath)
    try {
      await stat(target)
    } catch (error) {
      if (!isENOENT(error)) return err('Failed')
    }
  }
  let unwritable = false
  if (refuseUnwritable) {
    try {
      const st = await stat(target)
      if (st.isFile()) {
        try {
          await access(target, fsConstants.W_OK)
        } catch (error) {
          if (!isENOENT(error)) return err('Failed')
          unwritable = true
        }
      }
    } catch (error) {
      if (!isENOENT(error)) return err('Failed')
    }
  }
  let resolvedExact = exactMode
  if (resolvedExact === undefined) {
    try {
      const st = await stat(target)
      if (st.isFile() && !unwritable) {
        resolvedExact = st.mode & (refuseUnwritable ? 511 : 4095)
      }
    } catch (error) {
      if (!isENOENT(error)) return err('Failed')
    }
  }
  try {
    await atomicWriteFile(target, value, {
      createMode: mode ?? MODE_ALL_RW,
      exactMode: resolvedExact,
      flush,
      followSymlinks: symlinks === 'follow',
      inPlaceOnTempCreateRefused: true,
    })
    return ok({ version: hashContentVersion(value) })
  } catch (error) {
    if (isENOENT(error)) return err('NotFound')
    return err('Failed')
  }
}

/**
 * densable leftover `Ma`=`U6c`=`Yn` @207288501 leftover-used official `x`.
 */
export async function symlinkAwareAtomicWrite(
  logPath: string,
  value: string | Uint8Array,
  symlinks: 'follow' | 'refuse',
  mode: number | undefined,
  opts?: {
    flush?: boolean
    makeParent?: boolean
    exactMode?: number
    parentMode?: number
    refuseUnwritable?: boolean
  },
): Promise<StorageV5Result<{ version: string }>> {
  const flush = opts?.flush ?? true
  const refuseUnwritable = opts?.refuseUnwritable ?? false
  const run = (): Promise<StorageV5Result<{ version: string }>> =>
    symlinkAwareStagedWrite(
      logPath,
      value,
      symlinks,
      mode,
      flush,
      opts?.exactMode,
      refuseUnwritable,
    )
  const first = await run()
  if (first.ok || first.error.code !== 'NotFound' || !opts?.makeParent) {
    return first
  }
  try {
    await mkdir(dirname(logPath), {
      recursive: true,
      ...(opts.parentMode !== undefined && { mode: opts.parentMode }),
    })
  } catch {
    return first
  }
  return run()
}

/** densable leftover `Hl` @207414790: Ur=Wn / Ol=$n / Ma=Yn@207288501. */
export async function dispatchDisciplineWrite(
  logPath: string,
  value: string | Uint8Array,
  dt: ResolvedWriteOpts,
): Promise<StorageV5Result<{ version: string }>> {
  switch (dt.discipline) {
    case 'atomic':
      return atomicWriteStagedRename(logPath, value, dt.mode, dt.makeParent, {
        keepMode: dt.keepMode,
        exactMode: dt.exactMode,
        createMode: dt.createMode,
        flush: dt.flush,
        parentMode: dt.parentMode,
      })
    case 'inPlace':
      return inPlaceWriteOpenTruncate(logPath, value, dt.symlinks, dt.mode, {
        exactMode: dt.exactMode,
        flush: dt.flush,
      })
    case 'followAtomic':
    case 'followDefault':
    case 'refuseDefault':
      return symlinkAwareAtomicWrite(logPath, value, dt.symlinks, dt.mode, {
        flush: dt.flush,
        makeParent: isMkdirParentDiscipline(dt.discipline) && dt.makeParent,
        exactMode: dt.exactMode,
        parentMode: dt.parentMode,
      })
    case 'rewriteDefault':
      return symlinkAwareAtomicWrite(logPath, value, dt.symlinks, dt.mode, {
        flush: dt.flush,
        makeParent: dt.makeParent,
        exactMode: dt.exactMode,
        parentMode: dt.parentMode,
        refuseUnwritable: true,
      })
    default:
      return atomicWriteStagedRename(logPath, value, dt.mode, dt.makeParent)
  }
}

/** densable leftover `Mt` @207414225. */
export async function publishFileByDiscipline(
  key: Record<string, unknown>,
  logPath: string,
  value: string | Uint8Array,
  dt: ResolvedWriteOpts,
): Promise<StorageV5Result<{ version: string }>> {
  const a = await dispatchDisciplineWrite(logPath, value, dt)
  if (
    !a.ok &&
    ((dt.discipline !== 'atomic' && dt.discipline !== 'rewriteDefault') ||
      !dt.makeParent) &&
    a.error.code === 'NotFound'
  ) {
    return err('NotFound')
  }
  return a
}

/** densable leftover `oy` @207413603 leftover-used. */
export async function publishFileSerialized(
  logPath: string,
  key: Record<string, unknown>,
  value: string | Uint8Array,
  dt: ResolvedWriteOpts,
  host?: DigestHost,
): Promise<StorageV5Result<{ version: string }>> {
  const run = (suspect?: () => boolean) => {
    if (suspect?.()) {
      // densable H("unknown",{telemetryCode:"LockSuspect"})
      return Promise.resolve(
        err('unknown', {
          telemetryCode: 'LockSuspect',
        }) as StorageV5Result<{ version: string }>,
      )
    }
    return publishFileByDiscipline(key, logPath, value, dt)
  }
  // densable: En/Kt when lockUnconditionalPublishes && discipline!=="inPlace"; else he.
  if (
    host?.lockUnconditionalPublishes === true &&
    dt.discipline !== 'inPlace'
  ) {
    const lockPath = resolveValuePublishLockPath(host.roots, key, logPath)
    const underLock = (): Promise<StorageV5Result<{ version: string }>> =>
      withValuePublishLock(host, key, lockPath, logPath, suspect =>
        run(suspect),
      )
    let result = await underLock()
    // densable oy: NotFound → ie(en(n), parentMode) → retry En when makeParent+Ua.
    if (!result.ok && result.error.code === 'NotFound') {
      if (!dt.makeParent || !isMkdirParentDiscipline(dt.discipline)) {
        return err('NotFound')
      }
      try {
        await mkdir(dirname(logPath), {
          recursive: true,
          ...(dt.parentMode !== undefined && { mode: dt.parentMode }),
        })
      } catch {
        return err('Failed')
      }
      result = await underLock()
    }
    return result
  }
  return runSerializedByPath(resolve(logPath), () => run())
}

/** densable leftover `sy` @207416249 leftover-used. */
export async function publishFileIfAbsent(
  logPath: string,
  key: Record<string, unknown>,
  value: string | Uint8Array,
  dt: ResolvedWriteOpts,
): Promise<StorageV5Result<{ version: string }>> {
  // Stat + publish under the same path queue so two concurrent callers cannot
  // both observe ENOENT and both report success after the second overwrite.
  return runSerializedByPath(resolve(logPath), async () => {
    try {
      await stat(logPath)
      return err('Failed')
    } catch (error) {
      if (!isENOENT(error)) return err('Failed')
    }
    return publishFileByDiscipline(key, logPath, value, dt)
  })
}

/** densable leftover `uy` @207416950 leftover-used. */
export async function publishFileIfPresent(
  logPath: string,
  key: Record<string, unknown>,
  value: string | Uint8Array,
  _version: string,
  dt: ResolvedWriteOpts,
): Promise<StorageV5Result<{ version: string }>> {
  return runSerializedByPath(resolve(logPath), async () => {
    try {
      await stat(logPath)
    } catch (error) {
      if (isENOENT(error)) return err('NotFound')
      return err('Failed')
    }
    return publishFileByDiscipline(key, logPath, value, dt)
  })
}

/** densable leftover `ja` @207412868 — official `Q` then `oy`/`sy`/`uy` + `K`. */
export async function publishFileWithPrecondition(
  logPath: string,
  key: Record<string, unknown>,
  value: string | Uint8Array,
  precondition: { type?: string; version?: string } | undefined,
  dt: ResolvedWriteOpts,
  host?: DigestHost,
): Promise<StorageV5Result<{ version: string }>> {
  if (!dt.makeParent) {
    try {
      await stat(dirname(logPath))
    } catch (error) {
      if (isENOENT(error)) return err('NotFound')
      return err('Failed')
    }
  } else if (isMkdirParentDiscipline(dt.discipline)) {
    await mkdir(dirname(logPath), { recursive: true })
  }
  return withDigestKeyExpect(host, key, async () => {
    if (precondition === undefined || precondition.type === 'none') {
      const published = await publishFileSerialized(
        logPath,
        key,
        value,
        dt,
        host,
      )
      // densable leftover `oy` @207414037 — success is always `updated`.
      if (published.ok) {
        announceDigestChange(host, {
          kind: 'updated',
          key,
          version: published.value.version,
          value,
        })
      }
      return published
    }
    if (precondition.type === 'ifAbsent') {
      const published = await publishFileIfAbsent(logPath, key, value, dt)
      // densable leftover `sy` @207416548 — success is `created`.
      if (published.ok) {
        announceDigestChange(host, {
          kind: 'created',
          key,
          version: published.value.version,
          value,
        })
      }
      return published
    }
    const published = await publishFileIfPresent(
      logPath,
      key,
      value,
      precondition.version ?? '',
      dt,
    )
    // densable leftover `uy` @207417393 — success is `updated`.
    if (published.ok) {
      announceDigestChange(host, {
        kind: 'updated',
        key,
        version: published.value.version,
        value,
      })
    }
    return published
  })
}

/** densable leftover `zl` @207412582 — `z/re/_e/Vi` then `ja`. */
export async function publishValidatedStorageFile(
  roots: DigestStorageRoots,
  key: Record<string, unknown>,
  logPath: string,
  value: string | Uint8Array,
  opts?: {
    mode?: number
    parent?: string
    publishDiscipline?: string
    precondition?: { type?: string; version?: string }
    exactMode?: number
    keepExistingMode?: boolean
    flush?: boolean
  },
  host?: DigestHost,
): Promise<StorageV5Result<{ version: string }>> {
  const i = validateWriteRequest(roots, key, value, opts)
  if (i !== undefined) return { ok: false, error: { code: i.code } }
  const o = await validateMarketplaceCacheSymlinks(roots, key, 'always')
  if (o !== undefined) return { ok: false, error: { code: o.code } }
  return publishFileWithPrecondition(
    logPath,
    key,
    value,
    opts?.precondition,
    resolveWriteOpts(key, opts),
    host,
  )
}

/** densable leftover `Qu` @207396685 — `Ve`→`lu`, else `Ot`. */
export async function getLogHeadStats(
  host: DigestHost,
  key: Record<string, unknown>,
  logPath: string,
): Promise<
  StorageV5Result<
    FramedStreamStat | { headSeq: number | null; recordCount: number }
  >
> {
  if (host.closed) return err('Unavailable')
  const i = validateStorageKey(key)
  if (i !== undefined) return { ok: false, error: { code: i.code } }
  if (isFramedDigestStreamKey(key)) {
    return countFramedStreamLu(host, key, logPath)
  }
  const layout = resolveDigestStreamLayout(host, key, logPath)
  if (!layout) return err('InvalidArgument')
  const t = await loadDigestIndex(host, layout)
  if (!t.ok) return t
  if (t.value === 'missing') return err('NotFound')
  return ok({
    headSeq: t.value.issuedSeq,
    recordCount: t.value.entries.filter(e => !e.tombstoned).length,
  })
}

/** densable leftover `Ju`/`Mg` @207394908 leftover-used. */
export async function tombstoneDigestRecords(
  host: DigestHost,
  key: Record<string, unknown>,
  logPath: string,
  recordIds: string[],
): Promise<StorageV5Result<{ matched: boolean[]; newly: string[] }>> {
  if (host.closed) return err('Unavailable')
  const i = validateStorageKey(key)
  if (i !== undefined) return { ok: false, error: { code: i.code } }
  if (isFramedDigestStreamKey(key)) return err('InvalidArgument')
  const layout = resolveDigestStreamLayout(host, key, logPath)
  if (!layout) return err('InvalidArgument')
  await ensureDigestStreamDirectory(layout)
  const loaded = await loadDigestIndex(host, layout)
  if (!loaded.ok) return loaded
  if (loaded.value === 'missing') {
    return ok({ matched: recordIds.map(() => false), newly: [] })
  }
  const d = loaded.value
  const matched = recordIds.map(h => d.byId.has(h))
  const newly = recordIds.filter(h => d.byId.get(h)?.tombstoned === false)
  if (newly.length === 0) return ok({ matched, newly })
  const p = await appendDigestIndexOpLine(
    layout,
    formatDigestTombstoneOpLine(newly),
  )
  if (!p.ok) return p
  digestInvalidateIndexCache(host, layout.directory)
  digestInvalidateVerifiedCache(host, layout.directory)
  return ok({ matched, newly })
}

/** densable leftover `Hn` — live (not tombstoned) entries. */
function filterLiveDigestEntries(index: DigestIndex): DigestIndexEntry[] {
  return index.entries.filter(e => !e.tombstoned)
}

/** densable leftover `Zo` @207332703. */
function buildPurgeTempPaths(
  layout: DigestStreamLayout,
  purgeId: string,
): { logTemporary: string; indexTemporary: string } {
  return {
    logTemporary: `${layout.log}.purge.${purgeId}.tmp`,
    indexTemporary: `${layout.index}.purge.${purgeId}.tmp`,
  }
}

/** densable leftover `dp` @207328900. */
function groupPackedEntriesBySeqRun(
  packed: Array<{ entry: DigestIndexEntry; bytes: Uint8Array }>,
): Array<{ priorLogEnd: number; entries: DigestIndexEntry[] }> {
  return packed.reduce<
    Array<{ priorLogEnd: number; entries: DigestIndexEntry[] }>
  >((r, { entry: n }) => {
    const last = r.at(-1)
    const tail = last?.entries.at(-1)
    if (last !== undefined && tail !== undefined && n.seq === tail.seq + 1) {
      last.entries.push(n)
    } else {
      r.push({ priorLogEnd: n.offset, entries: [n] })
    }
    return r
  }, [])
}

/**
 * densable leftover `Yd` @207327584 leftover-used Vo as write+rename.
 */
export async function compactTombstonedDigestLog(
  layout: DigestStreamLayout,
  index: DigestIndex,
): Promise<StorageV5Result<{ purged: number }>> {
  const live = filterLiveDigestEntries(index)
  const purged = index.entries.length - live.length
  if (purged === 0) return ok({ purged: 0 })
  const chunks = await readDigestLogByteRanges(
    layout.log,
    live.map(e => ({ offset: e.offset, length: e.length })),
  )
  if (!chunks.ok) return chunks
  const packed = assignDigestEntryOffsets(
    live.map((entry, i) => ({
      entry,
      bytes: chunks.value[i] ?? new Uint8Array(),
    })),
    0,
  )
  const purgeId = randomUUID()
  const { logTemporary, indexTemporary } = buildPurgeTempPaths(layout, purgeId)
  try {
    await mkdir(dirname(logTemporary), { recursive: true })
    await writeFile(
      logTemporary,
      Buffer.concat(packed.map(p => Buffer.from(p.bytes))),
      layout.createMode !== undefined ? { mode: layout.createMode } : undefined,
    )
    const ident = await digestLogIdentityAtPath(logTemporary)
    const header = formatDigestIndexHeaderLine(
      index.applyGeneration + 1,
      ident,
      index.issuedSeq,
      {
        applyGeneration: index.applyGeneration,
        indexBytes: index.indexBytes,
        logSize: packed.reduce((n, p) => n + p.entry.length, 0),
        ...(index.logIdentity !== undefined && {
          logIdentity: index.logIdentity,
        }),
      },
    )
    const body = groupPackedEntriesBySeqRun(packed)
      .map(g => formatDigestAppendOpLine(g.priorLogEnd, g.entries))
      .join('')
    await writeFile(indexTemporary, header + body)
    await writeFile(layout.marker, digestJsonStringify({ purgeId }))
    await rename(logTemporary, layout.log)
    await rename(indexTemporary, layout.index)
    return ok({ purged })
  } catch {
    await unlink(logTemporary).catch(() => undefined)
    await unlink(indexTemporary).catch(() => undefined)
    // Leave layout.marker if present: a half-published rename pair needs the
    // next syncDigestStream to notice and repair. Full success clears it in
    // purgeTombstonedDigestLog after this returns ok.
    return err('Failed')
  }
}

/**
 * densable leftover `Zu`/`Bg` @207396056.
 */
export async function purgeTombstonedDigestLog(
  host: DigestHost,
  key: Record<string, unknown>,
  logPath: string,
): Promise<StorageV5Result<{ purged: number }>> {
  if (host.closed) return err('Unavailable')
  const i = validateStorageKey(key)
  if (i !== undefined) return { ok: false, error: { code: i.code } }
  if (isFramedDigestStreamKey(key)) return err('InvalidArgument')
  const layout = resolveDigestStreamLayout(host, key, logPath)
  if (!layout) return err('InvalidArgument')
  return digestWithStreamLock(layout, async () => {
    await ensureDigestStreamDirectory(layout)
    const loaded = await loadDigestIndex(host, layout)
    if (!loaded.ok) return loaded
    if (loaded.value === 'missing') return err('NotFound')
    const live = filterLiveDigestEntries(loaded.value)
    const purged = loaded.value.entries.length - live.length
    if (purged === 0) return ok({ purged: 0 })
    const rewritten = await compactTombstonedDigestLog(layout, loaded.value)
    if (rewritten.ok) {
      digestInvalidateIndexCache(host, layout.directory)
      digestInvalidateVerifiedCache(host, layout.directory)
      // Consume the crash-recovery marker once the rewrite has published.
      // Leaving it would force every subsequent read through syncDigestStream.
      await unlink(layout.marker).catch(() => undefined)
    }
    return rewritten
  })
}

export type FramedStreamStamp = {
  generation: string | number
  size: number
  mtimeMs: number
}

export type FramedStreamEntry = {
  seq: number
  recordId: string
  offset: number
  length: number
  digest: string
  tombstoned: boolean
}

export type FramedStreamObserve =
  | 'missing'
  | 'unchanged'
  | {
      generation: string | number
      entries: FramedStreamEntry[]
      byteEnd: number
      stamp: FramedStreamStamp
    }
  | { unobservable: { code: string; telemetryCode?: string } }

/** densable leftover `mn` @207360287. */
const FRAMED_SCAN_MAX_RECORDS = 2_000_000
/** densable leftover `Gr` @207360246. */
const FRAMED_SCAN_CHUNK_BYTES = 4_194_304
/** densable leftover `kp` @207360312. */
const FRAMED_SCAN_RETRIES = 2
/** densable leftover `Rp` @207360330. */
const FRAMED_TAIL_HASH_BYTES = 4096
/** densable leftover `Sp` @207360338. */
const SCAN_COUNT_CACHE_CAP = 64
/** densable leftover `Kp` @207360353 — `hu` screened-sessionLog cap. */
const SCREENED_SESSION_LOG_CAP = 32
/** densable leftover `Pi` @207360261 — `gn` tail window. */
const FRAMED_LIVE_TAIL_CHUNK_BYTES = 65_536
/**
 * densable leftover `kr`=`K6c`=`Kn`=`E` @207293000 — `Ki`/`fu`/`gu` default
 * view budget. Barrel `K6c as kr`; `var E=268435456; Kn=E`.
 */
export const FRAMED_VIEW_BUDGET_BYTES = 268_435_456
/** densable leftover `St` @207360298 — `xp` `maxSingleReadBytes`. */
const FRAMED_MAX_SINGLE_READ_BYTES = 2_147_479_552
/** densable leftover `Le` @207227223 — `Xn` → Unavailable. */
const TRANSIENT_FS_CODES = new Set([
  'EAGAIN',
  'EBUSY',
  'EMFILE',
  'ENFILE',
  'ENOSPC',
  'EDQUOT',
  'ENOMEM',
])

type FramedUnobservable = {
  unobservable: { code: string; telemetryCode?: string }
}

/** densable leftover `cn` @207344553. */
function framedScanEntry(start: number, length: number): FramedStreamEntry {
  return {
    seq: start,
    recordId: String(start),
    offset: start,
    length,
    digest: '',
    tombstoned: false,
  }
}

/** densable leftover `C` @207230127 — identity usable. */
function inodeUsable(inode: bigint): boolean {
  return inode !== 0n && inode !== -1n && inode !== 0xffffffffffffffffn
}

/** densable leftover `ya` @207230254 — `mtimeNs` → ms. */
function mtimeNsToMs(ns: bigint): number {
  let sec = ns / 1_000_000_000n
  if (sec * 1_000_000_000n > ns) sec -= 1n
  return Number(sec) * 1000 + Number(ns - sec * 1_000_000_000n) / 1e6
}

/** densable leftover `Xn`/`Le` @207227146. */
function unobservableFromFs(error: unknown): FramedUnobservable {
  const telemetryCode = getErrnoCode(error)
  if (telemetryCode !== undefined && TRANSIENT_FS_CODES.has(telemetryCode)) {
    return { unobservable: { code: 'Unavailable', telemetryCode } }
  }
  return {
    unobservable: {
      code: 'Failed',
      ...(telemetryCode !== undefined && { telemetryCode }),
    },
  }
}

/** densable leftover `du` @207336147. */
async function retryWhile<T>(
  opts: { retries?: number } | undefined,
  run: () => Promise<T>,
  pred: (value: T) => boolean,
): Promise<T> {
  const retries = opts?.retries ?? FRAMED_SCAN_RETRIES
  for (let i = 0; ; i++) {
    const value = await run()
    if (!pred(value) || i >= retries) return value
  }
}

/** densable leftover `xi` @207336252. */
function isUnavailableEagain(value: FramedStreamObserve): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'unobservable' in value &&
    value.unobservable.code === 'Unavailable' &&
    value.unobservable.telemetryCode === 'EAGAIN'
  )
}

/** densable leftover `yr` / `Me`. */
function scanRecordBudgetError(): Error {
  return Object.assign(
    Error('refusing to scan a stream log past the record-count budget'),
    { code: 'EFBIG' },
  )
}

function scanShrinkError(): Error {
  return Object.assign(
    Error('stream log shrank under a scan read; retry reads fresh'),
    { code: 'EAGAIN' },
  )
}

/**
 * densable leftover `Ii` @207349789 — `chunkBytes??Gr`, `maxRecords??mn`.
 * `"frame"` collects `cn` rows; `"count"` only tallies (`wp`).
 */
async function framedScanIi(
  handle: FileHandle,
  size: number,
  opts?: {
    chunkBytes?: number
    maxRecords?: number
    mode?: 'frame' | 'count'
    from?: number
    priorLines?: number
  },
): Promise<
  | {
      ok: true
      entries: FramedStreamEntry[]
      liveBytes: number
      lastLineStart: number | null
      recordCount: number
    }
  | { ok: false; error: unknown }
> {
  const chunkBytes = opts?.chunkBytes ?? FRAMED_SCAN_CHUNK_BYTES
  const maxRecords = opts?.maxRecords ?? FRAMED_SCAN_MAX_RECORDS
  const collect = opts?.mode !== 'count'
  const entries: FramedStreamEntry[] = []
  let recordCount = opts?.priorLines ?? 0
  let liveBytes = opts?.from ?? 0
  let lineStart = opts?.from ?? 0
  let lastLineStart: number | null = null
  const start = opts?.from ?? 0
  const buf = Buffer.alloc(Math.min(chunkBytes, Math.max(0, size - start)) || 1)
  const single = size - start <= buf.length
  let pos = start
  while (pos < size) {
    const want = Math.min(buf.length, size - pos)
    let bytesRead: number
    try {
      ;({ bytesRead } = await handle.read(buf, 0, want, pos))
    } catch (error) {
      return { ok: false, error }
    }
    if (bytesRead === 0) return { ok: false, error: scanShrinkError() }
    let from = 0
    for (;;) {
      const nl = buf.indexOf(10, from)
      if (nl === -1 || nl >= bytesRead) break
      if (recordCount >= maxRecords) {
        return { ok: false, error: scanRecordBudgetError() }
      }
      const end = pos + nl
      if (collect) entries.push(framedScanEntry(lineStart, end + 1 - lineStart))
      recordCount += 1
      lastLineStart = lineStart
      liveBytes = end + 1
      lineStart = end + 1
      from = nl + 1
    }
    if (single && pos === start && bytesRead === want) {
      return { ok: true, entries, liveBytes, lastLineStart, recordCount }
    }
    pos += bytesRead
  }
  return { ok: true, entries, liveBytes, lastLineStart, recordCount }
}

type FramedOpenHandle = {
  handle: FileHandle
  identity: DigestLogIdentity
  nlink: number
  size: number
  mode: number
  mtimeMs: number
  birthtimeMs: number
}

type FramedOpenError =
  | { kind: 'absent' }
  | { kind: 'fs'; error?: unknown }
  | { kind: 'classified'; error?: unknown }

type FramedOpenResult =
  | { ok: true; value: FramedOpenHandle }
  | { ok: false; error: FramedOpenError }

/** densable leftover `Jn` @207359759. */
function framedViewBudgetError(): Error {
  return Object.assign(
    Error('refusing to materialize a stream view over the byte budget'),
    { code: 'EFBIG' },
  )
}

/** densable leftover `Or` @207360000 — rewritten / torn last byte. */
function framedRewriteError(): Error {
  return Object.assign(
    Error(
      'stream log was rewritten in place under a scan read; retry reads fresh',
    ),
    { code: 'EAGAIN' },
  )
}

/**
 * densable leftover `Ee` @207325879 — `ke`/`open` + bigint `ce` wrap.
 * Official `ip()` only forwards `read`/`stat`/`close`; leftover uses the
 * FileHandle. Official non-file is `ENXIO`.
 */
async function openRegularFramedEe(path: string): Promise<FramedOpenResult> {
  const opened = await openRegularFile(path, fsConstants.O_RDONLY)
  if (!opened.ok) return opened
  const handle = opened.value
  try {
    const info = await handle.stat({ bigint: true })
    if (!info.isFile()) {
      await handle.close().catch(() => undefined)
      return {
        ok: false,
        error: {
          kind: 'fs',
          error: Object.assign(Error('ENXIO'), { code: 'ENXIO' }),
        },
      }
    }
    return {
      ok: true,
      value: {
        handle,
        identity: toDigestLogIdentity(info),
        nlink: Number(info.nlink),
        size: Number(info.size),
        mode: Number(info.mode),
        mtimeMs: mtimeNsToMs(info.mtimeNs),
        birthtimeMs: mtimeNsToMs(info.birthtimeNs),
      },
    }
  } catch (error) {
    await handle.close().catch(() => undefined)
    return { ok: false, error: { kind: 'fs', error } }
  }
}

/** densable leftover `da` @207354200 — `te` + `ue`. */
function isScreenedSessionLogIdentity(
  screened: Map<string, DigestLogIdentity>,
  path: string,
  identity: DigestLogIdentity,
): boolean {
  return (
    inodeUsable(BigInt(identity.inode)) &&
    isSameDigestLogIdentity(screened.get(path), identity)
  )
}

/** densable leftover `hu` @207354250 — cap `Kp`. */
function rememberScreenedSessionLog(
  screened: Map<string, DigestLogIdentity>,
  path: string,
  identity: DigestLogIdentity,
): void {
  screened.delete(path)
  if (!inodeUsable(BigInt(identity.inode))) return
  screened.set(path, identity)
  if (screened.size > SCREENED_SESSION_LOG_CAP) {
    const first = screened.keys().next()
    if (!first.done) screened.delete(first.value)
  }
}

function hopsKind(kind: PathEnsureKind): FramedOpenError {
  return kind.kind === 'absent' ? { kind: 'absent' } : { kind: 'fs' }
}

/**
 * densable leftover `Ft` @207355400 — non-`sessionLog` is `Ee`.
 * `sessionLog` screens via leftover `$r` + `da`/`hu`. Official `j(n,le)`:
 * `le`=`tfd`=`be`=`"LeafMoved"` @205147919.
 */
export async function openFramedStreamFt(
  host: DigestHost,
  key: Record<string, unknown>,
  path: string,
): Promise<FramedOpenResult> {
  if (key.namespace !== 'sessionLog') return openRegularFramedEe(path)
  const screened = host.screenedSessionLogs
  const cached = screened.has(path)
  if (!cached) {
    const hops = await ensureDirectoryTreeForPath(path, undefined, false)
    if (hops !== undefined) return { ok: false, error: hopsKind(hops) }
  }
  const opened = await openRegularFramedEe(path)
  if (!opened.ok) {
    if (!cached) return opened
    screened.delete(path)
    const hops = await ensureDirectoryTreeForPath(path, undefined, false)
    return {
      ok: false,
      error: hops !== undefined ? hopsKind(hops) : opened.error,
    }
  }
  const handle = opened.value
  const fail = async (error: FramedOpenError): Promise<FramedOpenResult> => {
    await handle.handle.close().catch(() => undefined)
    return { ok: false, error }
  }
  if (cached && isScreenedSessionLogIdentity(screened, path, handle.identity)) {
    return opened
  }
  screened.delete(path)
  const hops = await ensureDirectoryTreeForPath(path, undefined, true)
  if (hops !== undefined) return fail(hopsKind(hops))
  try {
    const info = await lstat(path, { bigint: true })
    if (!isSameDigestLogIdentity(toDigestLogIdentity(info), handle.identity)) {
      return fail({
        kind: 'fs',
        error: Object.assign(Error('LeafMoved'), { code: 'LeafMoved' }),
      })
    }
  } catch (error) {
    if (!isENOENT(error)) return fail({ kind: 'fs', error })
    return fail({ kind: 'fs' })
  }
  if (handle.nlink === 1) {
    rememberScreenedSessionLog(screened, path, handle.identity)
  }
  return opened
}

function mapFramedOpenToObserve(opened: FramedOpenResult): FramedStreamObserve {
  if (opened.ok) {
    return { unobservable: { code: 'Failed' } }
  }
  if (opened.error.kind === 'absent') return 'missing'
  return unobservableFromFs(
    opened.error.kind === 'fs' ? opened.error.error : opened.error,
  )
}

function mapFramedOpenToResult(
  opened: FramedOpenResult,
): StorageV5Result<never> {
  if (opened.ok) return err('Failed')
  if (opened.error.kind === 'absent') return err('NotFound')
  return mappedScanErr(
    opened.error.kind === 'fs' ? opened.error.error : opened.error,
  )
}

/**
 * densable leftover `Li`=`Sr`=`P6c` @207285604 — range / tail clamp.
 */
export function framedReadRangeLi(
  req: { offset?: number; length?: number; tail?: number },
  liveBytes: number,
): { start: number; end: number } {
  if ('tail' in req && req.tail !== undefined) {
    return { start: Math.max(0, liveBytes - req.tail), end: liveBytes }
  }
  const offset = req.offset ?? 0
  return {
    start: Math.min(offset, liveBytes),
    end:
      req.length === undefined
        ? liveBytes
        : Math.min(offset + req.length, liveBytes),
  }
}

type FramedLiveTail = {
  liveBytes: number
  chunk: Buffer
  chunkStart: number
  chunkFilled: number
}

/** densable leftover `gn` @207340570. */
async function readFramedLiveTailGn(
  opened: FramedOpenHandle,
  opts?: { chunkBytes?: number },
): Promise<
  { ok: true; value: FramedLiveTail } | { ok: false; error: FramedOpenError }
> {
  const n = opts?.chunkBytes ?? FRAMED_LIVE_TAIL_CHUNK_BYTES
  const chunk = Buffer.allocUnsafe(Math.min(n, opened.size) || 1)
  let i = opened.size
  while (i > 0) {
    const o = Math.max(0, i - chunk.length)
    const a = i - o
    let bytesRead: number
    try {
      ;({ bytesRead } = await opened.handle.read(chunk, 0, a, o))
    } catch (error) {
      return { ok: false, error: { kind: 'fs', error } }
    }
    if (bytesRead < a) {
      return { ok: false, error: { kind: 'fs', error: scanShrinkError() } }
    }
    const l = chunk.lastIndexOf(10, a - 1)
    if (l !== -1) {
      return {
        ok: true,
        value: {
          liveBytes: o + l + 1,
          chunk,
          chunkStart: o,
          chunkFilled: a,
        },
      }
    }
    i = o
  }
  return {
    ok: true,
    value: { liveBytes: 0, chunk, chunkStart: 0, chunkFilled: 0 },
  }
}

/** densable leftover `cu` @207340220. */
async function readFramedSliceCu(
  opened: FramedOpenHandle,
  tail: FramedLiveTail | undefined,
  start: number,
  end: number,
): Promise<
  { ok: true; value: Buffer } | { ok: false; error: FramedOpenError }
> {
  const i = Buffer.allocUnsafe(end - start)
  if (
    tail !== undefined &&
    start >= tail.chunkStart &&
    end <= tail.chunkStart + tail.chunkFilled
  ) {
    tail.chunk.copy(i, 0, start - tail.chunkStart, end - tail.chunkStart)
    return { ok: true, value: i }
  }
  if (i.byteLength > 0) {
    let bytesRead: number
    try {
      ;({ bytesRead } = await opened.handle.read(i, 0, i.byteLength, start))
    } catch (error) {
      return { ok: false, error: { kind: 'fs', error } }
    }
    if (bytesRead < i.byteLength) {
      return { ok: false, error: { kind: 'fs', error: scanShrinkError() } }
    }
  }
  return { ok: true, value: i }
}

export type FramedRangeRead = {
  bytes: Uint8Array
  version: string
  totalBytes: number
  mtimeMs: number
}

/**
 * densable leftover `xp` @2073428xx — `gn`/`Li`/`cu`; torn last byte → `Or`.
 */
async function readFramedRangeXp(
  opened: FramedOpenHandle,
  req: { offset?: number; length?: number; tail?: number },
  viewBudget: number,
  opts?: { chunkBytes?: number; maxSingleReadBytes?: number },
): Promise<
  { ok: true; value: FramedRangeRead } | { ok: false; error: FramedOpenError }
> {
  const tail = await readFramedLiveTailGn(opened, opts)
  if (!tail.ok) return tail
  const { liveBytes } = tail.value
  const { start, end } = framedReadRangeLi(req, liveBytes)
  const maxRead = opts?.maxSingleReadBytes ?? FRAMED_MAX_SINGLE_READ_BYTES
  if (end - start > Math.min(viewBudget, maxRead)) {
    return {
      ok: false,
      error: { kind: 'classified', error: framedViewBudgetError() },
    }
  }
  const slice = await readFramedSliceCu(opened, tail.value, start, end)
  if (!slice.ok) return slice
  const bytes = slice.value
  if (
    bytes.byteLength > 0 &&
    end === liveBytes &&
    bytes[bytes.byteLength - 1] !== 10
  ) {
    return { ok: false, error: { kind: 'fs', error: framedRewriteError() } }
  }
  return {
    ok: true,
    value: {
      bytes: new Uint8Array(bytes),
      totalBytes: liveBytes,
      mtimeMs: opened.mtimeMs,
      version: framedScanVersion(
        {
          device: BigInt(opened.identity.device),
          inode: BigInt(opened.identity.inode),
        },
        liveBytes,
        opened.mtimeMs,
      ),
    },
  }
}

/**
 * densable leftover `gu`/`Op` @207342738 — `uu` → `Ft` → `xp`.
 */
export async function readFramedRangeGu(
  host: DigestHost,
  key: Record<string, unknown>,
  path: string,
  req: { offset?: number; length?: number; tail?: number },
  viewBudget: number = FRAMED_VIEW_BUDGET_BYTES,
  opts?: { chunkBytes?: number; maxSingleReadBytes?: number; retries?: number },
): Promise<
  { ok: true; value: FramedRangeRead } | { ok: false; error: FramedOpenError }
> {
  return retryWhile(
    opts,
    async () => {
      const opened = await openFramedStreamFt(host, key, path)
      if (!opened.ok) return opened
      try {
        return await readFramedRangeXp(opened.value, req, viewBudget, opts)
      } finally {
        await opened.value.handle.close().catch(() => undefined)
      }
    },
    value =>
      !value.ok &&
      value.error.kind === 'fs' &&
      getErrnoCode(value.error.error) === 'EAGAIN',
  )
}

export type ValueReadBytes = {
  bytes: Uint8Array
  size: number
  mtimeMs: number
  createdMs?: number
  version?: string
}

/**
 * densable leftover `dr` @207228280 — classified fs messages for `ue`.
 */
function classifyValueFsMessageDr(code: string): Error {
  switch (code) {
    case 'ELOOP':
      return Error('refusing a symlinked path')
    case 'ENXIO':
      return Error('refusing a non-regular file')
    case 'EISDIR':
      return Error('refusing a directory at the leaf')
    case 'ENOTDIR':
      return Error('refusing a non-directory node on a write path')
    case 'EFBIG':
      return Error('refusing a file over the size cap')
    case 'OtherNames':
      return Error('refusing a value that has a second name (hard link)')
    case 'LeafMoved':
      return Error(
        'refusing a value whose opened object is no longer at its key',
      )
    case 'HardeningUnavailable':
      return Error('refusing a hardened read the host cannot verify')
    default:
      return Error(code)
  }
}

/**
 * densable leftover `ue`=`e8c` @207228190 — `Object.assign(dr(n),{code,path})`.
 */
function wrapValueFsErrorUe(path: string, code: string): Error {
  return Object.assign(classifyValueFsMessageDr(code), { code, path })
}

/**
 * densable leftover `we`=`ga`=`f8c` @207228251 — `ue(e,oe)`,
 * `oe`=`qfd`=`ye`=`"OtherNames"`.
 */
function hardLinkValueErrorWe(path: string): FramedOpenError {
  return { kind: 'fs', error: wrapValueFsErrorUe(path, 'OtherNames') }
}

type ValueIdentityStat = {
  ino: bigint
  dev: bigint
  nlink: bigint
  isFile(): boolean
}

type ValueIdentityCheck =
  | { ok: true; value: true | false | 'unavailable' | 'otherNames' }
  | { ok: false; error: FramedOpenError }

/**
 * densable leftover `u` @207226400 — ENOENT/ENOTDIR → absent.
 */
async function wrapValueFsOp<T>(
  op: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: FramedOpenError }> {
  try {
    return { ok: true, value: await op }
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ok: false, error: { kind: 'absent' } }
    }
    return { ok: false, error: { kind: 'fs', error } }
  }
}

/**
 * densable leftover `ve` @207229681 — path lstat vs opened fstat.
 */
function sameValueIdentityVe(
  pathStat:
    | { ok: true; value: ValueIdentityStat }
    | { ok: false; error: FramedOpenError },
  opened: ValueIdentityStat,
): ValueIdentityCheck {
  if (!pathStat.ok) {
    return pathStat.error.kind === 'absent'
      ? { ok: true, value: false }
      : pathStat
  }
  if (!pathStat.value.isFile()) return { ok: true, value: false }
  if (
    !inodeUsable(opened.ino) ||
    !inodeUsable(pathStat.value.ino) ||
    opened.nlink === 0n ||
    pathStat.value.nlink === 0n
  ) {
    return { ok: true, value: 'unavailable' }
  }
  return {
    ok: true,
    value:
      pathStat.value.ino === opened.ino && pathStat.value.dev === opened.dev,
  }
}

/**
 * densable leftover `He`/`gr`=`i8c` @207230022 — first call pins
 * `available=!1`. `/proc/self/fd` only runs when a host already set true.
 */
const procFdCapabilityGr: { available?: boolean } = {}

async function probeProcFdAvailableGr(): Promise<
  { ok: true; value: boolean } | { ok: false; error: FramedOpenError }
> {
  if (procFdCapabilityGr.available !== undefined) {
    return { ok: true, value: procFdCapabilityGr.available }
  }
  procFdCapabilityGr.available = false
  return { ok: true, value: false }
}

/**
 * densable leftover `Se`=`ma`=`h8c` @207228950 — `gr` then `/proc/self/fd`
 * or portable `ve` + `realpath(dirname)`.
 */
async function confirmHardenedValueIdentitySe(
  handle: FileHandle,
  hardened: string,
): Promise<ValueIdentityCheck> {
  const cap = await probeProcFdAvailableGr()
  if (!cap.ok) return cap
  if (cap.value) {
    const linked = await wrapValueFsOp(readlink(`/proc/self/fd/${handle.fd}`))
    if (linked.ok) {
      return {
        ok: true,
        value:
          !linked.value.endsWith(' (deleted)') && linked.value === hardened,
      }
    }
    if (
      linked.error.kind === 'fs' &&
      TRANSIENT_FS_CODES.has(getErrnoCode(linked.error.error) ?? '')
    ) {
      return linked
    }
    return {
      ok: true,
      value:
        linked.error.kind === 'fs' &&
        getErrnoCode(linked.error.error) === 'ENAMETOOLONG'
          ? false
          : 'unavailable',
    }
  }
  const [pathStat, opened] = await Promise.all([
    wrapValueFsOp(lstat(hardened, { bigint: true })),
    wrapValueFsOp(handle.stat({ bigint: true })),
  ])
  if (!opened.ok) return opened
  const first = sameValueIdentityVe(pathStat, opened.value)
  if (!first.ok || first.value !== true) return first
  const parent = await wrapValueFsOp(realpath(dirname(hardened)))
  if (!parent.ok) {
    return parent.error.kind === 'absent' ? { ok: true, value: false } : parent
  }
  if (parent.value !== dirname(hardened)) return { ok: true, value: false }
  const again = await wrapValueFsOp(lstat(hardened, { bigint: true }))
  const second = sameValueIdentityVe(again, opened.value)
  if (!second.ok || second.value !== true) return second
  return (pathStat.ok && pathStat.value.nlink > 1n) ||
    (again.ok && again.value.nlink > 1n) ||
    opened.value.nlink > 1n
    ? { ok: true, value: 'otherNames' }
    : { ok: true, value: true }
}

/**
 * densable leftover `Me` @207282930 — refuse/`ke` or follow `open`;
 * hardened `n` uses leftover `Fe`=`gr` then `le`=`LeafMoved` when
 * `join(realpath(dirname), basename)` mismatches. After open: `we` on
 * `nlink>1`, `Y` on `nlink===0`, leftover `Se`=`ma`.
 */
async function openValueReadMe<T>(
  path: string,
  policy: 'follow' | 'refuse',
  hardened: string | undefined,
  read: (
    handle: FileHandle,
    first: {
      size: number
      mtimeMs: number
      birthtimeMs: number
      mtimeNs: bigint
      ctimeNs: bigint
    },
  ) => Promise<{ ok: true; value: T } | { ok: false; error: FramedOpenError }>,
): Promise<{ ok: true; value: T } | { ok: false; error: FramedOpenError }> {
  if (hardened !== undefined) {
    const cap = await probeProcFdAvailableGr()
    if (!cap.ok) return cap
    if (!cap.value) {
      try {
        const st = await lstat(path)
        if (st.isSymbolicLink()) {
          return {
            ok: false,
            error: { kind: 'fs', error: wrapValueFsErrorUe(path, 'ELOOP') },
          }
        }
        const parent = await realpath(dirname(path))
        if (join(parent, basename(path)) !== hardened) {
          return {
            ok: false,
            error: {
              kind: 'fs',
              error: wrapValueFsErrorUe(path, 'LeafMoved'),
            },
          }
        }
      } catch (error) {
        if (!isENOENT(error)) return { ok: false, error: { kind: 'fs', error } }
      }
    }
  }
  const opened =
    policy === 'refuse' || hardened !== undefined
      ? await openRegularFile(path, fsConstants.O_RDONLY)
      : await open(path, fsConstants.O_RDONLY)
          .then(handle => ({ ok: true as const, value: handle }))
          .catch(error =>
            isENOENT(error)
              ? { ok: false as const, error: { kind: 'absent' as const } }
              : {
                  ok: false as const,
                  error: { kind: 'fs' as const, error },
                },
          )
  if (!opened.ok) return opened
  const handle = opened.value
  try {
    const info = await handle.stat({ bigint: true })
    if (!info.isFile()) {
      return {
        ok: false,
        error: { kind: 'fs', error: wrapValueFsErrorUe(path, 'ENXIO') },
      }
    }
    if (hardened !== undefined) {
      if (info.nlink > 1) {
        return { ok: false, error: hardLinkValueErrorWe(path) }
      }
      if (info.nlink === 0n) {
        return {
          ok: false,
          error: {
            kind: 'fs',
            error: wrapValueFsErrorUe(path, 'HardeningUnavailable'),
          },
        }
      }
      const confirmed = await confirmHardenedValueIdentitySe(handle, hardened)
      if (!confirmed.ok) return confirmed
      if (confirmed.value !== true) {
        const code =
          confirmed.value === 'unavailable'
            ? 'HardeningUnavailable'
            : confirmed.value === 'otherNames'
              ? 'OtherNames'
              : 'LeafMoved'
        return {
          ok: false,
          error: { kind: 'fs', error: wrapValueFsErrorUe(path, code) },
        }
      }
    }
    return await read(handle, {
      size: Number(info.size),
      mtimeMs: mtimeNsToMs(info.mtimeNs),
      birthtimeMs: mtimeNsToMs(info.birthtimeNs),
      mtimeNs: info.mtimeNs,
      ctimeNs: info.ctimeNs,
    })
  } catch (error) {
    return { ok: false, error: { kind: 'fs', error } }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * densable leftover `Pl`=`jn`=`Q6c` @207285604 — `Me` + `Li`/`Sr` + budget `E`.
 */
export async function readValueRangePl(
  path: string,
  policy: 'follow' | 'refuse',
  req: { offset?: number; length?: number; tail?: number },
  hardened?: string,
): Promise<
  { ok: true; value: ValueReadBytes } | { ok: false; error: FramedOpenError }
> {
  return openValueReadMe(path, policy, hardened, async (handle, first) => {
    const { size, mtimeMs, birthtimeMs: createdMs } = first
    const { start, end } = framedReadRangeLi(req, size)
    if (end - start > FRAMED_VIEW_BUDGET_BYTES) {
      return {
        ok: false,
        error: { kind: 'classified', error: framedViewBudgetError() },
      }
    }
    const bytes = new Uint8Array(end - start)
    let m = 0
    while (m < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        m,
        bytes.byteLength - m,
        start + m,
      )
      if (bytesRead === 0) break
      m += bytesRead
    }
    return {
      ok: true,
      value: {
        bytes: m === bytes.byteLength ? bytes : bytes.slice(0, m),
        size,
        mtimeMs,
        createdMs,
      },
    }
  })
}

/**
 * densable leftover `se`=`Gn`=`N6c` @207283900 — `Me` + `Er`/`wr` + budget `E`.
 */
export async function readValueWholeSe(
  path: string,
  policy: 'follow' | 'refuse',
  hardened?: string,
): Promise<
  { ok: true; value: ValueReadBytes } | { ok: false; error: FramedOpenError }
> {
  return openValueReadMe(path, policy, hardened, async (handle, first) => {
    const { size, mtimeMs, birthtimeMs: createdMs } = first
    if (size > FRAMED_VIEW_BUDGET_BYTES) {
      return {
        ok: false,
        error: { kind: 'classified', error: framedViewBudgetError() },
      }
    }
    const raw = await handle.readFile()
    let bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    const again = await handle.stat({ bigint: true })
    // densable leftover inner `kr(e,r)` @207284778: size|mtimeNs|ctimeNs.
    const drifted =
      Number(again.size) !== first.size ||
      again.mtimeNs !== first.mtimeNs ||
      again.ctimeNs !== first.ctimeNs ||
      again.size !== BigInt(bytes.byteLength)
    if (drifted) {
      if (Number(again.size) > FRAMED_VIEW_BUDGET_BYTES) {
        return {
          ok: false,
          error: { kind: 'classified', error: framedViewBudgetError() },
        }
      }
      const grown = await handle.readFile()
      bytes = new Uint8Array(grown.buffer, grown.byteOffset, grown.byteLength)
    }
    if (bytes.byteLength > FRAMED_VIEW_BUDGET_BYTES) {
      return {
        ok: false,
        error: { kind: 'classified', error: framedViewBudgetError() },
      }
    }
    return {
      ok: true,
      value: {
        bytes,
        size: bytes.byteLength,
        mtimeMs,
        createdMs,
        version: hashContentVersion(bytes),
      },
    }
  })
}

/**
 * densable leftover `Ou` @207359054 — `xi` → `Ft`/`Ee`/`te` → `Ii(..., "frame")`.
 */
export async function observeFramedStreamOu(
  host: DigestHost,
  key: Record<string, unknown>,
  path: string,
  stamp?: FramedStreamStamp,
): Promise<FramedStreamObserve> {
  return retryWhile(
    undefined,
    () => observeFramedStreamOnce(host, key, path, stamp),
    value => isUnavailableEagain(value),
  )
}

async function observeFramedStreamOnce(
  host: DigestHost,
  key: Record<string, unknown>,
  path: string,
  stamp?: FramedStreamStamp,
): Promise<FramedStreamObserve> {
  const opened = await openFramedStreamFt(host, key, path)
  if (!opened.ok) return mapFramedOpenToObserve(opened)
  const handle = opened.value.handle
  try {
    const identity = {
      device: BigInt(opened.value.identity.device),
      inode: BigInt(opened.value.identity.inode),
    }
    const usable = inodeUsable(identity.inode)
    const generation = usable
      ? `scan:${String(identity.device)}:${String(identity.inode)}`
      : -1
    const size = opened.value.size
    const mtimeMs = opened.value.mtimeMs
    if (
      usable &&
      stamp !== undefined &&
      stamp.generation === generation &&
      stamp.size === size &&
      stamp.mtimeMs === mtimeMs
    ) {
      return 'unchanged'
    }
    const scanned = await framedScanIi(handle, size)
    if (!scanned.ok) {
      if (isENOENT(scanned.error)) return 'missing'
      return unobservableFromFs(scanned.error)
    }
    return {
      generation,
      entries: scanned.entries,
      byteEnd: scanned.liveBytes,
      stamp: { generation, size, mtimeMs },
    }
  } catch (error) {
    if (isENOENT(error)) return 'missing'
    return unobservableFromFs(error)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export type FramedStreamStat = {
  headSeq: number | null
  recordCount: number
  version: string
  size: number
  tornTailBytes: number
}

/** densable leftover `yn` @207340982. */
function framedScanVersion(
  identity: { device: bigint; inode: bigint },
  liveBytes: number,
  mtimeMs: number,
): string {
  return `scan:${identity.device}:${identity.inode}:${liveBytes}:${mtimeMs}`
}

/** densable leftover `Jd` @207338619. */
function rememberScanCount(
  host: DigestHost,
  path: string,
  row: ScanCountCacheEntry,
): void {
  host.scanCountCache.delete(path)
  host.scanCountCache.set(path, row)
  if (host.scanCountCache.size > SCAN_COUNT_CACHE_CAP) {
    const first = host.scanCountCache.keys().next()
    if (!first.done) host.scanCountCache.delete(first.value)
  }
}

/** densable leftover `Qo` @207338193 — tail `xr` / leftover `S`. */
async function hashFramedTail(
  handle: FileHandle,
  liveBytes: number,
): Promise<{ ok: true; value: string } | { ok: false; error: unknown }> {
  const start = Math.max(0, liveBytes - FRAMED_TAIL_HASH_BYTES)
  const length = liveBytes - start
  if (length === 0)
    return { ok: true, value: hashContentVersion(new Uint8Array()) }
  const buf = Buffer.alloc(length)
  try {
    const read = await handle.read(buf, 0, length, start)
    if (read.bytesRead < length) return { ok: false, error: scanShrinkError() }
  } catch (error) {
    return { ok: false, error }
  }
  return { ok: true, value: hashContentVersion(buf) }
}

function mappedScanErr(error: unknown): StorageV5Result<never> {
  const mapped = unobservableFromFs(error)
  return err(mapped.unobservable.code, {
    telemetryCode: mapped.unobservable.telemetryCode,
  })
}

function isXiRetryResult(value: StorageV5Result<unknown>): boolean {
  return (
    !value.ok &&
    value.error.code === 'Unavailable' &&
    value.error.telemetryCode === 'EAGAIN'
  )
}

/** densable leftover `uu` @207336359. */
function isUuFsEagain(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    (error as { kind?: string }).kind === 'fs' &&
    getErrnoCode((error as { error?: unknown }).error) === 'EAGAIN'
  )
}

/** densable leftover `ea` @207338429. */
function framedCountView(
  size: number,
  identity: { device: bigint; inode: bigint },
  mtimeMs: number,
  counted: {
    lines: number
    lastLineStart: number | null
    countedLiveBytes: number
  },
): FramedStreamStat {
  return {
    headSeq: counted.lastLineStart,
    recordCount: counted.lines,
    version: framedScanVersion(identity, counted.countedLiveBytes, mtimeMs),
    size: counted.countedLiveBytes,
    tornTailBytes: size - counted.countedLiveBytes,
  }
}

/**
 * densable leftover `wp` @207336677 — `Ft`/`Ee` + cache/`Qo`/`Fp` + `Ii(...,"count")`.
 */
async function countFramedStreamWp(
  host: DigestHost,
  key: Record<string, unknown>,
  path: string,
): Promise<StorageV5Result<FramedStreamStat>> {
  const opened = await openFramedStreamFt(host, key, path)
  if (!opened.ok) return mapFramedOpenToResult(opened)
  const handle = opened.value.handle
  try {
    const identity = {
      device: BigInt(opened.value.identity.device),
      inode: BigInt(opened.value.identity.inode),
    }
    const size = opened.value.size
    const mtimeMs = opened.value.mtimeMs
    const cached = host.scanCountCache.get(path)
    const same =
      cached !== undefined &&
      inodeUsable(identity.inode) &&
      cached.device === identity.device &&
      cached.inode === identity.inode
    if (same && cached.sizeAt === size && cached.mtimeAt === mtimeMs) {
      if (cached.lines > FRAMED_SCAN_MAX_RECORDS) {
        return mappedScanErr(scanRecordBudgetError())
      }
      rememberScanCount(host, path, cached)
      return ok(framedCountView(size, identity, mtimeMs, cached))
    }
    if (same && size > cached.sizeAt) {
      const tail = await hashFramedTail(handle, cached.countedLiveBytes)
      if (!tail.ok) return mappedScanErr(tail.error)
      if (tail.value === cached.tailHash) {
        const added = await framedScanIi(handle, size, {
          mode: 'count',
          from: cached.countedLiveBytes,
          priorLines: cached.lines,
        })
        if (!added.ok) return mappedScanErr(added.error)
        const liveBytes =
          added.recordCount === cached.lines
            ? cached.countedLiveBytes
            : added.liveBytes
        let nextHash = cached.tailHash
        if (added.recordCount > cached.lines) {
          const hashed = await hashFramedTail(handle, liveBytes)
          if (!hashed.ok) return mappedScanErr(hashed.error)
          nextHash = hashed.value
        }
        const row: ScanCountCacheEntry = {
          device: identity.device,
          inode: identity.inode,
          sizeAt: size,
          mtimeAt: mtimeMs,
          countedLiveBytes: liveBytes,
          lines: added.recordCount,
          lastLineStart:
            added.recordCount === cached.lines
              ? cached.lastLineStart
              : added.lastLineStart,
          tailHash: nextHash,
        }
        if (row.lines > FRAMED_SCAN_MAX_RECORDS) {
          return mappedScanErr(scanRecordBudgetError())
        }
        rememberScanCount(host, path, row)
        return ok(framedCountView(size, identity, mtimeMs, row))
      }
    }
    const counted = await framedScanIi(handle, size, { mode: 'count' })
    if (!counted.ok) return mappedScanErr(counted.error)
    const row = {
      countedLiveBytes: counted.liveBytes,
      lines: counted.recordCount,
      lastLineStart: counted.lastLineStart,
    }
    if (inodeUsable(identity.inode)) {
      const hashed = await hashFramedTail(handle, counted.liveBytes)
      if (!hashed.ok) return mappedScanErr(hashed.error)
      rememberScanCount(host, path, {
        ...row,
        device: identity.device,
        inode: identity.inode,
        sizeAt: size,
        mtimeAt: mtimeMs,
        tailHash: hashed.value,
      })
    }
    return ok(framedCountView(size, identity, mtimeMs, row))
  } catch (error) {
    if (isENOENT(error)) return err('NotFound')
    return mappedScanErr(error)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** densable leftover `lu` @207336451 — `xi` → `wp`. */
export async function countFramedStreamLu(
  host: DigestHost,
  key: Record<string, unknown>,
  path: string,
): Promise<StorageV5Result<FramedStreamStat>> {
  return retryWhile(
    undefined,
    () => countFramedStreamWp(host, key, path),
    value => isXiRetryResult(value),
  )
}

/**
 * densable leftover `fu`/`Lp` @207341329 — `uu` → whole framed read.
 */
export async function readFramedStreamFu(
  host: DigestHost,
  key: Record<string, unknown>,
  path: string,
): Promise<
  | { bytes: Uint8Array; version: string; size: number; mtimeMs: number }
  | undefined
> {
  const ran = await retryWhile(
    undefined,
    () => readFramedStreamLp(host, key, path),
    value => value === 'eagain',
  )
  return ran === 'eagain' || ran === 'absent' || ran === 'failed'
    ? undefined
    : ran
}

async function readFramedStreamLp(
  host: DigestHost,
  key: Record<string, unknown>,
  path: string,
): Promise<
  | { bytes: Uint8Array; version: string; size: number; mtimeMs: number }
  | 'absent'
  | 'failed'
  | 'eagain'
> {
  const opened = await openFramedStreamFt(host, key, path)
  if (!opened.ok) {
    if (opened.error.kind === 'absent') return 'absent'
    return isUuFsEagain(opened.error) ? 'eagain' : 'failed'
  }
  const handle = opened.value.handle
  try {
    const identity = {
      device: BigInt(opened.value.identity.device),
      inode: BigInt(opened.value.identity.inode),
    }
    const size = opened.value.size
    const mtimeMs = opened.value.mtimeMs
    const counted = await framedScanIi(handle, size, { mode: 'count' })
    if (!counted.ok) {
      if (isENOENT(counted.error)) return 'absent'
      return getErrnoCode(counted.error) === 'EAGAIN' ? 'eagain' : 'failed'
    }
    let bytes = new Uint8Array(0)
    if (counted.liveBytes > 0) {
      const buf = Buffer.alloc(counted.liveBytes)
      const read = await handle.read(buf, 0, counted.liveBytes, 0)
      if (read.bytesRead < counted.liveBytes) {
        return getErrnoCode(scanShrinkError()) === 'EAGAIN'
          ? 'eagain'
          : 'failed'
      }
      bytes = new Uint8Array(buf)
    }
    return {
      bytes,
      version: framedScanVersion(identity, bytes.byteLength, mtimeMs),
      size: bytes.byteLength,
      mtimeMs,
    }
  } catch (error) {
    if (isENOENT(error)) return 'absent'
    return getErrnoCode(error) === 'EAGAIN' ? 'eagain' : 'failed'
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** densable leftover `Ob` @207547246 — `or` → `Ou`, else `Ot`. */
export async function observeDigestIndexState(
  host: DigestHost,
  key: Record<string, unknown>,
  logPath: string,
  stamp?: FramedStreamStamp,
): Promise<
  | { generation: number; entries: DigestIndexEntry[] }
  | FramedStreamObserve
  | { unobservable: { code: string } }
> {
  if (key.namespace === 'history' || key.namespace === 'transcript') {
    return observeFramedStreamOu(host, key, logPath, stamp)
  }
  const layout = resolveDigestStreamLayout(host, key, logPath)
  if (!layout) return { unobservable: { code: 'InvalidArgument' } }
  const t = await loadDigestIndex(host, layout)
  if (!t.ok) return { unobservable: t.error }
  return t.value === 'missing'
    ? 'missing'
    : { generation: t.value.applyGeneration, entries: t.value.entries }
}
