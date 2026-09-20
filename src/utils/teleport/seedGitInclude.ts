/**
 * densable `_583` `rr` / `ar` include graph + `be`/`De`/`ie` reach.
 * Gold: gold-forged-rr.txt / gold-forged-ar.txt / gold-forged-be.txt /
 * gold-forged-ie-full.txt / gold-forged-gn.txt / gold-forged-ke.txt
 */

import { constants } from 'fs'
import { access, lstat, readlink, realpath, stat } from 'fs/promises'
import { homedir, userInfo } from 'os'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'path'
import { getErrnoCode } from '../errors.js'
import { getPlatform } from '../platform.js'
import type { SeedGitRun } from './seedWipInspect.js'

const INCLUDE_DEPTH = 8
const INCLUDE_OPEN_CAP = 32
const INCLUDE_SET_CAP = 4096
const INCLUDE_HOP = 40
const INCLUDE_PATH = /^(include|includeif\..*)\.path$/s
const FILTER_NAME = /^filter\.(.*)\.(?:clean|smudge|process|required)$/s
const HOOK_NAME = /^hook\.(.*)\.(?:command|event|enabled)$/s
const UNLISTABLE_NAME =
  'a configured filter driver or hook has a name that is not valid UTF-8'

export type SeedConfigPins = {
  filterDrivers: string[]
  configPins: Record<string, string>
}

export type SeedPinResult =
  | { kind: 'unlistable'; detail: string }
  | { kind: 'many_includes' }
  | { kind: 'included'; file: string }
  | { kind: 'pins'; pins: SeedConfigPins }

export type SeedConfigScope = {
  ids: Map<string, string>
  roots: string[]
  fixed: string[]
}

type SeedLayoutPin = {
  gitDir: string
  commonDir: string
  workTree: string
  bound: boolean
}

type NulRow = {
  origin: string
  key: string
  value: string
  valueless: boolean
}

/** densable `_843` `d` / `y` */
function uniq<T>(items: T[]): T[] {
  return [...new Set(items)]
}

/** densable `_843` `p` / `Mn` */
function countWhere<T>(items: T[], pred: (item: T) => boolean): number {
  let n = 0
  for (const item of items) n += +!!pred(item)
  return n
}

/** densable `x` */
export function joinIfRelative(base: string, path: string): string {
  return isAbsolute(path) ? path : `${base}${sep}${path}`
}

/**
 * densable `T` — `n` is inside `e` (or equal).
 * mac/windows NFC+lower before relative.
 */
export function seedPathContains(parent: string, path: string): boolean {
  if (!isAbsolute(path)) return false
  const fold = (value: string) => {
    const platform = getPlatform()
    return platform === 'macos' || platform === 'windows'
      ? value.normalize('NFC').toLowerCase()
      : value
  }
  const rel = relative(fold(parent), fold(path))
  const escaped =
    rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')
  return rel === '' || (!escaped && !isAbsolute(rel))
}

/** densable `Pt` */
function isWindowsDriveAbs(path: string): boolean {
  return /^[A-Za-z]:[\\/][^:]*$/.test(path)
}

/** densable `se` */
export function seedPathIsWinNonDrive(path: string): boolean {
  return getPlatform() === 'windows' && !isWindowsDriveAbs(path)
}

/** densable `St` — GIT_CONFIG_NOSYSTEM */
function gitConfigNoSystem(value: string | undefined): boolean {
  const n = value?.trim().toLowerCase()
  if (n === undefined || ['', 'false', 'no', 'off'].includes(n)) return false
  if (['true', 'yes', 'on'].includes(n)) return true
  return /^[-+]?\d+$/.test(n) && Number(n) !== 0
}

/** densable `ke` */
export function seedHomeDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const { HOME, HOMEDRIVE, HOMEPATH } = env
  const winHome =
    getPlatform() === 'windows' && HOMEDRIVE && HOMEPATH
      ? `${HOMEDRIVE}${HOMEPATH}`
      : undefined
  return uniq(
    [HOME, winHome, homedir()].filter((item): item is string => Boolean(item)),
  )
}

