import { type ChildProcess, spawn } from 'child_process'
import { join } from 'path'
import { stat } from 'fs/promises'
import type { Readable } from 'stream'
import treeKill from 'tree-kill'
import { generateTaskId } from '../Task.js'
import { formatDuration } from './format.js'
import {
  MAX_TASK_OUTPUT_BYTES,
  MAX_TASK_OUTPUT_BYTES_DISPLAY,
} from './task/diskOutput.js'
import { TaskOutput } from './task/TaskOutput.js'

/**
 * Absolute System32\taskkill.exe — densable-style, avoids PATH lookup and any
 * shell fallback that can flash a console on abort/timeout/Ctrl+C cleanup.
 */
function win32TaskkillPath(): string {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  return join(root, 'System32', 'taskkill.exe')
}

/**
 * Kill a process tree.
 *
 * Official 2.1.210 densable (killProcessTree): on win32
 * `spawn(System32/taskkill.exe, ["/PID",…,"/T","/F"], {stdio:"ignore", windowsHide:!0})`.
 * Older tree-kill used `exec('taskkill …')` (cmd.exe flash); 210 fixed hide.
 * Unix path keeps stock tree-kill.
 */
function treeKillNoFlash(
  pid: number,
  signal: NodeJS.Signals | number = 'SIGKILL',
  callback?: (error?: Error) => void,
): void {
  if (process.platform === 'win32') {
    // Prefer absolute taskkill.exe + windowsHide. Bare "taskkill" can resolve via
    // PATHEXT/cmd on some shells and flash on every Bash abort / SessionEnd kill.
    const child = spawn(
      win32TaskkillPath(),
      ['/PID', String(pid), '/T', '/F'],
      {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      },
    )
    child.once('error', err => {
      // Fallback: bare name if System32 path missing (unusual).
      const fallback = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      })
      fallback.once('error', fallbackErr => {
        callback?.(fallbackErr)
      })
      fallback.once('exit', () => {
        callback?.()
      })
      void err
    })
    child.once('exit', (code, sig) => {
      // taskkill: 0 = killed; 128 / non-zero often means already gone.
      // Match tree-kill's fire-and-forget spirit — only surface spawn errors.
      if (code === 0 || code === null) {
        callback?.()
        return
      }
      // Process not found / access denied: treat as success for abort paths.
      if (code === 128 || code === 1) {
        callback?.()
        return
      }
      callback?.(
        new Error(
          `taskkill exited with code ${code}${sig ? ` signal ${sig}` : ''}`,
        ),
      )
    })
    return
  }
  treeKill(pid, signal, callback)
}

export type ExecResult = {
  stdout: string
  stderr: string
  code: number
  interrupted: boolean
  backgroundTaskId?: string
  backgroundedByUser?: boolean
  /** Set when assistant-mode auto-backgrounded a long-running blocking command. */
  assistantAutoBackgrounded?: boolean
  /** Set when stdout was too large to fit inline — points to the output file on disk. */
  outputFilePath?: string
  /** Total size of the output file in bytes (set when outputFilePath is set). */
  outputFileSize?: number
  /** The task ID for the output file (set when outputFilePath is set). */
  outputTaskId?: string
  /** Error message when the command failed before spawning (e.g., deleted cwd). */
  preSpawnError?: string
}

/** densable ShellCommand.background options — capMs wall-clock kill + skipSpill */
export type ShellBackgroundOptions = {
  /** densable capMs — arm kill timer after background (agent-scoped shells) */
  capMs?: number
  /** densable skipSpill — skip pipe-mode spillToDisk */
  skipSpill?: boolean
}

export type ShellCommand = {
  background: (
    backgroundTaskId: string,
    options?: ShellBackgroundOptions,
  ) => boolean
  result: Promise<ExecResult>
  kill: () => void
  status: 'running' | 'backgrounded' | 'completed' | 'killed'
  /**
   * Cleans up stream resources (event listeners).
   * Should be called after the command completes or is killed to prevent memory leaks.
   */
  cleanup: () => void
  onTimeout?: (
    callback: (
      backgroundFn: (
        taskId: string,
        options?: ShellBackgroundOptions,
      ) => boolean,
    ) => void,
  ) => void
  /** The TaskOutput instance that owns all stdout/stderr data and progress. */
  taskOutput: TaskOutput
}

