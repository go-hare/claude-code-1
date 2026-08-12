/**
 * densable 2.1.224 git configure / proxy / governed seed helpers.
 * Recovered from SEA `/tmp/shr-extract-224/git-*.js` + `governed-*.js`.
 */
import { spawn } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
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
): Promise<void> {
  try {
    await rm(dirname(opts.xdgConfigPath), { recursive: true, force: true })
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
