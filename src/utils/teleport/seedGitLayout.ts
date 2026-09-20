/**
 * densable `_583` `K4n`/`Qi` harden layout + TCt `Gr` git env.
 * Gold: gold-forged-K4n-wide.txt / gold-forged-X4n-to.txt / gold-forged-Or.
 *
 * X4n/`to` private `~/.claude/seed-admin` is only called when
 * `hardenForDeviceSessions===true` (TCt `b`). Default `i` uses layout
 * without adminDir (`hs` `t.adminDir??o`).
 *
 * Seed git runner is official `V()` hardened when `layout.bound===true`
 * or TCt `i` / `opts.hardened` (K4n always `hardened:!0`). Windows /
 * gXo default `i=false` never reaches K4n (`g=i?await K4n`).
 */

import { lstat, realpath, stat } from 'fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'path'
import { getErrnoCode } from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { gitExe } from '../git.js'
import { getPlatform } from '../platform.js'
import { mapControlFormatToSpace } from '../sessionTitleSanitize.js'
import { pinSeedConfig } from './seedGitInclude.js'
import {
  runSeedGitHardened,
  SEED_GIT_HARDENED_C,
  SEED_GIT_MAX_BUFFER,
  seedGitEt,
  seedGitQn,
  seedGitZn,
} from './seedGitHardened.js'
import {
  classifyGitFile,
  isSeedTempRoot,
  vouchLinkedGitDir,
} from './seedGitLinked.js'
import type { SeedGitRun } from './seedWipInspect.js'

const HARDENED_C = SEED_GIT_HARDENED_C

const HARDENED_ENV: NodeJS.ProcessEnv = {
  GIT_ALLOW_PROTOCOL: 'file:git:http:https:ssh',
  GIT_TERMINAL_PROMPT: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_GRAFT_FILE:
    getPlatform() === 'windows'
      ? '\\\\.\\NUL\\no-grafts'
      : '/dev/null/no-grafts',
}

/** densable `Fr`/`Cr` */
function ceilingDirectories(resolved: string, cwd: string): string {
  const slash = (path: string) =>
    getPlatform() === 'windows' ? path.replaceAll('\\', '/') : path
  return [
    ...new Set(
      [resolved, cwd].flatMap(path => [dirname(path), slash(dirname(path))]),
    ),
  ].join(delimiter)
}

const GIT_NOT_FOUND =
  'git was not found on the PATH this process was started with'

export type SeedStoreStamps = {
  info: string
  pack: string
  alternates: string
  httpAlternates: string
}

export type SeedGitLayout = {
  gitDir: string
  commonDir: string
  workTree: string
  adminDir?: string
  checkout: 'main' | 'linked'
  bound: boolean
  gitDirId?: string
  storeStamps?: SeedStoreStamps
  filterDrivers: string[]
  configPins: Record<string, string>
  run: SeedGitRun
  withWorkTree: (workTree: string) => SeedGitLayout
}

export type SeedLayoutResult =
  | { kind: 'read'; layout: SeedGitLayout }
  | {
      kind: 'tampered'
      misplaced: string
      gitDir: string
      commonDir: string
      detail?: string
    }
  | { kind: 'failed'; detail: string; why?: 'git_not_found' }

function layoutEnv(layout: {
  gitDir: string
  commonDir: string
  workTree: string
  adminDir?: string
  configPins?: Record<string, string>
}): NodeJS.ProcessEnv {
  const pins = layout.configPins ?? {}
  if (layout.adminDir === undefined) {
    return {
      GIT_DIR: layout.gitDir,
      GIT_COMMON_DIR: layout.commonDir,
      GIT_WORK_TREE: layout.workTree,
      ...pins,
    }
  }
  return {
    GIT_DIR: layout.adminDir,
    GIT_WORK_TREE: layout.workTree,
    GIT_INDEX_FILE: join(layout.adminDir, 'index'),
    ...pins,
  }
}

function makeRun(
  cwd: string,
  layout: {
    gitDir: string
    commonDir: string
    workTree: string
    adminDir?: string
    configPins?: Record<string, string>
    bound?: boolean
  },
  signal?: AbortSignal,
  hardened = true,
): SeedGitRun {
  if (layout.bound === true || hardened) {
    return async (args, env, input) => {
      const result = await runSeedGitHardened(cwd, args, {
        layout: {
          gitDir: layout.gitDir,
          commonDir: layout.commonDir,
          workTree: layout.workTree,
          adminDir: layout.adminDir,
          bound: layout.bound === true,
          configPins: layout.configPins,
        },
        signal,
        env,
        input,
        stripFinalNewline: false,
      })
      return { ...result, exitCode: result.code }
    }
  }
  return async (args, env, input) => {
    const result = await execFileNoThrowWithCwd(
      gitExe(),
      [...HARDENED_C, ...args],
      {
        cwd,
        abortSignal: signal,
        preserveOutputOnError: false,
        stripFinalNewline: false,
        maxBuffer: SEED_GIT_MAX_BUFFER,
        env: {
          ...process.env,
          ...HARDENED_ENV,
          ...layoutEnv(layout),
          ...env,
        },
        input,
      },
    )
    return { ...result, exitCode: result.code }
  }
}

