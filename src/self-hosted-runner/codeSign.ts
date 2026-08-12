/**
 * densable 2.1.224 self-hosted-runner code-sign (Wqv / S2h / T2h / jqv / zqv).
 * SSH-style `git -Y sign` helper → POST /v1/code/sessions/{id}/sign-commit.
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve as pathResolve } from 'node:path'
import { getProxyFetchOptions } from '../utils/proxy.js'

/** densable `Nqv` — session id charset */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

export type CodeSignArgs = {
  bufferFile: string
  namespace?: string
  keyFile?: string
}

/** densable `zqv` */
export function truncateForError(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** densable `jqv` — git object format for sign-commit body */
export function resolveGitObjectFormat(): 'sha1' | 'sha256' {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-object-format'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim()
    return out === 'sha256' ? 'sha256' : 'sha1'
  } catch {
    return 'sha1'
  }
}

/**
 * densable `S2h` — only SSH-style signing (`-Y sign`) is supported.
 * Parses git-ssh-like argv: `-Y sign`, optional `-n` namespace, `-f` key, positional file.
 */
export function parseCodeSignArgs(argv: string[]): CodeSignArgs {
  let sign = false
  let namespace: string | undefined
  let keyFile: string | undefined
  let bufferFile: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '-Y' && argv[i + 1] === 'sign') {
      sign = true
      i++
    } else if (arg === '-n') {
      namespace = argv[++i]
    } else if (arg === '-f') {
      keyFile = argv[++i]
    } else if (arg.startsWith('-')) {
      // densable: skip unknown flag and its value if next is non-flag
      if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('-')) {
        i++
      }
    } else if (bufferFile === undefined) {
      bufferFile = arg
    }
  }
  if (!sign) {
    throw new Error(
      `code-sign: only SSH-style signing (-Y sign) is supported; got: ${argv.join(' ')}`,
    )
  }
  if (!bufferFile) {
    throw new Error('code-sign: no file specified to sign')
  }
  return {
    bufferFile: pathResolve(bufferFile),
    namespace,
    keyFile,
  }
}

export type SignCommitDeps = {
  env: NodeJS.ProcessEnv
  fetchFn?: typeof fetch
  version?: string
}

/**
 * densable `T2h` — POST sign-commit, write `${bufferFile}.sig`, return path.
 */
export async function signCommitFile(
  args: CodeSignArgs,
  deps: SignCommitDeps,
): Promise<string> {
  const sessionId = deps.env.CLAUDE_CODE_REMOTE_SESSION_ID
  const token = deps.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
  const base = (
    deps.env.ANTHROPIC_BASE_URL ||
    deps.env.SESSION_INGRESS_URL ||
    ''
  ).replace(/\/+$/, '')

  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    throw new Error(
      'code-sign: CLAUDE_CODE_REMOTE_SESSION_ID is unset or malformed — ' +
        'is this process a descendant of a runner-spawned session?',
    )
  }
  if (!token) {
    throw new Error('code-sign: CLAUDE_CODE_SESSION_ACCESS_TOKEN is unset')
  }
  if (!base) {
    throw new Error('code-sign: ANTHROPIC_BASE_URL is unset')
  }

  const contents = await readFile(args.bufferFile, 'utf8')
  const gitObjectFormat = resolveGitObjectFormat()
  const body = JSON.stringify({
    contents,
    source: { type: 'git_repository' },
    git_object_format: gitObjectFormat,
  })
  const url = `${base}/v1/code/sessions/${sessionId}/sign-commit`
  const version =
    deps.version ??
    (typeof MACRO !== 'undefined' && typeof MACRO.VERSION === 'string'
      ? MACRO.VERSION
      : '0.0.0')
  const fetchFn = deps.fetchFn ?? fetch
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-environment-runner-version': `shr-${version}`,
      authorization: `Bearer ${token}`,
    },
    body,
    ...getProxyFetchOptions({ forAnthropicAPI: true }),
    signal: AbortSignal.timeout(30_000),
  } as RequestInit)

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `code-sign: sign-commit returned HTTP ${response.status}` +
        (text ? `: ${truncateForError(text, 200)}` : ''),
    )
  }
  const json = (await response.json()) as { signature?: string }
  if (!json.signature) {
    throw new Error('code-sign: response missing signature')
  }
  const sigPath = `${args.bufferFile}.sig`
  await writeFile(sigPath, json.signature)
  return sigPath
}

/** densable `Wqv` / `selfHostedRunnerCodeSignMain` */
export async function selfHostedRunnerCodeSignMain(
  argv: string[],
): Promise<void> {
  try {
    const parsed = parseCodeSignArgs(argv)
    await signCommitFile(parsed, {
      env: process.env,
      fetchFn: fetch,
    })
    process.exit(0)
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
