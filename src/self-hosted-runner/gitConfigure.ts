/**
 * densable 2.1.224 git configure / proxy / governed seed helpers.
 * Recovered from SEA `/tmp/shr-extract-224/git-*.js` + `governed-*.js`.
 */
import { spawn } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** densable `f2h` */
export const GIT_PROXY_CRED_HELPER_CONTENT = `#!/bin/sh
test "$1" = get || exit 0
printf "username=unused\\npassword=%s\\n" "$CLAUDE_CODE_SESSION_ACCESS_TOKEN"
`

/** densable `_2h` */
export const HOOK_STUB_GENERIC = `#!/bin/sh
common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || common_dir=.git
local_hook="$common_dir/hooks/$(basename "$0")"
[ -x "$local_hook" ] && exec "$local_hook" "$@"
exit 0
`

/** densable `y2h` — coauthor trailer (email from CCR_SESSION_ACCOUNT_EMAIL) */
export const HOOK_STUB_COAUTHOR = `#!/bin/sh
common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || common_dir=.git
local_hook="$common_dir/hooks/$(basename "$0")"
if [ -x "$local_hook" ]; then
  "$local_hook" "$@" || exit $?
fi
email="$CCR_SESSION_ACCOUNT_EMAIL"
nl='
'
case "$email" in
  ''|*'<'*|*'>'*|*"$nl"*) email='' ;;
esac
if [ -n "$email" ] && printf %s "$email" | LC_ALL=C grep -q '[^ -~]'; then
  email=''
fi
if [ -n "$email" ]; then
  name="\${email%%@*}"
  git interpret-trailers --in-place \
    --if-exists addIfDifferent \
    --trailer "Co-authored-by: $name <$email>" "$1"
fi
exit 0
`

/** densable `MJl` */
export const MIN_GIT_VERSION_FOR_SSH_SIGN: readonly [number, number] = [2, 34]

/** densable `g2h` */
export const GENERIC_HOOK_NAMES = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'reference-transaction',
  'fsmonitor-watchman',
  'pre-auto-gc',
  'post-rewrite',
  'sendemail-validate',
  'post-index-change',
] as const

/** densable `tjv` — http.* allowlist for governed seed */
export const GOVERNED_HTTP_GIT_KEYS = new Set([
  'postbuffer',
  'lowspeedlimit',
  'lowspeedtime',
  'version',
])

/** densable `Jrr` — governed git spawn timeout */
export const GOVERNED_GIT_SPAWN_TIMEOUT_MS = 30_000

/** densable `m2h` */
export function gitProxyCredHelperPath(baseDir: string): string {
  return join(baseDir, '.runner', 'git-proxy-cred')
}

