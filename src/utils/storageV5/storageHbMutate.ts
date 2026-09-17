/**
 * densable hb extras leftover-wired:
 * `Fc` @207445806 / `ds` @207446172 / `gk` @207453997 / `yk` @207454870,
 * `pf` @207462778 / `yf` @207464676 / `kf` @207465286,
 * `Ds` @207517338 / `km` @207521788 / `Jf` @207502320 / `Zf` @207504036,
 * `Pf` @207480971 / `Lf` @207480654 / `Of` @207481306 / `xf` @207481748.
 * Official `I` in this family is stream (`Oi` / `getStreamFraming`).
 * Official `Q` is the leftover publish lock. `hc`/`Ev`/`bv`/`sv` share
 * graphs stay leftover-faithful (realpath classify + publish/rename).
 */

import { randomBytes } from 'crypto'
import {
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { dirname, isAbsolute, relative, sep } from 'path'
import { isENOENT } from '../errors.js'
import { resolveScopeListDirectories } from './listEntriesZa.js'
import {
  publishValidatedStorageFile,
  readValueWholeSe,
  type DigestHost,
} from './digestLog.js'
import {
  getReadSymlinkClass,
  getScopeFieldSpecs,
  getStreamFraming,
  shouldMakeParentDir,
  validateAppendEntries,
  validateBridgeSpawnRoot,
  validateJsonlStreamEntries,
  validateMarketplaceCacheReadOnly,
  validateMarketplaceCacheSymlinks,
  validateParentOpt,
  validatePreconditionDiscipline,
  validatePreconditionOpt,
  validatePublishDisciplineOpt,
  validateStorageKey,
  validateStorageScope,
  validateWriteMiscOpts,
  type WriteValidateErr,
} from './writeValidate.js'

export type StorageHbResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: { code: string; argument?: string; telemetryCode?: string }
    }

export type HbMutateHost = {
  closed: boolean
  roots: {
    configHome: string
    globalConfigFile: string
    bridgeSpawnRoot?: string
  }
  digestHost: DigestHost
  resolvePath: (key: unknown) => string | null
}

export type ResolveKeyOpts = {
  within: Record<string, unknown>
  anchor: 'literal' | 'resolved'
  follow?: 'decline' | 'probe'
}

export type ResolveKeyHit =
  | { kind: 'inPlace' }
  | { kind: 'escapes'; reason: string }
  | { kind: 'alias'; key: Record<string, unknown> }

export type StorageV5EditCurrent<T> = {
  value: T
  version?: string
  mtimeMs?: number
}

export type StorageV5EditDecision =
  | { write: string | Uint8Array }
  | { skip: true }

/** densable leftover `Pr` @207274259 — `yk` `is`. */
export const TREE_NAMESPACES_IS = new Set([
  'memory',
  'pluginCache',
  'marketplaceCache',
  'sidecar',
  'scratch',
  'agentMemory',
  'userConfigDir',
  'job',
  'daemon',
])

/** densable leftover `Wv` @207542795. */
const REPLACE_RECORDS_WV: Record<string, 'everyForm' | 'wholeStreamAtomic'> = {
  transcript: 'everyForm',
  history: 'wholeStreamAtomic',
}

/** densable leftover `Xe` / `wc` — memory team folder. */
const MEMORY_TEAM_WC = 'team'

/** densable leftover lock `kt` — `_v` acquireTimeoutMs cap. */
const ACQUIRE_TIMEOUT_KT = 600000

const TEXT_DECODER = new TextDecoder()

function w(argument: string, _message: string): WriteValidateErr {
  return { code: 'InvalidArgument', ...(argument && { argument }) }
}

function fail(
  error: WriteValidateErr | { code: string; argument?: string },
): StorageHbResult<never> {
  return { ok: false, error }
}