const SIGKILL = 137
const SIGTERM = 143

// Background tasks write stdout/stderr directly to a file fd (no JS involvement),
// so a stuck append loop can fill the disk. Poll file size and kill when exceeded.
const SIZE_WATCHDOG_INTERVAL_MS = 5_000

function prependStderr(prefix: string, stderr: string): string {
  return stderr ? `${prefix} ${stderr}` : prefix
}

/**
 * Thin pipe from a child process stream into TaskOutput.
 * Used in pipe mode (hooks) for stdout and stderr.
 * In file mode (bash commands), both fds go to the output file —
 * the child process streams are null and no wrappers are created.
 */
class StreamWrapper {
  #stream: Readable | null
  #isCleanedUp = false
  #taskOutput: TaskOutput | null
  #isStderr: boolean
  #onData = this.#dataHandler.bind(this)

  constructor(stream: Readable, taskOutput: TaskOutput, isStderr: boolean) {
    this.#stream = stream
    this.#taskOutput = taskOutput
    this.#isStderr = isStderr
    // Emit strings instead of Buffers - avoids repeated .toString() calls
    stream.setEncoding('utf-8')
    stream.on('data', this.#onData)
  }

  #dataHandler(data: Buffer | string): void {
    const str = typeof data === 'string' ? data : data.toString()

    if (this.#isStderr) {
      this.#taskOutput!.writeStderr(str)
    } else {
      this.#taskOutput!.writeStdout(str)
    }
  }

  cleanup(): void {
    if (this.#isCleanedUp) {
      return
    }
    this.#isCleanedUp = true
    this.#stream!.removeListener('data', this.#onData)
    // Release references so the stream, its StringDecoder, and
    // the TaskOutput can be GC'd independently of this wrapper.
    this.#stream = null
    this.#taskOutput = null
    this.#onData = () => {}
  }
}

/**
 * Implementation of ShellCommand that wraps a child process.
 *
 * For bash commands: both stdout and stderr go to a file fd via
 * stdio[1] and stdio[2] — no JS involvement. Progress is extracted
 * by polling the file tail.
 * For hooks: pipe mode with StreamWrappers for real-time detection.
 */
class ShellCommandImpl implements ShellCommand {
  #status: 'running' | 'backgrounded' | 'completed' | 'killed' = 'running'
  #backgroundTaskId: string | undefined
  #stdoutWrapper: StreamWrapper | null
  #stderrWrapper: StreamWrapper | null
  #childProcess: ChildProcess
  #timeoutId: NodeJS.Timeout | null = null
  #sizeWatchdog: NodeJS.Timeout | null = null
  /** densable #l — wall-clock cap timer after background({capMs}) */
  #bgCapTimeout: NodeJS.Timeout | null = null
  #killedForSize = false
  #maxOutputBytes: number
  #abortSignal: AbortSignal
  #onTimeoutCallback:
    | ((
        backgroundFn: (
          taskId: string,
          options?: ShellBackgroundOptions,
        ) => boolean,
      ) => void)
    | undefined
  #timeout: number
  #shouldAutoBackground: boolean
  #resultResolver: ((result: ExecResult) => void) | null = null
  #exitCodeResolver: ((code: number) => void) | null = null
  #boundAbortHandler: (() => void) | null = null
  readonly taskOutput: TaskOutput