/** densable `b2h` — shell-single-quote escape */
export function shellSingleQuote(s: string): string {
  return s.replace(/'/g, `'\\''`)
}

/** densable `u2h` */
export function parseGitVersion(stdout: string): [number, number] | null {
  const m = /git version (\d+)\.(\d+)/.exec(stdout)
  if (!m) return null
  return [Number(m[1]), Number(m[2])]
}

/**
 * densable `d2h` — true if git supports SSH signing; null if unparseable.
 */
export function gitSupportsSshSign(versionStdout: string): boolean | null {
  const v = parseGitVersion(versionStdout)
  if (v === null) return null
  const [maj, min] = v
  const [needMaj, needMin] = MIN_GIT_VERSION_FOR_SSH_SIGN
  return maj > needMaj || (maj === needMaj && min >= needMin)
}

/** densable `p2h` — code-sign shim script body */
export function codeSignShimScript(execPath: string): string {
  return `#!/bin/sh
BIN="$CLAUDE_RUNNER_CLAUDE_BIN"
[ -n "$BIN" ] || BIN='${shellSingleQuote(execPath)}'
exec "$BIN" self-hosted-runner code-sign "$@"
`
}

/**
 * densable `$2h` — allowlist filter for governed gitconfig seed entries.
 */
export function isGovernedGitConfigAllowed(
  key: string,
  value: string,
): boolean {
  const k = key.toLowerCase()
  if (k.startsWith('user.')) return true
  if (k === 'core.autocrlf' || k === 'core.safecrlf' || k === 'core.eol') {
    return true
  }
  if (k.startsWith('url.') && k.endsWith('.insteadof')) {
    const mid = key.slice(4, key.length - 10)
    return !/\/\/[^/]*@/.test(mid)
  }
  if (k.startsWith('alias.')) {
    return !value.trimStart().startsWith('!')
  }
  if (k.startsWith('http.')) {
    const rest = k.slice(5)
    if (rest.includes('.')) return false
    return GOVERNED_HTTP_GIT_KEYS.has(rest)
  }
  return false
}

/** densable `LJl` — per-session governed signing entries under baseDir/.runner */
export function governedSigningEntries(
  baseDir: string,
): Array<[string, string]> {
  const runner = join(baseDir, '.runner')
  return [
    ['user.name', 'Claude'],
    ['user.email', 'noreply@anthropic.com'],
    ['user.signingkey', join(runner, 'commit_signing_key.pub')],
    ['gpg.format', 'ssh'],
    ['gpg.ssh.program', join(runner, 'code-sign')],
    ['commit.gpgsign', 'true'],
    ['tag.gpgsign', 'true'],
    ['core.hooksPath', join(runner, 'git-hooks')],
  ]
}

async function runGit(
  args: string[],
  opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: opts?.env ?? process.env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', d => {
      stdout += String(d)
    })
    child.stderr?.on('data', d => {
      stderr += String(d)
    })
    const timeout = setTimeout(
      () => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      },
      opts?.timeoutMs ?? 60_000,
      child,
    )
    child.on('error', err => {
      clearTimeout(timeout)
      reject(err)
    })
    child.on('close', code => {
      clearTimeout(timeout)
      resolve({ stdout, stderr, code })
    })
  })
}

/**
 * densable `GJl` — git with GIT_CONFIG_GLOBAL/SYSTEM null for governed seed ops.
 */
export async function governedGitSpawn(args: string[]): Promise<string> {
  const r = await runGit(args, {
    timeoutMs: GOVERNED_GIT_SPAWN_TIMEOUT_MS,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  })
  if (r.code === 0) return r.stdout
  throw new Error(
    `git ${args[0]} ${args[1] ?? ''} exited ${r.code}: ${r.stderr.trim()}`,
  )
}

/** densable `RKn` — write file with mode (rm + mkdir + write + chmod) */
export async function writeFileWithMode(
  path: string,
  content: string,
  mode: number,
): Promise<void> {
  await rm(path, { recursive: true, force: true })
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, { mode })
  await chmod(path, mode)
}

/**
 * densable `qqv` — register Anthropic git proxy credential helper.
 * Returns api base URL (trailing slash stripped).
 */
export async function configureAnthropicGitProxy(opts: {
  apiBaseUrl: string
  baseDir: string
  gitConfigPath?: string
  onStatus: (msg: string) => void
}): Promise<string> {
  const base = opts.apiBaseUrl.replace(/\/+$/, '')
  let host: string
  try {
    host = new URL(base).host
  } catch {
    throw new Error(
      `--use-anthropic-git-proxy: apiBaseUrl is not a valid URL: ${opts.apiBaseUrl}`,
    )
  }
  const runnerDir = join(opts.baseDir, '.runner')
  await mkdir(runnerDir, { recursive: true })
  const helper = gitProxyCredHelperPath(opts.baseDir)
  await writeFile(helper, GIT_PROXY_CRED_HELPER_CONTENT, { mode: 0o700 })
  await chmod(helper, 0o700)
  const fileArgs = opts.gitConfigPath
    ? ['--file', opts.gitConfigPath]
    : ['--global']
  const pairs: Array<[string, string]> = [
    [`credential.https://${host}.helper`, `!'${shellSingleQuote(helper)}'`],
    [`credential.https://${host}.useHttpPath`, 'false'],
    [`credential.https://${host}.username`, 'unused'],
    [`http.https://${host}/.proactiveAuth`, 'basic'],
  ]
  for (const [k, v] of pairs) {
    const r = await runGit(['config', ...fileArgs, '--replace-all', k, v])
    if (r.code !== 0) {
      throw new Error(
        `git config ${k} failed: ${r.stderr.trim() || r.stdout.trim()}`,
      )
    }
  }
  opts.onStatus(
    `[runner:git] --use-anthropic-git-proxy: credential helper registered for https://${host} (${helper})`,
  )
  return base
}

/**
 * densable `$qv` — configure global git identity + SSH signing program.
 * Returns path to code-sign shim.
 */
export async function configureGitSigning(opts: {
  baseDir: string
  execPath: string
  gitConfigPath?: string
  onStatus: (msg: string) => void
}): Promise<string> {
  const ver = await runGit(['--version'])
  const ok = gitSupportsSshSign(ver.stdout)
  if (ok === null) {
    opts.onStatus(
      `[runner:git] --configure-git: could not parse git version from "${ver.stdout.trim()}"; proceeding without version check`,
    )
  } else if (!ok) {
    const [c, u] = MIN_GIT_VERSION_FOR_SSH_SIGN
    throw new Error(
      `--configure-git requires git >= ${c}.${u} for SSH commit signing (found: ${ver.stdout.trim()}). Upgrade git in your runner image, or omit --configure-git and manage git identity yourself`,
    )
  }
  const runnerDir = join(opts.baseDir, '.runner')
  await mkdir(runnerDir, { recursive: true })
  const codeSign = join(runnerDir, 'code-sign')
  const pubKey = join(runnerDir, 'commit_signing_key.pub')
  const shim = codeSignShimScript(opts.execPath)
  await writeFile(codeSign, shim, { mode: 0o755 })
  await chmod(codeSign, 0o755)
  await writeFile(pubKey, '')
  const pairs: Array<[string, string]> = [
    ['user.name', 'Claude'],
    ['user.email', 'noreply@anthropic.com'],
    ['gpg.format', 'ssh'],
    ['gpg.ssh.program', codeSign],
    ['user.signingkey', pubKey],
    ['commit.gpgsign', 'true'],
    ['tag.gpgsign', 'true'],
  ]
  const fileArgs = opts.gitConfigPath
    ? ['--file', opts.gitConfigPath]
    : ['--global']
  for (const [k, v] of pairs) {
    const r = await runGit(['config', ...fileArgs, '--replace-all', k, v])
    if (r.code !== 0) {
      throw new Error(
        `git config ${k} failed: ${r.stderr.trim() || r.stdout.trim()}`,
      )
    }
  }
  opts.onStatus(
    `[runner:git] --configure-git: identity=Claude <noreply@anthropic.com>, gpg.ssh.program=${codeSign}`,
  )
  await installCoauthorHooks(runnerDir, fileArgs, opts.onStatus)
  return codeSign
}

