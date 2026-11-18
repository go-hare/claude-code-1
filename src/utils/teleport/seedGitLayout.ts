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

// ---------------------------------------------------------------------------
// SEA #134 & #135: per-cause rejection messages (no, To, vr, vo, _d, ro, io)
// ---------------------------------------------------------------------------

export const SEED_LINKED_WORKTREE_REJECTIONS: Record<string, string> = {
  worktree_config:
    'its administrative entry carries a per-worktree configuration file, one a Claude Code session of this repository could have written there — delete that file only if nothing in it matters (`git rev-parse --git-path config.worktree` names it; git sparse-checkout writes one, and a sparse tree needs it to stay sparse), or start from the repository’s main checkout',
  common_dir:
    'the commondir file in its administrative directory, which does not read as git writes it, would decide which repository that way takes its configuration from',
  keyed_elsewhere:
    'its .git file leads git to another repository than the one under which Claude Code keeps this folder’s trust and settings, and that way would run under the other’s configuration — start from the repository’s main checkout',
  placement:
    'its repository is placed or named as git does not place one this upload takes a repository from (not <name>.git or .git, inside the working tree, or under another git directory) — rename a bare repository’s directory to <name>.git and run git worktree repair from it, or start from an ordinary clone',
  back_link:
    'its administrative entry does not point back at this tree (a moved tree, or a back link something rewrote) — run git worktree repair, or start from the repository’s main checkout',
  admin_dir:
    'its .git file names a worktree entry that does not exist or is not one git made, so where it would lead that capture cannot be judged — run git worktree repair if this tree was moved, or start from the repository’s main checkout',
  foreign_mount:
    'something is mounted over its administrative entry in the repository (.git/worktrees/<name>), so what stands there is not the repository’s own — unmount it, or start from the repository’s main checkout',
  git_file:
    'its .git entry is a pointer file this upload could not follow, so where it leads cannot be judged — start from an ordinary clone instead',
}

const SEED_WORK_TREE_REJECTION =
  'its git configuration points the work tree somewhere else (core.worktree), so that capture would read the directory it names rather than this one; remove core.worktree or start from an ordinary clone'

export const SEED_TAMPERED_REJECTIONS: Record<string, string> = {
  reftable:
    'this repository keeps (or appears to keep) its refs in reftable storage — a state a Claude Code session can bring about without the user, under which that capture would run git; start from an ordinary clone of the repository',
  borrowed_objects:
    'this repository borrows objects from another through an alternates file — a state a Claude Code session can bring about without the user, under which that capture would run git; start from an ordinary clone of the repository',
  included_config:
    'a cloud session could change a file that git reads this checkout’s configuration from, so that capture would run under whatever is put there',
  many_includes:
    'its git configuration pulls in more include files than are followed, so that capture would run every program those files name and enter any nested repository registered here; trim the include chain',
  work_tree: SEED_WORK_TREE_REJECTION,
  git_file: SEED_LINKED_WORKTREE_REJECTIONS.git_file!,
}

const DEFAULT_TAMPERED_REJECTION =
  'Could not read where git keeps this checkout (git rev-parse did not name its git directory), so nothing was uploaded. Check `git status` here, then retry.'

/**
 * SEA #135: map a `tampered` probe result to its specific rejection message.
 */
export function formatSeedTamperedError(tampered: {
  misplaced: string
  detail?: string
}): string {
  if (tampered.detail && tampered.detail in SEED_LINKED_WORKTREE_REJECTIONS) {
    return SEED_LINKED_WORKTREE_REJECTIONS[tampered.detail]!
  }
  if (tampered.misplaced in SEED_TAMPERED_REJECTIONS) {
    return SEED_TAMPERED_REJECTIONS[tampered.misplaced]!
  }
  return DEFAULT_TAMPERED_REJECTION
}

export const SEED_LAUNCH_ENV_CONFIG_SENTINEL = '<launch-env>'

export type SeedGitConfigRejection =
  | { kind: 'includes'; file: string }
  | { kind: 'work_tree'; file: string }
  | { kind: 'worktree_config'; file: string }
  | { kind: 'second_name'; file: string }
  | { kind: 'unread'; file: string }
  | { kind: 'settings_unreadable'; file: string }
  | {
      kind: 'home_checkout'
      file: string
      checkout: string
      relation: 'home' | 'above_home' | 'elsewhere'
    }
  | { kind: 'config_in_checkout'; file: string; checkout: string }

/**
 * SEA #134 `_d(e, n, r)` + `ro(e, n)` + `io(e, n, r)`: shortened per-config-type
 * rejection messages for `/ultrareview` git config checks.
 */