function attachRun(
  cwd: string,
  layout: Omit<SeedGitLayout, 'run' | 'withWorkTree'>,
  signal?: AbortSignal,
  hardened = true,
): SeedGitLayout {
  const full: SeedGitLayout = {
    ...layout,
    run: makeRun(cwd, layout, signal, hardened),
    withWorkTree(workTree) {
      return attachRun(cwd, { ...layout, workTree }, signal, hardened)
    },
  }
  return full
}

/** densable `Ae` */
function stdoutLine(stdout: string): string | null {
  const re = getPlatform() === 'windows' ? /\r?\n$/ : /\n$/
  return re.test(stdout) ? stdout.replace(re, '') : null
}

/** densable `A` */
async function hopKind(
  path: string,
): Promise<'directory' | 'file' | 'absent' | 'other'> {
  try {
    const st = await lstat(path)
    if (st.isDirectory()) return 'directory'
    if (st.isFile() && st.nlink === 1) return 'file'
    return 'other'
  } catch (err) {
    const code = getErrnoCode(err)
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'other'
  }
}

/** densable `gr` */
async function gitDirIdentity(
  workTree: string,
): Promise<string | 'not_a_directory' | { unreadable: string }> {
  try {
    const st = await lstat(join(workTree, '.git'), { bigint: true })
    return st.isDirectory() ? `${st.dev}:${st.ino}` : 'not_a_directory'
  } catch (err) {
    const code = getErrnoCode(err)
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? 'not_a_directory'
      : { unreadable: String(err) }
  }
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

/** densable `zn` */
async function hasBorrowedObjects(commonDir: string): Promise<boolean> {
  return (
    await Promise.all(
      ['alternates', 'http-alternates'].map(async name => {
        const kind = await hopKind(join(commonDir, 'objects', 'info', name))
        if (kind !== 'file') return kind !== 'absent'
        try {
          const st = await stat(join(commonDir, 'objects', 'info', name))
          return !(st.isFile() && st.nlink === 1 && st.size === 0)
        } catch {
          return true
        }
      }),
    )
  ).some(Boolean)
}

/** densable `Kn` */
export async function storeStamps(commonDir: string): Promise<SeedStoreStamps> {
  const stamp = async (...parts: string[]) => {
    try {
      const st = await lstat(join(commonDir, 'objects', ...parts), {
        bigint: true,
      })
      return `${st.dev}:${st.ino}:${st.ctimeNs}:${st.mtimeNs}:${st.size}`
    } catch {
      return 'absent'
    }
  }
  const [info, pack, alternates, httpAlternates] = await Promise.all([
    stamp('info'),
    stamp('pack'),
    stamp('info', 'alternates'),
    stamp('info', 'http-alternates'),
  ])
  return { info, pack, alternates, httpAlternates }
}

/** densable `Lr` — linked checkout must not have worktreeConfig. */
async function linkedWorktreeConfigState(
  cwd: string,
  layout: {
    gitDir: string
    commonDir: string
    workTree: string
    bound: boolean
  },
  signal?: AbortSignal,
  hardened = true,
): Promise<'absent' | 'standing' | 'unread'> {
  const run = makeRun(cwd, { ...layout, configPins: {} }, signal, hardened)
  const [listed, file] = await Promise.all([
    run([
      'config',
      '--file',
      join(layout.commonDir, 'config'),
      '--bool',
      '--default=false',
      'extensions.worktreeConfig',
    ]),
    lstat(join(layout.gitDir, 'config.worktree')).then(
      st =>
        st.isFile() && st.nlink === 1 && st.size === 0 ? 'absent' : 'standing',
      err => {
        const code = getErrnoCode(err)
        return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unread'
      },
    ),
  ])
  if (listed.code !== 0 || file === 'unread') return 'unread'
  return listed.stdout.trim() === 'false' && file === 'absent'
    ? 'absent'
    : 'standing'
}

/** densable `rr` — pin filter/hook config; walk include.path via `ar`. */
async function pinConfig(
  cwd: string,
  layout: {
    gitDir: string
    commonDir: string
    workTree: string
    checkout: 'main' | 'linked'
    bound: boolean
  },
  signal?: AbortSignal,
  hardened = true,
) {
  return pinSeedConfig(
    layout,
    makeRun(cwd, { ...layout, configPins: {} }, signal, hardened),
  )
}

/** densable TCt `h={...h,adminDir:T.path}` after X4n `made`. */
export function bindSeedAdminDir(
  cwd: string,
  layout: SeedGitLayout,
  adminDir: string,
  signal?: AbortSignal,
): SeedGitLayout {
  const { run: _run, withWorkTree: _with, ...rest } = layout
  return attachRun(cwd, { ...rest, adminDir }, signal)
}

export type ProbeLayoutOpts = {
  linkedTrees?: boolean
  bound?: boolean
  /** densable TCt `i` / V `hardened`. K4n always `true`. */
  hardened?: boolean
}

/**
 * densable `K4n` / `Qi`.
 */
export async function probeSeedGitLayout(
  cwd: string,
  signal?: AbortSignal,
  opts: ProbeLayoutOpts = {},
): Promise<SeedLayoutResult> {
  const linkedTrees = opts.linkedTrees === true
  const bound = opts.bound ?? linkedTrees
  const hardened = opts.hardened ?? true
  const resolved = await realpath(cwd).catch(() => cwd)
  if (bound && (await isSeedTempRoot(resolved, cwd))) {
    return {
      kind: 'tampered',
      misplaced: 'temp_root',
      gitDir: '',
      commonDir: '',
    }
  }
  const gitFile = await classifyGitFile(resolved)
  if (gitFile.kind === 'refuse' || (gitFile.kind === 'chain' && !linkedTrees)) {
    const why =
      linkedTrees && gitFile.kind === 'refuse' && gitFile.why !== 'git_file'
        ? gitFile.why
        : null
    return {
      kind: 'tampered',
      misplaced: why !== null ? 'linked_worktree' : 'git_file',
      gitDir:
        gitFile.kind === 'refuse' ? (gitFile.adminDir ?? '') : gitFile.adminDir,
      commonDir: gitFile.kind === 'chain' ? gitFile.commonDir : '',
      ...(why !== null && { detail: why }),
    }
  }
  const reach = bound
    ? seedGitZn(resolved, [
        ...seedGitEt(resolved),
        ...(gitFile.kind === 'chain' ? [seedGitQn(gitFile.commonDir)] : []),
      ])
    : undefined
  const run = (args: string[]) =>
    bound || hardened
      ? runSeedGitHardened(cwd, args, {
          signal,
          stripFinalNewline: false,
          env: {
            GIT_CEILING_DIRECTORIES: ceilingDirectories(resolved, cwd),
          },
          reach,
        })
      : execFileNoThrowWithCwd(gitExe(), [...HARDENED_C, ...args], {
          cwd: resolved,
          abortSignal: signal,
          preserveOutputOnError: false,
          stripFinalNewline: false,
          maxBuffer: SEED_GIT_MAX_BUFFER,
          env: {
            ...process.env,
            ...HARDENED_ENV,
            GIT_CEILING_DIRECTORIES: ceilingDirectories(resolved, cwd),
          },
        })
  const [absGit, common, top] = await Promise.all([
    run(['rev-parse', '--absolute-git-dir']),
    run(['rev-parse', '--path-format=absolute', '--git-common-dir']),
    run(['rev-parse', '--show-toplevel']),
  ])
  const gitDir = stdoutLine(absGit.stdout)
  const commonDir = stdoutLine(common.stdout)
  const workTree = stdoutLine(top.stdout)
  if (
    [absGit, common, top].some(row => row.code !== 0) ||
    gitDir === null ||
    commonDir === null ||
    workTree === null ||
    !isAbsolute(gitDir) ||
    !isAbsolute(workTree)
  ) {
    const detail = mapControlFormatToSpace(
      (absGit.stderr || common.stderr || top.stderr || absGit.stdout).trim(),
    )
    return {
      kind: 'failed',
      detail,
      ...(absGit.code === 127 && absGit.stderr.startsWith(GIT_NOT_FOUND)
        ? { why: 'git_not_found' as const }
        : {}),
    }
  }
  if (mapControlFormatToSpace(commonDir) === '--path-format=absolute') {
    return {
      kind: 'tampered',
      misplaced: 'old_git',
      gitDir,
      commonDir,
    }
  }
  if (!isAbsolute(commonDir)) {
    return {
      kind: 'tampered',
      misplaced: 'common_dir',
      gitDir,
      commonDir,
    }
  }
  if ((await hopKind(join(commonDir, 'reftable'))) !== 'absent') {
    return { kind: 'tampered', misplaced: 'reftable', gitDir, commonDir }
  }
  if (await hasBorrowedObjects(commonDir)) {
    return {
      kind: 'tampered',
      misplaced: 'borrowed_objects',
      gitDir,
      commonDir,
    }
  }
  const ident = await gitDirIdentity(resolved)
  if (typeof ident !== 'string') {
    return { kind: 'failed', detail: ident.unreadable }
  }
  if (ident === 'not_a_directory') {
    if (!linkedTrees || gitFile.kind !== 'chain') {
      return { kind: 'tampered', misplaced: 'git_file', gitDir, commonDir }
    }
    const vouched = await vouchLinkedGitDir(
      resolved,
      gitDir,
      commonDir,
      gitFile,
    )
    if (vouched.kind !== 'vouched') {
      return vouched.kind === 'unread'
        ? { kind: 'failed', detail: vouched.detail }
        : {
            kind: 'tampered',
            misplaced: vouched.kind,
            gitDir,
            commonDir,
            ...(vouched.kind === 'linked_worktree' && {
              detail: vouched.detail,
            }),
          }
    }
    return finishSeedLayout(
      cwd,
      resolved,
      {
        gitDir: vouched.gitDir,
        gitDirId: vouched.gitDirId,
        commonDir: vouched.commonDir,
        workTree,
        checkout: 'linked',
        bound,
      },
      signal,
      hardened,
    )
  }
  if (ident !== (await pathId(gitDir))) {
    return { kind: 'tampered', misplaced: 'git_dir', gitDir, commonDir }
  }
  if (commonDir !== gitDir) {
    return { kind: 'tampered', misplaced: 'common_dir', gitDir, commonDir }
  }
  return finishSeedLayout(
    cwd,
    resolved,
    {
      gitDir,
      gitDirId: ident,
      commonDir,
      workTree,
      checkout: 'main',
      bound,
    },
    signal,
    hardened,
  )
}

/** densable `An` */
async function finishSeedLayout(
  cwd: string,
  resolved: string,
  layout: {
    gitDir: string
    gitDirId: string
    commonDir: string
    workTree: string
    checkout: 'main' | 'linked'
    bound: boolean
  },
  signal?: AbortSignal,
  hardened = true,
): Promise<SeedLayoutResult> {
  const { gitDir, commonDir, workTree } = layout
  const [workId, cwdId] = await Promise.all([
    pathId(workTree),
    pathId(resolved),
  ])
  if (workId === null || workId !== cwdId) {
    return { kind: 'tampered', misplaced: 'work_tree', gitDir, commonDir }
  }
  const stamps = await storeStamps(commonDir)
  if (stamps.info === 'absent' || stamps.pack === 'absent') {
    return {
      kind: 'failed',
      detail:
        'objects/info or objects/pack is missing from the git directory (running git init again in the checkout puts them back)',
    }
  }
  if (layout.checkout === 'linked') {
    const worktreeCfg = await linkedWorktreeConfigState(
      cwd,
      layout,
      signal,
      hardened,
    )
    if (worktreeCfg !== 'absent') {
      return worktreeCfg === 'unread'
        ? {
            kind: 'failed',
            detail: 'could not read extensions.worktreeConfig',
          }
        : {
            kind: 'tampered',
            misplaced: 'linked_worktree',
            gitDir,
            commonDir,
            detail: 'worktree_config',
          }
    }
  }
  const pins = await pinConfig(
    cwd,
    {
      gitDir,
      commonDir,
      workTree,
      checkout: layout.checkout,
      bound: layout.bound,
    },
    signal,
    hardened,
  )
  switch (pins.kind) {
    case 'unlistable':
      return { kind: 'failed', detail: pins.detail }
    case 'many_includes':
      return { kind: 'tampered', misplaced: 'many_includes', gitDir, commonDir }
    case 'included':
      return {
        kind: 'tampered',
        misplaced: 'included_config',
        gitDir,
        commonDir,
        detail: pins.file,
      }
    case 'pins':
      return {
        kind: 'read',
        layout: attachRun(
          cwd,
          {
            gitDir,
            commonDir,
            workTree,
            checkout: layout.checkout,
            bound: layout.bound,
            gitDirId: layout.gitDirId,
            storeStamps: stamps,
            filterDrivers: pins.pins.filterDrivers,
            configPins: pins.pins.configPins,
          },
          signal,
          hardened,
        ),
      }
  }
}
