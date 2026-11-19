import { type ChildProcess, spawn } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, readFileSync, type WriteStream } from 'fs'
import { stat } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, isAbsolute, join } from 'path'
import { createInterface } from 'readline'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { resolveChildLogsDirSync } from './childLogsDir.js'
import { debugTruncate } from './debugUtils.js'
import { buildSessionChildEnv } from './sessionChildEnv.js'
import type {
  SessionActivity,
  SessionDoneStatus,
  SessionHandle,
  SessionSpawner,
  SessionSpawnOpts,
} from './types.js'

const MAX_ACTIVITIES = 10
const MAX_STDERR_LINES = 10

/**
 * Sanitize a session ID for use in file names.
 * Strips any characters that could cause path traversal (e.g. `../`, `/`)
 * or other filesystem issues, replacing them with underscores.
 */
export function safeFilenameId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * A control_request emitted by the child CLI when it needs permission to
 * execute a **specific** tool invocation (not a general capability check).
 * The bridge forwards this to the server so the user can approve/deny.
 */
export type PermissionRequest = {
  type: 'control_request'
  request_id: string
  request: {
    /** Per-invocation permission check — "may I run this tool with these inputs?" */
    subtype: 'can_use_tool'
    tool_name: string
    input: Record<string, unknown>
    tool_use_id: string
  }
}

export const BRIDGE_SETTINGS_BINDING_ENV = 'CLAUDE_CODE_BRIDGE_SETTINGS_BINDING'

/**
 * #1846 / official `KFo(resolvedPath, content)` — compute the SHA-256 binding
 * string `${sha256Hex}:${resolvedPath}` for `claude remote-control --settings`.
 */
export function computeBridgeSettingsBinding(
  resolvedPath: string,
  content: string | Buffer,
): string {
  const hash = createHash('sha256').update(content).digest('hex')
  return `${hash}:${resolvedPath}`
}

/**
 * #1846 / official verification @295194845 — verify that a `--settings` file
 * matches `CLAUDE_CODE_BRIDGE_SETTINGS_BINDING` (both format and SHA-256 hash)
 * so no new session starts if the file changed after `claude remote-control`
 * launched.
 */
export function verifyBridgeSettingsBinding(
  settingsArg: string,
  resolvedPath: string,
  content: string | Buffer,
  bindingEnv: string | undefined = process.env[BRIDGE_SETTINGS_BINDING_ENV],
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; error: string } {
  if (bindingEnv === undefined) return { ok: true }
  const colonIdx = bindingEnv.indexOf(':')
  const boundPath = colonIdx >= 0 ? bindingEnv.slice(colonIdx + 1) : ''
  const jobShort = basename(env.CLAUDE_JOB_DIR ?? '')
  const restartHint =
    env.CLAUDE_CODE_SESSION_KIND === 'bg' && /^[0-9a-f]{8}$/.test(jobShort)
      ? `Run \`claude respawn ${jobShort}\` in a terminal`
      : 'Restart `claude remote-control`'
  if (!(/^[0-9a-f]{64}:/.test(bindingEnv) && isAbsolute(boundPath))) {
    return {
      ok: false,
      error: `Error: The settings file ${settingsArg} can't be checked, because what Remote Control recorded of it is damaged, so this session did not start. ${restartHint} to use it as it is now.`,
    }
  }
  if (
    (settingsArg === boundPath || resolvedPath === boundPath) &&
    createHash('sha256').update(content).digest('hex') !==
      bindingEnv.slice(0, colonIdx)
  ) {
    return {
      ok: false,
      error: `Error: The settings file ${settingsArg} has changed since Remote Control started, so this session did not start. ${restartHint} to use it as it is now.`,
    }
  }
  return { ok: true }
}

