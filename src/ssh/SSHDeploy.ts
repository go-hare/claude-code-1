import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logForDebugging } from 'src/utils/debug.js'

const SSH_TIMEOUT_MS = 60_000
const KILL_GRACE_MS = 2_000
const REMOTE_BIN_DIR = '~/.local/bin'
const REMOTE_CLI_FILE = 'claude-code-cli.js'
const REMOTE_WRAPPER = 'claude'

export interface DeployOptions {
  host: string
  remotePlatform: string
  remoteArch: string
  localVersion: string
  onProgress?: (msg: string) => void
}

export function runCommandCapture(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimers = () => {
      clearTimeout(timer)
      if (killTimer !== undefined) {
        clearTimeout(killTimer)
        killTimer = undefined
      }
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        proc.kill('SIGTERM')
      } catch {
        // already exited
      }
      proc.stdout?.destroy()
      proc.stderr?.destroy()
      killTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          // already exited
        }
      }, KILL_GRACE_MS)
      killTimer.unref?.()
      reject(
        new Error(
          `Command "${command}" timed out after ${Math.max(1, Math.round(timeoutMs / 1000))}s`,
        ),
      )
    }, timeoutMs)
    timer.unref?.()

    proc.once('exit', () => {
      if (killTimer !== undefined) {
        clearTimeout(killTimer)
        killTimer = undefined
      }
    })

    proc.once('error', err => {
      if (settled) return
      settled = true
      clearTimers()
      reject(err)
    })

    proc.once('close', code => {
      if (settled) return
      settled = true
      clearTimers()
      resolvePromise({
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
        exitCode: code ?? 1,
      })
    })
  })
}

async function runSshCommand(
  host: string,
  command: string,
  timeoutMs = SSH_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCommandCapture(
    'ssh',
    ['-o', 'ConnectTimeout=10', host, command],
    timeoutMs,
  )
}

function findLocalBinary(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const projectRoot = resolve(currentDir, '../..')
  const distPath = resolve(projectRoot, 'dist/cli.js')
  if (existsSync(distPath)) return distPath

  const devPath = resolve(projectRoot, 'src/entrypoints/cli.tsx')
  if (existsSync(devPath)) return devPath

  throw new Error(
    'Cannot find local CLI binary to deploy. Run `bun run build` first.',
  )
}

export async function deployBinary(options: DeployOptions): Promise<string> {
  const { host, remotePlatform, remoteArch, localVersion, onProgress } = options

  if (remotePlatform !== 'linux' && remotePlatform !== 'darwin') {
    throw new Error(
      `Remote platform "${remotePlatform}" is not supported. Only linux and darwin are supported.`,
    )
  }

  logForDebugging(
    `[SSHDeploy] deploying to ${host} (${remotePlatform}/${remoteArch}, v${localVersion})`,
  )

  const localBinary = findLocalBinary()
  logForDebugging(`[SSHDeploy] local binary: ${localBinary}`)

  onProgress?.('Creating remote directory...')
  const mkdirResult = await runSshCommand(host, `mkdir -p ${REMOTE_BIN_DIR}`)
  if (mkdirResult.exitCode !== 0) {
    throw new Error(`Failed to create remote directory: ${mkdirResult.stderr}`)
  }

  onProgress?.('Uploading binary...')
  const remotePath = `${REMOTE_BIN_DIR}/${REMOTE_CLI_FILE}`
  const scpResult = await runCommandCapture(
    'scp',
    ['-o', 'ConnectTimeout=10', localBinary, `${host}:${remotePath}`],
    SSH_TIMEOUT_MS,
  )

  if (scpResult.exitCode !== 0) {
    throw new Error(
      `SCP upload failed (exit ${scpResult.exitCode}): ${scpResult.stderr}`,
    )
  }

  onProgress?.('Installing wrapper script...')
  const wrapperScript = [
    `cat > ${REMOTE_BIN_DIR}/${REMOTE_WRAPPER} << 'WRAPPER'`,
    '#!/bin/sh',
    `exec bun ${REMOTE_BIN_DIR}/${REMOTE_CLI_FILE} "$@"`,
    'WRAPPER',
    `chmod +x ${REMOTE_BIN_DIR}/${REMOTE_WRAPPER}`,
  ].join('\n')

  const wrapperResult = await runSshCommand(host, wrapperScript)
  if (wrapperResult.exitCode !== 0) {
    throw new Error(`Failed to install wrapper script: ${wrapperResult.stderr}`)
  }

  onProgress?.('Verifying installation...')
  const verifyResult = await runSshCommand(
    host,
    `${REMOTE_BIN_DIR}/${REMOTE_WRAPPER} --version`,
  )
  if (verifyResult.exitCode !== 0) {
    throw new Error(
      `Binary deployed but verification failed (exit ${verifyResult.exitCode}): ${verifyResult.stderr}`,
    )
  }

  logForDebugging(
    `[SSHDeploy] deployed successfully, remote version: ${verifyResult.stdout}`,
  )
  onProgress?.(`Deployed v${verifyResult.stdout}`)

  return `${REMOTE_BIN_DIR}/${REMOTE_WRAPPER}`
}