/**
 * densable `h2h` — install generic + coauthor hook stubs + set core.hooksPath.
 */
export async function installCoauthorHooks(
  runnerDir: string,
  gitConfigArgs: string[],
  onStatus: (msg: string) => void,
): Promise<void> {
  const hooksDir = join(runnerDir, 'git-hooks')
  const getArgs =
    gitConfigArgs[0] === '--file' ? gitConfigArgs : ([] as string[])
  const existing = await runGit([
    'config',
    ...getArgs,
    '--get',
    'core.hooksPath',
  ]).then(
    r => r.stdout.trim(),
    () => '',
  )
  if (existing !== '' && existing !== hooksDir) {
    onStatus(
      `[runner:git] --configure-git: core.hooksPath already set (${existing}); skipping Co-authored-by hook install so existing hooks keep running`,
    )
    return
  }
  await mkdir(hooksDir, { recursive: true })
  for (const name of GENERIC_HOOK_NAMES) {
    const p = join(hooksDir, name)
    await writeFile(p, HOOK_STUB_GENERIC, { mode: 0o755 })
    await chmod(p, 0o755)
  }
  for (const name of ['commit-msg', 'prepare-commit-msg'] as const) {
    const p = join(hooksDir, name)
    await writeFile(p, HOOK_STUB_COAUTHOR, { mode: 0o755 })
    await chmod(p, 0o755)
  }
  const setArgs = gitConfigArgs.length > 0 ? gitConfigArgs : getArgs
  const r = await runGit([
    'config',
    ...setArgs,
    '--replace-all',
    'core.hooksPath',
    hooksDir,
  ])
  if (r.code !== 0) {
    throw new Error(
      `git config core.hooksPath failed: ${r.stderr.trim() || r.stdout.trim()}`,
    )
  }
  onStatus(`[runner:git] --configure-git: core.hooksPath=${hooksDir}`)
}

/**
 * densable `eBh` — capture allowlisted host gitconfig seed string.
 * Returns empty string on total failure (sessions seed empty governed config).
 */