type SessionSpawnerDeps = {
  execPath: string
  /**
   * Arguments that must precede the CLI flags when spawning. Empty for
   * compiled binaries (where execPath is the claude binary itself); contains
   * the script path (process.argv[1]) for npm installs where execPath is the
   * node runtime. Without this, node sees --sdk-url as a node option and
   * exits with "bad option: --sdk-url" (see anthropics/claude-code#28334).
   */
  scriptArgs: string[]
  env: NodeJS.ProcessEnv
  verbose: boolean
  sandbox: boolean
  debugFile?: string
  permissionMode?: string
  chrome?: boolean
  /** #1846: resolved path passed via `claude remote-control --settings <file>`. */
  settingsFile?: string
  /** #1846: `${sha256}:${resolvedPath}` computed at `claude remote-control` startup. */
  settingsBinding?: string
  onDebug: (msg: string) => void
  onActivity?: (sessionId: string, activity: SessionActivity) => void
  onPermissionRequest?: (
    sessionId: string,
    request: PermissionRequest,
    accessToken: string,
  ) => void
}

/** Map tool names to human-readable verbs for the status display. */
const TOOL_VERBS: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Bash: 'Running',
  Glob: 'Searching',
  Grep: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching',
  Task: 'Running task',
  FileReadTool: 'Reading',
  FileWriteTool: 'Writing',
  FileEditTool: 'Editing',
  GlobTool: 'Searching',
  GrepTool: 'Searching',
  BashTool: 'Running',
  NotebookEditTool: 'Editing notebook',
  LSP: 'LSP',
}

/**
 * Official 2.1.323 #2117: guard all tool input fields with `typeof ... === 'string'`
 * so a numeric/boolean/object `command` (or other field) never throws `.slice is not a function`
 * and crashes or stalls the Remote Control host in verbose/debug mode.
 */
export function toolSummary(
  name: string,
  input: Record<string, unknown>,
): string {
  const verb = TOOL_VERBS[name] ?? name
  const firstString = (v: unknown, maxLen?: number): string | undefined =>
    typeof v === 'string' && v.length > 0
      ? maxLen !== undefined
        ? v.slice(0, maxLen)
        : v
      : undefined
  const target =
    firstString(input.file_path) ??
    firstString(input.filePath) ??
    firstString(input.pattern) ??
    firstString(input.command, 60) ??
    firstString(input.url) ??
    firstString(input.query) ??
    ''
  if (target) {
    return `${verb} ${target}`
  }
  return verb
}

function extractActivities(
  line: string,
  sessionId: string,
  onDebug: (msg: string) => void,
): SessionActivity[] {
  let parsed: unknown
  try {
    parsed = jsonParse(line)
  } catch {
    return []
  }

  if (!parsed || typeof parsed !== 'object') {
    return []
  }

  const msg = parsed as Record<string, unknown>
  const activities: SessionActivity[] = []
  const now = Date.now()

  switch (msg.type) {
    case 'assistant': {
      const message = msg.message as Record<string, unknown> | undefined
      if (!message) break
      const content = message.content
      if (!Array.isArray(content)) break

      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>

        if (b.type === 'tool_use') {
          const name = (b.name as string) ?? 'Tool'
          const input = (b.input as Record<string, unknown>) ?? {}
          const summary = toolSummary(name, input)
          activities.push({
            type: 'tool_start',
            summary,
            timestamp: now,
          })
          onDebug(
            `[bridge:activity] sessionId=${sessionId} tool_use name=${name} ${inputPreview(input)}`,
          )
        } else if (b.type === 'text') {
          const text = (b.text as string) ?? ''
          if (text.length > 0) {
            activities.push({
              type: 'text',
              summary: text.slice(0, 80),
              timestamp: now,
            })
            onDebug(
              `[bridge:activity] sessionId=${sessionId} text "${text.slice(0, 100)}"`,
            )
          }
        }
      }
      break
    }
    case 'result': {
      const subtype = msg.subtype as string | undefined
      if (subtype === 'success') {
        activities.push({
          type: 'result',
          summary: 'Session completed',
          timestamp: now,
        })
        onDebug(
          `[bridge:activity] sessionId=${sessionId} result subtype=success`,
        )
      } else if (subtype) {
        const errors = msg.errors as string[] | undefined
        const errorSummary = errors?.[0] ?? `Error: ${subtype}`
        activities.push({
          type: 'error',
          summary: errorSummary,
          timestamp: now,
        })
        onDebug(
          `[bridge:activity] sessionId=${sessionId} result subtype=${subtype} error="${errorSummary}"`,
        )
      } else {
        onDebug(
          `[bridge:activity] sessionId=${sessionId} result subtype=undefined`,
        )
      }
      break
    }
    default:
      break
  }

  return activities
}

