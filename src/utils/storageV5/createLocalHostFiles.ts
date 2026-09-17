/**
 * densable leftover `$c` @207455722 — `createLocalHostFiles`.
 * Spaces `Tc`=`Vt`=`agd` @205107964.
 * `ft`=`Hr`, `Dc`=`Oe`, `us`=`Br`, `ls`=`Ur`, `Vc`=`$r`,
 * `Kc`=`Mr`, `_c`=`Wr`, `Uc`=`zr`, `jc`=`Vr`, `qc`=`Gr`.
 * `Cc`=`lr` Unsupported; `zt`=`fr` AttestedAbsent.
 * hardened `zc`=`$t` leftover-faithful via `writeFileAndFlush`.
 */

import { constants as fsConstants } from 'fs'
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import {
  SymlinkWriteRefusedError,
  writeFileAndFlush,
} from '../symlinkWriteGuard.js'

/** densable leftover `Tc`=`Vt`=`agd` @205107964 — `["home","workspace","system","userNamed"]`. */
export const HOST_FILE_SPACES_TC = [
  'home',
  'workspace',
  'system',
  'userNamed',
] as const

export type HostFileSpace = (typeof HOST_FILE_SPACES_TC)[number]

export type HostFilePath = { space: HostFileSpace; path: string }

export type HostFileServeMode = true | false | 'absent'

export type HostFilesServeMap = Partial<
  Record<HostFileSpace, HostFileServeMode>
>

export type HostFilesStoreRoots = {
  configHome: string
  globalConfigFile: string
  heldRoots?: string[]
  home?: string | (() => string)
}

export type CreateLocalHostFilesOpts = {
  serve?: HostFilesServeMap
  refuse?: () => HostFilesError | undefined
  store?: {
    roots: HostFilesStoreRoots
    resolved?: Promise<HostFilesStoreRoots | undefined>
  }
}

export type HostFilesError = {
  code: string
  argument?: string
  reason?: string
  failureClass?: string
  telemetryCode?: string
  cause?: unknown
}

export type HostFilesResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: HostFilesError }

const SANCTIONED_CONFIG_HOME_FILES_GT = [
  'completion.zsh',
  'completion.bash',
  'completion.fish',
] as const

const JT_STORE_PATH =
  "a path under the config home is the store's own state: address it by its key, not as a host file"

const PERMISSION_ERRNOS = new Set(['EACCES', 'EPERM'])
const RESOURCE_ERRNOS = new Set([
  'EMFILE',
  'ENFILE',
  'ENOSPC',
  'EDQUOT',
  'ENOMEM',
])
const ENVIRONMENT_ERRNOS = new Set([
  'EROFS',
  'ENODEV',
  'ENOTSUP',
  'ELOOP',
  'EISDIR',
  'ENXIO',
  'ENOTDIR',
  'OtherNames',
  'LeafMoved',
  'HardeningUnavailable',
  'ENAMETOOLONG',
])

const ACCESS_MK: Record<string, number> = {
  exists: fsConstants.F_OK,
  read: fsConstants.R_OK,
  write: fsConstants.W_OK,
  execute: fsConstants.X_OK,
}

function ok<T>(value: T): HostFilesResult<T> {
  return { ok: true, value }
}