export async function captureGovernedGitConfigSeed(
  onDebug: (msg: string) => void,
): Promise<string> {
  const gitConfigGlobal = process.env.GIT_CONFIG_GLOBAL
  const home = process.env.HOME || homedir()
  const xdg = process.env.XDG_CONFIG_HOME || join(home, '.config')
  const paths = gitConfigGlobal
    ? [gitConfigGlobal]
    : [join(xdg, 'git', 'config'), join(home, '.gitconfig')]
  const entries: Array<[string, string]> = []
  for (const path of paths) {
    try {
      await readFile(path)
    } catch {
      continue
    }
    try {
      const listed = await governedGitSpawn([
        'config',
        '--file',
        path,
        '--list',
        '-z',
      ])
      for (const u of listed.split('\0')) {
        if (!u) continue
        const d = u.indexOf('\n')
        const key = d === -1 ? u : u.slice(0, d)
        const val = d === -1 ? 'true' : u.slice(d + 1)
        entries.push([key, val])
      }
      onDebug(
        `[runner] governed git: captured gitconfig seed from ${path} (startup snapshot)`,
      )
    } catch (err) {
      onDebug(
        `[runner] governed git: could not parse ${path} for gitconfig seed (${err}); skipping it`,
      )
    }
  }
  const kept = entries.filter(([k, v]) => isGovernedGitConfigAllowed(k, v))
  if (kept.length < entries.length) {
    const family = (d: string): string => {
      const p = d.indexOf('.')
      const f = d.lastIndexOf('.')
      return p === f ? d : `${d.slice(0, p)}.*${d.slice(f)}`
    }
    const dropped = entries.filter(
      ([k, v]) => !isGovernedGitConfigAllowed(k, v),
    )
    const families = [...new Set(dropped.map(([d]) => family(d)))].sort()
    onDebug(
      `[runner] governed git: seed filter dropped ${dropped.length} non-allowlisted gitconfig entries (families: ${families.join(', ')})`,
    )
  }
  if (kept.length === 0) return ''
  let tmp: string | undefined
  try {
    tmp = await mkdtemp(join(tmpdir(), 'ccr-govseed-'))
    const seedPath = join(tmp, 'seed.gitconfig')
    for (const [k, v] of kept) {
      await governedGitSpawn(['config', '--file', seedPath, '--add', k, v])
    }
    return await readFile(seedPath, 'utf8')
  } catch (err) {
    onDebug(
      `[runner] governed git: seed serialization failed (${err}); governed sessions seed an empty gitconfig`,
    )
    return ''
  } finally {
    if (tmp) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export type GitArtifactFile = {
  path: string
  content: string
  mode: number
}

/**
 * densable `Fqv` — code-sign + empty pubkey artifacts under baseDir/.runner.
 */
export function codeSignArtifacts(
  baseDir: string,
  execPath: string,
): GitArtifactFile[] {
  const runner = join(baseDir, '.runner')
  return [
    {
      path: join(runner, 'code-sign'),
      content: codeSignShimScript(execPath),
      mode: 0o755,
    },
    {
      path: join(runner, 'commit_signing_key.pub'),
      content: '',
      mode: 0o644,
    },
  ]
}

/**
 * densable `Uqv` — coauthor + generic hook stub artifacts under .runner/git-hooks.
 */
export function coauthorHookStubs(baseDir: string): GitArtifactFile[] {
  const hooks = join(baseDir, '.runner', 'git-hooks')
  return [
    ...GENERIC_HOOK_NAMES.map(name => ({
      path: join(hooks, name),
      content: HOOK_STUB_GENERIC,
      mode: 0o755,
    })),
    ...(['commit-msg', 'prepare-commit-msg'] as const).map(name => ({
      path: join(hooks, name),
      content: HOOK_STUB_COAUTHOR,
      mode: 0o755,
    })),
  ]
}

/**
 * densable `bjv` — restore HOME-level git-proxy state to startup snapshot
 * before session prep (cross-session isolation).
 *
 * densable: rm XDG config dir, optional HOME .gitconfig if distinct from global,
 * rewrite globalConfigPath from snapshot (mode 0644), rewrite cred helper +
 * signing artifacts under .runner.
 */
export type GitProxyHomeSanitizeOpts = {
  xdgConfigPath: string
  homeGitconfigPath?: string
  globalConfigPath: string
  globalConfigSnapshot: string
  credHelper?: { path: string; content: string }
  signingArtifacts?: GitArtifactFile[]
}

export async function sanitizeGitProxyHomeState(
  opts: GitProxyHomeSanitizeOpts,
  onDebug: (msg: string) => void,
  onStatus: (msg: string) => void = () => {},
): Promise<void> {
  try {
    const xdgDir = dirname(opts.xdgConfigPath)
    await rm(xdgDir, { recursive: true, force: true })
    const ignoreDirs = [xdgDir]
    const homeGitDir =
      opts.homeGitconfigPath &&
      join(dirname(opts.homeGitconfigPath), '.config', 'git')
    if (homeGitDir && homeGitDir !== xdgDir) {
      await rm(homeGitDir, { recursive: true, force: true })
      ignoreDirs.push(homeGitDir)
    }
    for (const dir of ignoreDirs) {
      const ignorePath = join(dir, 'ignore')
      await writeFileWithMode(
        ignorePath,
        '**/.claude/settings.local.json\n',
        0o644,
      ).catch(err =>
        onStatus(
          `[runner:warn] could not write ${ignorePath}, so git may not ignore .claude/settings.local.json in this session and "git add -A" may commit it: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    }
    if (
      opts.homeGitconfigPath &&
      opts.homeGitconfigPath !== opts.globalConfigPath
    ) {
      await rm(opts.homeGitconfigPath, { recursive: true, force: true })
    }
    await writeFileWithMode(
      opts.globalConfigPath,
      opts.globalConfigSnapshot,
      0o644,
    )
    if (opts.credHelper) {
      const runnerDir = dirname(opts.credHelper.path)
      const st = await lstat(runnerDir).catch(() => undefined)
      if (!st) {
        await mkdir(runnerDir, { recursive: true })
      } else if (!st.isDirectory() || st.isSymbolicLink()) {
        await rm(runnerDir, { recursive: true, force: true })
        await mkdir(runnerDir, { recursive: true })
      }
      if (opts.signingArtifacts) {
        for (const art of opts.signingArtifacts) {
          await writeFileWithMode(art.path, art.content, art.mode)
        }
      }
      await writeFileWithMode(
        opts.credHelper.path,
        opts.credHelper.content,
        0o700,
      )
    }
    onDebug(
      '[runner:session] restored ~/.gitconfig and git-proxy-cred to startup snapshot (git-proxy cross-session isolation)',
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `git-proxy: could not sanitize runner HOME-level git state before prep — ${msg}`,
    )
  }
}

/**
 * densable `yjv` — clean-slate git-hooks dir + rewrite stubs (cross-session isolation).
 * Optionally rewrite signing artifacts first.
 */
export async function restoreGitHookStubs(
  hookStubs: GitArtifactFile[],
  signingArtifacts: GitArtifactFile[] | undefined,
  onDebug: (msg: string) => void,
): Promise<void> {
  if (hookStubs.length === 0) return
  const hooksDir = dirname(hookStubs[0]!.path)
  const runnerDir = dirname(hooksDir)
  try {
    const st = await stat(runnerDir).catch(() => undefined)
    // densable uses lstat; for restore we accept missing → mkdir
    if (!st) {
      await mkdir(runnerDir, { recursive: true })
    } else if (!st.isDirectory()) {
      await rm(runnerDir, { recursive: true, force: true })
      await mkdir(runnerDir, { recursive: true })
    }
    if (signingArtifacts) {
      for (const s of signingArtifacts) {
        await writeFileWithMode(s.path, s.content, s.mode)
      }
    }
    await rm(hooksDir, { recursive: true, force: true })
    await mkdir(hooksDir, { recursive: true })
    for (const s of hookStubs) {
      await writeFileWithMode(s.path, s.content, 0o755)
    }
    onDebug(
      `[runner:session] clean-slated ${hooksDir} and rewrote ${hookStubs.length} hook stubs (cross-session isolation)`,
    )
  } catch (err) {
    throw new Error(
      `--configure-git: could not restore hook stubs under ${hooksDir} — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

export type OperatorGitTlsVar = { name: string; value: string }
export type OperatorGitTls = {
  certificateFile: OperatorGitTlsVar[]
  skipVerification: OperatorGitTlsVar[]
}
export type GovernedGitRouting = {
  governedHosts?: string[]
  directHosts?: string[]
  mountBaseUrl: string
  pushBaseUrl?: string
}
export type TrustBundleState =
  | {
      status: 'built'
      path: string
      certificatesLeftOut?: number
      certificatesUnjudged?: number
    }
  | {
      status: 'unavailable'
      reason:
        | 'variable_unset'
        | 'file_unreadable'
        | 'file_too_large'
        | 'file_not_pem'
        | 'file_other_certificate_kinds'
        | 'bundle_write_failed'
        | 'no_system_roots'
        | 'shared_with_other_sessions'
    }

export type GitTlsSessionState = {
  operator: OperatorGitTls
  routing: GovernedGitRouting | undefined
  trustBundlePath: string
  trustBundle: TrustBundleState
  otherSessionsShareTheAccount: boolean
  anySourceOnGitMount: boolean
}

function collectEnvCaseAware(
  env: NodeJS.ProcessEnv,
  name: string,
  caseInsensitive: boolean,
): OperatorGitTlsVar[] {
  const out: OperatorGitTlsVar[] = []
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    if (k === name) out.unshift({ name: k, value: v })
    else if (caseInsensitive && k.toUpperCase() === name) {
      out.push({ name: k, value: v })
    }
  }
  return out
}

/** densable `H$i` */
export function resolveOperatorGitTls(
  env: NodeJS.ProcessEnv,
  caseInsensitive = process.platform === 'win32',
): OperatorGitTls {
  return {
    certificateFile: collectEnvCaseAware(
      env,
      'GIT_SSL_CAINFO',
      caseInsensitive,
    ),
    skipVerification: collectEnvCaseAware(
      env,
      'GIT_SSL_NO_VERIFY',
      caseInsensitive,
    ),
  }
}

function unsetVars(vars: OperatorGitTlsVar[]): Record<string, undefined> {
  const out: Record<string, undefined> = {}
  for (const { name } of vars) out[name] = undefined
  return out
}

function mountUrlOrigins(routing: GovernedGitRouting): string[] {
  const set = new Set<string>()
  for (const u of [routing.mountBaseUrl, routing.pushBaseUrl]) {
    if (u && URL.canParse(u)) {
      for (const candidate of [new URL(u).origin, u]) {
        if (!candidate.includes('=')) set.add(candidate)
      }
    }
  }
  return [...set]
}

/** densable `GDn` — compute envOverrides and -c entries for prep/hook/child */
export function computeGovernedGitTls(opts: {
  role: 'prep' | 'resume' | 'outcome' | 'hook' | 'child'
  operator: OperatorGitTls
  routing: GovernedGitRouting | undefined
  target?: { url: string; mountRouted: boolean }
  trustBundle?: TrustBundleState
  reachesGitMount?: boolean
}): {
  envOverrides: Record<string, string | undefined>
  commandScopeEntries: Array<[string, string]>
} {
  const hasCert = opts.operator.certificateFile.length > 0
  const hasSkip = opts.operator.skipVerification.length > 0
  if (!opts.routing) {
    return { envOverrides: {}, commandScopeEntries: [] }
  }
  if (opts.role === 'hook') {
    if (!opts.reachesGitMount) {
      return { envOverrides: {}, commandScopeEntries: [] }
    }
    const origins = URL.canParse(opts.routing.mountBaseUrl)
      ? mountUrlOrigins(opts.routing)
      : []
    const pinned = origins.map((u): [string, string] => [
      `http.${u}.sslVerify`,
      'true',
    ])
    const moveSkip = hasSkip && origins.length > 0
    return {
      envOverrides: hasSkip ? unsetVars(opts.operator.skipVerification) : {},
      commandScopeEntries: moveSkip
        ? [['http.sslVerify', 'false'], ...pinned]
        : pinned,
    }
  }
  if (
    opts.role === 'prep' ||
    opts.role === 'resume' ||
    opts.role === 'outcome'
  ) {
    const target = opts.target
    if (!target?.mountRouted) {
      return { envOverrides: {}, commandScopeEntries: [] }
    }
    const skipOverrides = unsetVars(opts.operator.skipVerification)
    const trustBundle = opts.trustBundle
    if (
      !hasCert ||
      trustBundle?.status !== 'built' ||
      !URL.canParse(target.url)
    ) {
      return { envOverrides: skipOverrides, commandScopeEntries: [] }
    }
    const origin = new URL(target.url).origin
    const entries: Array<[string, string]> = [
      '',
      `${origin}.`,
      `${target.url}.`,
    ].map(suffix => [`http.${suffix}sslCAInfo`, trustBundle.path])
    return {
      envOverrides: {
        ...unsetVars(opts.operator.certificateFile),
        ...skipOverrides,
      },
      commandScopeEntries: entries,
    }
  }
  return { envOverrides: {}, commandScopeEntries: [] }
}

/** densable `jd` */
export function createGitTlsSessionState(
  env: NodeJS.ProcessEnv,
  caseInsensitive: boolean,
  routing: GovernedGitRouting | undefined,
  trustBundlePath: string,
  otherSessionsShareTheAccount = false,
): GitTlsSessionState {
  return {
    operator: resolveOperatorGitTls(env, caseInsensitive),
    routing,
    trustBundlePath,
    trustBundle: { status: 'unavailable', reason: 'variable_unset' },
    otherSessionsShareTheAccount,
    anySourceOnGitMount: false,
  }
}

/** densable `xi` */
export async function prepareGitTlsTrustBundle(
  state: GitTlsSessionState,
  buildBundle: (
    certFile: string,
    trustBundlePath: string,
  ) => Promise<TrustBundleState>,
): Promise<void> {
  const certFile = state.operator.certificateFile[0]?.value.trim()
  if (!state.routing || !certFile) {
    state.trustBundle = { status: 'unavailable', reason: 'variable_unset' }
    return
  }
  if (state.otherSessionsShareTheAccount) {
    state.trustBundle = {
      status: 'unavailable',
      reason: 'shared_with_other_sessions',
    }
    return
  }
  state.trustBundle = { status: 'unavailable', reason: 'bundle_write_failed' }
  state.trustBundle = await buildBundle(certFile, state.trustBundlePath)
}

const TRUST_BUNDLE_UNAVAILABLE_REASONS: Record<
  Exclude<
    Extract<TrustBundleState, { status: 'unavailable' }>['reason'],
    'variable_unset'
  >,
  { because: string; first: string }
> = {
  file_unreadable: {
    because:
      'the file the variable names could not be read (missing, not a regular file, or not readable by the runner account)',
    first: 'Fix the path or its permissions: git cannot read it either.',
  },
  file_too_large: {
    because: 'the file the variable names is larger than 1 MiB',
    first:
      "Cut it down to your company's own certificate authorities; the runner adds the public ones itself.",
  },
  file_not_pem: {
    because: 'the file the variable names holds no certificate in PEM form',
    first:
      'Put your certificate authorities in it in PEM form: git cannot use it as it is either.',
  },
  file_other_certificate_kinds: {
    because:
      'the file the variable names holds a TRUSTED CERTIFICATE or X509 CERTIFICATE block, which the certificate file the runner builds cannot carry',
    first:
      'Give every certificate authority in it as a plain CERTIFICATE block (openssl x509 without -trustout).',
  },
  bundle_write_failed: {
    because:
      'the runner could not finish building the file in the _sessions folder under its --base-dir',
    first: "Check that folder's permissions and free space.",
  },
  no_system_roots: {
    because:
      'this machine has no usable file of public certificate authorities at a standard Linux location',
    first:
      'On Linux, install or update your distribution ca-certificates package.',
  },
  shared_with_other_sessions: {
    because:
      "this runner runs more than one session at a time (--capacity above 1), and another session's process, which runs under the same account, could rewrite a certificate file the runner builds",
    first:
      "Run with --capacity 1, or put the public certificate authorities in the company's file yourself.",
  },
}

/** densable `Xd` */
export function formatRunnerMountTlsWarning(
  state: GitTlsSessionState,
): string | undefined {
  if (
    !state.routing ||
    state.operator.certificateFile.length === 0 ||
    state.trustBundle.status === 'built' ||
    state.trustBundle.reason === 'variable_unset'
  ) {
    return undefined
  }
  const { because, first } =
    TRUST_BUNDLE_UNAVAILABLE_REASONS[state.trustBundle.reason]
  const otherwise =
    state.trustBundle.reason === 'shared_with_other_sessions'
      ? 'Otherwise unset'
      : 'Otherwise add the public certificate authorities to the file, or unset'
  return `[runner:warn] governed git: GIT_SSL_CAINFO is set on this runner and ${because}, so the runner did not build the certificate file it gives its own git for Anthropic-managed git (the git mount): the public certificate authorities plus yours. The runner's own fetches from the mount keep the variable as it is, and fail if the file holds only your company's certificate authority, because the mount presents a public certificate. ${first} ${otherwise} the variable for the runner and name your company's file for your own server in the machine's system git config (an http.<your server's URL>.sslCAInfo entry).`
}

const DEFAULT_SYSTEM_ROOTS_CANDIDATES = [
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
]
const TRUST_BUNDLE_USER_MAX_BYTES = 1_048_576
const TRUST_BUNDLE_SYSTEM_MAX_BYTES = 8_388_608
const PEM_CERT_BLOCK_RE =
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g

const CLI_CERT_DENY_LIST: ReadonlyArray<{ certificate: string; key: string }> =
  [
    {
      certificate:
        '86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b',
      key: '8d417db2dd8bf5e3084d1e3f196d583849d81bdd4c00c70b9d39369e96b8c782',
    },
    {
      certificate:
        'bc4d809b15189d78db3e1d8cf4f9726a795da1643ca5f1358e1ddb0edc0d7eb3',
      key: 'eabc185c4e82d942b1a5978ba3c0181487d6b3b9974e5c49f72f6d0bd9637150',
    },
    {
      certificate:
        '40f6af0346a99aa1cd1d555a4e9cce62c7f9634603ee406615833dc8c8d00367',
      key: '376a1a7082a593dccc20d561d119e9ab8d30f11cc321d0a37fa41f0df284e01c',
    },
    {
      certificate:
        '125609aa301da0a249b97a8239cb6a34216f44dcac9f3954b14292f2e8c8608f',
      key: 'b7408b4d2be0238ba37004dd34e276c6019bd2f24c9db7d4980f5f6c359a4bcc',
    },
    {
      certificate:
        '0d74ef67c88de3560365e225aef976f915e901347b73352d81ab5b4132bb2150',
      key: '941ea0cbce0926d9f34ec667cee669b61fd39f4338fa0b91048d5749d8880d25',
    },
    {
      certificate:
        '1997770a5633fb6d0440abf7d7e87e15d795f094f8c2959dadb00e785866bf48',
      key: '1cbbd4cb5eec6a287e34636c07c78378fa3eb3c6d3fb0563286870f283d87034',
    },
    {
      certificate:
        '1aa0c2709e831bd6e3b5129a00ba41f7eeef020872f1e6504bf0f6c3f24f3af3',
      key: '71f8adeec2b58adbdf6205c98dde928a4254b03695193d7f9a63a9a2588095d0',
    },
    {
      certificate:
        '46cd083b47e80402028df493960ea19c85fe851950d5165f1c7da4faa951e2f8',
      key: '3f83a68c4e80fc3f4f487e3105ad146498e56a09a3ea223b2a2982943f5995d7',
    },
    {
      certificate:
        '47911bc8f32a11b029e0bb10a348b459404b87731b870a2f3fa97b4705dc4c25',
      key: '33836758bd871b8d464bd669b0b81832880b81e363fb8cbb21ba8e843a138858',
    },
    {
      certificate:
        '75d2ce75979cf2a43b172c9f89f733dda2136031db4bbf3698b053714c077155',
      key: '11567f2aaf4325c4044880c6ed2b37f1ca2586d87059cf254934d97c4fee89a5',
    },
    {
      certificate:
        '7dd78d5f4f13459a83dff9abbba62edbaf6f2d102bf257fd712f4d9f2746ed8d',
      key: 'c619e4780ed8e0abeda24ad732567de4383a7ea941338f6d1a7d1b49ac792fe9',
    },
    {
      certificate:
        '8abfc40faeaf13cbc8bb67b61c8d097a321cd2fee047c54256927e0f8bfeadfd',
      key: 'b5ee1c904ac2aae39c92601ab466269c0c1cd0b96badbd251b0ed88e6c4ded68',
    },
    {
      certificate:
        'bbd8b3d745efb79198d93b9c482b9d934537325729ea2f02c129261f91be2e3d',
      key: '8dd3d055a7f47ffbca287285dcfd201dde92823ccc484d30f11cc40f079b3a3e',
    },
    {
      certificate:
        'be0c7a1e9ed59990c3060095c2d6a9fd55a6e9448728f3235c7c3c0108fa2f43',
      key: 'e3212ac258d6d86f464c1150866a298c04a42783c1d17d7baa6a24ac0323f139',
    },
    {
      certificate:
        'c626090fd48ddbf2eee327e6a3d2ca78bd350c1faf0ceff015d834c3bd176ab0',
      key: 'cf36ee3b065cb7405569f6c189b54c2f3d43042a995e3f5fcfccefe09ad73177',
    },
    {
      certificate:
        'cef71e70b7c29addf6c30cd19e614b38fd5f02a435a0eeddd0087e183d101a51',
      key: 'ece28e35289ce8621c72407949e5050052ad4607cc332eaf9b546029aacbfb7a',
    },
    {
      certificate:
        'd7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef4',
      key: 'bd153ed7b0434f6886b17bce8bbe84ed340c7132d702a8f4fa318f756ecbd6f3',
    },
    {
      certificate:
        'f2edaaff3d9b701fb4d14c9f285f8c0bad90fc3bcc1fa07d47f4718edaba34a5',
      key: '0a6c2b2ca5b364207954171987ac9d2178561569d8205457e77ca90c32ede282',
    },
    {
      certificate:
        'f76a0d440c418dc5b362be8e11e0a5d06023f4396093e4f455827bf55153d8a4',
      key: '5da77dc800f4c6fa93c6015aa6bd898fdb7c28d869e764571b25c00375a77755',
    },
  ]

const DENIED_CERT_HASHES = new Set(CLI_CERT_DENY_LIST.map(e => e.certificate))
const DENIED_KEY_HASHES = new Set(CLI_CERT_DENY_LIST.map(e => e.key))

function normalizePemWhitespace(pem: string): string {
  return pem.replace(/\s/g, '')
}

export function filterTrustedPemCertificates(
  pemText: string,
  unjudgedBlocks?: Set<string>,
  extraDenied?: { certificates?: Set<string>; keys?: Set<string> },
): string {
  const blocks = pemText.match(PEM_CERT_BLOCK_RE)
  if (!blocks) return ''
  const certDeny = extraDenied?.certificates ?? DENIED_CERT_HASHES
  const keyDeny = extraDenied?.keys ?? DENIED_KEY_HASHES
  const kept: string[] = []
  for (const block of blocks) {
    try {
      const cert = new X509Certificate(block)
      const certSha256 = createHash('sha256').update(cert.raw).digest('hex')
      let keySha256: string | undefined
      try {
        const spki = cert.publicKey.export({ type: 'spki', format: 'der' })
        keySha256 = createHash('sha256').update(spki).digest('hex')
      } catch {
        unjudgedBlocks?.add(block)
      }
      if (
        certDeny.has(certSha256) ||
        (keySha256 !== undefined && keyDeny.has(keySha256))
      ) {
        continue
      }
      kept.push(block)
    } catch {
      unjudgedBlocks?.add(block)
      kept.push(block)
    }
  }
  return kept.join('\n')
}

async function readBoundedTextFile(
  filePath: string,
  maxBytes: number,
): Promise<
  | { kind: 'text'; text: string }
  | { kind: 'too_large' }
  | { kind: 'unreadable' }
> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    )
    const st = await handle.stat()
    if (!st.isFile()) return { kind: 'unreadable' }
    if (st.size > maxBytes) return { kind: 'too_large' }
    const buf = Buffer.alloc(maxBytes + 1)
    let total = 0
    while (total < buf.length) {
      const { bytesRead } = await handle.read(
        buf,
        total,
        buf.length - total,
        total,
      )
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > maxBytes) return { kind: 'too_large' }
    return { kind: 'text', text: buf.toString('utf8', 0, total) }
  } catch {
    return { kind: 'unreadable' }
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** densable `Yo` — build governed git trust bundle (system roots + GIT_SSL_CAINFO), filtered by CLI deny list */
export async function buildGitTrustBundle(
  certFile: string | undefined,
  trustBundlePath: string,
  onLog: (msg: string) => void = () => {},
  systemRootsCandidates: string[] = DEFAULT_SYSTEM_ROOTS_CANDIDATES,
  filterPem: (
    pem: string,
    unjudgedBlocks?: Set<string>,
  ) => string = filterTrustedPemCertificates,
): Promise<TrustBundleState> {
  if (certFile === undefined) {
    return { status: 'unavailable', reason: 'variable_unset' }
  }
  const userRead = await readBoundedTextFile(
    certFile,
    TRUST_BUNDLE_USER_MAX_BYTES,
  )
  if (userRead.kind !== 'text') {
    return {
      status: 'unavailable',
      reason:
        userRead.kind === 'too_large' ? 'file_too_large' : 'file_unreadable',
    }
  }
  if (
    /^-----BEGIN (?!CERTIFICATE-----)[A-Z0-9 ]*CERTIFICATE-----/m.test(
      userRead.text,
    )
  ) {
    return { status: 'unavailable', reason: 'file_other_certificate_kinds' }
  }
  const rawUserBlocks = userRead.text.match(PEM_CERT_BLOCK_RE)
  if (!rawUserBlocks) {
    return { status: 'unavailable', reason: 'file_not_pem' }
  }
  const unjudged = new Set<string>()
  let filteredSysText: string | undefined
  let rawSysBlocks: string[] = []
  for (const candidate of systemRootsCandidates) {
    const sysRead = await readBoundedTextFile(
      candidate,
      TRUST_BUNDLE_SYSTEM_MAX_BYTES,
    )
    if (sysRead.kind !== 'text') continue
    const filtered = filterPem(sysRead.text, unjudged)
    if (filtered.match(PEM_CERT_BLOCK_RE)) {
      filteredSysText = filtered
      rawSysBlocks = sysRead.text.match(PEM_CERT_BLOCK_RE) ?? []
      break
    }
  }
  if (filteredSysText === undefined) {
    return { status: 'unavailable', reason: 'no_system_roots' }
  }
  const filteredUserBlocks =
    filterPem(userRead.text, unjudged).match(PEM_CERT_BLOCK_RE) ?? []
  const keptSet = new Set(filteredSysText.match(PEM_CERT_BLOCK_RE) ?? [])
  let bundleText = filteredSysText.endsWith('\n')
    ? filteredSysText
    : `${filteredSysText}\n`
  for (const block of filteredUserBlocks) {
    if (!keptSet.has(block)) {
      keptSet.add(block)
      bundleText += `${block}\n`
    }
  }
  try {
    await writeFileWithMode(trustBundlePath, bundleText, 0o600)
  } catch (err) {
    onLog(
      `[runner:session] governed git: the trust bundle could not be written: ${err instanceof Error ? err.message : String(err)}`,
    )
    await rm(trustBundlePath, { force: true }).catch(() => {})
    return { status: 'unavailable', reason: 'bundle_write_failed' }
  }
  const keptNorm = new Set([...keptSet].map(normalizePemWhitespace))
  const certificatesLeftOut = new Set(
    [...rawSysBlocks, ...rawUserBlocks]
      .map(normalizePemWhitespace)
      .filter(b => !keptNorm.has(b)),
  ).size
  const bundleBlocks = new Set(bundleText.match(PEM_CERT_BLOCK_RE) ?? [])
  const certificatesUnjudged = new Set(
    [...unjudged].filter(b => bundleBlocks.has(b)).map(normalizePemWhitespace),
  ).size
  if (certificatesUnjudged > 0) {
    onLog(
      `[runner:session] governed git: kept ${certificatesUnjudged} certificate block(s) in the trust bundle without checking their keys against the deny list, because this runtime could not parse them or read their keys`,
    )
  }
  return {
    status: 'built',
    path: trustBundlePath,
    ...(certificatesLeftOut > 0 ? { certificatesLeftOut } : undefined),
    ...(certificatesUnjudged > 0 ? { certificatesUnjudged } : undefined),
  }
}

/** densable `qd` */
export function formatCertificatesLeftOutWarning(
  bundles: TrustBundleState[],
): string | undefined {
  const n = Math.max(
    0,
    ...bundles.map(b =>
      b.status === 'built' ? (b.certificatesLeftOut ?? 0) : 0,
    ),
  )
  if (n === 0) return undefined
  return `[runner:warn] governed git: the certificate file the runner builds for Anthropic-managed git (the git mount) leaves out ${n} ${n === 1 ? 'certificate' : 'certificates'} because of Claude Code's deny list, from this machine's public certificate authorities or the file GIT_SSL_CAINFO names. A git given this file does not trust ${n === 1 ? 'it' : 'them'} for the mount.`
}
