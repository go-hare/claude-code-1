import { spawn } from 'node:child_process'
import { logForDebugging } from 'src/utils/debug.js'

const PROBE_TIMEOUT_MS = 15_000

export interface ProbeResult {
  hasBinary: boolean
  remoteVersion: string | null
  remotePlatform: 'linux' | 'darwin'
  remoteArch: 'x64' | 'arm64'
  defaultCwd: string
  binaryPath: string | null
}

export class SSHProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHProbeError'
  }
}

function hasDisallowedSshHostChar(host: string): boolean {
  for (let i = 0; i < host.length; i++) {
    const code = host.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f || /\s/.test(host[i]!)) {
      return true
    }
  }
  return false
}

/**
 * P1-E4: Validate SSH host target before passing to `ssh` / `scp`.
 * Rejects leading `'-'` (OpenSSH option injection such as `-oProxyCommand=...`)
 * as well as empty strings, whitespace, NUL bytes, and ASCII control characters.
 */
export function validateSshHost(host: string): string {
  if (!host || host.startsWith('-') || hasDisallowedSshHostChar(host)) {
    throw new SSHProbeError(
      `Invalid SSH host "${host}": host must be non-empty, must not start with '-', and must not contain whitespace or control characters`,
    )
  }
  return host
}

export async function probeRemote(
  host: string,
  onProgress?: (msg: string) => void,
): Promise<ProbeResult> {
  const safeHost = validateSshHost(host)
  onProgress?.('Probing remote host…')

  const { stdout, stderr, exitCode } = await new Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }>((resolvePromise, reject) => {
    const proc = spawn(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        '--',
        safeHost,
        'CLAUDE_BIN=$(test -x "$HOME/.local/bin/claude" && echo "$HOME/.local/bin/claude" || command -v claude 2>/dev/null); echo "$CLAUDE_BIN"; $CLAUDE_BIN --version 2>/dev/null; uname -sm; pwd',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        proc.kill()
      } catch {
        // already exited
      }
      reject(
        new SSHProbeError(
          `SSH probe timed out after ${PROBE_TIMEOUT_MS / 1000}s`,
        ),
      )
    }, PROBE_TIMEOUT_MS)

    proc.once('error', err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new SSHProbeError(`SSH probe failed: ${err.message}`))
    })

    proc.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? 1,
      })
    })
  })

  if (exitCode !== 0) {
    const detail = stderr.trim() || `exit code ${exitCode}`
    throw new SSHProbeError(`SSH probe failed: ${detail}`)
  }

  const lines = stdout
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  logForDebugging(`[SSHProbe] raw lines: ${JSON.stringify(lines)}`)

  const unameIdx = lines.findIndex(l => /^(Linux|Darwin)\s/.test(l))
  if (unameIdx === -1) {
    throw new SSHProbeError(
      'Could not detect remote platform (uname output missing)',
    )
  }

  const binaryPath = unameIdx >= 2 ? lines[unameIdx - 2] || null : null
  const versionLine = unameIdx >= 1 ? lines[unameIdx - 1] || null : null
  const remoteVersion =
    versionLine && /^\d+\.\d+/.test(versionLine) ? versionLine : null
  const hasBinary = binaryPath !== null && binaryPath.startsWith('/')
  const defaultCwd = lines[unameIdx + 1] || '/'

  const [osName, arch] = lines[unameIdx]!.split(/\s+/)

  const remotePlatform = osName === 'Darwin' ? 'darwin' : 'linux'
  const remoteArch: 'x64' | 'arm64' =
    arch === 'aarch64' || arch === 'arm64' ? 'arm64' : 'x64'

  onProgress?.(`Detected ${remotePlatform}/${remoteArch}`)

  return {
    hasBinary: hasBinary && remoteVersion !== null,
    remoteVersion,
    remotePlatform,
    remoteArch,
    defaultCwd,
    binaryPath: hasBinary ? binaryPath : null,
  }
}