function fail(error: HostFilesError): HostFilesResult<never> {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invalid(argument: string, reason?: string): HostFilesError {
  return { code: 'InvalidArgument', argument, ...(reason && { reason }) }
}

/** densable leftover `zt` path shape @205104527. */
function requireAbsolutePathZt(
  path: unknown,
  argument: string,
  reason: string,
): HostFilesError | undefined {
  return typeof path === 'string' &&
    path.length > 0 &&
    !path.includes('\0') &&
    isAbsolute(path)
    ? undefined
    : invalid(argument, reason)
}

/** densable leftover `Oe`/`Dc` @205104627. */
function validateHostPathDc(
  value: unknown,
  argument = 'path',
): HostFilesError | undefined {
  if (typeof value !== 'object' || value === null) {
    return invalid(argument, 'a host path { space, path }')
  }
  const { space, path } = value as { space?: unknown; path?: unknown }
  if (
    typeof space !== 'string' ||
    !(HOST_FILE_SPACES_TC as readonly string[]).includes(space)
  ) {
    return invalid(
      argument,
      "space must be 'home', 'workspace', 'system' or 'userNamed'",
    )
  }
  return requireAbsolutePathZt(
    path,
    argument,
    'an absolute path with no NUL byte',
  )
}

/** densable leftover `Hr`/`ft` @205104848. */
function peelHostPathFt(value: unknown): { space?: string; path?: string } {
  if (typeof value !== 'object' || value === null) return value as never
  const { space, path } = value as { space?: string; path?: string }
  return { space, path }
}

/** densable leftover `Br`/`us`. */
function storeOverlapUs(argument = 'path'): HostFilesError {
  return invalid(argument, JT_STORE_PATH)
}

/** densable leftover `Cc`=`lr` @205102619 — `Pt`=`Unsupported`. */
function refusedSpaceCc(): HostFilesError {
  return {
    code: 'Failed',
    failureClass: 'environment',
    telemetryCode: 'Unsupported',
  }
}

/** densable leftover `zt`/`fr` — `Ft`=`AttestedAbsent`. */
function attestedAbsentZt(): HostFilesError {
  return {
    code: 'Failed',
    failureClass: 'environment',
    telemetryCode: 'AttestedAbsent',
  }
}

function isUnderAe(path: string, root: string): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep
  return path !== root && path.startsWith(prefix)
}

/** densable leftover `Ur`/`ls` @205104900. */
function pathHitsStoreLs(
  path: string,
  roots: HostFilesStoreRoots,
  n?: {
    admitRoot?: boolean
    admitSanctionedFiles?: boolean
    configHomeRuleOff?: boolean
  },
): boolean {
  const r = resolve(path)
  for (const held of roots.heldRoots ?? []) {
    const a = resolve(held)
    if (r === a || isUnderAe(r, a)) return true
  }
  const i = resolve(roots.globalConfigFile)
  if (
    r === i ||
    (dirname(r) === dirname(i) && basename(r).startsWith(`${basename(i)}.`))
  ) {
    return true
  }
  if (n?.configHomeRuleOff === true) return false
  const o = resolve(roots.configHome)
  if (r === o) return n?.admitRoot !== true
  if (!isUnderAe(r, o)) return false
  return !(
    n?.admitSanctionedFiles === true &&
    dirname(r) === o &&
    (SANCTIONED_CONFIG_HOME_FILES_GT as readonly string[]).includes(basename(r))
  )
}

function requireModeOctal(
  mode: unknown,
  argument: string,
): HostFilesError | undefined {
  return mode === undefined ||
    (typeof mode === 'number' &&
      Number.isInteger(mode) &&
      mode >= 0 &&
      mode <= 4095)
    ? undefined
    : invalid(argument, 'mode must be an integer 0..0o7777')
}

function requireBoolean(
  value: unknown,
  argument: string,
  label: string,
): HostFilesError | undefined {
  return value === undefined || typeof value === 'boolean'
    ? undefined
    : invalid(argument, `${label} must be a boolean`)
}

function requireOptsObject(opts: unknown): HostFilesError | undefined {
  return opts === undefined || (typeof opts === 'object' && opts !== null)
    ? undefined
    : invalid('opts', 'options must be an object')
}