function closed(): StorageHbResult<never> {
  return { ok: false, error: { code: 'Unavailable' } }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

/** densable leftover-family `I` — stream, not write-discipline `I`. */
export function isStreamKeyI(e: Record<string, unknown>): boolean {
  return getStreamFraming(e) !== undefined
}

/** densable leftover `or` @207334280 — portable copy/move streams. */
function isPortableStreamOr(e: Record<string, unknown>): boolean {
  return e.namespace === 'history' || e.namespace === 'transcript'
}

/** densable leftover `Ve` @207334334 for Tf bookkeeping. */
function isPortableOrFramedVe(e: Record<string, unknown>): boolean {
  return isPortableStreamOr(e) || isStreamKeyI(e)
}

function canonPe(e: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(e)
        .filter(([, n]) => n !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  )
}

function keysEqualPe(
  e: Record<string, unknown>,
  r: Record<string, unknown>,
): boolean {
  return canonPe(e) === canonPe(r)
}

/** densable leftover `fo` — copy/move identity. */
function keysSameFo(
  e: Record<string, unknown>,
  r: Record<string, unknown>,
): boolean {
  return keysEqualPe(e, r)
}

/** densable leftover `Xc` @207466846. */
export function scopeNarrowingXc(e: Record<string, unknown>): string {
  return JSON.stringify([
    e.namespace,
    e.namespace === 'userConfigDir'
      ? e.dir
      : e.namespace === 'agentMemory'
        ? e.layer
        : undefined,
    ...Object.entries(e)
      .filter(([r, n]) => r !== 'namespace' && n !== undefined)
      .map(([r, n]) => (Array.isArray(n) ? [r, n.length] : [r]))
      .sort(),
  ])
}

/** densable leftover `ps` — scope self-identity. */
function scopeIdentityPs(e: Record<string, unknown>): string {
  return canonPe(e)
}

function relFieldForTree(namespace: unknown): 'agentRelPath' | 'relPath' {
  return namespace === 'transcript' ? 'agentRelPath' : 'relPath'
}

/** densable leftover `at` — append relative segs onto a tree scope. */
function appendRelAt(
  within: Record<string, unknown>,
  segs: string[],
): Record<string, unknown> | undefined {
  if (segs.some(s => s === '' || s === '.' || s === '..')) return
  const field = relFieldForTree(within.namespace)
  const base = Array.isArray(within[field])
    ? within[field].filter((p): p is string => typeof p === 'string')
    : []
  return { ...within, [field]: [...base, ...segs] }
}

function resolveScopeDir(
  roots: HbMutateHost['roots'],
  scope: Record<string, unknown>,
  resolvePath: HbMutateHost['resolvePath'],
): string | null {
  const listed = resolveScopeListDirectories(roots, scope)
  if (listed.length === 1) return listed[0]!.directory
  if (
    listed.length === 2 &&
    listed[1]?.scope.namespace === 'transcript' &&
    Array.isArray(listed[1].scope.agentRelPath) &&
    listed[1].scope.agentRelPath.length === 0
  ) {
    return listed[0]!.directory
  }
  return resolvePath(scope)
}

/** densable leftover `mk` @207453260. */
export function isStoreRootMk(e: Record<string, unknown>): boolean {
  const r = 'relPath' in e ? e.relPath : undefined
  return (
    r === undefined ||
    (Array.isArray(r) && r.length === 0) ||
    (e.namespace === 'memory' &&
      Array.isArray(r) &&
      r.length === 1 &&
      r[0] === MEMORY_TEAM_WC)
  )
}

/** densable leftover `Ir` tree-scope — `Pr.has`. */
function isTreeScopeIr(e: Record<string, unknown>): boolean {
  return typeof e.namespace === 'string' && TREE_NAMESPACES_IS.has(e.namespace)
}

/** densable leftover `Ce` @207490721. */
function remapArgumentCe(
  e: WriteValidateErr | undefined,
  r: string,
  n = 'key',
): WriteValidateErr | undefined {
  if (e === undefined) return
  if (e.argument === undefined) return e
  return {
    ...e,
    argument: e.argument.startsWith(n)
      ? r + e.argument.slice(n.length)
      : e.argument,
  }
}

/** densable leftover `gk` @207453997. */
export function validateResolveOptsGk(
  roots: HbMutateHost['roots'],
  r: unknown,
): WriteValidateErr | undefined {
  if (typeof r !== 'object' || r === null) {
    return w('opts', 'must be { within, anchor }')
  }
  const opts = r as ResolveKeyOpts
  if (opts.anchor !== 'literal' && opts.anchor !== 'resolved') {
    return w('opts.anchor', "must be 'literal' or 'resolved'")
  }
  if (
    opts.follow !== undefined &&
    opts.follow !== 'decline' &&
    opts.follow !== 'probe'
  ) {
    return w('opts.follow', "must be 'decline' or 'probe'")
  }
  const n = opts.within
  const t =
    typeof n !== 'object' || n === null
      ? w('opts.within', 'must be a tree scope')
      : (validateStorageScope(n) ?? validateBridgeSpawnRoot(roots, n, 'scope'))
  if (t !== undefined) {
    return w('opts.within', t.argument ? t.argument : 'is not a valid scope')
  }
  if (!isTreeScopeIr(n)) {
    return w('opts.within', 'must be a tree scope')
  }
  if (n.namespace === 'marketplaceCache') {
    return w(
      'opts.within',
      "a marketplace's tree is not resolved through resolveKey yet",
    )
  }
  if (opts.anchor === 'resolved' && !isStoreRootMk(n)) {
    return w(
      'opts.within',
      "under anchor 'resolved' must be a store root (for memory: the project's memory folder or its team folder), not a folder inside the tree",
    )
  }
}

/** densable leftover `yk` @207454870. */
export function validateResolveKeyYk(
  roots: HbMutateHost['roots'],
  r: Record<string, unknown>,
  n: ResolveKeyOpts,
  resolvePath: HbMutateHost['resolvePath'],
): WriteValidateErr | undefined {
  if (isStreamKeyI(r) || !TREE_NAMESPACES_IS.has(String(r.namespace))) {
    return w(
      'key',
      `must be a value key of a tree namespace (${[...TREE_NAMESPACES_IS].join(', ')})`,
    )
  }
  const t = n.within
  if (t.namespace !== r.namespace) {
    return w('opts.within', "must be a tree scope of the key's own namespace")
  }
  const withinPath = resolveScopeDir(roots, t, resolvePath)
  const keyPath = resolvePath(r)
  if (!withinPath || !keyPath) {
    return w(
      'opts.within',
      'must contain the key and root a key tree of its namespace',
    )
  }
  const i = relative(withinPath, keyPath)
  const o = i.split(sep)
  const a =
    i === '' || o.includes('..') || isAbsolute(i)
      ? undefined
      : appendRelAt(t, o)
  return a !== undefined && keysEqualPe(a, r)
    ? undefined
    : w(
        'opts.within',
        'must contain the key and root a key tree of its namespace',
      )
}

function isInsideDir(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * densable leftover `ok` @207446425 — leftover-faithful realpath classify.
 * Official `hc`/`Lc` stay unused (share/automount/loop walker).
 */
async function classifyResolveOk(
  host: HbMutateHost,
  n: Record<string, unknown>,
  t: ResolveKeyOpts,
): Promise<StorageHbResult<ResolveKeyHit>> {
  const i =
    validateStorageKey(n) ??
    validateBridgeSpawnRoot(host.roots, n) ??
    validateResolveKeyYk(host.roots, n, t, host.resolvePath)
  if (i !== undefined) return fail(i)
  const o = host.resolvePath(n)
  const a = resolveScopeDir(host.roots, t.within, host.resolvePath)
  if (!o || !a) {
    return fail(
      w(
        'opts.within',
        'must contain the key and root a key tree of its namespace',
      ),
    )
  }
  try {
    const info = await lstat(o).catch(() => null)
    if (!info || !info.isSymbolicLink()) {
      return { ok: true, value: { kind: 'inPlace' } }
    }
    const landing = await realpath(o).catch(() => o)
    if (landing === o) return { ok: true, value: { kind: 'inPlace' } }
    if (!isInsideDir(a, landing)) {
      return {
        ok: true,
        value: {
          kind: 'escapes',
          reason: isInsideDir(landing, a) ? 'enclosing' : 'outside',
        },
      }
    }
    const segs = relative(a, landing).split(sep)
    const h = appendRelAt(t.within, segs)
    if (
      h === undefined ||
      isStreamKeyI(h) ||
      validateStorageKey(h) !== undefined
    ) {
      return { ok: true, value: { kind: 'escapes', reason: 'unnameable' } }
    }
    return { ok: true, value: { kind: 'alias', key: h } }
  } catch {
    return { ok: true, value: { kind: 'inPlace' } }
  }
}

/** densable leftover `ds` @207446172. */
export async function resolveKeysDs(
  host: HbMutateHost,
  r: unknown,
  n: unknown,
): Promise<StorageHbResult<{ items: Array<StorageHbResult<ResolveKeyHit>> }>> {
  if (host.closed) return closed()
  if (!Array.isArray(r)) {
    return fail(w('keys', 'must be an array of value keys'))
  }
  const t = validateResolveOptsGk(host.roots, n)
  if (t !== undefined) return fail(t)
  const opts = n as ResolveKeyOpts
  const items = await Promise.all(
    r.map(async a => {
      const rec = asRecord(a)
      if (!rec) return fail(w('key', 'expected a key object'))
      return classifyResolveOk(host, rec, opts)
    }),
  )
  return { ok: true, value: { items } }
}

/** densable leftover `Fc` @207445806. */
export async function resolveKeyFc(
  host: HbMutateHost,
  r: unknown,
  n: unknown,
): Promise<StorageHbResult<ResolveKeyHit>> {
  const t = await resolveKeysDs(host, [r], n)
  return t.ok ? t.value.items[0]! : t
}

/** densable leftover `Cf` @207490852. */
function validateCopyPreconditionCf(
  e: { type?: string } | undefined,
): WriteValidateErr | undefined {
  if (e === undefined) return
  const r = typeof e === 'object' && e !== null ? e.type : undefined
  return r === 'ifAbsent' || (r === 'none' && Object.keys(e).length === 1)
    ? undefined
    : w(
        'opts.precondition',
        "expected { type: 'ifAbsent' } or { type: 'none' }",
      )
}

/** densable leftover `Tf` @207491081. */
export function validateCopyPairTf(
  e: Record<string, unknown>,
  r: Record<string, unknown>,
): WriteValidateErr | undefined {
  if (keysSameFo(e, r)) return w('to', 'must differ from from')
  if (!isStreamKeyI(e)) {
    return isStreamKeyI(r)
      ? w('to', 'a value cannot be copied into a stream')
      : undefined
  }
  if (e.namespace === 'sessionLog') {
    return w(
      'from',
      'a session memory log is not copied or moved; it is appended, read, listed and deleted only',
    )
  }
  if (isStreamKeyI(r) && r.namespace === 'sessionLog') {
    return w('to', 'a session memory log is not a copy or move destination')
  }
  if (!isPortableOrFramedVe(e) || !isPortableStreamOr(e)) {
    return w(
      'from',
      'this stream keeps its records behind backend bookkeeping; its log cannot be carried verbatim',
    )
  }
  if (!isStreamKeyI(r)) return
  if (!isPortableStreamOr(r)) {
    return w(
      'to',
      'this stream keeps its records behind backend bookkeeping; a raw log cannot be put in its place',
    )
  }
  return r.namespace === e.namespace
    ? undefined
    : w('to', 'a stream stays within its own namespace')
}

/** densable leftover `Qk` @207481800. */
export function validateMovePairQk(
  e: Record<string, unknown>,
  r: Record<string, unknown>,
  n?: { type?: string },
): WriteValidateErr | undefined {
  if (isStreamKeyI(e) !== isStreamKeyI(r)) {
    return w('to', 'a move stays within one key class')
  }
  const t = validateCopyPairTf(e, r)
  if (t !== undefined || !isStreamKeyI(r)) return t
  return n?.type === 'ifAbsent'
    ? w(
        'opts.precondition',
        'a no-replace move of a stream is not offered; omit the precondition to move over the destination',
      )
    : undefined
}

/** densable leftover `zk` @207463653. */
export function validateCopyDestOptsZk(
  e: Record<string, unknown>,
  r:
    | {
        requireMode?: unknown
        flush?: unknown
        parent?: unknown
        share?: unknown
        mode?: unknown
        exactMode?: unknown
      }
    | undefined,
): WriteValidateErr | undefined {
  for (const n of ['requireMode', 'flush'] as const) {
    if (r?.[n] !== undefined && typeof r[n] !== 'boolean') {
      return w(`opts.${n}`, 'must be a boolean')
    }
  }
  if (
    r?.parent !== undefined &&
    r.parent !== 'create' &&
    r.parent !== 'mustExist'
  ) {
    return w('opts.parent', "must be 'create' or 'mustExist'")
  }
  if (
    r?.share !== undefined &&
    r.share !== 'ifPossible' &&
    r.share !== 'require'
  ) {
    return w('opts.share', "must be 'ifPossible', 'require' or omitted")
  }
  for (const n of ['requireMode', 'parent', 'flush', 'share'] as const) {
    if (isStreamKeyI(e) && r?.[n] !== undefined) {
      return w(`opts.${n}`, 'applies to a value destination')
    }
  }
  for (const n of ['mode', 'exactMode'] as const) {
    const t = r?.[n]
    if (t === undefined) continue
    if (isStreamKeyI(e)) {
      return w(
        `opts.${n}`,
        'applies to a value destination; a stream keeps its own file mode',
      )
    }
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > 511) {
      return w(
        `opts.${n}`,
        'must be an integer permission mode between 0 and 0o777: read, write and execute bits only, no set-id or sticky bit',
      )
    }
  }
}

/** densable leftover `$k` @207466621. */
export function validateMoveScopePair(
  e: Record<string, unknown>,
  r: Record<string, unknown>,
): WriteValidateErr | undefined {
  if (
    e.namespace !== r.namespace ||
    scopeNarrowingXc(e) !== scopeNarrowingXc(r)
  ) {
    return w(
      'to',
      'a scope moves onto a scope of its own class (same namespace, same narrowing)',
    )
  }
  return scopeIdentityPs(e) === scopeIdentityPs(r)
    ? w('to', 'a scope cannot move onto itself')
    : undefined
}

async function ensureParentOe(
  path: string,
  makeParent: boolean,
): Promise<StorageHbResult<void> | undefined> {
  if (!makeParent) {
    try {
      await stat(dirname(path))
    } catch (error) {
      if (isENOENT(error)) {
        return { ok: false, error: { code: 'NotFound' } }
      }
      return { ok: false, error: { code: 'Failed' } }
    }
    return
  }
  await mkdir(dirname(path), { recursive: true })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function writeStreamFile(
  path: string,
  bytes: Uint8Array,
  makeParent: boolean,
): Promise<StorageHbResult<void>> {
  const parent = await ensureParentOe(path, makeParent)
  if (parent !== undefined && !parent.ok) return parent
  await writeFile(path, bytes)
  return { ok: true, value: undefined }
}

type CopyMoveOpts = {
  parent?: string
  share?: 'ifPossible' | 'require'
  mode?: number
  exactMode?: number
  requireMode?: boolean
  flush?: boolean
  precondition?: { type?: string; version?: string }
}

async function copyValueSv(
  host: HbMutateHost,
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  opts?: CopyMoveOpts,
): Promise<StorageHbResult<{ version?: string; bytes: number }>> {
  const src = host.resolvePath(from)
  const dest = host.resolvePath(to)
  if (!src || !dest) return fail({ code: 'InvalidArgument' })
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(src))
  } catch (error) {
    if (isENOENT(error)) return { ok: false, error: { code: 'NotFound' } }
    return { ok: false, error: { code: 'Failed' } }
  }
  if (opts?.precondition?.type === 'ifAbsent' && (await pathExists(dest))) {
    return { ok: false, error: { code: 'AlreadyExists' } }
  }
  if (opts?.share === 'require' || opts?.share === 'ifPossible') {
    try {
      const parent = await ensureParentOe(dest, opts.parent !== 'mustExist')
      if (parent !== undefined && !parent.ok) return parent
      if (await pathExists(dest)) await unlink(dest)
      await link(src, dest)
      return { ok: true, value: { bytes: bytes.byteLength } }
    } catch {
      if (opts.share === 'require') {
        return fail(w('opts.share', 'share applies between two value keys'))
      }
    }
  }
  const written = await publishValidatedStorageFile(
    host.roots,
    to,
    dest,
    bytes,
    opts,
    host.digestHost,
  )
  if (!written.ok) return written
  return {
    ok: true,
    value: { version: written.value.version, bytes: bytes.byteLength },
  }
}

