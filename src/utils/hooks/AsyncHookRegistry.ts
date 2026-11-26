import type {
  AsyncHookJSONOutput,
  HookEvent,
  SyncHookJSONOutput,
} from 'src/entrypoints/agentSdkTypes.js'
import {
  hookJSONOutputSchema,
  isSyncHookJSONOutput,
} from '../../types/hooks.js'
import { logForDebugging } from '../debug.js'
import type { ShellCommand } from '../ShellCommand.js'
import { invalidateSessionEnvCache } from '../sessionEnvironment.js'
import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from '../sessionHost.js'
import type { Session } from '../sessionRoot.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { emitHookResponse, startHookProgressInterval } from './hookEvents.js'

export type PendingAsyncHook = {
  processId: string
  hookId: string
  hookName: string
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion'
  toolName?: string
  pluginId?: string
  startTime: number
  timeout: number
  command: string
  responseAttachmentSent: boolean
  shellCommand?: ShellCommand
  stopProgressInterval: () => void
  capturedSession?: Session
}

class HostAsyncHookRegistry {
  pendingHooks = new Map<string, PendingAsyncHook>()
}

const hostAsyncHookRegistrySlot = new HostSlot<HostAsyncHookRegistry>(
  () => new HostAsyncHookRegistry(),
)
const liveAsyncHookRegistries = new Set<WeakRef<HostAsyncHookRegistry>>()
let exitHandlerRegistered = false

function collectLiveRegistries(): HostAsyncHookRegistry[] {
  const live: HostAsyncHookRegistry[] = []
  for (const ref of liveAsyncHookRegistries) {
    const reg = ref.deref()
    if (reg === undefined) {
      liveAsyncHookRegistries.delete(ref)
    } else {
      live.push(reg)
    }
  }
  return live
}

function ensureProcessExitCleanupRegistered(): void {
  if (exitHandlerRegistered) return
  exitHandlerRegistered = true
  if (typeof process !== 'undefined' && typeof process.once === 'function') {
    process.once('exit', () => {
      for (const reg of collectLiveRegistries()) {
        for (const hook of reg.pendingHooks.values()) {
          hook.stopProgressInterval()
          if (
            hook.shellCommand &&
            hook.shellCommand.status !== 'killed' &&
            hook.shellCommand.status !== 'completed' &&
            typeof hook.shellCommand.kill === 'function'
          ) {
            hook.shellCommand.kill()
          }
        }
        reg.pendingHooks.clear()
      }
    })
  }
}

function trackLiveRegistry(registry: HostAsyncHookRegistry): void {
  let found = false
  for (const ref of liveAsyncHookRegistries) {
    const deref = ref.deref()
    if (deref === undefined) {
      liveAsyncHookRegistries.delete(ref)
    } else if (deref === registry) {
      found = true
    }
  }
  if (!found) {
    liveAsyncHookRegistries.add(new WeakRef(registry))
  }
  ensureProcessExitCleanupRegistered()
}

function getHostAsyncHookRegistry(): HostAsyncHookRegistry {
  return hostAsyncHookRegistrySlot.of(getBootstrapSessionHost())
}