/** densable leftover `$r`/`Vc`. */
function validateWriteVc(
  hostPath: { space?: string },
  data: unknown,
  n?: Record<string, unknown>,
): HostFilesError | undefined {
  if (typeof data !== 'string' && !(data instanceof Uint8Array)) {
    return invalid('data', 'data must be a string or a Uint8Array')
  }
  const i = n ?? {}
  const o = requireOptsObject(n) ?? requireModeOctal(i.mode, 'opts')
  if (o !== undefined) return o
  if (i.publish === undefined || i.publish === 'inPlace') {
    return (
      requireBoolean(i.exclusive, 'opts', 'exclusive') ??
      (i.symlinks === undefined &&
      i.refuseLinkedParent === undefined &&
      i.stagingFolder === undefined
        ? undefined
        : invalid(
            'opts',
            "symlinks, refuseLinkedParent and stagingFolder belong to publish 'hardenedAtomic'",
          ))
    )
  }
  if (i.publish !== 'hardenedAtomic') {
    return invalid('opts', "publish must be 'inPlace' or 'hardenedAtomic'")
  }
  if (typeof data !== 'string') {
    return invalid('data', 'a hardened write takes text: data must be a string')
  }
  if (i.exclusive !== undefined) {
    return invalid('opts', "exclusive belongs to publish 'inPlace'")
  }
  if (
    i.symlinks !== undefined &&
    i.symlinks !== 'refuse' &&
    i.symlinks !== 'through'
  ) {
    return invalid('opts', "symlinks must be 'refuse' or 'through'")
  }
  const s =
    requireBoolean(i.refuseLinkedParent, 'opts', 'refuseLinkedParent') ??
    (i.refuseLinkedParent === true && i.symlinks === 'through'
      ? invalid(
          'opts',
          "refuseLinkedParent cannot hold under symlinks 'through'",
        )
      : undefined)
  if (s !== undefined || i.stagingFolder === undefined) return s
  const a = validateHostPathDc(i.stagingFolder, 'opts.stagingFolder')
  if (a !== undefined) return a
  const staging = i.stagingFolder as HostFilePath
  return hostPath.space === undefined || staging.space === hostPath.space
    ? undefined
    : invalid(
        'opts.stagingFolder',
        'the staging folder must be in the same space as the path',
      )
}

/** densable leftover `Mr`/`Kc`. */
function validateEnsureFolderKc(e: unknown): HostFilesError | undefined {
  const t = (e ?? {}) as Record<string, unknown>
  return (
    requireOptsObject(e) ??
    requireModeOctal(t.mode, 'opts') ??
    requireBoolean(t.recursive, 'opts', 'recursive')
  )
}

/** densable leftover `Wr`/`_c`. */
function validateAccessC(e: unknown): HostFilesError | undefined {
  const t = (e ?? {}) as Record<string, unknown>
  return (
    requireOptsObject(e) ??
    (t.mode === undefined ||
    t.mode === 'exists' ||
    t.mode === 'read' ||
    t.mode === 'write' ||
    t.mode === 'execute'
      ? undefined
      : invalid('opts', "mode must be 'exists', 'read', 'write' or 'execute'"))
  )
}

/** densable leftover `Vr`/`jc`. */
function validateDeleteJc(e: unknown): HostFilesError | undefined {
  const t = (e ?? {}) as Record<string, unknown>
  return (
    requireOptsObject(e) ?? requireBoolean(t.missingOk, 'opts', 'missingOk')
  )
}

/** densable leftover `zr`/`Uc`. */
function validateRenameUc(
  from: { space?: string },
  to: unknown,
): HostFilesError | undefined {
  const n = validateHostPathDc(to, 'to')
  if (n !== undefined) return n
  const dest = to as HostFilePath
  return dest.space === from.space
    ? undefined
    : invalid('to', 'a rename stays within one space')
}

/** densable leftover `Gr`/`qc`. */
function validateStatQc(e: unknown): HostFilesError | undefined {
  const t = (e ?? {}) as Record<string, unknown>
  return requireOptsObject(e) ?? requireBoolean(t.follow, 'opts', 'follow')
}

/** densable leftover `Bk` @207460433. */
function peelWriteOptsBk(e: unknown): Record<string, unknown> | undefined {
  if (e === undefined || e === null || typeof e !== 'object') {
    return e as undefined
  }
  const r = e as Record<string, unknown>
  const n = r.stagingFolder
  const t: Record<string, unknown> = {
    publish: r.publish,
    mode: r.mode,
    exclusive: r.exclusive,
    symlinks: r.symlinks,
    refuseLinkedParent: r.refuseLinkedParent,
    stagingFolder: n === undefined ? undefined : peelHostPathFt(n),
  }
  for (const i of Object.keys(t)) {
    if (t[i] === undefined) delete t[i]
  }
  return t
}