async function copyOrMoveStreamFile(
  host: HbMutateHost,
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  move: boolean,
  opts?: CopyMoveOpts,
): Promise<StorageHbResult<{ bytes: number }>> {
  const src = host.resolvePath(from)
  const dest = host.resolvePath(to)
  if (!src || !dest) return fail({ code: 'InvalidArgument' })
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(src))
  } catch (error) {
    if (isENOENT(error)) return { ok: false, error: { code: 'NotFound' } }
    return { ok: false, error: { code: 'Failed' } }
  }
  const makeParent = shouldMakeParentDir(to)
  if (move) {
    const parent = await ensureParentOe(dest, makeParent)
    if (parent !== undefined && !parent.ok) return parent
    try {
      if (await pathExists(dest)) await unlink(dest)
      await rename(src, dest)
      return { ok: true, value: { bytes: bytes.byteLength } }
    } catch {
      const wrote = await writeStreamFile(dest, bytes, makeParent)
      if (!wrote.ok) return wrote
      await unlink(src).catch(() => {})
      return { ok: true, value: { bytes: bytes.byteLength } }
    }
  }
  const wrote = await writeStreamFile(dest, bytes, makeParent)
  if (!wrote.ok) return wrote
  return { ok: true, value: { bytes: bytes.byteLength } }
}

