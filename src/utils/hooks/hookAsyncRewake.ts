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
import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from '../sessionHost.js'
import type { ShellCommand } from '../ShellCommand.js'
import { jsonParse } from '../slowOperations.js'
import { registerPendingAsyncHook } from './AsyncHookRegistry.js'
import { emitHookResponse } from './hookEvents.js'

/** densable Aqo @189460720 */
const ASYNC_REWAKE_SUMMARY_CAP = 300
const BROKEN_ASYNC_REWAKE_DEDUP_CAP = 64
const hostBrokenAsyncRewakeSlot = new HostSlot<Map<string, string>>(
  () => new Map(),
)

function brokenAsyncRewakeOutputs(): Map<string, string> {
  return hostBrokenAsyncRewakeSlot.of(getBootstrapSessionHost())
}

export function resetBrokenAsyncRewakeForTests(): void {
  brokenAsyncRewakeOutputs().clear()
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

export type ScriptPathCandidate = {
  path: string
  cutFrom?: string
}

export function extractCommandScriptCandidates(
  command: string,
): ScriptPathCandidate[] {
  const tokens: Array<{ value: string; quoted: boolean }> = []
  let current = ''
  let quote: '"' | "'" | undefined
  let active = false
  let wasQuoted = false
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
      wasQuoted = true
    } else if (ch === '\\' && i + 1 < command.length) {
      current += command[++i]!
      active = true
    } else if (/\s/.test(ch)) {
      if (active) {
        tokens.push({ value: current, quoted: wasQuoted })
        current = ''
        active = false
        wasQuoted = false
      }
    } else {
      current += ch
      active = true
    }
  }
  if (active) tokens.push({ value: current, quoted: wasQuoted })
  const candidates: ScriptPathCandidate[] = []
  for (let idx = 0; idx < tokens.length; idx++) {
    const { value, quoted } = tokens[idx]!
    if (
      idx === 0 ||
      value.startsWith('-') ||
      !(
        value.includes('/') ||
        value.includes('\\') ||
        /\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|pl|rb|ps1)$/i.test(value)
      )
    ) {
      continue
    }
    candidates.push({ path: value, cutFrom: undefined })
    if (!quoted) {
      const splitPrefix = /^[^ \t\n]+(?= )/.exec(value)?.[0]
      if (splitPrefix !== undefined) {
        candidates.push({ path: splitPrefix, cutFrom: value })
      }
    }
  }
  return candidates
}

export function extractCommandScriptPaths(command: string): string[] {
  return extractCommandScriptCandidates(command).map(c => c.path)
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
  const outputs = brokenAsyncRewakeOutputs()
  if (output === undefined) {
    outputs.delete(key)
    return false
  }
  if (outputs.get(key) === output) {
    return true
  }
  outputs.delete(key)
  outputs.set(key, output)
  if (outputs.size > BROKEN_ASYNC_REWAKE_DEDUP_CAP) {
    const [oldest] = outputs.keys()
    if (oldest !== undefined) outputs.delete(oldest)
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
    const captured = getActiveSessionFromAls()
    void shellCommand.result.then(result => {
      const handleResult = async () => {
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
        const scriptCandidates = scriptPaths
          ? scriptPaths.map(p => ({ path: p, cutFrom: undefined }))
          : extractCommandScriptCandidates(command)
        const missingScript =
          result.code === 2
            ? await detectMissingAsyncRewakeScript({
                stdout,
                stderr,
                scriptPaths: scriptCandidates.map(c => c.path),
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
            const cutFrom = scriptCandidates.find(
              c => c.path === missingScript.scriptPath,
            )?.cutFrom
            let splitHint = ''
            summary = `${hookEvent} hook could not open ${basename(missingScript.scriptPath)}`
            if (cutFrom !== undefined) {
              splitHint = ` (the hook's command passes ${cutFrom} without quotes, so the shell split it at the space)`
              summary = `${hookEvent} hook needs quotes around a path with a space (${basename(cutFrom)})`
            }
            prefix = `${hookName} hook could not run: ${missingScript.scriptPath} cannot be opened${splitHint}, so its command exited with code 2 without doing any work. This is a broken hook installation, not feedback on your work; it is reported this once and identical repeats are dropped. Interpreter output:`
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
      }
      if (captured !== undefined && getActiveSessionFromAls() !== captured) {
        return runWithSession(captured, handleResult)
      }
      return handleResult()
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