  static #handleTimeout(self: ShellCommandImpl): void {
    if (self.#shouldAutoBackground && self.#onTimeoutCallback) {
      self.#onTimeoutCallback(self.background.bind(self))
    } else {
      self.#doKill(SIGTERM)
    }
  }

  readonly result: Promise<ExecResult>
  readonly onTimeout?: (
    callback: (
      backgroundFn: (
        taskId: string,
        options?: ShellBackgroundOptions,
      ) => boolean,
    ) => void,
  ) => void

  constructor(
    childProcess: ChildProcess,
    abortSignal: AbortSignal,
    timeout: number,
    taskOutput: TaskOutput,
    shouldAutoBackground = false,
    maxOutputBytes = MAX_TASK_OUTPUT_BYTES,
  ) {
    this.#childProcess = childProcess
    this.#abortSignal = abortSignal
    this.#timeout = timeout
    this.#shouldAutoBackground = shouldAutoBackground
    this.#maxOutputBytes = maxOutputBytes
    this.taskOutput = taskOutput

    // In file mode (bash commands), both stdout and stderr go to the
    // output file fd — childProcess.stdout/.stderr are both null.
    // In pipe mode (hooks), wrap streams to funnel data into TaskOutput.
    this.#stderrWrapper = childProcess.stderr
      ? new StreamWrapper(childProcess.stderr, taskOutput, true)
      : null
    this.#stdoutWrapper = childProcess.stdout
      ? new StreamWrapper(childProcess.stdout, taskOutput, false)
      : null

    if (shouldAutoBackground) {
      this.onTimeout = (callback): void => {
        this.#onTimeoutCallback = callback
      }
    }

    this.result = this.#createResultPromise()
  }

  get status(): 'running' | 'backgrounded' | 'completed' | 'killed' {
    return this.#status
  }

  #abortHandler(): void {
    // On 'interrupt' (user submitted a new message), don't kill — let the
    // caller background the process so the model can see partial output.
    if (this.#abortSignal.reason === 'interrupt') {
      return
    }
    this.kill()
  }

  #exitHandler(code: number | null, signal: NodeJS.Signals | null): void {
    // densable / POSIX shell: SIGTERM → 128+15 = 143 (same as #doKill(SIGTERM)).
    // Do not use 144 (that would be 128+16 / SIGTOP) — external SIGTERM and
    // timeout kill must share the densable 143 code so #handleExit can gate
    // "Command timed out" only when wasKilled && code === SIGTERM.
    const exitCode =
      code !== null && code !== undefined
        ? code
        : signal === 'SIGTERM'
          ? SIGTERM
          : 1
    this.#resolveExitCode(exitCode)
  }

  #errorHandler(): void {
    this.#resolveExitCode(1)
  }

  #resolveExitCode(code: number): void {
    if (this.#exitCodeResolver) {
      this.#exitCodeResolver(code)
      this.#exitCodeResolver = null
    }
  }

  // Note: exit/error listeners are NOT removed here — they're needed for
  // the result promise to resolve. They clean up when the child process exits.
  #cleanupListeners(): void {
    this.#clearSizeWatchdog()
    this.#clearBgCapTimeout()
    const timeoutId = this.#timeoutId
    if (timeoutId) {
      clearTimeout(timeoutId)
      this.#timeoutId = null
    }
    const boundAbortHandler = this.#boundAbortHandler
    if (boundAbortHandler) {
      this.#abortSignal.removeEventListener('abort', boundAbortHandler)
      this.#boundAbortHandler = null
    }
  }

  #clearBgCapTimeout(): void {
    if (this.#bgCapTimeout) {
      clearTimeout(this.#bgCapTimeout)
      this.#bgCapTimeout = null
    }
  }

  #clearSizeWatchdog(): void {
    if (this.#sizeWatchdog) {
      clearInterval(this.#sizeWatchdog)
      this.#sizeWatchdog = null
    }
  }

  #startSizeWatchdog(): void {
    this.#sizeWatchdog = setInterval(() => {
      void stat(this.taskOutput.path).then(
        s => {
          // Bail if the watchdog was cleared while this stat was in flight
          // (process exited on its own) — otherwise we'd mislabel stderr.
          if (
            s.size > this.#maxOutputBytes &&
            this.#status === 'backgrounded' &&
            this.#sizeWatchdog !== null
          ) {
            this.#killedForSize = true
            this.#clearSizeWatchdog()
            this.#doKill(SIGKILL)
          }
        },
        () => {
          // ENOENT before first write, or unlinked mid-run — skip this tick
        },
      )
    }, SIZE_WATCHDOG_INTERVAL_MS)
    this.#sizeWatchdog.unref()
  }

  #createResultPromise(): Promise<ExecResult> {
    this.#boundAbortHandler = this.#abortHandler.bind(this)
    this.#abortSignal.addEventListener('abort', this.#boundAbortHandler, {
      once: true,
    })

    // Use 'exit' not 'close': 'close' waits for stdio to close, which includes
    // grandchild processes that inherit file descriptors (e.g. `sleep 30 &`).
    // 'exit' fires when the shell itself exits, returning control immediately.
    this.#childProcess.once('exit', this.#exitHandler.bind(this))
    this.#childProcess.once('error', this.#errorHandler.bind(this))

    this.#timeoutId = setTimeout(
      ShellCommandImpl.#handleTimeout,
      this.#timeout,
      this,
    ) as NodeJS.Timeout

    const exitPromise = new Promise<number>(resolve => {
      this.#exitCodeResolver = resolve
    })

    return new Promise<ExecResult>(resolve => {
      this.#resultResolver = resolve
      void exitPromise.then(this.#handleExit.bind(this))
    })
  }

  async #handleExit(code: number): Promise<void> {
    this.#cleanupListeners()
    // densable #w: capture killed BEFORE flipping running/backgrounded → completed
    const wasKilled = this.#status === 'killed'
    if (this.#status === 'running' || this.#status === 'backgrounded') {
      this.#status = 'completed'
    }

    const stdout = await this.taskOutput.getStdout()
    const result: ExecResult = {
      code,
      stdout,
      stderr: this.taskOutput.getStderr(),
      // densable: interrupted only when we killed AND exit is SIGKILL (137)
      interrupted: wasKilled && code === SIGKILL,
      backgroundTaskId: this.#backgroundTaskId,
    }

    if (this.taskOutput.stdoutToFile && !this.#backgroundTaskId) {
      if (this.taskOutput.outputFileRedundant || this.#killedForSize) {
        // densable: also delete when size-killed; small file → full content in stdout
        void this.taskOutput.deleteOutputFile()
      } else {
        // Large file — tell the caller where the full output lives
        result.outputFilePath = this.taskOutput.path
        result.outputFileSize = this.taskOutput.outputFileSize
        result.outputTaskId = this.taskOutput.taskId
      }
    }

    // densable stderr prefixes: size kill; OR (killed && code===143) timeout.
    // External SIGTERM (exit 143 without local #doKill) must NOT say "timed out".
    if (this.#killedForSize) {
      result.stderr = prependStderr(
        `Background command killed: output file exceeded ${MAX_TASK_OUTPUT_BYTES_DISPLAY}`,
        result.stderr,
      )
      result.outputFileSize = this.taskOutput.outputFileSize
    } else if (wasKilled && code === SIGTERM) {
      result.stderr = prependStderr(
        `Command timed out after ${formatDuration(this.#timeout)}`,
        result.stderr,
      )
    }

    const resultResolver = this.#resultResolver
    if (resultResolver) {
      this.#resultResolver = null
      resultResolver(result)
    }
  }

  #doKill(code?: number): void {
    this.#status = 'killed'
    if (this.#childProcess.pid) {
      treeKillNoFlash(this.#childProcess.pid, 'SIGKILL')
    }
    this.#resolveExitCode(code ?? SIGKILL)
  }

  kill(): void {
    this.#doKill()
  }

  /**
   * densable ShellCommand.background(e, t) — mid-flight FG→BG transition.
   * Options: capMs arms densable #l kill timer; skipSpill skips pipe spill.
   */
  background(taskId: string, options?: ShellBackgroundOptions): boolean {
    if (this.#status === 'running') {
      this.#backgroundTaskId = taskId
      this.#status = 'backgrounded'
      // Clear FG timeout/abort listeners; keep exit/error for result promise.
      // Note: #cleanupListeners also clears any prior bg cap (none on first bg).
      this.#cleanupListeners()
      if (this.taskOutput.stdoutToFile) {
        // File mode: child writes directly to the fd with no JS involvement.
        // The foreground timeout is gone, so watch file size to prevent
        // a stuck append loop from filling the disk (768GB incident).
        this.#startSizeWatchdog()
      } else if (!options?.skipSpill) {
        // Pipe mode: spill the in-memory buffer so readers can find it on disk.
        // densable: else if (!t?.skipSpill) this.taskOutput.spillToDisk()
        this.taskOutput.spillToDisk()
      }
      // densable: if (t?.capMs) this.#l = setTimeout(kill, capMs).unref()
      if (options?.capMs !== undefined && options.capMs > 0) {
        this.#bgCapTimeout = setTimeout(
          (self: ShellCommandImpl) => {
            self.#bgCapTimeout = null
            // densable #A — kill when wall-clock cap elapses
            if (self.#status === 'backgrounded') {
              self.#doKill(SIGKILL)
            }
          },
          options.capMs,
          this,
        ) as NodeJS.Timeout
        this.#bgCapTimeout.unref?.()
      }
      return true
    }
    return false
  }

  cleanup(): void {
    this.#stdoutWrapper?.cleanup()
    this.#stderrWrapper?.cleanup()
    this.taskOutput.clear()
    // Must run before nulling #abortSignal — #cleanupListeners() calls
    // removeEventListener on it. Without this, a kill()+cleanup() sequence
    // crashes: kill() queues #handleExit as a microtask, cleanup() nulls
    // #abortSignal, then #handleExit runs #cleanupListeners() on the null ref.
    this.#cleanupListeners()
    // Release references to allow GC of ChildProcess internals and AbortController chain
    this.#childProcess = null!
    this.#abortSignal = null!
    this.#onTimeoutCallback = undefined
  }
}