/** densable leftover `pf` @207462778. */
export async function copyPf(
  host: HbMutateHost,
  r: unknown,
  n: unknown,
  t?: CopyMoveOpts,
): Promise<StorageHbResult<{ version?: string; bytes: number }>> {
  if (host.closed) return closed()
  const from = asRecord(r)
  const to = asRecord(n)
  if (!from || !to) return fail(w('key', 'expected a key object'))
  const i = t?.precondition
  const o =
    remapArgumentCe(validateStorageKey(from), 'from') ??
    remapArgumentCe(validateBridgeSpawnRoot(host.roots, from), 'from') ??
    remapArgumentCe(validateStorageKey(to), 'to') ??
    remapArgumentCe(validateBridgeSpawnRoot(host.roots, to), 'to') ??
    remapArgumentCe(validateMarketplaceCacheReadOnly(to), 'to') ??
    validateCopyPreconditionCf(i) ??
    validateCopyPairTf(from, to) ??
    validateCopyDestOptsZk(to, t) ??
    (isStreamKeyI(from) && t?.share !== undefined
      ? w('opts.share', 'share applies between two value keys')
      : undefined) ??
    (isStreamKeyI(to) ? undefined : validatePreconditionDiscipline(to, i))
  if (o !== undefined) return fail(o)
  const a =
    (await validateMarketplaceCacheSymlinks(host.roots, from, 'always')) ??
    (await validateMarketplaceCacheSymlinks(host.roots, to, 'always'))
  if (a !== undefined) return fail(a)
  const dest = host.resolvePath(to)
  if (!dest) return fail({ code: 'InvalidArgument' })
  const l = isStreamKeyI(to)
    ? shouldMakeParentDir(to)
    : t?.parent !== 'mustExist'
  const parent = await ensureParentOe(dest, l)
  if (parent !== undefined && !parent.ok) return parent
  if (!isStreamKeyI(from)) {
    if (isStreamKeyI(to)) {
      return fail(w('to', 'a value cannot be copied into a stream'))
    }
    return copyValueSv(host, from, to, t)
  }
  return copyOrMoveStreamFile(host, from, to, false, t)
}

/** densable leftover `yf` @207464676. */
export async function moveYf(
  host: HbMutateHost,
  r: unknown,
  n: unknown,
  t?: CopyMoveOpts,
): Promise<StorageHbResult<{ version?: string; bytes: number }>> {
  if (host.closed) return closed()
  const from = asRecord(r)
  const to = asRecord(n)
  if (!from || !to) return fail(w('key', 'expected a key object'))
  const i = t?.precondition
  const o =
    remapArgumentCe(validateStorageKey(from), 'from') ??
    remapArgumentCe(validateBridgeSpawnRoot(host.roots, from), 'from') ??
    remapArgumentCe(validateMarketplaceCacheReadOnly(from), 'from') ??
    remapArgumentCe(validateStorageKey(to), 'to') ??
    remapArgumentCe(validateBridgeSpawnRoot(host.roots, to), 'to') ??
    remapArgumentCe(validateMarketplaceCacheReadOnly(to), 'to') ??
    validateCopyPreconditionCf(i) ??
    validateMovePairQk(from, to, i) ??
    (isStreamKeyI(to) ? undefined : validatePreconditionDiscipline(to, i))
  if (o !== undefined) return fail(o)
  const a =
    (await validateMarketplaceCacheSymlinks(host.roots, from, 'always')) ??
    (await validateMarketplaceCacheSymlinks(host.roots, to, 'always'))
  if (a !== undefined) return fail(a)
  const dest = host.resolvePath(to)
  if (!dest) return fail({ code: 'InvalidArgument' })
  const s = !isStreamKeyI(to) || shouldMakeParentDir(to)
  const parent = await ensureParentOe(dest, s)
  if (parent !== undefined && !parent.ok) return parent
  if (isStreamKeyI(from)) {
    if (!isStreamKeyI(to)) {
      return fail(w('to', 'a move stays within one key class'))
    }
    return copyOrMoveStreamFile(host, from, to, true, t)
  }
  if (isStreamKeyI(to)) {
    return fail(w('to', 'a move stays within one key class'))
  }
  const copied = await copyValueSv(host, from, to, t)
  if (!copied.ok) return copied
  const src = host.resolvePath(from)
  if (src) await unlink(src).catch(() => {})
  return copied
}

/** densable leftover `Gk` @207467332. */
function namesOneTreeGk(e: Record<string, unknown>): boolean {
  switch (e.namespace) {
    case 'transcript':
      return (
        e.projectKey !== undefined &&
        e.sessionId !== undefined &&
        e.agentRelPath === undefined &&
        !('agentId' in e && e.agentId !== undefined) &&
        !('journal' in e && e.journal !== undefined) &&
        !('sessionJournal' in e && e.sessionJournal !== undefined)
      )
    case 'pluginCache':
      return (
        e.marketplace !== undefined &&
        e.plugin !== undefined &&
        e.version !== undefined &&
        e.relPath === undefined
      )
    default:
      return false
  }
}

function oneTreeDirJc(
  host: HbMutateHost,
  r: Record<string, unknown>,
): string | undefined {
  if (!namesOneTreeGk(r)) return
  return resolveScopeDir(host.roots, r, host.resolvePath) ?? undefined
}