/**
 * Extract plain text from a replayed SDKUserMessage NDJSON line. Returns the
 * trimmed text if this looks like a real human-authored message, otherwise
 * undefined so the caller keeps waiting for the first real message.
 */
function extractUserMessageText(
  msg: Record<string, unknown>,
): string | undefined {
  // Skip tool-result user messages (wrapped subagent results) and synthetic
  // caveat messages — neither is human-authored.
  if (msg.parent_tool_use_id != null || msg.isSynthetic || msg.isReplay)
    return undefined

  const message = msg.message as Record<string, unknown> | undefined
  const content = message?.content
  let text: string | undefined
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as Record<string, unknown>).type === 'text'
      ) {
        text = (block as Record<string, unknown>).text as string | undefined
        break
      }
    }
  }
  text = text?.trim()
  return text ? text : undefined
}

/** Build a short preview of tool input for debug logging. */
function inputPreview(input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, val] of Object.entries(input)) {
    if (typeof val === 'string') {
      parts.push(`${key}="${val.slice(0, 100)}"`)
    }
    if (parts.length >= 3) break
  }
  return parts.join(' ')
}

// Official 2.1.323 #2118: single in-flight guard for `stat(dir)` on spawn
// ENOENT so repeated failed spawns on an unresponsive filesystem cannot
// exhaust the libuv threadpool and stall the Remote Control host.
let dirStatInFlight = false
const DIR_STAT_TIMEOUT_MS = 1000