function direntKindCk(e: {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  name: string
}): { name: string; kind: string } {
  const r = e.isFile()
    ? 'file'
    : e.isDirectory()
      ? 'directory'
      : e.isSymbolicLink()
        ? 'link'
        : 'other'
  return { name: e.name, kind: r }
}

function failureClassIo(code: string | undefined): string {
  if (code === undefined) return 'unknown'
  if (PERMISSION_ERRNOS.has(code)) return 'permission'
  if (RESOURCE_ERRNOS.has(code)) return 'resource'
  if (ENVIRONMENT_ERRNOS.has(code)) return 'environment'
  return 'unknown'
}

/** densable leftover `xn` @207461793. */
function wrapFsXn(error: unknown): HostFilesError {
  const r =
    getErrnoCode(error) ??
    (error instanceof SymlinkWriteRefusedError ? 'ELOOP' : undefined)
  return {
    code: 'Failed',
    failureClass: failureClassIo(r),
    cause: error,
    ...(r !== undefined && { telemetryCode: r }),
  }
}

function notFoundWt(error: unknown): HostFilesResult<{ found: false }> {
  return getErrnoCode(error) === 'ENOENT'
    ? ok({ found: false })
    : fail(wrapFsXn(error))
}

function statKindDk(e: {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  size: number | bigint
  mtimeMs: number | bigint
  mode: number | bigint
  nlink: number | bigint
  ino?: number | bigint
  dev?: number | bigint
}): Record<string, unknown> {
  const r = e.isFile()
    ? 'file'
    : e.isDirectory()
      ? 'directory'
      : e.isSymbolicLink()
        ? 'link'
        : 'other'
  return {
    kind: r,
    size: Number(e.size),
    mtimeMs: Number(e.mtimeMs),
    mode: Number(e.mode),
    nlink: Number(e.nlink),
    ...(e.ino !== undefined &&
      e.dev !== undefined && {
        objectId: `${e.dev.toString()}:${e.ino.toString()}`,
      }),
  }
}

/** densable leftover `Ht` @207461660. */
async function realpathWalkHt(e: string): Promise<string> {
  const r = resolve(e)
  const n: string[] = []
  let t = r
  for (;;) {
    try {
      return join(await realpath(t), ...n)
    } catch {
      const i = dirname(t)
      if (i === t) return r
      n.unshift(basename(t))
      t = i
    }
  }
}

/** densable leftover `Tk` @207460882. */
async function homeFenceTk(
  store: HostFilesStoreRoots,
  resolved: Promise<HostFilesStoreRoots | undefined>,
): Promise<boolean> {
  let n: unknown
  try {
    n =
      typeof store.home === 'function'
        ? store.home()
        : (store.home ?? homedir())
  } catch (a) {
    logForDebugging(
      `storage: the host-files config-home fence stays on (the home folder could not be determined: ${String(a)})`,
    )
    return true
  }
  if (typeof n !== 'string' || !isAbsolute(n)) {
    logForDebugging(
      'storage: the host-files config-home fence stays on (the home folder reported is empty or not an absolute path)',
    )
    return true
  }
  const t = [...new Set([resolve(n), await realpathWalkHt(n)])]
  const i = (a: string): boolean => {
    const s = resolve(a)
    return t.some(l => l === s || isUnderAe(s, l))
  }
  let o = i(store.configHome)
  if (!o) {
    const a = await resolved
    o = a !== undefined && i(a.configHome)
  }
  if (o) {
    logForDebugging(
      'storage: the host-files config-home rule stands down (the config home is the home folder or above it); the global config file and the roots held independent of the config home stay fenced, everything else behaves exactly as today',
    )
  }
  return !o
}