/** densable `gn` */
export function listGitConfigFiles(
  fromGitVar: string[],
  workTree: string,
  prefixEtc: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Array<string | null> {
  const {
    GIT_CONFIG_GLOBAL: globalFile,
    GIT_CONFIG_SYSTEM: systemFile,
    XDG_CONFIG_HOME: xdg,
  } = env
  const noSystem = gitConfigNoSystem(env.GIT_CONFIG_NOSYSTEM)
  const system = noSystem
    ? []
    : [
        ...(systemFile ? [systemFile] : []),
        ...(getPlatform() === 'windows' ? [] : ['/etc/gitconfig']),
        ...(prefixEtc === null ? [] : [`${prefixEtc}${sep}etc${sep}gitconfig`]),
      ]
  const programData =
    !noSystem && getPlatform() === 'windows' && env.PROGRAMDATA
      ? [`${env.PROGRAMDATA}${sep}Git${sep}config`]
      : []
  return [
    ...fromGitVar.filter(line => line !== ''),
    ...system,
    ...programData,
    ...(globalFile ? [globalFile] : []),
    ...seedHomeDirs(env).flatMap(home => [
      `${xdg || `${home}${sep}.config`}${sep}git${sep}config`,
      `${home}${sep}.gitconfig`,
    ]),
  ].map(path => joinIfRelative(workTree, path))
}

/** densable `cr` */
export function originFilePath(
  origin: string,
  workTree: string,
): string | null {
  return origin.startsWith('file:')
    ? joinIfRelative(workTree, origin.slice(5))
    : null
}

/** densable `ur` */
function gitConfigUserName(): string | null {
  try {
    return userInfo().username
  } catch {
    return null
  }
}

/** densable `lr` */
export function expandIncludePath(
  path: string,
  origin: string,
  workTree: string,
): string {
  const home = /^~([^/]*)\//.exec(path)
  if (home !== null) {
    return home[1] === '' || home[1] === gitConfigUserName()
      ? `${homedir()}${sep}${path.slice(home[0].length)}`
      : path
  }
  if (isAbsolute(path) || path.startsWith('%(prefix)/')) return path
  const base = origin.startsWith('file:')
    ? dirname(joinIfRelative(workTree, origin.slice(5)))
    : workTree
  return `${base}${sep}${path}`
}

/** densable `Ln` */
export function includePathTargets(
  value: string,
  origin: string,
  workTree: string,
): string[] {
  const multi = /^~[^/]*\//.exec(value)
  if (multi !== null) {
    return seedHomeDirs(process.env).map(home =>
      joinIfRelative(workTree, `${home}${sep}${value.slice(multi[0].length)}`),
    )
  }
  const expanded = expandIncludePath(value, origin, workTree)
  return isAbsolute(expanded) ? [expanded] : []
}

/** densable `wn` */
function dirIdentity(st: {
  isDirectory(): boolean
  ino: bigint | number
  dev: bigint | number
}): string | undefined {
  return st.isDirectory() && Number(st.ino) !== 0
    ? `${st.dev}:${st.ino}`
    : undefined
}

/** densable `Rt` */
function sameUid(uid: number): boolean {
  return process.getuid === undefined || uid === process.getuid()
}

/** densable `It` */
async function isWritable(path: string): Promise<boolean> {
  return access(path, constants.W_OK).then(
    () => true,
    err => !['EACCES', 'EROFS', 'EPERM'].includes(getErrnoCode(err) ?? ''),
  )
}

/** densable `ie` */
export async function includePathContributes(
  path: string,
  scope: SeedConfigScope,
  hops = INCLUDE_HOP,
  opts: { secondNames?: boolean } = { secondNames: true },
): Promise<boolean | null> {
  const inside = (value: string) =>
    scope.roots.some(root => seedPathContains(root, value))
  const equalRoot = (value: string) =>
    scope.roots.some(
      root => seedPathContains(root, value) && seedPathContains(value, root),
    )
  const fixed = (value: string) => scope.fixed.includes(value)
  const badHop = (value: string) =>
    inside(value) && !equalRoot(value) && !fixed(value)
  const absent = (code: string | undefined) =>
    code === 'ENOENT' || code === 'ENOTDIR'
  if (
    !isAbsolute(path) ||
    seedPathIsWinNonDrive(path) ||
    path.includes('\uFFFD')
  ) {
    return true
  }
  const win = getPlatform() === 'windows'
  if (win && path !== resolve(path)) {
    return includePathContributes(resolve(path), scope, hops, opts)
  }
  const { root } = parse(path)
  const parts = path
    .slice(root.length)
    .split(sep === '/' ? /\/+/ : /[\\/]+/)
    .filter(part => part !== '' && part !== '.')
  let cursor = root
  let jumped = false
  for (const [index, part] of parts.entries()) {
    if (part === '..') {
      if (jumped) return true
      cursor = dirname(cursor)
      continue
    }
    const next = join(cursor, part)
    if (badHop(next)) return true
    let mapped: string | undefined
    const kind = await lstat(next).then(
      st => {
        const id = dirIdentity(st)
        mapped = id === undefined ? undefined : scope.ids.get(id)
        if (st.isSymbolicLink()) return 'link' as const
        if (opts.secondNames && !st.isDirectory() && st.nlink > 1) {
          return sameUid(st.uid) ? 'shared' : 'shared_if_writable'
        }
        return 'entry' as const
      },
      err => {
        const code = getErrnoCode(err)
        if (absent(code)) return 'absent' as const
        if (['EACCES', 'EPERM'].includes(code ?? '')) return 'sealed' as const
        return null
      },
    )
    switch (kind) {
      case null:
        return null
      case 'sealed':
        return false
      case 'shared':
        return true
      case 'shared_if_writable':
        if (await isWritable(next)) return true
        jumped = mapped !== undefined && mapped !== next
        cursor = mapped ?? next
        break
      case 'absent':
        return badHop(resolve(next, ...parts.slice(index + 1)))
      case 'link': {
        const target = await readlink(next).catch(() => null)
        if (target === null || hops === 0) return null
        const drive = win ? /^[A-Za-z]:/.exec(next)?.[0] : undefined
        if (win && /^[A-Za-z]:(?![\\/])/.test(target)) return true
        const joined =
          drive !== undefined && /^[\\/](?![\\/])/.test(target)
            ? `${drive}${target}`
            : target
        if (joined.includes('\uFFFD')) return true
        const rest = [joinIfRelative(cursor, joined), ...parts.slice(index + 1)]
        return includePathContributes(rest.join(sep), scope, hops - 1, opts)
      }
      case 'entry':
        jumped = mapped !== undefined && mapped !== next
        cursor = mapped ?? next
        break
    }
  }
  return inside(cursor) && !fixed(cursor)
}

/** densable `De` */
export async function firstContributingInclude(
  scope: SeedConfigScope,
  paths: Array<string | null>,
): Promise<string | null | undefined> {
  const rows = await Promise.all(
    uniq(paths.filter((path): path is string => path !== null)).map(
      async path => ({
        path,
        reachable: await includePathContributes(path, scope),
      }),
    ),
  )
  const hit = rows.find(row => row.reachable === true)
  if (hit !== undefined) return hit.path
  return rows.some(row => row.reachable === null) ? null : undefined
}

/** densable `be` */
export async function buildConfigScope(
  workTree: string,
  dirs: { GIT_DIR?: string; GIT_COMMON_DIR?: string },
  tree: string,
): Promise<SeedConfigScope | null> {
  const gitDir = dirs.GIT_DIR ?? join(tree, '.git')
  const commonDir = dirs.GIT_COMMON_DIR ?? gitDir
  const keep = (path: string) =>
    realpath(path).catch(err => (getErrnoCode(err) === 'ENOENT' ? path : null))
  const groups = await Promise.all(
    [[tree, resolve(workTree)], [gitDir], [commonDir]].map(async group => [
      ...group,
      ...(await Promise.all(group.map(keep))),
    ]),
  )
  if (groups.some(group => group.includes(null))) return null
  const [trees, gits, commons] = groups.map(group =>
    uniq(group.filter((path): path is string => path !== null)),
  )
  const roots = uniq([...trees, ...gits, ...commons])
  const extra =
    getPlatform() === 'windows' ? [] : await Promise.all(roots.map(keep))
  if (extra.includes(null)) return null
  const ids = await Promise.all(
    uniq(extra.filter((path): path is string => path !== null)).map(path =>
      stat(path).then(
        st => {
          const id = dirIdentity(st)
          return id === undefined ? [] : [[id, path] as [string, string]]
        },
        err => (getErrnoCode(err) === 'ENOENT' ? [] : null),
      ),
    ),
  )
  if (ids.includes(null)) return null
  return {
    ids: new Map(
      ids.filter((row): row is [string, string][] => row !== null).flat(),
    ),
    roots,
    fixed: uniq([
      ...gits.flatMap(dir => [
        dir,
        join(dir, 'config'),
        join(dir, 'config.worktree'),
        join(dir, 'commondir'),
      ]),
      ...commons.flatMap(dir => [
        dir,
        join(dir, 'config'),
        join(dir, 'worktrees'),
      ]),
    ]),
  }
}

/** densable `ue` */
export function parseNulConfig(stdout: string): NulRow[] {
  const parts = stdout.split('\0')
  return Array.from({ length: Math.floor(parts.length / 2) }, (_, i) => {
    const origin = parts[2 * i] ?? ''
    const rest = parts[2 * i + 1] ?? ''
    const nl = rest.indexOf('\n')
    return {
      origin,
      key: nl < 0 ? rest : rest.slice(0, nl),
      value: nl < 0 ? '' : rest.slice(nl + 1),
      valueless: nl < 0,
    }
  })
}

export type IncludeList = {
  keys: NulRow[]
  targets: string[]
}

/** densable `ar` */
export async function walkSeedIncludeGraph(
  start: Array<string | null>,
  listFile: (file: string) => Promise<IncludeList | null>,
  reach: (paths: Array<string | null>) => Promise<string | null | undefined>,
): Promise<
  | { tooMany: true }
  | { contributes: string }
  | { files: string[]; keys: NulRow[] }
  | null
> {
  const kept = (path: string | null): path is string => path !== null
  const seen = new Set(start.filter(kept))
  const keys: NulRow[] = []
  let queue = [...seen]
  let opened = 0
  for (let depth = 0; queue.length > 0; depth += 1) {
    if (depth === INCLUDE_DEPTH || seen.size > INCLUDE_SET_CAP) {
      return { tooMany: true }
    }
    const bad = queue.find(path => path.includes('\uFFFD'))
    if (bad !== undefined) return { contributes: bad }
    const hit = await reach(queue)
    if (hit !== undefined) return hit === null ? null : { contributes: hit }
    const files = await Promise.all(
      queue.map(async path =>
        !seedPathIsWinNonDrive(path) &&
        (await stat(path).catch(() => null))?.isFile()
          ? path
          : null,
      ),
    )
    opened += countWhere(files, kept)
    if (opened > INCLUDE_OPEN_CAP) return { tooMany: true }
    const listed = await Promise.all(files.filter(kept).map(listFile))
    if (listed.some(row => row === null)) return null
    keys.push(...listed.flatMap(row => row?.keys ?? []))
    queue = uniq(listed.flatMap(row => row?.targets ?? []).filter(kept)).filter(
      path => !seen.has(path),
    )
    for (const path of queue) seen.add(path)
  }
  return { files: [...seen], keys }
}

/** densable `rr` */
export async function pinSeedConfig(
  layout: SeedLayoutPin,
  run: SeedGitRun,
): Promise<SeedPinResult> {
  const unlistable: SeedPinResult = {
    kind: 'unlistable',
    detail: 'could not list the configuration in force',
  }
  const list = async (extra: string[]): Promise<IncludeList | null> => {
    const [listed, paths] = await Promise.all([
      run(['config', '-z', '--show-origin', ...extra, '--list']),
      run([
        'config',
        '-z',
        '--show-origin',
        '--type=path',
        ...extra,
        '--get-regexp',
        String.raw`^(include|includeif\..*)\.path$`,
      ]),
    ])
    const emptyFile = extra.length > 0 && listed.exitCode === 128
    if (
      (listed.code !== 0 && !emptyFile) ||
      (paths.code !== 0 && paths.exitCode === undefined)
    ) {
      return null
    }
    const keys = emptyFile ? [] : parseNulConfig(listed.stdout)
    return {
      keys,
      targets: [
        ...keys
          .filter(row => INCLUDE_PATH.test(row.key))
          .flatMap(row =>
            includePathTargets(row.value, row.origin, layout.workTree),
          ),
        ...(paths.code === 0
          ? parseNulConfig(paths.stdout).flatMap(row =>
              includePathTargets(row.value, row.origin, layout.workTree),
            )
          : []),
      ],
    }
  }
  const [root, globalVar, systemVar] = await Promise.all([
    list([]),
    run(['var', 'GIT_CONFIG_GLOBAL']),
    run(['var', 'GIT_CONFIG_SYSTEM']),
  ])
  if (root === null) return unlistable
  const scope = await buildConfigScope(
    layout.workTree,
    { GIT_DIR: layout.gitDir, GIT_COMMON_DIR: layout.commonDir },
    layout.workTree,
  )
  if (scope === null) return unlistable
  const origins = [
    ...root.keys.map(row => originFilePath(row.origin, layout.workTree)),
    ...listGitConfigFiles(
      [globalVar, systemVar].flatMap(row =>
        row.code === 0 ? row.stdout.split('\n') : [],
      ),
      layout.workTree,
      null,
      process.env,
    ),
  ]
  const badUtf8 = origins.find(
    path => path?.includes('\uFFFD') && path !== null,
  )
  if (badUtf8 !== undefined && badUtf8 !== null) {
    return { kind: 'included', file: badUtf8 }
  }
  const first = await firstContributingInclude(scope, origins)
  if (first !== undefined) {
    return first === null ? unlistable : { kind: 'included', file: first }
  }
  const walked = await walkSeedIncludeGraph(
    root.targets,
    file => list(['--file', file]),
    paths => firstContributingInclude(scope, paths),
  )
  if (walked === null) return unlistable
  if ('tooMany' in walked) return { kind: 'many_includes' }
  if ('contributes' in walked) {
    return { kind: 'included', file: walked.contributes }
  }
  const keys = [...root.keys, ...walked.keys]
  const names = (re: RegExp) =>
    uniq(
      keys.flatMap(row => {
        const name = re.exec(row.key)?.[1]
        return name === undefined ? [] : [name]
      }),
    )
  const filters = names(FILTER_NAME)
  const hooks = names(HOOK_NAME)
  if ([...filters, ...hooks].some(name => name.includes('\uFFFD'))) {
    return { kind: 'unlistable', detail: UNLISTABLE_NAME }
  }
  const pairs = [
    ...filters.flatMap(name => [
      [`filter.${name}.clean`, ''] as const,
      [`filter.${name}.smudge`, ''] as const,
      [`filter.${name}.process`, ''] as const,
      [`filter.${name}.required`, 'false'] as const,
    ]),
    ...hooks.flatMap(name => [
      [`hook.${name}.enabled`, 'false'] as const,
      [`hook.${name}.event`, ''] as const,
    ]),
  ]
  return {
    kind: 'pins',
    pins: {
      filterDrivers: filters,
      configPins: Object.fromEntries([
        ['GIT_CONFIG_COUNT', String(pairs.length)],
        ...pairs.flatMap(([key, value], i) => [
          [`GIT_CONFIG_KEY_${i}`, key],
          [`GIT_CONFIG_VALUE_${i}`, value],
        ]),
      ]),
    },
  }
}