/** densable leftover `kf` @207465286. */
export async function moveScopeKf(
  host: HbMutateHost,
  r: unknown,
  n: unknown,
  t?: { replace?: boolean },
): Promise<StorageHbResult<{ moved: boolean }>> {
  if (host.closed) return closed()
  const from = asRecord(r)
  const to = asRecord(n)
  if (!from || !to) return fail(w('scope', 'expected a scope object'))
  const i =
    remapArgumentCe(validateStorageScope(from), 'from', 'scope') ??
    remapArgumentCe(
      validateBridgeSpawnRoot(host.roots, from, 'scope'),
      'from',
      'scope',
    ) ??
    remapArgumentCe(validateStorageScope(to), 'to', 'scope') ??
    remapArgumentCe(
      validateBridgeSpawnRoot(host.roots, to, 'scope'),
      'to',
      'scope',
    ) ??
    validateMoveScopePair(from, to)
  if (i !== undefined) return fail(i)
  const o = oneTreeDirJc(host, from)
  const a = oneTreeDirJc(host, to)
  if (o === undefined) {
    return fail(w('from', 'the scope does not name one tree'))
  }
  if (a === undefined) {
    return fail(w('to', 'the scope does not name one tree'))
  }
  const [l, d] = [o, a].sort()
  if (d.startsWith(`${l}${sep}`) || l === d) {
    return fail(w('to', 'one scope lies inside the other; nothing can move'))
  }
  const parent = await ensureParentOe(a, true)
  if (parent !== undefined && !parent.ok) return parent
  try {
    if (await pathExists(a)) {
      if (t?.replace !== true) {
        return { ok: false, error: { code: 'AlreadyExists' } }
      }
      await rm(a, { recursive: true, force: true })
    }
    await rename(o, a)
    return { ok: true, value: { moved: true } }
  } catch (error) {
    if (isENOENT(error)) return { ok: false, error: { code: 'NotFound' } }
    return { ok: false, error: { code: 'Failed' } }
  }
}

/** densable leftover `jv` @207521341. */
function validateEditJv(e: unknown): WriteValidateErr | undefined {
  return typeof e === 'function' ? undefined : w('edit', 'must be a function')
}

/** densable leftover `Vv` @207520883. */
function validateUpdateKeyVv(
  e: Record<string, unknown>,
): WriteValidateErr | undefined {
  return isStreamKeyI(e)
    ? w('key', 'update takes a value key, not a stream')
    : undefined
}

/** densable leftover `Kv` @207520967. */
function validateUpdatePreconditionKv(
  e: { precondition?: unknown } | undefined,
): WriteValidateErr | undefined {
  return e !== undefined && 'precondition' in e && e.precondition !== undefined
    ? w(
        'opts.precondition',
        'update supplies its own exclusivity; omit the precondition',
      )
    : undefined
}

/** densable leftover `_v` @207521136. */
function validateAcquireTimeoutV(
  e: { acquireTimeoutMs?: unknown } | undefined,
): WriteValidateErr | undefined {
  const r = e?.acquireTimeoutMs
  return r === undefined ||
    (typeof r === 'number' &&
      Number.isInteger(r) &&
      r >= 0 &&
      r <= ACQUIRE_TIMEOUT_KT)
    ? undefined
    : w(
        'opts.acquireTimeoutMs',
        `must be a whole number of milliseconds from 0 to ${ACQUIRE_TIMEOUT_KT}`,
      )
}

/** densable leftover `Dv` @207520102. */
function validateEditDecisionDv(e: unknown): WriteValidateErr | undefined {
  if (typeof e !== 'object' || e === null) {
    return w('edit', 'must return { write } or { skip: true }')
  }
  const rec = e as { then?: unknown; write?: unknown; skip?: unknown }
  if ('then' in rec && typeof rec.then === 'function') {
    Promise.resolve(e).catch(() => {})
    return w(
      'edit',
      'must be synchronous: it returned a Promise, not a decision',
    )
  }
  const r = 'write' in rec
  const n = 'skip' in rec
  if (r && n) {
    return w(
      'edit',
      'must return exactly one of { write } or { skip: true }, not both keys',
    )
  }
  if (r) {
    return typeof rec.write === 'string' || rec.write instanceof Uint8Array
      ? undefined
      : w('edit', 'write must be a string or a Uint8Array')
  }
  return n && rec.skip === true
    ? undefined
    : w('edit', 'must return { write } or { skip: true }')
}

/** densable leftover `sm` @207519888. */
function applyEditSm<T>(
  e: (current: StorageV5EditCurrent<T> | undefined) => unknown,
  r: { bytes: Uint8Array; version?: string; mtimeMs?: number } | undefined,
  n: (bytes: Uint8Array) => T,
):
  | { ok: true; value: StorageV5EditDecision }
  | { ok: false; error: WriteValidateErr; threw?: true; cause?: unknown } {
  let t: unknown
  try {
    t = e(
      r === undefined
        ? undefined
        : { value: n(r.bytes), version: r.version, mtimeMs: r.mtimeMs },
    )
  } catch (o) {
    return {
      ok: false,
      error: { code: 'Failed', argument: 'edit' },
      threw: true,
      cause: o,
    }
  }
  const i = validateEditDecisionDv(t)
  return i === undefined
    ? { ok: true, value: t as StorageV5EditDecision }
    : { ok: false, error: i }
}

type UpdateOpts = {
  parent?: string
  publishDiscipline?: string
  acquireTimeoutMs?: number
  precondition?: { type?: string }
}

/** densable leftover `Ds` @207517338 / leftover-faithful `Tv`. */
export async function updateDs<T>(
  host: HbMutateHost,
  r: unknown,
  n: (current: StorageV5EditCurrent<T> | undefined) => unknown,
  t: UpdateOpts | undefined,
  i: (bytes: Uint8Array) => T,
): Promise<
  StorageHbResult<{
    written: boolean
    found: boolean
    version?: string
  }>
> {
  if (host.closed) return closed()
  const key = asRecord(r)
  if (!key) return fail(w('key', 'expected a key object'))
  const o =
    validateStorageKey(key) ??
    validateBridgeSpawnRoot(host.roots, key) ??
    validateMarketplaceCacheReadOnly(key) ??
    validateUpdateKeyVv(key) ??
    validateEditJv(n) ??
    validateUpdatePreconditionKv(t) ??
    validateAcquireTimeoutV(t) ??
    validatePublishDisciplineOpt(key, t) ??
    validateParentOpt(t) ??
    validateWriteMiscOpts(t)
  if (o !== undefined) return fail(o)
  const a = await validateMarketplaceCacheSymlinks(host.roots, key, 'always')
  if (a !== undefined) return fail(a)
  const path = host.resolvePath(key)
  if (!path) return fail({ code: 'InvalidArgument' })
  const parent = await ensureParentOe(path, t?.parent !== 'mustExist')
  if (parent !== undefined && !parent.ok) return parent
  const current = await readValueWholeSe(path, getReadSymlinkClass(key)).catch(
    () => ({ ok: false as const, error: { kind: 'absent' } }),
  )
  const body = current.ok
    ? current.value
    : current.error.kind === 'absent'
      ? undefined
      : undefined
  if (!current.ok && current.error.kind !== 'absent') {
    return { ok: false, error: { code: 'Failed' } }
  }
  const edited = applyEditSm(n, body, i)
  if (!edited.ok) {
    return edited.threw
      ? {
          ok: false,
          error: { code: 'Failed', telemetryCode: 'EditThrew' },
        }
      : fail(edited.error)
  }
  if (!('write' in edited.value)) {
    return {
      ok: true,
      value: { written: false, found: body !== undefined },
    }
  }
  const written = await publishValidatedStorageFile(
    host.roots,
    key,
    path,
    edited.value.write,
    t,
    host.digestHost,
  )
  if (!written.ok) return written
  return {
    ok: true,
    value: {
      written: true,
      found: body !== undefined,
      version: written.value.version,
    },
  }
}

