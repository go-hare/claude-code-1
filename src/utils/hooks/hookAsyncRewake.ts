import { basename } from 'path'
import type {
  AsyncHookJSONOutput,
  HookEvent,
} from 'src/entrypoints/agentSdkTypes.js'
import { isSyncHookJSONOutput } from '../../types/hooks.js'
import { logForDebugging } from '../debug.js'
import { pathExists } from '../file.js'
import { enqueuePendingNotification } from '../messageQueueManager.js'
import { wrapInSystemReminder } from '../messages.js'
import { ALLOWED_OFFICIAL_MARKETPLACE_NAMES } from '../plugins/schemas.js'
import type { ShellCommand } from '../ShellCommand.js'
import { jsonParse } from '../slowOperations.js'
import { registerPendingAsyncHook } from './AsyncHookRegistry.js'
import { emitHookResponse } from './hookEvents.js'

/** densable Aqo @189460720 */
const ASYNC_REWAKE_SUMMARY_CAP = 300
const BROKEN_ASYNC_REWAKE_DEDUP_CAP = 64
const brokenAsyncRewakeOutputs = new Map<string, string>()

export function resetBrokenAsyncRewakeForTests(): void {
  brokenAsyncRewakeOutputs.clear()
}

/** densable `_ce` @189501200 — official marketplace / builtin plugin provenance. */
export function isOfficialHookPluginId(pluginId: string | undefined): boolean {
  if (!pluginId) return false
  const atIndex = pluginId.lastIndexOf('@')
  if (atIndex <= 0) return false
  const marketplace = pluginId.slice(atIndex + 1)
  return (
    ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(marketplace) ||
    marketplace === 'builtin'
  )
}

function normalizeScriptLookupPath(raw: string): string {
  const normalized = raw.replace(/[\\/]+/g, '/')
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

export function extractCommandScriptPaths(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let active = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      active = true
    } else if (ch === '\\' && i + 1 < command.length) {
      current += command[++i]!
      active = true
    } else if (/\s/.test(ch)) {
      if (active) {
        tokens.push(current)
        current = ''
        active = false
      }
    } else {
      current += ch
      active = true
    }
  }
  if (active) tokens.push(current)
  return tokens.filter(
    (token, idx) =>
      idx > 0 &&
      !token.startsWith('-') &&
      (token.includes('/') ||
        token.includes('\\') ||
        /\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|pl|rb|ps1)$/i.test(token)),
  )
}

