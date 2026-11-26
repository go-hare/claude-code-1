import { type ChildProcess, spawn } from 'child_process'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'

/** Official 2.1.331 `09b_org_helper_limit.js` debug log message. */
export const ORG_HELPER_OUTPUT_LIMIT_LOG =
  'Organization helper wrote more than its output limit'

/** Official 2.1.331 `09b_org_helper_limit.js` thrown Error message. */
export const ORG_HELPER_OUTPUT_LIMIT_ERROR =
  'The helper wrote more than its output limit.'

/** Official 2.1.331 collector helper default `h = 65536` (64 KiB). */
export const ORG_HELPER_DEFAULT_MAX_BUFFER = 65_536

/** Official 2.1.331 collector helper default `p = 30000` (30 s). */
export const ORG_HELPER_DEFAULT_TIMEOUT_MS = 30_000

/** Official 2.1.331 `P = 200` ms exit-to-close stream drain grace period. */
export const ORG_HELPER_EXIT_DRAIN_MS = 200

export class OrganizationHelperOutputLimitError extends Error {
  constructor() {
    super(ORG_HELPER_OUTPUT_LIMIT_ERROR)
    this.name = 'OrganizationHelperOutputLimitError'
  }
}

export type SpawnOrganizationHelperOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  timeout?: number
  killSignal?: NodeJS.Signals | number
  maxBuffer?: number
  exitDrainMs?: number
  windowsVerbatimArguments?: boolean
  windowsHide?: boolean
  /** Optional spawn override for deterministic unit testing. */
  spawnFn?: typeof spawn
}

export type SpawnOrganizationHelperResult = {
  stdout: string
  stderr: string
  code: number | null
}

/**
 * Official 2.1.331 `U(command, args, options)` (`09b_org_helper_limit.js`):
 * Spawns an organization helper executable with `shell: false`, enforces an
 * explicit byte limit (`maxBuffer`) on both `stdout` and `stderr`, kills the
 * process immediately when the limit is exceeded, logs
 * `"Organization helper wrote more than its output limit"`, and rejects with
 * `"The helper wrote more than its output limit."`.
 */
export function spawnOrganizationHelper(
  command: string,
  args: readonly string[],
  options: SpawnOrganizationHelperOptions = {},
): Promise<SpawnOrganizationHelperResult> {
  const maxBuffer = options.maxBuffer ?? ORG_HELPER_DEFAULT_MAX_BUFFER
  const timeoutMs = options.timeout ?? ORG_HELPER_DEFAULT_TIMEOUT_MS
  const killSignal = options.killSignal ?? 'SIGKILL'
  const exitDrainMs = options.exitDrainMs ?? ORG_HELPER_EXIT_DRAIN_MS
  const spawnImpl = options.spawnFn ?? spawn

  return new Promise<SpawnOrganizationHelperResult>((resolve, reject) => {
    let settled = false
    const finishResolve = (result: SpawnOrganizationHelperResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      if (exitDrainTimer !== undefined) clearTimeout(exitDrainTimer)
      resolve(result)
    }
    const finishReject = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      if (exitDrainTimer !== undefined) clearTimeout(exitDrainTimer)
      reject(err)
    }

    let child: ChildProcess
    try {
      child = spawnImpl(command, [...args], {
        shell: false,
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        killSignal,
        windowsVerbatimArguments: options.windowsVerbatimArguments,
        windowsHide: options.windowsHide ?? true,
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      logForDebugging(
        `Organization helper did not start (${getErrnoCode(error) ?? error.name})`,
        { level: 'error' },
      )
      finishReject(error)
      return
    }

    const output: { stdout: string; stderr: string } = {
      stdout: '',
      stderr: '',
    }
    const byteCounts: { stdout: number; stderr: number } = {
      stdout: 0,
      stderr: 0,
    }

    let exitDrainTimer: ReturnType<typeof setTimeout> | undefined
    const timeoutTimer = setTimeout(() => {
      child.kill(killSignal)
    }, timeoutMs)

    child.on('error', err => {
      logForDebugging(
        `Organization helper did not start (${getErrnoCode(err) ?? err.name})`,
        { level: 'error' },
      )
      finishReject(err)
    })

    for (const streamName of ['stdout', 'stderr'] as const) {
      const stream = child[streamName]
      stream?.setEncoding('utf8')
      stream?.on('data', (chunk: string | Buffer) => {
        if (settled) return
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        output[streamName] += text
        byteCounts[streamName] += Buffer.byteLength(text, 'utf8')
        if (byteCounts[streamName] > maxBuffer) {
          child.kill(killSignal)
          child.stdout?.destroy()
          child.stderr?.destroy()
          logForDebugging(ORG_HELPER_OUTPUT_LIMIT_LOG, { level: 'error' })
          finishReject(new OrganizationHelperOutputLimitError())
        }
      })
    }

    child.on('exit', code => {
      clearTimeout(timeoutTimer)
      if (settled) return
      exitDrainTimer = setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        finishResolve({ ...output, code })
      }, exitDrainMs)
    })

    child.on('close', code => {
      finishResolve({ ...output, code })
    })

    child.stdin?.end()
  })
}