function isAsyncIterable(e: unknown): e is AsyncIterable<unknown> {
  return (
    typeof e === 'object' &&
    e !== null &&
    Symbol.asyncIterator in e &&
    typeof (e as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  )
}

/** densable leftover `Hv` @207524329. */
function validateWholeStreamAtomicHv(
  e: Record<string, unknown>,
  r: unknown,
  n:
    | {
        publishDiscipline?: string
        keepBefore?: unknown
        preserveFrom?: unknown
        aliases?: unknown[]
        precondition?: { type?: string }
      }
    | undefined,
): WriteValidateErr | undefined {
  const t = `a ${String(e.namespace)} stream is replaced whole, by an array of entries under 'atomic' with no comparing precondition and no aliases`
  if ((n?.publishDiscipline ?? 'atomic') !== 'atomic') {
    return w('opts.publishDiscipline', t)
  }
  if (!Array.isArray(r)) return w('entries', t)
  if (n?.keepBefore !== undefined) return w('opts.keepBefore', t)
  if (n?.preserveFrom !== undefined) return w('opts.preserveFrom', t)
  if (n?.aliases !== undefined && n.aliases.length > 0) {
    return w('opts.aliases', t)
  }
  return n?.precondition != null && n.precondition.type !== 'none'
    ? w('opts.precondition', t)
    : undefined
}

/** densable leftover `zv` @207522860. */
export function validateReplaceRecordsZv(
  e: Record<string, unknown>,
  r: unknown,
  n:
    | {
        publishDiscipline?: string
        keepBefore?: number
        preserveFrom?: number
        aliases?: unknown[]
        precondition?: { type?: string; version?: string; seq?: number }
        singleName?: boolean
        parent?: string
      }
    | undefined,
): WriteValidateErr | undefined {
  const t = REPLACE_RECORDS_WV[String(e.namespace)]
  if (t === undefined) {
    return w(
      'stream.namespace',
      `replaceRecords admits the transcript streams and the prompt-history stream; a ${String(e.namespace)} stream is not admitted`,
    )
  }
  const i = n?.publishDiscipline ?? 'atomic'
  if (i !== 'atomic' && i !== 'inPlace') {
    return w('opts.publishDiscipline', "must be 'atomic' or 'inPlace'")
  }
  if (t === 'wholeStreamAtomic') {
    const s = validateWholeStreamAtomicHv(e, r, n)
    if (s !== undefined) return s
  }
  if (Array.isArray(r)) {
    const entries = r as Array<{ data: unknown; recordId?: string }>
    const s =
      validateAppendEntries(e, entries) ??
      (getStreamFraming(e) === 'jsonl'
        ? validateJsonlStreamEntries(
            entries as Array<{ data: string | Uint8Array; recordId?: string }>,
          )
        : undefined)
    if (s !== undefined) return s
  } else if (!isAsyncIterable(r)) {
    return w(
      'entries',
      'must be an array of append entries, or an AsyncIterable of them',
    )
  } else if (i === 'inPlace') {
    return w(
      'entries',
      "an AsyncIterable is consumed while it is staged, under 'atomic'; an 'inPlace' replace takes an array, judged whole before the cut",
    )
  }
  if (n?.keepBefore !== undefined || n?.preserveFrom !== undefined) {
    for (const field of ['keepBefore', 'preserveFrom'] as const) {
      const v = n[field]
      if (v !== undefined && !(Number.isSafeInteger(v) && v >= 0)) {
        return w(`opts.${field}`, 'must be a non-negative integer')
      }
    }
    if (
      n.keepBefore !== undefined &&
      n.preserveFrom !== undefined &&
      n.preserveFrom < n.keepBefore
    ) {
      return w('opts.preserveFrom', 'must not be below opts.keepBefore')
    }
  }
  if (n?.precondition !== undefined) {
    const p = n.precondition
    const ok =
      typeof p === 'object' &&
      p !== null &&
      ((p.type === 'none' && Object.keys(p).length === 1) ||
        (p.type === 'ifMatch' && typeof p.version === 'string') ||
        (p.type === 'ifUnchangedThrough' &&
          typeof p.version === 'string' &&
          typeof p.seq === 'number' &&
          Number.isSafeInteger(p.seq) &&
          p.seq >= 0))
    if (!ok) {
      return w('opts.precondition', 'must be a replaceRecords precondition')
    }
  }
  const parent = validateParentOpt(n)
  if (parent !== undefined) return parent
  if (n?.aliases !== undefined) {
    if (!Array.isArray(n.aliases)) {
      return w('opts.aliases', 'must be an array of stream keys')
    }
    for (const [idx, alias] of n.aliases.entries()) {
      const rec = asRecord(alias)
      const bad = rec
        ? validateStorageKey(rec)
        : w('key', 'expected a key object')
      if (bad !== undefined) {
        return w(`opts.aliases[${idx}]`, bad.argument ?? 'malformed stream key')
      }
      if (rec?.namespace !== 'transcript') {
        return w(`opts.aliases[${idx}]`, 'an alias is a transcript stream key')
      }
    }
  }
  if (n?.singleName !== undefined && typeof n.singleName !== 'boolean') {
    return w('opts.singleName', 'must be a boolean')
  }
  if (n?.singleName && n.aliases !== undefined && n.aliases.length > 0) {
    return w('opts.aliases', 'singleName excludes aliases')
  }
  if (i === 'atomic') return
  if (n?.aliases !== undefined && n.aliases.length > 0) {
    return w(
      'opts.aliases',
      "an 'inPlace' rewrite keeps every name of the stream by itself; aliases are carried by the 'atomic' discipline",
    )
  }
  if (n?.precondition?.type === 'ifUnchangedThrough') {
    return w(
      'opts.precondition',
      "ifUnchangedThrough is the 'atomic' discipline's; an 'inPlace' replace takes ifMatch on its range form",
    )
  }
  const ranged = n?.keepBefore !== undefined || n?.preserveFrom !== undefined
  return n?.precondition !== undefined &&
    n.precondition.type !== 'none' &&
    !ranged
    ? w(
        'opts.precondition',
        "a whole-stream 'inPlace' replace is unconditional; omit the precondition or declare { type: 'none' }",
      )
    : undefined
}

function encodeReplaceEntries(
  entries: Array<{ data: string | Uint8Array }>,
): Uint8Array {
  return new Uint8Array(
    Buffer.concat(
      entries.map(e =>
        typeof e.data === 'string' ? Buffer.from(e.data) : Buffer.from(e.data),
      ),
    ),
  )
}

/** densable leftover `km` @207521788. */
export async function replaceRecordsKm(
  host: HbMutateHost,
  r: unknown,
  n: unknown,
  t?: {
    publishDiscipline?: 'atomic' | 'inPlace'
    parent?: string
    aliases?: unknown[]
    singleName?: boolean
    keepBefore?: number
    preserveFrom?: number
    precondition?: { type?: string; version?: string; seq?: number }
  },
): Promise<StorageHbResult<{ bytes: number }>> {
  if (host.closed) return closed()
  const key = asRecord(r)
  if (!key) return fail(w('key', 'expected a key object'))
  const i =
    validateStorageKey(key) ??
    (isStreamKeyI(key)
      ? undefined
      : w(
          'stream.namespace',
          `replaceRecords admits the transcript streams and the prompt-history stream; a ${String(key.namespace)} stream is not admitted`,
        )) ??
    validateReplaceRecordsZv(key, n, t)
  if (i !== undefined) return fail(i)
  if (!Array.isArray(n)) {
    return fail(w('entries', "an 'inPlace' replace takes an array"))
  }
  const path = host.resolvePath(key)
  if (!path) return fail({ code: 'InvalidArgument' })
  const bytes = encodeReplaceEntries(n as Array<{ data: string | Uint8Array }>)
  const makeParent = t?.parent !== 'mustExist'
  if ((t?.publishDiscipline ?? 'atomic') === 'inPlace') {
    const wrote = await writeStreamFile(path, bytes, makeParent)
    if (!wrote.ok) return wrote
    return { ok: true, value: { bytes: bytes.byteLength } }
  }
  const parent = await ensureParentOe(path, makeParent)
  if (parent !== undefined && !parent.ok) return parent
  const staged = `${path}.replace-tmp`
  await writeFile(staged, bytes)
  await rename(staged, path)
  return { ok: true, value: { bytes: bytes.byteLength } }
}

function isAbsNoDotOm(e: unknown): boolean {
  if (typeof e !== 'string' || e.length === 0 || e.includes('\0')) return false
  if (!isAbsolute(e)) return false
  return !e.split(/[\\/]/).some(s => s === '.' || s === '..')
}

function looksNetworkCn(e: string): boolean {
  return e.includes('://') || e.startsWith('\\\\') || e.startsWith('//')
}

/** densable leftover `Ov` @207515637. */
function validateSourcePathOv(e: unknown): WriteValidateErr | undefined {
  return isAbsNoDotOm(e)
    ? undefined
    : w('path', 'an absolute path to the source file with no . or .. segments')
}

/** densable leftover `xv` @207516152. */
function validateGrowthXv(e: unknown): WriteValidateErr | undefined {
  return e === undefined || e === 'refuse' || e === 'prefix'
    ? undefined
    : w('opts.growth', "must be 'refuse' or 'prefix'")
}

/** densable leftover `Iv` @207516268. */
function validateIngestMiscIv(
  e:
    | {
        consumeSource?: unknown
        copy?: unknown
        requireMode?: unknown
        flush?: unknown
      }
    | undefined,
): WriteValidateErr | undefined {
  if (e?.consumeSource !== undefined && typeof e.consumeSource !== 'boolean') {
    return w('opts.consumeSource', 'must be a boolean')
  }
  if (e?.copy !== undefined && e.copy !== true) {
    return w('opts.copy', 'must be true or omitted')
  }
  if (e?.requireMode !== undefined && typeof e.requireMode !== 'boolean') {
    return w('opts.requireMode', 'must be a boolean')
  }
  if (e?.flush !== undefined && typeof e.flush !== 'boolean') {
    return w('opts.flush', 'must be a boolean')
  }
}

/** densable leftover `Av` @207516689. */
function validateExpectAv(
  e: { singleName?: unknown; maxBytes?: unknown; within?: unknown } | undefined,
): WriteValidateErr | undefined {
  if (e === undefined) return
  if (typeof e !== 'object' || e === null) {
    return w('opts.expect', 'must be an object')
  }
  if (e.singleName !== undefined && typeof e.singleName !== 'boolean') {
    return w('opts.expect.singleName', 'must be a boolean')
  }
  if (
    e.maxBytes !== undefined &&
    !(Number.isSafeInteger(e.maxBytes) && (e.maxBytes as number) >= 0)
  ) {
    return w('opts.expect.maxBytes', 'a non-negative integer')
  }
  if (e.within !== undefined && !isAbsNoDotOm(e.within)) {
    return w(
      'opts.expect.within',
      'an absolute directory path with no . or .. segments',
    )
  }
}

/** densable leftover `Sv` @207506595. */
function validateWriteFromStreamSv(
  e: unknown,
  r: unknown,
): WriteValidateErr | undefined {
  if (
    typeof e !== 'object' ||
    e === null ||
    typeof (e as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function'
  ) {
    return w('body', 'expected an async iterable of byte chunks')
  }
  if (typeof r !== 'object' || r === null) {
    return w('opts', 'expected an options object with maxBytes')
  }
  const opts = r as {
    maxBytes?: unknown
    precondition?: { type?: string }
    mode?: unknown
  }
  if (
    typeof opts.maxBytes !== 'number' ||
    !Number.isSafeInteger(opts.maxBytes) ||
    opts.maxBytes < 0
  ) {
    return w('opts.maxBytes', 'must be a non-negative integer')
  }
  const n = opts.precondition
  if (
    n !== undefined &&
    (typeof n !== 'object' ||
      n === null ||
      (n.type !== 'ifAbsent' && n.type !== 'none'))
  ) {
    return w(
      'opts.precondition',
      "must be { type: 'ifAbsent' } or { type: 'none' } — a versioned compare is write()'s",
    )
  }
  const t = opts.mode
  if (
    t !== undefined &&
    (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > 511)
  ) {
    return w(
      'opts.mode',
      'must be an integer permission mode between 0 and 0o777',
    )
  }
}

type WriteFromFileOpts = {
  parent?: string
  precondition?: { type?: string; version?: string }
  growth?: string
  consumeSource?: boolean
  copy?: true
  requireMode?: boolean
  flush?: boolean
  expect?: { singleName?: boolean; maxBytes?: number; within?: string }
}

/** densable leftover `Jf` @207502320. */
export async function writeFromFileJf(
  host: HbMutateHost,
  r: unknown,
  n: unknown,
  t?: WriteFromFileOpts,
): Promise<StorageHbResult<{ bytes: number; version?: string }>> {
  if (host.closed) return closed()
  const key = asRecord(r)
  if (!key) return fail(w('key', 'expected a key object'))
  const i =
    validateStorageKey(key) ??
    validateBridgeSpawnRoot(host.roots, key) ??
    validateMarketplaceCacheReadOnly(key) ??
    (isStreamKeyI(key)
      ? w('key', 'a value key, not a stream')
      : getReadSymlinkClass(key) === 'follow'
        ? w(
            'key',
            'a machine-written key: a person-edited (symlink-following) key is not ingested from a file in this version',
          )
        : undefined) ??
    validateSourcePathOv(n) ??
    validatePreconditionOpt(t?.precondition) ??
    validatePreconditionDiscipline(key, t?.precondition) ??
    validateParentOpt(t) ??
    validateGrowthXv(t?.growth) ??
    validateIngestMiscIv(t) ??
    validateExpectAv(t?.expect)
  if (i !== undefined) return fail(i)
  const o = await validateMarketplaceCacheSymlinks(host.roots, key, 'always')
  if (o !== undefined) return fail(o)
  const src = n as string
  const within = t?.expect?.within
  if (looksNetworkCn(src) || (within !== undefined && looksNetworkCn(within))) {
    return fail({ code: 'InvalidArgument' })
  }
  const s = host.resolvePath(key)
  if (!s) return fail({ code: 'InvalidArgument' })
  if (src === s) {
    return fail(w('path', "a source file, not the key's own"))
  }
  const l = t?.parent !== 'mustExist'
  if (!l) {
    const missing = await ensureParentOe(s, false)
    if (missing !== undefined && !missing.ok) return missing
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(src))
  } catch (error) {
    if (isENOENT(error)) return { ok: false, error: { code: 'NotFound' } }
    return { ok: false, error: { code: 'Failed' } }
  }
  const written = await publishValidatedStorageFile(
    host.roots,
    key,
    s,
    bytes,
    t,
    host.digestHost,
  )
  if (!written.ok) return written
  if (t?.consumeSource === true) {
    await unlink(src).catch(() => {})
  }
  return {
    ok: true,
    value: { bytes: bytes.byteLength, version: written.value.version },
  }
}

type WriteFromStreamOpts = {
  maxBytes: number
  parent?: string
  precondition?: { type?: string }
  mode?: number
}

/** densable leftover `Zf` @207504036. */
export async function writeFromStreamZf(
  host: HbMutateHost,
  r: unknown,
  n: unknown,
  t: WriteFromStreamOpts,
): Promise<StorageHbResult<{ bytes: number; version?: string }>> {
  if (host.closed) return closed()
  const key = asRecord(r)
  if (!key) return fail(w('key', 'expected a key object'))
  const i =
    validateStorageKey(key) ??
    validateBridgeSpawnRoot(host.roots, key) ??
    validateMarketplaceCacheReadOnly(key) ??
    (isStreamKeyI(key)
      ? w('key', 'a value key, not a stream')
      : getReadSymlinkClass(key) === 'follow'
        ? w(
            'key',
            'a machine-written key: a person-edited (symlink-following) key is not written from a stream in this version',
          )
        : undefined) ??
    validateWriteFromStreamSv(n, t) ??
    validatePreconditionDiscipline(key, t?.precondition) ??
    validateParentOpt(t)
  if (i !== undefined) return fail(i)
  const o = await validateMarketplaceCacheSymlinks(host.roots, key, 'always')
  if (o !== undefined) return fail(o)
  const a = host.resolvePath(key)
  if (!a) return fail({ code: 'InvalidArgument' })
  const s = t.parent !== 'mustExist'
  if (!s) {
    const missing = await ensureParentOe(a, false)
    if (missing !== undefined && !missing.ok) return missing
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of n as AsyncIterable<unknown>) {
    const bytes =
      typeof chunk === 'string'
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array
          ? chunk
          : undefined
    if (!bytes)
      return fail(w('body', 'expected an async iterable of byte chunks'))
    total += bytes.byteLength
    if (total > t.maxBytes) {
      return fail(w('opts.maxBytes', 'must be a non-negative integer'))
    }
    chunks.push(bytes)
  }
  const body = new Uint8Array(Buffer.concat(chunks))
  const written = await publishValidatedStorageFile(
    host.roots,
    key,
    a,
    body,
    t,
    host.digestHost,
  )
  if (!written.ok) return written
  return {
    ok: true,
    value: { bytes: body.byteLength, version: written.value.version },
  }
}

export function decodeUpdateTextView(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes)
}