/**
 * Wraps a child process to enable flexible handling of shell command execution.
 */
export function wrapSpawn(
  childProcess: ChildProcess,
  abortSignal: AbortSignal,
  timeout: number,
  taskOutput: TaskOutput,
  shouldAutoBackground = false,
  maxOutputBytes = MAX_TASK_OUTPUT_BYTES,
): ShellCommand {
  return new ShellCommandImpl(
    childProcess,
    abortSignal,
    timeout,
    taskOutput,
    shouldAutoBackground,
    maxOutputBytes,
  )
}

/**
 * Static ShellCommand implementation for commands that were aborted before execution.
 */
class AbortedShellCommand implements ShellCommand {
  readonly status = 'killed' as const
  readonly result: Promise<ExecResult>
  readonly taskOutput: TaskOutput

  constructor(opts?: {
    backgroundTaskId?: string
    stderr?: string
    code?: number
  }) {
    this.taskOutput = new TaskOutput(generateTaskId('local_bash'), null)
    this.result = Promise.resolve({
      code: opts?.code ?? 145,
      stdout: '',
      stderr: opts?.stderr ?? 'Command aborted before execution',
      interrupted: true,
      backgroundTaskId: opts?.backgroundTaskId,
    })
  }

  background(
    _backgroundTaskId?: string,
    _options?: ShellBackgroundOptions,
  ): boolean {
    return false
  }

