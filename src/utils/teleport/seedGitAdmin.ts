/**
 * densable `_583` `to` / `X4n` — private `~/.claude/seed-admin` git dir.
 * TCt only calls this when `hardenForDeviceSessions===true` (`b=h&&s`).
 * Gold: gold-forged-X4n-to.txt (`symlink as qt`, `Ne`, `yr`, `Rn`/`K`).
 */

import { constants } from 'fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'
import { getErrnoCode } from '../errors.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getProcessLstartString } from '../genericProcessUtils.js'
import { getPlatform } from '../platform.js'
import { sanitizeSeedDisplay, truncateSeedDisplay } from './seedDisplay.js'
import { washSeedStderr } from './seedGitBundleUxo.js'
import { seedPathContains } from './seedGitInclude.js'
import type { SeedGitRun } from './seedWipInspect.js'

const COPY_FILE_CAP = 268435456
const SHAREDINDEX_CAP = 64
const COPY_BUDGET = 1073741824
const SWEEP_AGE_MS = 3600000
const ADMIN_DETAIL_CAP = 300
const CORE_PINS = new Set([
  'core.autocrlf',
  'core.eol',
  'core.safecrlf',
  'core.symlinks',
  'core.filemode',
  'core.ignorecase',
  'core.precomposeunicode',
  'core.checkstat',
  'core.trustctime',
  'core.longpaths',
])
const CORE_PIN_VALUE = /^[A-Za-z0-9._-]{1,32}$/
const DRIFT_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'CLAUDE_CODE_USE_COWORK_PLUGINS',
] as const

export type SeedAdminResult =
  | {
      kind: 'made'
      path: string
      dispose: () => Promise<void>
      [Symbol.asyncDispose]: () => Promise<void>
    }
  | {
      kind: 'failed'
      reason: 'setup' | 'placement'
      detail: string
      [Symbol.asyncDispose]: () => Promise<void>
    }

/** densable `O` */
function fail(
  detail: string,
  reason: 'setup' | 'placement' = 'setup',
): SeedAdminResult {
  return {
    kind: 'failed',
    reason,
    detail,
    [Symbol.asyncDispose]: async () => {},
  }
}

/**
 * densable `Rn(K)`. `j()` is `_612` `PYb`/`ot` =
 * `peekPreSettingsEnvSnapshot()` — no local host. Official
 * `if(n===void 0)return` skips the drift check.
 */
function driftedConfigHome(_keys: readonly string[]): string | undefined {
  return undefined
}

/** densable `Me` */
function oneLine(text: string | undefined): string | null {
  if (text === undefined) return null
  const n = text.replace(/\r?\n$/, '')
  return n === '' || /[\r\n]/.test(n) ? null : n
}

/** densable `me` — read a small regular file as utf8. */
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

/**
 * densable `to()` packed-refs line:
 * `/^[0-9a-f]{40}(?:[0-9a-f]{24})? refs\/[^\u0000-\u0020\u007f]+$/`
 */
function isPackedRefLine(line: string): boolean {
  const match = /^(?:[0-9a-f]{40}(?:[0-9a-f]{24})?) refs\/(.*)$/.exec(line)
  const name = match?.[1]
  if (name === undefined || name.length === 0) return false
  for (const ch of name) {
    const code = ch.charCodeAt(0)
    if (code <= 0x20 || code === 0x7f) return false
  }
  return true
}

/** densable `Ar` */
async function worktreeConfigEnabled(
  run: SeedGitRun,
  commonDir: string,
): Promise<boolean | null> {
  const listed = await run([
    'config',
    '--file',
    join(commonDir, 'config'),
    '--bool',
    '--default=false',
    'extensions.worktreeConfig',
  ])
  return listed.code !== 0 ? null : listed.stdout.trim() === 'true'
}