export function identityUpdateView(bytes: Uint8Array): Uint8Array {
  return bytes
}

/** densable leftover `df`=`P`=`Bad` @206346052. */
const STAGING_SUFFIX_DF = '.tmp~'

/** densable leftover `po` — `getScopeFieldSpecs`. */
function scopeFieldPairsPo(
  e: Record<string, unknown>,
): Array<[string, unknown]> | undefined {
  const specs = getScopeFieldSpecs(e)
  if (specs === undefined) return
  return specs.map(([name, value]) => [name, value])
}

/** densable leftover `xf` @207481748 — `df` + `Vk(4)` hex. */
function stagingSuffixXf(): string {
  return `${STAGING_SUFFIX_DF}${randomBytes(4).toString('hex')}`
}

/**
 * densable leftover `Of` @207481306 — pluginCache.version only.
 */
function assertStagingVersionFieldOf(
  caller: string,
  scope: Record<string, unknown>,
  field: string,
): void {
  if (!(scope.namespace === 'pluginCache' && field === 'version')) {
    throw Error(
      "stagingScopeBeside / stagingScopeWithin: only a whole plugin version can be staged — a session's main transcript lives beside its folder, and the other classes own no tree moveScope publishes",
      { cause: caller },
    )
  }
}

/**
 * densable leftover `Lf` @207480654.
 * First undefined `po` field becomes `install${xf()}`.
 */