  kill(): void {}

  cleanup(): void {}
}

export function createAbortedCommand(
  backgroundTaskId?: string,
  opts?: { stderr?: string; code?: number },
): ShellCommand {
  return new AbortedShellCommand({
    backgroundTaskId,
    ...opts,
  })
}

export function createFailedCommand(preSpawnError: string): ShellCommand {
  const taskOutput = new TaskOutput(generateTaskId('local_bash'), null)
  return {
    status: 'completed' as const,
    result: Promise.resolve({
      code: 1,
      stdout: '',
      stderr: preSpawnError,
      interrupted: false,
      preSpawnError,
    }),
    taskOutput,
    background(
      _backgroundTaskId?: string,
      _options?: ShellBackgroundOptions,
    ): boolean {
      return false
    },
    kill(): void {},
    cleanup(): void {},
  }
}

/**
 * Official k$a portable — adopt a detached background shell by pid (+ optional
 * procStart / startTimeTicks identity). Polls liveness; on death resolves with
 * exit code -1 and appends a note. kill() identity-gates SIGTERM.
 */
const ADOPTED_POLL_MS = 1000

export type AdoptedShellOptions = {
  taskId: string
  pid: number
  /** Optional identity tokens (official procStart / startTimeTicks). */
  procStart?: string
  startTimeTicks?: number
  /** Poll interval ms (default 1000). */
  pollMs?: number
}