export function formatSeedGitConfigRejection(
  hit: SeedGitConfigRejection,
  prefix = '',
  offerOrdinaryClone = true,
): string {
  if (hit.file === SEED_LAUNCH_ENV_CONFIG_SENTINEL) {
    switch (hit.kind) {
      case 'includes':
        return `its launch environment’s git configuration (GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT) includes a file inside this working tree, its repository or a directory your settings open to Claude Code sessions — configuration this upload could not have git list here, where a file a session may write could say what that capture runs; ${prefix}drop that include from the environment, or start from an ordinary clone`
      case 'work_tree':
        return SEED_WORK_TREE_REJECTION
      case 'worktree_config':
        return `its launch environment’s git configuration switches per-worktree configuration on (extensions.worktreeConfig), under which that capture would also read a configuration file a session of the repository can plant in this tree’s administrative entry; ${prefix}start from the repository’s main checkout`
      case 'second_name':
        return `its launch environment’s git configuration (GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT) includes a file that has a second name — a hard link — so a session that can reach the other name could change what that capture runs under; ${prefix}give that file a single name again (copy it aside and move the copy back over it), drop that include from the environment, or start from an ordinary clone`
      case 'unread':
        return 'the git configuration its launch environment carries (GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT) does not parse as git would parse it, or includes a file that cannot be read or followed here, so what that capture would run under cannot be judged; check those variables, or start from an ordinary clone'
      case 'settings_unreadable':
        return `a Claude Code settings file inside this working tree (${hit.file}/settings.json or settings.local.json) stands but cannot be read, so which directories it opens to sessions — and so whether a session could write the configuration that capture would run under — cannot be told; ${prefix}fix or remove that settings file, then retry`
      case 'home_checkout': {
        const cloneHint = offerOrdinaryClone
          ? 'start from an ordinary clone, or '
          : ''
        return hit.relation === 'home'
          ? `your home directory is itself a git checkout, so a Claude Code session started there can write the user-level git configuration that capture would run under (${hit.file}, whether or not that file exists yet); ${prefix}${cloneHint}keep the dotfiles repository’s git directory outside your home (a bare repository used with --git-dir)`
          : `your home directory lies inside a git checkout (${hit.checkout}), so a Claude Code session started there can write the user-level git configuration that capture would run under (${hit.file}, whether or not that file exists yet); ${prefix}${cloneHint}move your home directory out of that checkout, or remove`
      }
      case 'config_in_checkout':
        return `its launch environment’s git configuration (GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT) includes a file that lies inside — or links into — a git checkout (${hit.checkout}), which a Claude Code session started there can write; ${prefix}drop that include from the environment, keep the file outside any checkout, or start from an ordinary clone`
    }
  }

  switch (hit.kind) {
    case 'includes':
      return `its git configuration (${hit.file}) pulls in include files, lies inside this working tree, its repository or a directory your settings open to Claude Code sessions, or includes a file there — configuration this upload could not have git list here, where a file a session may write could say what that capture runs; ${prefix}move what the includes hold into the configuration file itself, stop granting sessions the directory that holds it (permissions.additionalDirectories, sandbox.filesystem.allowWrite, an Edit rule or --add-dir), or start from an ordinary clone`
    case 'second_name':
      return `its git configuration file ${hit.file} (or a file it includes) has a second name — a hard link — so a session that can reach the other name could change what that capture runs under; ${prefix}give the file a single name again (copy it aside and move the copy back over it), or start from an ordinary clone`
    case 'work_tree':
      return SEED_WORK_TREE_REJECTION
    case 'worktree_config':
      return `its git configuration (${hit.file}) switches per-worktree configuration on (extensions.worktreeConfig), under which that capture would also read a configuration file a session of the repository can plant in this tree’s administrative entry; ${prefix}start from the repository’s main checkout`
    case 'unread':
      return `its git configuration file ${hit.file} could not be read as a plain file git would parse, or is reached through a link that cannot be followed here, so what that capture would run under cannot be judged; ${prefix}check that file, or start from an ordinary clone`
    case 'settings_unreadable':
      return `a Claude Code settings file inside this working tree (${hit.file}/settings.json or settings.local.json) stands but cannot be read, so which directories it opens to sessions — and so whether a session could write the configuration that capture would run under — cannot be told; ${prefix}fix or remove that settings file, then retry`
    case 'home_checkout': {
      const cloneHint = offerOrdinaryClone
        ? 'start from an ordinary clone, or '
        : ''
      return hit.relation === 'home'
        ? `your home directory is itself a git checkout, so a Claude Code session started there can write the user-level git configuration that capture would run under (${hit.file}, whether or not that file exists yet); ${prefix}${cloneHint}keep the dotfiles repository’s git directory outside your home (a bare repository used with --git-dir)`
        : `your home directory lies inside a git checkout (${hit.checkout}), so a Claude Code session started there can write the user-level git configuration that capture would run under (${hit.file}, whether or not that file exists yet); ${prefix}${cloneHint}move your home directory out of that checkout, or remove`
    }
    case 'config_in_checkout':
      return `the user-level git configuration file ${hit.file}, or a file it includes, lies inside — or links into — a git checkout (${hit.checkout}), so a Claude Code session started there can write what that capture would run under, whether or not the file exists yet; ${prefix}${offerOrdinaryClone ? 'start from an ordinary clone, or ' : ''}keep user-level git configuration outside any checkout`
  }
}