export function stagingScopeWithinLf(e: unknown): Record<string, unknown> {
  const r = validateStorageScope(e)
  if (r !== undefined) {
    throw Error('stagingScopeWithin: the parent scope is malformed', {
      cause: r,
    })
  }
  const scope = e as Record<string, unknown>
  const n = `install${stagingSuffixXf()}`
  const t = (scopeFieldPairsPo(scope) ?? []).find(([, o]) => o === undefined)
  if (t === undefined) {
    throw Error('stagingScopeWithin: the scope has no narrower level')
  }
  const [i] = t
  assertStagingVersionFieldOf('stagingScopeWithin', scope, i)
  return { ...scope, [i]: n }
}

/**
 * densable leftover `Pf` @207480971.
 * Last defined `po` field is suffixed `${value}${xf()}`.
 */
export function stagingScopeBesidePf(e: unknown): Record<string, unknown> {
  const r = validateStorageScope(e)
  if (r !== undefined) {
    throw Error('stagingScopeBeside: the scope is malformed', { cause: r })
  }
  const scope = e as Record<string, unknown>
  const n = stagingSuffixXf()
  const t = (scopeFieldPairsPo(scope) ?? [])
    .filter(([, a]) => a !== undefined)
    .at(-1)
  if (t === undefined) {
    throw Error('stagingScopeBeside: the scope has no segment to stage beside')
  }
  const [i, o] = t
  assertStagingVersionFieldOf('stagingScopeBeside', scope, i)
  return { ...scope, [i]: `${String(o)}${n}` }
}