/** densable `Ne` */
async function copyRegularFile(
  from: string,
  to: string,
  budget: { left: number },
): Promise<void> {
  if (getPlatform() === 'windows') {
    const st = await lstat(from).catch(() => null)
    if (st !== null && !st.isFile()) throw Error('not a regular file')
  }
  let src
  try {
    src = await open(from, constants.O_RDONLY)
  } catch (err) {
    if (getErrnoCode(err) === 'ENOENT') return
    throw err
  }
  try {
    const st = await src.stat()
    if (!st.isFile() || st.nlink !== 1) throw Error('not a regular file')
    if (st.size > COPY_FILE_CAP) {
      throw Error('larger than an index or refs file gets')
    }
    budget.left -= st.size
    if (budget.left < 0) {
      throw Error('the files to copy grew past what a git dir holds')
    }
    const dest = await open(to, 'wx', 384)
    try {
      const buf = Buffer.allocUnsafe(1048576)
      let offset = 0
      while (offset < st.size) {
        const { bytesRead } = await src.read(
          buf,
          0,
          Math.min(buf.length, st.size - offset),
          offset,
        )
        if (bytesRead === 0) break
        await dest.write(buf, 0, bytesRead)
        offset += bytesRead
      }
      await dest.utimes(st.atime, st.mtime)
    } finally {
      await dest.close()
    }
  } finally {
    await src.close()
  }
}

/** densable `Er` */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return getErrnoCode(err) === 'EPERM'
  }
}

/**
 * densable `Jn` / `_695` `YBc`/`m`. `Wn(e,{env})` is process-start
 * identity (CIM ticks / `ps lstart` / FFI FILETIME) — not a Windows
 * access-token API. Env PATH lookup (`w`/`y`) is unlocked; host is
 * `getProcessLstartString` (official `??""` when missing).
 */
async function adminPidToken(
  pid: number,
  _env: NodeJS.ProcessEnv,
): Promise<string> {
  return ((await getProcessLstartString(pid)) ?? '')
    .replace(/[^0-9a-z]/gi, '')
    .toLowerCase()
    .slice(0, 24)
}

/** densable `yr` */
async function sweepSeedAdmin(
  dir: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    const now = Date.now()
    await Promise.all(
      (await readdir(dir)).map(async name => {
        const parsed = /^claude-seed-admin-([0-9]+)-([0-9a-z]*)-/.exec(name)
        if (parsed === null && !name.startsWith('claude-seed-stage-')) return
        const path = join(dir, name)
        if (now - (await lstat(path)).mtimeMs < SWEEP_AGE_MS) return
        if (parsed !== null && pidAlive(Number(parsed[1]))) {
          if (parsed[2] === '') return
          const token = await adminPidToken(Number(parsed[1]), env)
          if (token === '' || token === parsed[2]) return
        }
        await rm(path, { recursive: true, force: true })
      }),
    )
  } catch {
    /* official yr swallows */
  }
}

function parseNulPairs(stdout: string): Array<{
  key: string
  value: string
  valueless: boolean
}> {
  const parts = stdout.split('\0')
  return Array.from({ length: Math.floor(parts.length / 2) }, (_, i) => {
    const rest = parts[2 * i + 1] ?? ''
    const nl = rest.indexOf('\n')
    return {
      key: nl < 0 ? rest : rest.slice(0, nl),
      value: nl < 0 ? '' : rest.slice(nl + 1),
      valueless: nl < 0,
    }
  })
}

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

/**
 * densable `to` / `X4n`.
 * `qt` is `fs.promises.symlink` (windows type `"junction"`).
 */
