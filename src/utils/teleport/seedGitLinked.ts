/**
 * densable `_583` `Or`/`Nr`/`tt`/`Ue`/`We`/`fe`/`pn` linked `.git` file chain.
 * Gold: gold-forged-Or.txt / gold-forged-K4n-Qi-full.txt /
 * gold-forged-pn-temp-roots.txt
 *
 * `pn` @210534261 unique. `oe`=`wZb`=`w` @209040413, `un`=`yZb`=`J`
 * @209040781 (`_615` `S`/`N`/`T`). `ne`=`yKb`=`Kr` @209860953 (`qa`=`homedir`).
 */

import { constants } from 'fs'
import { lstat, open, realpath } from 'fs/promises'
import { homedir as mn, tmpdir as T } from 'os'
import { basename, dirname, join, join as G, sep } from 'path'
import { gitdirPointerHopUnsafe } from '../git/gitdirHopWalk.js'
import { getErrnoCode } from '../errors.js'
import { getPlatform } from '../platform.js'
import { isWorktreePathNetworkRelativeToCwd } from '../worktree.js'
import { joinIfRelative, seedPathContains } from './seedGitInclude.js'

export type SeedGitFile =
  | { kind: 'not_file' }
  | { kind: 'refuse'; why: string; adminDir?: string }
  | { kind: 'chain'; adminDir: string; commonDir: string }

export type SeedLinkVoucher =
  | { kind: 'vouched'; gitDir: string; gitDirId: string; commonDir: string }
  | { kind: 'unread'; detail: string }
  | { kind: 'git_file' }
  | { kind: 'linked_worktree'; detail: string }

/** densable `Me` */
function oneLine(text: string | undefined): string | null {
  if (text === undefined) return null
  const n = text.replace(/\r?\n$/, '')
  return n === '' || /[\r\n]/.test(n) ? null : n
}

/** densable `me` */
async function readUtf8File(path: string): Promise<string | undefined> {
  if (getPlatform() === 'windows') {
    const st = await lstat(path).catch(() => null)
    if (st === null || !st.isFile()) return
  }
  const fh = await open(path, constants.O_RDONLY)
  try {
    const st = await fh.stat()
    if (!st.isFile() || st.size > 4096) return
    const buf = Buffer.alloc(st.size)
    const { bytesRead } = await fh.read(buf, 0, st.size, 0)
    return bytesRead === st.size ? buf.toString('utf8') : undefined
  } finally {
    await fh.close()
  }
}

/** densable `fe` = `Gn`/`Ji` || `Hn`/`xe` */
function pointerHopBad(
  pointer: string,
  base: string,
  jBase: string = base,
): boolean {
  return (
    isWorktreePathNetworkRelativeToCwd(pointer, jBase) ||
    gitdirPointerHopUnsafe(pointer, base, jBase)
  )
}

/** densable `We` — ENOENT is `null` (`Ue` → `.` / gitDir). */
export async function readCommondir(
  adminDir: string,
): Promise<string | null | undefined> {
  const path = join(adminDir, 'commondir')
  try {
    const text = await readUtf8File(path)
    if (text !== undefined) return text.replace(/\r?\n$/, '')
    const st = await lstat(path).catch(err => err)
    if (st instanceof Error) {
      return getErrnoCode(st) === 'ENOENT' ? null : undefined
    }
    return
  } catch (err) {
    return getErrnoCode(err) === 'ENOENT' ? null : undefined
  }
}

/** densable `Ue` */
export function resolveCommondir(
  listed: string | null | undefined,
  adminDir: string,
): string | undefined {
  if (listed === undefined) return
  const trimmed =
    listed === null
      ? '.'
      : listed.length > 1 && listed.endsWith('/')
        ? listed.slice(0, -1)
        : listed
  if (trimmed === '.') return adminDir
  if (trimmed === '../..') return dirname(dirname(adminDir))
  return trimmed
}

/** densable `_843` `y` */
function y(items: string[]): string[] {
  return [...new Set(items)]
}

/**
 * densable `_615` `N` — `l` is `_825` `ji`/`fgd` (`process.env`).
 * `T` is `os.tmpdir`. Do not invent TEMP/TMP.
 */
function N(): string {
  const e = process.env.CLAUDE_CODE_TMPDIR
  if (e) return e
  return T()
}

/** densable `_615` `w`/`S` as `oe` (`wZb`). */
function oe(): string {
  return G(N(), 'claude')
}

/** densable `_615` `J`/`S` as `un` (`yZb`). Same `S` path as `oe`. */
function un(): string {
  return G(N(), 'claude')
}

/**
 * densable `_584` `Kr` as `ne` (`yKb`). `qa` is `os.homedir` (`mn`).
 */
function ne(): string[] {
  const e = mn()
  return [
    '/dev/stdout',
    '/dev/stderr',
    '/dev/null',
    '/dev/tty',
    '/dev/dtracehelper',
    '/dev/autofs_nowait',
    '/tmp/claude',
    '/private/tmp/claude',
    G(e, '.npm/_logs'),
    G(e, '.claude/debug'),
  ]
}

/**
 * densable `pn` — `Ie`/`nt` when `j()` unset ⇒ `pn`.
 * Gold: gold-forged-pn-temp-roots.txt
 */