export function registerPendingAsyncHook({
  processId,
  hookId,
  asyncResponse,
  hookName,
  hookEvent,
  command,
  shellCommand,
  toolName,
  pluginId,
}: {
  processId: string
  hookId: string
  asyncResponse: AsyncHookJSONOutput
  hookName: string
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion'
  command: string
  shellCommand: ShellCommand
  toolName?: string
  pluginId?: string
}): void {
  const registry = getHostAsyncHookRegistry()
  trackLiveRegistry(registry)
  const capturedSession = getActiveSessionFromAls()
  const runInCapturedSession = <T>(fn: () => T): T =>
    capturedSession ? runWithSession(capturedSession, fn) : fn()

  const timeout = asyncResponse.asyncTimeout || 15000 // Default 15s
  logForDebugging(
    `Hooks: Registering async hook ${processId} (${hookName}) with timeout ${timeout}ms`,
  )
  const stopProgressInterval = runInCapturedSession(() =>
    startHookProgressInterval({
      hookId,
      hookName,
      hookEvent,
      getOutput: async () =>
        runInCapturedSession(async () => {
          const taskOutput =
            registry.pendingHooks.get(processId)?.shellCommand?.taskOutput
          if (!taskOutput) {
            return { stdout: '', stderr: '', output: '' }
          }
          const stdout = await taskOutput.getStdout()
          const stderr = taskOutput.getStderr()
          return { stdout, stderr, output: stdout + stderr }
        }),
    }),
  )
  registry.pendingHooks.set(processId, {
    processId,
    hookId,
    hookName,
    hookEvent,
    toolName,
    pluginId,
    command,
    startTime: Date.now(),
    timeout: timeout as number,
    responseAttachmentSent: false,
    shellCommand,
    stopProgressInterval,
    capturedSession,
  })
}

export function getPendingAsyncHooks(): PendingAsyncHook[] {
  const { pendingHooks } = getHostAsyncHookRegistry()
  return Array.from(pendingHooks.values()).filter(
    hook => !hook.responseAttachmentSent,
  )
}

async function finalizeHook(
  hook: PendingAsyncHook,
  exitCode: number,
  outcome: 'success' | 'error' | 'cancelled',
): Promise<void> {
  hook.stopProgressInterval()
  const taskOutput = hook.shellCommand?.taskOutput
  const stdout = taskOutput ? await taskOutput.getStdout() : ''
  const stderr = taskOutput?.getStderr() ?? ''
  hook.shellCommand?.cleanup()
  const emit = () =>
    emitHookResponse({
      hookId: hook.hookId,
      hookName: hook.hookName,
      hookEvent: hook.hookEvent,
      output: stdout + stderr,
      stdout,
      stderr,
      exitCode,
      outcome,
    })
  if (hook.capturedSession) {
    runWithSession(hook.capturedSession, emit)
  } else {
    emit()
  }
}