const MISSING_SCRIPT_LINE_RE =
  /^(?:(?:[A-Za-z]:\\[^:]*|[^\s:]+): )?(?:\d+: )?(?:[Cc]an't|cannot) open (?:file |perl script )?(?:(['"])(.+?)\1[:( ]|([^'"]+?): )|(?:No such file or directory):\s*([^\r\n]+)|([^\s:'"]+):\s*No such file or directory/i

/** densable `Amt` @187847941 — detect missing script on asyncRewake exit 2. */
async function detectMissingAsyncRewakeScript(opts: {
  stdout: string
  stderr: string
  scriptPaths: readonly string[]
}): Promise<{ scriptPath: string; output: string } | undefined> {
  if (
    opts.scriptPaths.length === 0 ||
    (opts.stdout.trim() !== '' && opts.stderr.trim() !== '')
  ) {
    return undefined
  }
  const output = opts.stderr.trim() !== '' ? opts.stderr : opts.stdout
  const lines = output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return undefined
  const known = new Map<string, string>()
  for (const scriptPath of opts.scriptPaths) {
    known.set(normalizeScriptLookupPath(scriptPath), scriptPath)
  }
  const matched = new Set<string>()
  for (const line of lines) {
    const execMatch = MISSING_SCRIPT_LINE_RE.exec(line)
    const candidate =
      execMatch?.[2] ?? execMatch?.[3] ?? execMatch?.[4] ?? execMatch?.[5]
    const found =
      candidate === undefined
        ? undefined
        : known.get(normalizeScriptLookupPath(candidate.trim()))
    if (found === undefined) return undefined
    matched.add(found)
  }
  for (const scriptPath of matched) {
    if (await pathExists(scriptPath)) return undefined
  }
  const [first] = matched
  return first === undefined ? undefined : { scriptPath: first, output }
}

/** densable `Imt` @187848551 — suppress duplicate broken-script wakeups. */
function isDuplicateBrokenAsyncRewake(
  key: string,
  output: string | undefined,
): boolean {
  if (output === undefined) {
    brokenAsyncRewakeOutputs.delete(key)
    return false
  }
  if (brokenAsyncRewakeOutputs.get(key) === output) {
    return true
  }
  brokenAsyncRewakeOutputs.delete(key)
  brokenAsyncRewakeOutputs.set(key, output)
  if (brokenAsyncRewakeOutputs.size > BROKEN_ASYNC_REWAKE_DEDUP_CAP) {
    const [oldest] = brokenAsyncRewakeOutputs.keys()
    if (oldest !== undefined) brokenAsyncRewakeOutputs.delete(oldest)
  }
  return false
}

export function executeInBackground({
  processId,
  hookId,
  shellCommand,
  asyncResponse,
  hookEvent,
  hookName,
  command,
  asyncRewake,
  rewakeMessage,
  rewakeSummary,
  scriptPaths,
  pluginId,
}: {
  processId: string
  hookId: string
  shellCommand: ShellCommand
  asyncResponse: AsyncHookJSONOutput
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion'
  hookName: string
  command: string
  asyncRewake?: boolean
  rewakeMessage?: string
  rewakeSummary?: string
  scriptPaths?: readonly string[]
  pluginId?: string
}): boolean {
  if (asyncRewake) {
    // asyncRewake hooks bypass the registry entirely. On completion, if exit
    // code 2 (blocking error), enqueue as a task-notification so it wakes the
    // model via useQueueProcessor (idle) or gets injected mid-query via
    // queued_command attachments (busy).
    void shellCommand.result.then(async result => {
      await new Promise(resolve => setImmediate(resolve))
      const stdout = await shellCommand.taskOutput.getStdout()
      const stderr = shellCommand.taskOutput.getStderr()
      shellCommand.cleanup()
      emitHookResponse({
        hookId,
        hookName,
        hookEvent,
        output: stdout + stderr,
        stdout,
        stderr,
        exitCode: result.code,
        outcome: result.code === 0 ? 'success' : 'error',
      })
      let jsonRewakeSummary: string | undefined
      if (pluginId) {
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('{')) continue
          try {
            const parsed = jsonParse(trimmed) as Record<string, unknown>
            if (parsed && typeof parsed === 'object' && 'async' in parsed) {
              continue
            }
            if (isSyncHookJSONOutput(parsed)) {
              const rawSummary = (parsed as { rewakeSummary?: unknown })
                .rewakeSummary
              if (
                typeof rawSummary === 'string' &&
                rawSummary.trim() !== '' &&
                isOfficialHookPluginId(pluginId)
              ) {
                jsonRewakeSummary = rawSummary
                  .trim()
                  .replace(/\s+/g, ' ')
                  .slice(0, ASYNC_REWAKE_SUMMARY_CAP)
              }
            }
            break
          } catch {
            // ignore non-JSON lines
          }
        }
      }
      const missingScript =
        result.code === 2
          ? await detectMissingAsyncRewakeScript({
              stdout,
              stderr,
              scriptPaths: scriptPaths ?? extractCommandScriptPaths(command),
            })
          : undefined
      if (
        isDuplicateBrokenAsyncRewake(
          `${hookName}\n${command}`,
          missingScript?.output,
        )
      ) {
        logForDebugging(
          `Hooks: asyncRewake hook "${hookName}" (${command}) exited 2 again because ${missingScript?.scriptPath} cannot be opened; already reported, not waking the model`,
          { level: 'warn' },
        )
        return
      }
      if (result.code === 2) {
        let prefix: string
        let summary: string
        let output: string
        if (missingScript !== undefined) {
          prefix = `${hookName} hook could not run: ${missingScript.scriptPath} cannot be opened, so its command exited with code 2 without doing any work. This is a broken hook installation, not feedback on your work; it is reported this once and identical repeats are dropped. Interpreter output:`
          summary = `${hookEvent} hook could not open ${basename(missingScript.scriptPath)}`
          output = missingScript.output
        } else {
          prefix =
            rewakeMessage ??
            `Stop hook blocking error from command "${hookName}":`
          summary = jsonRewakeSummary ?? rewakeSummary ?? 'Stop hook feedback'
          output = stderr || stdout
        }
        const escapedSummary = summary
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        enqueuePendingNotification(
          {
            value: `<task-notification>\n<summary>${escapedSummary}</summary>\n</task-notification>\n${wrapInSystemReminder(`${prefix} ${output}`)}`,
            mode: 'task-notification',
            priority: 'next',
            stopHookActive: true,
            skipAttachments: true,
          },
          { turnAttribution: 'inherit' },
        )
      }
    })
    return true
  }

  // TaskOutput on the ShellCommand accumulates data — no stream listeners needed
  if (!shellCommand.background(processId)) {
    return false
  }

  registerPendingAsyncHook({
    processId,
    hookId,
    asyncResponse,
    hookEvent,
    hookName,
    command,
    shellCommand,
    pluginId,
  })

  return true
}