export function createSessionSpawner(deps: SessionSpawnerDeps): SessionSpawner {
  return {
    spawn(opts: SessionSpawnOpts, dir: string): SessionHandle {
      // Debug file resolution:
      // 1. If deps.debugFile is provided, use it with session ID suffix for uniqueness
      // 2. If verbose or ant build, auto-generate a temp file path
      // 3. Otherwise, no debug file
      const safeId = safeFilenameId(opts.sessionId)
      let debugFile: string | undefined
      if (deps.debugFile) {
        const ext = deps.debugFile.lastIndexOf('.')
        if (ext > 0) {
          debugFile = `${deps.debugFile.slice(0, ext)}-${safeId}${deps.debugFile.slice(ext)}`
        } else {
          debugFile = `${deps.debugFile}-${safeId}`
        }
      } else if (deps.verbose || process.env.USER_TYPE === 'ant') {
        // Official 2.1.326 #338: write `--verbose` child session debug logs to
        // `~/.claude/child-logs/` (mode 0700, owner-verified).
        const childLogsDir = resolveChildLogsDirSync(msg =>
          deps.onDebug(`[bridge:session] ${msg}`),
        )
        if (childLogsDir) {
          debugFile = join(childLogsDir, `bridge-session-${safeId}.log`)
        }
      }

      // Transcript file: write raw NDJSON lines for post-hoc analysis.
      // Placed alongside the debug file when one is configured.
      let transcriptStream: WriteStream | null = null
      let transcriptPath: string | undefined
      if (deps.debugFile) {
        transcriptPath = join(
          dirname(deps.debugFile),
          `bridge-transcript-${safeId}.jsonl`,
        )
        transcriptStream = createWriteStream(transcriptPath, { flags: 'a' })
        transcriptStream.on('error', err => {
          deps.onDebug(
            `[bridge:session] Transcript write error: ${err.message}`,
          )
          transcriptStream = null
        })
        deps.onDebug(`[bridge:session] Transcript log: ${transcriptPath}`)
      }

      // #1846: If `claude remote-control --settings <file>` was supplied, verify
      // the file has not changed since remote-control started before spawning.
      if (deps.settingsFile && deps.settingsBinding) {
        let currentContent: Buffer
        try {
          currentContent = readFileSync(deps.settingsFile)
        } catch (err) {
          throw new Error(
            `Error: Settings file not found or unreadable: ${deps.settingsFile} (${err instanceof Error ? err.message : String(err)})`,
          )
        }
        const check = verifyBridgeSettingsBinding(
          deps.settingsFile,
          deps.settingsFile,
          currentContent,
          deps.settingsBinding,
          deps.env,
        )
        if (!check.ok) {
          throw new Error(check.error)
        }
      }

      const args = [
        ...deps.scriptArgs,
        '--print',
        '--sdk-url',
        opts.sdkUrl,
        '--session-id',
        opts.sessionId,
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--replay-user-messages',
        ...(deps.verbose ? ['--verbose'] : []),
        ...(debugFile ? ['--debug-file', debugFile] : []),
        ...(deps.permissionMode
          ? ['--permission-mode', deps.permissionMode]
          : []),
        ...(deps.chrome === undefined
          ? []
          : [deps.chrome ? '--chrome' : '--no-chrome']),
        ...(deps.settingsFile ? ['--settings', deps.settingsFile] : []),
      ]

      // densable 2.1.238 #21 NDl: Vso/MDl/Eot/wot. Do not apply mrn.
      // Tip extras POST_FOR_SESSION_INGRESS_V2 / USE_CCR_V2 overlay after NDl.
      // densable RQt spawn stamps (spawn-only; attach must not set these).
      // Gold sbr: if(a) AUTO_DEFAULT; if(f) ARTIFACT; if(b) MACHINE_SETTINGS.
      const env: NodeJS.ProcessEnv = {
        ...buildSessionChildEnv(deps.env, {
          accessToken: opts.accessToken,
          workerEpoch: opts.workerEpoch,
          sandbox: deps.sandbox,
        }),
        CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2: '1',
        ...(deps.settingsBinding
          ? { [BRIDGE_SETTINGS_BINDING_ENV]: deps.settingsBinding }
          : {}),
        ...(opts.useCcrV2 && {
          CLAUDE_CODE_USE_CCR_V2: '1',
          CLAUDE_CODE_WORKER_EPOCH: String(opts.workerEpoch),
        }),
        ...(opts.autoDefault
          ? { CLAUDE_CODE_BRIDGE_CHILD_AUTO_DEFAULT: '1' }
          : {}),
        ...(opts.artifact ? { CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT: '1' } : {}),
        ...(opts.machineSettings
          ? { CLAUDE_CODE_BRIDGE_CHILD_MACHINE_SETTINGS: '1' }
          : {}),
      }

      deps.onDebug(
        `[bridge:session] Spawning sessionId=${opts.sessionId} sdkUrl=${opts.sdkUrl} accessToken=${opts.accessToken ? 'present' : 'MISSING'}`,
      )
      deps.onDebug(`[bridge:session] Child args: ${args.join(' ')}`)
      if (debugFile) {
        deps.onDebug(`[bridge:session] Debug log: ${debugFile}`)
      }

      // Pipe all three streams: stdin for control, stdout for NDJSON parsing,
      // stderr for error capture and diagnostics.
      const child: ChildProcess = spawn(deps.execPath, args, {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        windowsHide: true,
      })

      deps.onDebug(
        `[bridge:session] sessionId=${opts.sessionId} pid=${child.pid}`,
      )

      const activities: SessionActivity[] = []
      let currentActivity: SessionActivity | null = null
      const lastStderr: string[] = []
      let sigkillSent = false
      let firstUserMessageSeen = false

      // Buffer stderr for error diagnostics
      if (child.stderr) {
        const stderrRl = createInterface({ input: child.stderr })
        stderrRl.on('line', line => {
          // Forward stderr to bridge's stderr in verbose mode
          if (deps.verbose) {
            process.stderr.write(line + '\n')
          }
          // Ring buffer of last N lines
          if (lastStderr.length >= MAX_STDERR_LINES) {
            lastStderr.shift()
          }
          lastStderr.push(line)
        })
      }

      // Parse NDJSON from child stdout
      if (child.stdout) {
        const rl = createInterface({ input: child.stdout })
        rl.on('line', line => {
          // Official 2.1.323 #2117: wrap per-line processing so a malformed
          // tool call or unexpected payload never crashes the host or stops
          // reading subsequent output lines.
          try {
            // Write raw NDJSON to transcript file
            if (transcriptStream) {
              transcriptStream.write(line + '\n')
            }

            // Log all messages flowing from the child CLI to the bridge
            deps.onDebug(
              `[bridge:ws] sessionId=${opts.sessionId} <<< ${debugTruncate(line)}`,
            )

            // In verbose mode, forward raw output to stderr
            if (deps.verbose) {
              process.stderr.write(line + '\n')
            }

            const extracted = extractActivities(
              line,
              opts.sessionId,
              deps.onDebug,
            )
            for (const activity of extracted) {
              // Maintain ring buffer
              if (activities.length >= MAX_ACTIVITIES) {
                activities.shift()
              }
              activities.push(activity)
              currentActivity = activity

              deps.onActivity?.(opts.sessionId, activity)
            }

            // Detect control_request and replayed user messages.
            // extractActivities parses the same line but swallows parse errors
            // and skips 'user' type — re-parse here is cheap (NDJSON lines are
            // small) and keeps each path self-contained.
            {
              let parsed: unknown
              try {
                parsed = jsonParse(line)
              } catch {
                // Non-JSON line, skip detection
              }
              if (parsed && typeof parsed === 'object') {
                const msg = parsed as Record<string, unknown>

                if (msg.type === 'control_request') {
                  const request = msg.request as
                    | Record<string, unknown>
                    | undefined
                  if (
                    request?.subtype === 'can_use_tool' &&
                    deps.onPermissionRequest
                  ) {
                    deps.onPermissionRequest(
                      opts.sessionId,
                      parsed as PermissionRequest,
                      opts.accessToken,
                    )
                  }
                  // interrupt is turn-level; the child handles it internally (print.ts)
                } else if (
                  msg.type === 'user' &&
                  !firstUserMessageSeen &&
                  opts.onFirstUserMessage
                ) {
                  const text = extractUserMessageText(msg)
                  if (text) {
                    firstUserMessageSeen = true
                    opts.onFirstUserMessage(text)
                  }
                }
              }
            }
          } catch (err) {
            deps.onDebug(
              `[bridge:activity] sessionId=${opts.sessionId} failed to process a line of the session's output; moving on to the next line: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        })
      }

      const done = new Promise<SessionDoneStatus>(resolve => {
        let pendingErrorCheck: Promise<void> | undefined

        const resolveAfterPending = (status: SessionDoneStatus): void => {
          if (!pendingErrorCheck) {
            resolve(status)
            return
          }
          // Official 2.1.323 #2115: never let an unresponsive-disk stat hang
          // prevent a finished session from releasing its slot.
          void Promise.race([
            pendingErrorCheck,
            new Promise<void>(r => {
              const t = setTimeout(r, DIR_STAT_TIMEOUT_MS)
              t.unref?.()
            }),
          ]).then(() => resolve(status))
        }

        child.on('close', (code, signal) => {
          // Close transcript stream on exit
          if (transcriptStream) {
            transcriptStream.end()
            transcriptStream = null
          }

          let status: SessionDoneStatus
          if (signal === 'SIGTERM' || signal === 'SIGINT') {
            deps.onDebug(
              `[bridge:session] sessionId=${opts.sessionId} interrupted signal=${signal} pid=${child.pid}`,
            )
            status = 'interrupted'
          } else if (code === 0) {
            deps.onDebug(
              `[bridge:session] sessionId=${opts.sessionId} completed exit_code=0 pid=${child.pid}`,
            )
            status = 'completed'
          } else {
            deps.onDebug(
              `[bridge:session] sessionId=${opts.sessionId} failed exit_code=${code} pid=${child.pid}`,
            )
            status = 'failed'
          }
          resolveAfterPending(status)
        })

        child.on('error', err => {
          deps.onDebug(
            `[bridge:session] sessionId=${opts.sessionId} spawn error: ${err.message}`,
          )
          const errCode = (err as NodeJS.ErrnoException).code
          const isEnoent = errCode === 'ENOENT'
          let checkDir: Promise<boolean | undefined>
          if (isEnoent && !dirStatInFlight) {
            dirStatInFlight = true
            const statPromise = stat(dir)
              .then(
                s => !s.isDirectory(),
                e =>
                  (e as NodeJS.ErrnoException)?.code === 'ENOENT' || undefined,
              )
              .finally(() => {
                dirStatInFlight = false
              })
            checkDir = Promise.race([
              statPromise,
              new Promise<undefined>(r => {
                const t = setTimeout(() => r(undefined), DIR_STAT_TIMEOUT_MS)
                t.unref?.()
              }),
            ])
          } else {
            checkDir = Promise.resolve(undefined)
          }
          pendingErrorCheck = checkDir.then(dirMissing => {
            let msg = `spawn error: ${err.message}`
            if (dirMissing) {
              msg = `working folder not found: '${dir}'`
            } else if (dirMissing === undefined && isEnoent) {
              msg += `; check that the program and the working folder '${dir}' exist`
            }
            lastStderr.push(msg)
          })
          resolveAfterPending('failed')
        })
      })

      const handle: SessionHandle = {
        sessionId: opts.sessionId,
        done,
        activities,
        accessToken: opts.accessToken,
        lastStderr,
        get currentActivity(): SessionActivity | null {
          return currentActivity
        },
        kill(): void {
          if (!child.killed) {
            deps.onDebug(
              `[bridge:session] Sending SIGTERM to sessionId=${opts.sessionId} pid=${child.pid}`,
            )
            // On Windows, child.kill('SIGTERM') throws; use default signal.
            if (process.platform === 'win32') {
              child.kill()
            } else {
              child.kill('SIGTERM')
            }
          }
        },
        forceKill(): void {
          // Use separate flag because child.killed is set when kill() is called,
          // not when the process exits. We need to send SIGKILL even after SIGTERM.
          if (!sigkillSent && child.pid) {
            sigkillSent = true
            deps.onDebug(
              `[bridge:session] Sending SIGKILL to sessionId=${opts.sessionId} pid=${child.pid}`,
            )
            if (process.platform === 'win32') {
              child.kill()
            } else {
              child.kill('SIGKILL')
            }
          }
        },
        writeStdin(data: string): void {
          if (child.stdin && !child.stdin.destroyed) {
            deps.onDebug(
              `[bridge:ws] sessionId=${opts.sessionId} >>> ${debugTruncate(data)}`,
            )
            child.stdin.write(data)
          }
        },
        updateAccessToken(token: string): void {
          handle.accessToken = token
          // Send the fresh token to the child process via stdin. The child's
          // StructuredIO handles update_environment_variables messages by
          // setting process.env directly, so getSessionIngressAuthToken()
          // picks up the new token on the next refreshHeaders call.
          handle.writeStdin(
            jsonStringify({
              type: 'update_environment_variables',
              variables: { CLAUDE_CODE_SESSION_ACCESS_TOKEN: token },
            }) + '\n',
          )
          deps.onDebug(
            `[bridge:session] Sent token refresh via stdin for sessionId=${opts.sessionId}`,
          )
        },
      }

      return handle
    },
  }
}

export { extractActivities as _extractActivitiesForTesting }