export function tempRootPaths(): string[] {
  return y([
    oe(),
    un(),
    ...ne().map(e =>
      e === '~' || e.startsWith('~/') ? G(mn(), e.slice(1)) : e,
    ),
  ])
}

/** densable `tt` */
async function commonDirPlacementOk(
  commonDir: string,
  workTree: string,
): Promise<boolean> {
  const parts = commonDir.split(sep).filter(part => part !== '')
  const leaf = parts.at(-1) ?? ''
  const looksGit = (part: string) =>
    part.toLowerCase() === '.git' || part.toLowerCase().endsWith('.git')
  if (!looksGit(leaf) || parts.slice(0, -1).some(looksGit)) return false
  if (
    seedPathContains(workTree, commonDir) ||
    seedPathContains(commonDir, workTree)
  ) {
    return false
  }
  return !tempRootPaths().some(root => seedPathContains(root, commonDir))
}

/** densable `Or` */
export async function classifyGitFile(cwd: string): Promise<SeedGitFile> {
  const gitFile = join(cwd, '.git')
  const st = await lstat(gitFile).catch(() => null)
  if (st === null || st.isDirectory()) return { kind: 'not_file' }
  if (!st.isFile() || st.nlink !== 1) {
    return { kind: 'refuse', why: 'git_file' }
  }
  const body = oneLine(await readUtf8File(gitFile).catch(() => undefined))
  const pointer = body === null ? undefined : /^gitdir: (.+)$/s.exec(body)?.[1]
  if (pointer === undefined || pointerHopBad(pointer, cwd)) {
    return { kind: 'refuse', why: 'git_file' }
  }
  const adminDir = await realpath(joinIfRelative(cwd, pointer)).catch(
    () => null,
  )
  if (adminDir === null) return { kind: 'refuse', why: 'admin_dir' }
  if (basename(dirname(adminDir)) !== 'worktrees') {
    return { kind: 'refuse', why: 'git_file', adminDir }
  }
  const commonDir = dirname(dirname(adminDir))
  if (resolveCommondir(await readCommondir(adminDir), adminDir) !== commonDir) {
    return { kind: 'refuse', why: 'common_dir', adminDir }
  }
  const back = oneLine(
    await readUtf8File(join(adminDir, 'gitdir')).catch(() => undefined),
  )
  const backPath =
    back === null || pointerHopBad(back, adminDir, cwd)
      ? null
      : await realpath(joinIfRelative(adminDir, back)).catch(() => null)
  if (backPath !== gitFile) {
    return { kind: 'refuse', why: 'back_link', adminDir }
  }
  if (!(await commonDirPlacementOk(commonDir, cwd))) {
    return { kind: 'refuse', why: 'placement', adminDir }
  }
  return { kind: 'chain', adminDir, commonDir }
}

/** densable `M` */
async function pathId(path: string): Promise<string | null> {
  try {
    const st = await lstat(path, { bigint: true })
    return `${st.dev}:${st.ino}`
  } catch {
    return null
  }
}

/** densable `Nr` */
export async function vouchLinkedGitDir(
  workTree: string,
  gitDir: string,
  commonDir: string,
  chain: { adminDir: string },
): Promise<SeedLinkVoucher> {
  const linked = (detail: string): SeedLinkVoucher => ({
    kind: 'linked_worktree',
    detail,
  })
  if (pointerHopBad(gitDir, workTree) || pointerHopBad(commonDir, workTree)) {
    return linked('admin_dir')
  }
  const [resolvedGit, resolvedCommon] = await Promise.all([
    realpath(gitDir).catch(() => null),
    realpath(commonDir).catch(() => null),
  ])
  if (resolvedGit === null || resolvedCommon === null) {
    return { kind: 'unread', detail: 'the git directory could not be resolved' }
  }
  const [gitId, adminId, commonId, parentId] = await Promise.all([
    pathId(resolvedGit),
    pathId(chain.adminDir),
    pathId(resolvedCommon),
    pathId(dirname(dirname(resolvedGit))),
  ])
  if (gitId !== null && gitId === commonId) return { kind: 'git_file' }
  if (
    gitId === null ||
    adminId !== gitId ||
    basename(dirname(resolvedGit)) !== 'worktrees' ||
    commonId === null ||
    parentId !== commonId
  ) {
    return linked('admin_dir')
  }
  if (
    resolveCommondir(await readCommondir(resolvedGit), resolvedGit) !==
    resolvedCommon
  ) {
    return linked('common_dir')
  }
  if (!(await commonDirPlacementOk(resolvedCommon, workTree))) {
    return linked('placement')
  }
  return {
    kind: 'vouched',
    gitDir: resolvedGit,
    gitDirId: gitId,
    commonDir: resolvedCommon,
  }
}

/**
 * densable `nt` — `Ie`/`j()` unset ⇒ `pn`, then realpath (`W`).
 * `y([...e,...n])` keeps both raw and resolved roots.
 */
export async function isSeedTempRoot(
  resolved: string,
  cwd: string,
): Promise<boolean> {
  const listed = tempRootPaths()
  const resolvedRoots = await Promise.all(
    listed.map(path => realpath(path).catch(() => path)),
  )
  return y([...listed, ...resolvedRoots]).some(
    root => seedPathContains(root, resolved) || seedPathContains(root, cwd),
  )
}