export type LocalHostFiles = {
  serves: (space: string) => boolean
  serving: (space: string) => 'host' | 'refused' | 'absent'
  readText: (
    path: unknown,
  ) => Promise<
    HostFilesResult<
      { found: false } | { found: true; value: string; bytes: number }
    >
  >
  readBytes: (
    path: unknown,
  ) => Promise<
    HostFilesResult<
      { found: false } | { found: true; value: Uint8Array; bytes: number }
    >
  >
  write: (
    path: unknown,
    data: unknown,
    opts?: unknown,
  ) => Promise<HostFilesResult<{ bytes: number }>>
  listFolder: (
    path: unknown,
  ) => Promise<
    HostFilesResult<
      | { found: false }
      | { found: true; entries: Array<{ name: string; kind: string }> }
    >
  >
  ensureFolder: (
    path: unknown,
    opts?: unknown,
  ) => Promise<HostFilesResult<{ created: boolean }>>
  readLink: (
    path: unknown,
  ) => Promise<
    HostFilesResult<{ found: false } | { found: true; target: string }>
  >
  access: (
    path: unknown,
    opts?: unknown,
  ) => Promise<HostFilesResult<{ accessible: boolean; code?: string }>>
  rename: (from: unknown, to: unknown) => Promise<HostFilesResult<void>>
  delete: (
    path: unknown,
    opts?: unknown,
  ) => Promise<HostFilesResult<{ existed: boolean }>>
  realPath: (
    path: unknown,
  ) => Promise<
    HostFilesResult<{ found: false } | { found: true; path: string }>
  >
  stat: (
    path: unknown,
    opts?: unknown,
  ) => Promise<HostFilesResult<Record<string, unknown>>>
}

/**
 * densable leftover `$c` @207455722.
 */