// densable pmt: validate the full response first; on malformed responses retain
// recognized fields so a bad additionalContext cannot hide a systemMessage.
function parseAsyncHookResponse(
  value: unknown,
  hookName: string,
): SyncHookJSONOutput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {}
  const parsed = hookJSONOutputSchema().safeParse(value)
  if (parsed.success && isSyncHookJSONOutput(parsed.data)) return parsed.data
  const input = value as Record<string, unknown>
  const response: SyncHookJSONOutput & {
    metrics?: Record<string, boolean | number>
  } = {}
  if (typeof input.systemMessage === 'string')
    response.systemMessage = input.systemMessage
  if (
    typeof input.metrics === 'object' &&
    input.metrics !== null &&
    !Array.isArray(input.metrics)
  ) {
    response.metrics = Object.fromEntries(
      Object.entries(input.metrics).filter(
        ([, metric]) =>
          typeof metric === 'boolean' || typeof metric === 'number',
      ),
    )
  }
  if (
    typeof input.hookSpecificOutput === 'object' &&
    input.hookSpecificOutput !== null &&
    !Array.isArray(input.hookSpecificOutput)
  ) {
    const { additionalContext, ...rest } = input.hookSpecificOutput as Record<
      string,
      unknown
    >
    // The upstream fallback deliberately preserves event-specific fields as-is.
    response.hookSpecificOutput = (
      typeof additionalContext === 'string' ? input.hookSpecificOutput : rest
    ) as SyncHookJSONOutput['hookSpecificOutput']
  }
  logForDebugging(
    `Hooks: ${hookName} async hook JSON output failed schema validation; delivering recognized fields`,
    { level: 'error' },
  )
  return response
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  if (!text.startsWith('{')) return undefined
  try {
    const parsed: unknown = jsonParse(text)
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * #420 SEA `Can`: Extract a sync JSON response from async hook stdout,
 * supporting both single-line JSON and multiline pretty-printed JSON
 * (including after an initial `{"async": true}` line).
 */
export function extractAsyncHookSyncResponse(
  stdout: string,
): Record<string, unknown> | undefined {
  const lines = stdout.trim().split('\n')
  const [firstLine = ''] = lines
  const firstParsed = parseJsonObject(firstLine.trim())
  const candidates = [
    (firstParsed !== undefined && 'async' in firstParsed
      ? lines.slice(1)
      : lines
    )
      .join('\n')
      .trim(),
    ...lines.map(line => line.trim()),
  ]
  for (const candidate of candidates) {
    const parsed = parseJsonObject(candidate)
    if (parsed !== undefined && !('async' in parsed)) {
      return parsed
    }
  }
  return undefined
}

/**
 * #420 SEA `Ran`: True if stdout has a non-async line starting with `{`
 * when the full stdout was not an `async` object.
 */
export function hasUnparsedAsyncHookJsonLine(stdout: string): boolean {
  const isAsyncObj = (text: string): boolean => {
    const obj = parseJsonObject(text)
    return obj !== undefined && 'async' in obj
  }
  return (
    !isAsyncObj(stdout.trim()) &&
    stdout.split('\n').some(line => {
      const trimmed = line.trim()
      return trimmed.startsWith('{') && !isAsyncObj(trimmed)
    })
  )
}

export async function checkForAsyncHookResponses(): Promise<
  Array<{
    processId: string
    response: SyncHookJSONOutput
    hookName: string
    hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion'
    toolName?: string
    pluginId?: string
    stdout: string
    stderr: string
    exitCode?: number
  }>
> {
  const responses: {
    processId: string
    response: SyncHookJSONOutput
    hookName: string
    hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion'
    toolName?: string
    pluginId?: string
    stdout: string
    stderr: string
    exitCode?: number
  }[] = []

  const { pendingHooks } = getHostAsyncHookRegistry()
  const pendingCount = pendingHooks.size
  logForDebugging(`Hooks: Found ${pendingCount} total hooks in registry`)

  // Snapshot hooks before processing — we'll mutate the map after.
  const hooks = Array.from(pendingHooks.values())

  const settled = await Promise.allSettled(
    hooks.map(async hook => {
      logForDebugging(
        `Hooks: Checking hook ${hook.processId} (${hook.hookName}) - attachmentSent: ${hook.responseAttachmentSent}`,
      )

      if (!hook.shellCommand) {
        logForDebugging(
          `Hooks: Hook ${hook.processId} has no shell command, removing from registry`,
        )
        hook.stopProgressInterval()
        return { type: 'remove' as const, processId: hook.processId }
      }

      logForDebugging(`Hooks: Hook shell status ${hook.shellCommand.status}`)

      if (hook.shellCommand.status === 'killed') {
        logForDebugging(
          `Hooks: Hook ${hook.processId} is ${hook.shellCommand.status}, removing from registry`,
        )
        hook.stopProgressInterval()
        hook.shellCommand.cleanup()
        return { type: 'remove' as const, processId: hook.processId }
      }

      if (hook.shellCommand.status !== 'completed') {
        return { type: 'skip' as const }
      }

      if (hook.responseAttachmentSent) {
        logForDebugging(
          `Hooks: Skipping hook ${hook.processId} - already delivered`,
        )
        hook.stopProgressInterval()
        return { type: 'remove' as const, processId: hook.processId }
      }

      const stdout = await hook.shellCommand.taskOutput.getStdout()
      const stderr = hook.shellCommand.taskOutput.getStderr()
      const lines = stdout.split('\n')
      logForDebugging(
        `Hooks: Processing ${lines.length} lines of stdout for ${hook.processId}`,
      )

      const execResult = await hook.shellCommand.result
      const exitCode = execResult.code

      let response: SyncHookJSONOutput = {}
      const parsed = extractAsyncHookSyncResponse(stdout)
      if (parsed !== undefined) {
        logForDebugging(
          `Hooks: Found sync response from ${hook.processId}: ${jsonStringify(parsed)}`,
        )
        response = parseAsyncHookResponse(parsed, hook.hookName)
      } else if (hasUnparsedAsyncHookJsonLine(stdout)) {
        logForDebugging(
          `Hooks: async hook ${hook.processId} (${hook.hookName}) printed a stdout line that begins with { but no JSON answer could be read. After any {"async":true} line, print one JSON object and nothing else, or put the object on one line.`,
          { level: 'error' },
        )
      }

      hook.responseAttachmentSent = true
      await finalizeHook(hook, exitCode, exitCode === 0 ? 'success' : 'error')
      if (
        Object.keys(response).length === 0 &&
        exitCode === 0 &&
        !stderr.trim()
      ) {
        return {
          type: 'remove' as const,
          processId: hook.processId,
          isSessionStart: hook.hookEvent === 'SessionStart',
        }
      }

      return {
        type: 'response' as const,
        processId: hook.processId,
        isSessionStart: hook.hookEvent === 'SessionStart',
        payload: {
          processId: hook.processId,
          response,
          hookName: hook.hookName,
          hookEvent: hook.hookEvent,
          toolName: hook.toolName,
          pluginId: hook.pluginId,
          stdout,
          stderr,
          exitCode,
        },
      }
    }),
  )

  // allSettled — isolate failures so one throwing callback doesn't orphan
  // already-applied side effects (responseAttachmentSent, finalizeHook) from others.
  let sessionStartCompleted = false
  for (const s of settled) {
    if (s.status !== 'fulfilled') {
      logForDebugging(
        `Hooks: checkForAsyncHookResponses callback rejected: ${s.reason}`,
        { level: 'error' },
      )
      continue
    }
    const r = s.value
    if (r.type === 'remove') {
      pendingHooks.delete(r.processId)
      if ('isSessionStart' in r && r.isSessionStart)
        sessionStartCompleted = true
    } else if (r.type === 'response') {
      responses.push(r.payload)
      pendingHooks.delete(r.processId)
      if (r.isSessionStart) sessionStartCompleted = true
    }
  }

  if (sessionStartCompleted) {
    logForDebugging(
      `Invalidating session env cache after SessionStart hook completed`,
    )
    invalidateSessionEnvCache()
  }

  logForDebugging(
    `Hooks: checkForNewResponses returning ${responses.length} responses`,
  )
  return responses
}

export function removeDeliveredAsyncHooks(processIds: string[]): void {
  const { pendingHooks } = getHostAsyncHookRegistry()
  for (const processId of processIds) {
    const hook = pendingHooks.get(processId)
    if (hook && hook.responseAttachmentSent) {
      logForDebugging(`Hooks: Removing delivered hook ${processId}`)
      hook.stopProgressInterval()
      pendingHooks.delete(processId)
    }
  }
}

export async function finalizePendingAsyncHooks(): Promise<void> {
  const { pendingHooks } = getHostAsyncHookRegistry()
  const hooks = Array.from(pendingHooks.values())
  await Promise.all(
    hooks.map(async hook => {
      if (hook.shellCommand?.status === 'completed') {
        const result = await hook.shellCommand.result
        await finalizeHook(
          hook,
          result.code,
          result.code === 0 ? 'success' : 'error',
        )
      } else {
        if (hook.shellCommand && hook.shellCommand.status !== 'killed') {
          hook.shellCommand.kill()
        }
        await finalizeHook(hook, 1, 'cancelled')
      }
    }),
  )
  pendingHooks.clear()
}

// Test utility function to clear all hooks
export function clearAllAsyncHooks(): void {
  const { pendingHooks } = getHostAsyncHookRegistry()
  for (const hook of pendingHooks.values()) {
    hook.stopProgressInterval()
  }
  pendingHooks.clear()
}
