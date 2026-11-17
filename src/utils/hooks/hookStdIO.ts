import type {
  HookEvent,
  HookJSONOutput,
} from 'src/entrypoints/agentSdkTypes.js'

export type HookCapture = {
  status: number
  stdout: string
  stderr: string
  aborted?: boolean
  stdioIncomplete?: boolean
  stdioClosedWithoutEnd?: boolean
}

const feedbackEvents = new Set<HookEvent>([
  'Stop',
  'SubagentStop',
  'StopFailure',
  'TaskCompleted',
  'TeammateIdle',
  'PostToolUse',
  'PostToolUseFailure',
])
const contextEvents = new Set<HookEvent>([
  'UserPromptSubmit',
  'UserPromptExpansion',
  'SessionStart',
  'PostModelSwitch',
])
const outputKeys = new Set([
  'continue',
  'suppressOutput',
  'stopReason',
  'decision',
  'systemMessage',
  'terminalSequence',
  'reason',
  'metrics',
  'rewakeSummary',
  'hookSpecificOutput',
])
const specificKeys = new Set([
  'hookEventName',
  'permissionDecision',
  'permissionDecisionReason',
  'additionalContext',
  'decision',
  'action',
  'content',
  'suppressOriginalPrompt',
  'retry',
])
export const stdioFailClosedEvents = new Set<HookEvent>([
  'PreToolUse',
  'PermissionRequest',
  'PreModelSwitch',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'ConfigChange',
  'Elicitation',
  'ElicitationResult',
  'PostToolBatch',
  'TaskCreated',
  'PreCompact',
])

/** Gold yct: whether a partial document is safe to honor. */
function isSafePartialOutput(
  json: HookJSONOutput,
  event: HookEvent,
  status: number,
): boolean {
  if ('async' in json) return true
  if (json.decision === 'approve') return false
  if (json.decision === 'block' && feedbackEvents.has(event)) return false
  if (Object.keys(json).some(key => !outputKeys.has(key))) return false
  const specific = json.hookSpecificOutput
  if (specific === undefined) return true
  if (
    'permissionDecision' in specific &&
    (specific.permissionDecision === 'allow' ||
      specific.permissionDecision === 'defer')
  )
    return false
  if ('decision' in specific && specific.decision.behavior === 'allow')
    return false
  if ('action' in specific && specific.action === 'accept') return false
  if ('retry' in specific && specific.retry === true) return false
  if (
    'additionalContext' in specific &&
    specific.additionalContext !== undefined &&
    !(status === 0 && contextEvents.has(event))
  )
    return false
  return Object.keys(specific).every(key => specificKeys.has(key))
}

export function selectCompleteHookOutput(
  capture: HookCapture,
  event: HookEvent,
  json: HookJSONOutput | undefined,
): HookJSONOutput | undefined {
  if (
    capture.status === 2 &&
    (capture.stdioIncomplete || capture.stdioClosedWithoutEnd) &&
    json !== undefined &&
    !isSafePartialOutput(json, event, capture.status)
  )
    return undefined
  return json
}

export function getHookStdioError(
  capture: HookCapture,
  event: HookEvent,
  json: HookJSONOutput | undefined,
  parse: (text: string) => HookJSONOutput | undefined,
): string | undefined {
  function inspect(text: string, output: HookJSONOutput | undefined) {
    if (capture.status === 2 || capture.aborted) return undefined
    if (!capture.stdioIncomplete && !capture.stdioClosedWithoutEnd)
      return undefined
    if (
      output !== undefined &&
      isSafePartialOutput(output, event, capture.status)
    )
      return undefined
    if (capture.stdioClosedWithoutEnd)
      return 'hook stdio closed before end-of-stream, so part of its output may have been discarded; refusing to read the capture as a clean verdict'
    if (output !== undefined)
      return 'hook output parsed as a document that grants, rewrites or injects, but its stdio went quiet before end-of-stream and a dropped later document could have changed it; refusing to honor the suspect capture'
    if (text.trim().startsWith('{'))
      return 'hook output opens a JSON payload that never completed before its stdio went quiet; refusing to read the partial capture as a verdict'
    return undefined
  }
  return (
    inspect(capture.stdout, json) ??
    (capture.status !== 0 &&
    capture.status !== 2 &&
    (event === 'Elicitation' || event === 'ElicitationResult')
      ? inspect(capture.stderr, parse(capture.stderr))
      : undefined)
  )
}

/** Gold hct: wait for end-of-stream, or 500ms of quiet, capped at 10s. */
export async function waitForHookStreams(
  streamsSettled: Promise<unknown>,
  lastDataAt: () => number,
): Promise<void> {
  const started = Date.now()
  const settled = streamsSettled.then(() => true)
  for (;;) {
    const before = lastDataAt()
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = await Promise.race([
      settled,
      new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), 500)
      }),
    ])
    clearTimeout(timer)
    if (done || Date.now() - started >= 10000) return
    if (lastDataAt() !== before) continue
    await new Promise<void>(resolve => setImmediate(resolve))
    if (lastDataAt() === before) return
  }
}