export async function makeSeedAdminDir(
  _cwd: string,
  layout: {
    gitDir: string
    commonDir: string
    workTree: string
    checkout: 'main' | 'linked'
    bound: boolean
  },
  run: SeedGitRun,
  signal?: AbortSignal,
): Promise<SeedAdminResult> {
  const [format, listed, refs] = await Promise.all([
    run(['rev-parse', '--show-object-format']),
    run([
      'config',
      '-z',
      '--show-origin',
      '--no-includes',
      '--file',
      join(layout.commonDir, 'config'),
      '--list',
    ]),
    run([
      'for-each-ref',
      '--format=%(objectname) %(refname)',
      'refs/heads/',
      'refs/tags/',
      'refs/remotes/',
    ]),
  ])
  const objectFormat = format.code === 0 ? format.stdout.trim() : ''
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
    return fail('could not read the object format')
  }
  if (refs.code !== 0) return fail('could not list the refs')
  if (refs.stdout.includes('\uFFFD')) {
    return fail('a ref name here is not valid UTF-8')
  }
  const packed = refs.stdout
    .split('\n')
    .filter(isPackedRefLine)
    .map(line => `${line}\n`)
    .join('')
  const hasConfig =
    (await hopKind(join(layout.commonDir, 'config'))) !== 'absent'
  if (listed.code !== 0 && hasConfig) {
    return fail('could not read the repository configuration')
  }
  const worktreeCfg =
    layout.checkout === 'linked'
      ? false
      : await worktreeConfigEnabled(run, layout.commonDir)
  if (worktreeCfg === null) {
    return fail('could not read extensions.worktreeConfig')
  }
  const worktreeListed = worktreeCfg
    ? await run([
        'config',
        '-z',
        '--show-origin',
        '--no-includes',
        '--file',
        join(layout.gitDir, 'config.worktree'),
        '--list',
      ])
    : null
  if (
    worktreeListed !== null &&
    worktreeListed.code !== 0 &&
    (await hopKind(join(layout.gitDir, 'config.worktree'))) !== 'absent'
  ) {
    return fail('could not read the per-worktree configuration')
  }
  const pins = [
    ...(listed.code === 0 ? parseNulPairs(listed.stdout) : []),
    ...(worktreeListed?.code === 0 ? parseNulPairs(worktreeListed.stdout) : []),
  ]
    .map(({ key, value, valueless }) => ({
      key,
      value: valueless ? 'true' : value === '' ? 'false' : value,
    }))
    .filter(
      ({ key, value }) => CORE_PINS.has(key) && CORE_PIN_VALUE.test(value),
    )
  const head = oneLine(
    await readUtf8File(join(layout.gitDir, 'HEAD')).catch(() => undefined),
  )
  if (
    head === null ||
    head.includes('\uFFFD') ||
    !(
      /^ref: refs\/heads\/\S+$/.test(head) ||
      /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(head)
    )
  ) {
    return fail('HEAD is not a branch or an object id')
  }
  const shared = (await readdir(layout.gitDir).catch(() => [])).filter(name =>
    /^sharedindex\.[0-9a-f]{40,64}$/.test(name),
  )
  if (shared.length > SHAREDINDEX_CAP) {
    return fail('too many sharedindex files stand in the git dir')
  }
  const sharedBytes = (
    await Promise.all(
      shared.map(name =>
        lstat(join(layout.gitDir, name)).then(
          st => (st.isFile() ? st.size : 0),
          () => 0,
        ),
      ),
    )
  ).reduce((sum, size) => sum + size, 0)
  if (sharedBytes > COPY_BUDGET) {
    return fail('the sharedindex files in the git dir are too large to copy')
  }
  const linkType = getPlatform() === 'windows' ? 'junction' : undefined
  const commonParent = dirname(layout.commonDir)
  const configHome = getClaudeConfigHomeDir()
  if (!isAbsolute(configHome)) {
    return fail(
      'the configuration home (CLAUDE_CONFIG_DIR) is not an absolute path',
      'placement',
    )
  }
  if (driftedConfigHome(DRIFT_KEYS) !== undefined) {
    return fail(
      'where your own settings are found (CLAUDE_CONFIG_DIR, the HOME it defaults from, or the cowork settings switch) changed after Claude Code started: set it in the shell, not a settings file, and restart',
      'placement',
    )
  }
  const adminRoot = join(
    await realpath(configHome).catch(() => configHome),
    'seed-admin',
  )
  if (
    [adminRoot, join(configHome, 'seed-admin')].some(
      path =>
        seedPathContains(layout.workTree, path) ||
        seedPathContains(commonParent, path) ||
        seedPathContains(layout.gitDir, path),
    )
  ) {
    return fail(
      '~/.claude/seed-admin lies inside this working tree or its repository',
      'placement',
    )
  }
  let made: string | undefined
  try {
    await mkdir(adminRoot, { recursive: true, mode: 448 })
    if (!(await lstat(adminRoot)).isDirectory()) {
      return fail('~/.claude/seed-admin is not a plain directory of this user')
    }
    await sweepSeedAdmin(adminRoot, process.env)
    made = await mkdtemp(
      join(
        adminRoot,
        `claude-seed-admin-${process.pid}-${await adminPidToken(process.pid, process.env)}-`,
      ),
    )
  } catch (err) {
    return fail(String(err))
  }
  try {
    const budget = { left: COPY_BUDGET + 2 * COPY_FILE_CAP }
    const coreLines = [
      '[core]',
      `\trepositoryformatversion = ${objectFormat === 'sha256' ? 1 : 0}`,
      '\tbare = false',
      '\tlogallrefupdates = false',
      '[gc]',
      '\tauto = 0',
      '\tautodetach = false',
      '\tpruneexpire = never',
      '[maintenance]',
      '\tauto = false',
      '[core]',
      ...pins.map(pin => `\t${pin.key.slice(5)} = ${pin.value}`),
      ...(objectFormat === 'sha256'
        ? ['[extensions]', '\tobjectformat = sha256']
        : []),
      '',
    ]
    await Promise.all([
      writeFile(join(made, 'config'), coreLines.join('\n'), {
        flag: 'wx',
        mode: 384,
      }),
      writeFile(join(made, 'HEAD'), `${head}\n`, { flag: 'wx', mode: 384 }),
      copyRegularFile(
        join(layout.gitDir, 'index'),
        join(made, 'index'),
        budget,
      ),
      ...['objects', 'info'].map(name =>
        symlink(join(layout.commonDir, name), join(made, name), linkType),
      ),
      mkdir(join(made, 'refs'), { mode: 448 }),
      writeFile(join(made, 'packed-refs'), packed, { flag: 'wx', mode: 384 }),
      copyRegularFile(
        join(layout.commonDir, 'shallow'),
        join(made, 'shallow'),
        budget,
      ),
      ...shared.map(name =>
        copyRegularFile(join(layout.gitDir, name), join(made, name), budget),
      ),
    ])
    if (signal?.aborted) throw Error('aborted')
    const path = made
    const dispose = () =>
      rm(path, { recursive: true, force: true }).catch(() => {})
    return { kind: 'made', path, dispose, [Symbol.asyncDispose]: dispose }
  } catch (err) {
    await rm(made, { recursive: true, force: true }).catch(() => {})
    return fail(String(err))
  }
}

/** densable TCt `bp($l(Bc(T.detail)), yCt=300)` — `Bc`=`Pzd` first line. */
export function formatSeedAdminFail(
  detail: string,
  reason: 'setup' | 'placement',
): string {
  const shown = truncateSeedDisplay(
    sanitizeSeedDisplay(washSeedStderr(detail)),
    ADMIN_DETAIL_CAP,
  )
  if (reason === 'placement') {
    return `Not uploading this working tree this way: the private git directory the upload must trust would stand where a cloud session can write \u2014 ${shown}. Nothing was uploaded; retry once that is changed.`
  }
  return `Could not prepare a private git directory for the upload (${shown}), so nothing was uploaded this way. It is made under ~/.claude/seed-admin from this checkout's HEAD and index: check that those are plain files git wrote (HEAD naming a branch or a commit) and that ~/.claude is a writable directory of yours, then retry.`
}