class AdoptedShellCommand implements ShellCommand {
  #pid: number
  #procStart: string | undefined
  #startTimeTicks: number | undefined
  #status: 'running' | 'backgrounded' | 'completed' | 'killed' = 'backgrounded'
  #poll: ReturnType<typeof setInterval> | null = null
  #resolve!: (r: ExecResult) => void
  readonly result: Promise<ExecResult>
  readonly taskOutput: TaskOutput

  constructor(opts: AdoptedShellOptions) {
    this.#pid = opts.pid
    this.#procStart = opts.procStart
    this.#startTimeTicks = opts.startTimeTicks
    this.taskOutput = new TaskOutput(opts.taskId, null, true)
    this.result = new Promise(resolve => {
      this.#resolve = resolve
    })
    const pollMs = opts.pollMs ?? ADOPTED_POLL_MS
    this.#poll = setInterval(() => {
      void this.#tick()
    }, pollMs)
    this.#poll.unref?.()
  }

  async #tick(): Promise<void> {
    if (this.#status !== 'backgrounded') return
    let alive = true
    try {
      process.kill(this.#pid, 0)
      if (this.#procStart !== undefined) {
        const { processLstartMatches } = await import(
          './genericProcessUtils.js'
        )
        if (!(await processLstartMatches(this.#pid, this.#procStart))) {
          alive = false
        }
      } else if (this.#startTimeTicks !== undefined) {
        void this.#startTimeTicks
      }
    } catch {
      alive = false
    }
    if (!alive) await this.#finish(false)
  }

  async #finish(killed: boolean): Promise<void> {
    if (this.#status !== 'backgrounded') return
    if (this.#poll) {
      clearInterval(this.#poll)
      this.#poll = null
    }
    this.#status = killed ? 'killed' : 'completed'
    const hasIdentity =
      this.#procStart !== undefined || this.#startTimeTicks !== undefined
    const note = killed
      ? hasIdentity
        ? '[SIGTERM requested for detached process tree (sent if identity still matched) — adopted handle released]'
        : '[detached process still running — adopted handle released]'
      : '[process exited while detached; exit code unknown]'
    try {
      const { appendFile } = await import('fs/promises')
      await appendFile(this.taskOutput.path, `\n${note}\n`).catch(() => {})
    } catch {
      // ignore
    }
    let stdout = ''
    try {
      stdout = await this.taskOutput.getStdout()
    } catch {
      stdout = ''
    }
    this.#resolve({
      code: -1,
      stdout,
      stderr: '',
      interrupted: killed,
      backgroundTaskId: this.taskOutput.taskId,
    })
  }

  get status(): 'running' | 'backgrounded' | 'completed' | 'killed' {
    return this.#status
  }

  background(
    _backgroundTaskId: string,
    _options?: ShellBackgroundOptions,
  ): boolean {
    return true
  }

  getPid(): number | undefined {
    return this.#pid > 0 ? this.#pid : undefined
  }

  detach(): number | undefined {
    return this.#pid > 0 ? this.#pid : undefined
  }

  kill(): void {
    if (this.#status !== 'backgrounded') return
    void (async () => {
      try {
        const { killPidIfIdentityMatches } = await import(
          './genericProcessUtils.js'
        )
        await killPidIfIdentityMatches(this.#pid, {
          procStart: this.#procStart,
          startTimeTicks: this.#startTimeTicks,
        })
      } catch {
        // Import/ps failure: do not SIGTERM ungated (recycled-pid risk).
      }
      await this.#finish(true)
    })()
  }

  cleanup(): void {
    if (this.#poll) {
      clearInterval(this.#poll)
      this.#poll = null
    }
    this.taskOutput.clear()
  }
}

/** Official k$a factory — adopted detached shell for claim rehydrate. */
export function createAdoptedShellCommand(
  opts: AdoptedShellOptions,
): ShellCommand {
  return new AdoptedShellCommand(opts)
}