export function createLocalHostFiles(
  e: CreateLocalHostFilesOpts = {},
): LocalHostFiles {
  const r = new Map(
    HOST_FILE_SPACES_TC.map(l => {
      const d =
        e.serve !== undefined && Object.hasOwn(e.serve, l)
          ? e.serve[l]
          : undefined
      if (d === undefined || d === true) return [l, 'host'] as const
      if (d === false) return [l, 'refused'] as const
      if (d === 'absent') return [l, 'absent'] as const
      throw TypeError(
        "createLocalHostFiles: each serve[space] must be true, false or 'absent'",
      )
    }),
  )
  const n = (l: string): 'host' | 'refused' | 'absent' =>
    r.get(l as HostFileSpace) ?? 'refused'
  const t = (l: string): boolean => n(l) !== 'refused'
  const i =
    e.store?.resolved?.catch(() => undefined) ?? Promise.resolve(undefined)
  const o =
    e.store === undefined
      ? Promise.resolve(false)
      : homeFenceTk(e.store.roots, i).catch(() => true)

  async function overlaps(l: string, d: string, c: string): Promise<boolean> {
    if (e.store === undefined || d === 'metadata' || c === 'userNamed') {
      return false
    }
    const f = {
      admitRoot: d === 'folder',
      admitSanctionedFiles: d === 'content',
      configHomeRuleOff: !(await o),
    }
    if (pathHitsStoreLs(l, e.store.roots, f)) return true
    const p = await i
    return p !== undefined && pathHitsStoreLs(l, p, f)
  }

  async function admit(
    l: unknown,
    d: string,
    c?: HostFilesError,
    f?: { path: string; argument: string; reach?: string },
    p = 'path',
  ): Promise<{ error: HostFilesError } | { absent: true } | { path: string }> {
    const g = peelHostPathFt(l)
    const v = e.refuse?.() ?? validateHostPathDc(g, p) ?? c
    if (v !== undefined) return { error: v }
    const { space: b, path: h } = g
    if (await overlaps(h!, d, b!)) return { error: storeOverlapUs(p) }
    if (f !== undefined && (await overlaps(f.path, f.reach ?? d, b!))) {
      return { error: storeOverlapUs(f.argument) }
    }
    switch (n(b!)) {
      case 'refused':
        return { error: refusedSpaceCc() }
      case 'absent':
        return { absent: true }
      case 'host':
        return { path: h! }
    }
  }

  return {
    serves: t,
    serving: n,
    async readText(l) {
      const d = await admit(l, 'content')
      if ('error' in d) return fail(d.error)
      if ('absent' in d) return ok({ found: false })
      try {
        const c = await readFile(d.path, { encoding: 'utf8' })
        return ok({ found: true, value: c, bytes: Buffer.byteLength(c) })
      } catch (c) {
        return notFoundWt(c)
      }
    },
    async readBytes(l) {
      const d = await admit(l, 'content')
      if ('error' in d) return fail(d.error)
      if ('absent' in d) return ok({ found: false })
      try {
        const c = await readFile(d.path)
        const f = new Uint8Array(c.buffer, c.byteOffset, c.byteLength)
        return ok({ found: true, value: f, bytes: f.byteLength })
      } catch (c) {
        return notFoundWt(c)
      }
    },
    async write(l, d, c) {
      const f = peelWriteOptsBk(c)
      const p = peelHostPathFt(l)
      const g = f?.publish === 'hardenedAtomic' ? f.stagingFolder : undefined
      const v =
        g !== undefined && g !== null
          ? {
              path: String((g as HostFilePath).path ?? ''),
              argument: 'opts.stagingFolder',
              reach: 'staging',
            }
          : undefined
      const b = await admit(p, 'content', validateWriteVc(p, d, f), v)
      if ('error' in b) return fail(b.error)
      if ('absent' in b) return fail(attestedAbsentZt())
      const h =
        typeof d === 'string'
          ? Buffer.byteLength(d)
          : (d as Uint8Array).byteLength
      if (f?.publish === 'hardenedAtomic') {
        try {
          await writeFileAndFlush(b.path, d as string, {
            encoding: 'utf-8',
            ...(f.mode !== undefined && { mode: f.mode as number }),
            allowSymlink: f.symlinks === 'through',
            checkParentDir: f.refuseLinkedParent === true,
            ...(f.stagingFolder !== undefined && {
              stagingDir: String((f.stagingFolder as HostFilePath).path),
            }),
          })
          return ok({ bytes: h })
        } catch (E) {
          return fail(wrapFsXn(E))
        }
      }
      try {
        await writeFile(b.path, d as string | Uint8Array, {
          ...(f?.exclusive === true && { flag: 'wx' }),
          ...(f?.mode !== undefined && { mode: f.mode as number }),
        })
        return ok({ bytes: h })
      } catch (E) {
        return fail(wrapFsXn(E))
      }
    },
    async listFolder(l) {
      const d = await admit(l, 'content')
      if ('error' in d) return fail(d.error)
      if ('absent' in d) return ok({ found: false })
      try {
        const c = await readdir(d.path, { withFileTypes: true })
        return ok({ found: true, entries: c.map(direntKindCk) })
      } catch (c) {
        return notFoundWt(c)
      }
    },
    async ensureFolder(l, d) {
      const c =
        d === undefined || d === null || typeof d !== 'object'
          ? d
          : {
              mode: (d as { mode?: number }).mode,
              recursive: (d as { recursive?: boolean }).recursive,
            }
      const f = await admit(l, 'folder', validateEnsureFolderKc(c))
      if ('error' in f) return fail(f.error)
      if ('absent' in f) return fail(attestedAbsentZt())
      const p =
        isRecord(c) && typeof c.mode === 'number' ? { mode: c.mode } : {}
      try {
        if (isRecord(c) && c.recursive === false) {
          await mkdir(f.path, p)
          return ok({ created: true })
        }
        const g = await mkdir(f.path, { recursive: true, ...p })
        return ok({ created: g !== undefined })
      } catch (g) {
        return fail(wrapFsXn(g))
      }
    },
    async readLink(l) {
      const d = await admit(l, 'metadata')
      if ('error' in d) return fail(d.error)
      if ('absent' in d) return ok({ found: false })
      try {
        return ok({ found: true, target: await readlink(d.path) })
      } catch (c) {
        return notFoundWt(c)
      }
    },
    async access(l, d) {
      const c =
        d === undefined || d === null || typeof d !== 'object'
          ? d
          : { mode: (d as { mode?: string }).mode }
      const f = await admit(l, 'metadata', validateAccessC(c))
      if ('error' in f) return fail(f.error)
      if ('absent' in f) return ok({ accessible: false, code: 'ENOENT' })
      try {
        const mode = isRecord(c) ? (c.mode ?? 'exists') : 'exists'
        await access(f.path, ACCESS_MK[String(mode)] ?? fsConstants.F_OK)
        return ok({ accessible: true })
      } catch (p) {
        return ok({ accessible: false, code: getErrnoCode(p) ?? 'UNKNOWN' })
      }
    },
    async rename(l, d) {
      const c = peelHostPathFt(d)
      const f = peelHostPathFt(l)
      const p = await admit(
        f,
        'content',
        validateRenameUc(f, c),
        { path: String(c?.path ?? ''), argument: 'to' },
        'from',
      )
      if ('error' in p) return fail(p.error)
      if ('absent' in p) return fail(attestedAbsentZt())
      try {
        await rename(p.path, String(c.path))
        return ok(undefined)
      } catch (g) {
        return fail(wrapFsXn(g))
      }
    },
    async delete(l, d) {
      const c =
        d === undefined || d === null || typeof d !== 'object'
          ? d
          : { missingOk: (d as { missingOk?: boolean }).missingOk }
      const f = await admit(l, 'content', validateDeleteJc(c))
      if ('error' in f) return fail(f.error)
      if ('absent' in f) {
        return isRecord(c) && c.missingOk === true
          ? ok({ existed: false })
          : fail(attestedAbsentZt())
      }
      try {
        await unlink(f.path)
        return ok({ existed: true })
      } catch (p) {
        if (
          isRecord(c) &&
          c.missingOk === true &&
          getErrnoCode(p) === 'ENOENT'
        ) {
          return ok({ existed: false })
        }
        return fail(wrapFsXn(p))
      }
    },
    async realPath(l) {
      const d = await admit(l, 'metadata')
      if ('error' in d) return fail(d.error)
      if ('absent' in d) return ok({ found: false })
      try {
        return ok({ found: true, path: await realpath(d.path) })
      } catch (c) {
        return notFoundWt(c)
      }
    },
    async stat(l, d) {
      const c =
        d === undefined || d === null || typeof d !== 'object'
          ? d
          : { follow: (d as { follow?: boolean }).follow }
      const f = await admit(l, 'metadata', validateStatQc(c))
      if ('error' in f) return fail(f.error)
      if ('absent' in f) return ok({ kind: 'absent' })
      try {
        const p =
          isRecord(c) && c.follow === false
            ? await lstat(f.path, { bigint: true })
            : await stat(f.path, { bigint: true })
        return ok(statKindDk(p))
      } catch (p) {
        if (getErrnoCode(p) === 'ENOENT') return ok({ kind: 'absent' })
        return fail(wrapFsXn(p))
      }
    },
  }
}

/** densable leftover `Ab` @207547903. */
export function snapshotHostStoreRootsAb(roots: {
  configHome: string
  globalConfigFile: string
  bridgeSpawnRoot?: string
}): HostFilesStoreRoots {
  return {
    configHome: roots.configHome,
    globalConfigFile: roots.globalConfigFile,
    heldRoots:
      roots.bridgeSpawnRoot !== undefined ? [roots.bridgeSpawnRoot] : [],
  }
}

/** densable leftover `Mb` @207548008 leftover-faithful `Ht`. */
export async function resolveHostStoreRootsMb(roots: {
  configHome: string
  globalConfigFile: string
  bridgeSpawnRoot?: string
}): Promise<HostFilesStoreRoots> {
  const snapshot = snapshotHostStoreRootsAb(roots)
  const [configHome, globalDir, heldRoots] = await Promise.all([
    realpathWalkHt(snapshot.configHome),
    realpathWalkHt(dirname(snapshot.globalConfigFile)),
    Promise.all((snapshot.heldRoots ?? []).map(realpathWalkHt)),
  ])
  return {
    configHome,
    globalConfigFile: join(globalDir, basename(snapshot.globalConfigFile)),
    heldRoots,
  }
}
