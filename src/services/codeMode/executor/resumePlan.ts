/**
 * Code Mode session resume planner, transcript `replMode` inference,
 * interrupted-script detection, and cloud-move refusal helpers.
 */
import { saveReplMode } from '../../../utils/sessionStorage.js'
import {
  CODE_MODE_ENV_VAR,
  CODE_MODE_EXPERIMENTAL_NAME,
  CODE_MODE_NAME,
} from '../constants.js'
import * as optInModule from '../optIn.js'
import {
  codeModeBeforePin,
  codeModeRefusalReasonText,
  formatCodeModeCommand,
  getCodeModeOptInState,
  isCodeModeEnabled,
  pinCodeMode,
  unpinCodeMode,
} from '../optIn.js'
import {
  buildCodeModeInterruptedScriptNotice,
  shouldRunCodeModeScriptInBackground,
} from './autoVerdict.js'
import type {
  CodeModeResumePlan,
  ResumedTranscriptMessageLike,
} from './types.js'

/**
 * Official 2.1.325 #2316: detect whether a resumed session's transcript ended
 * while a Code Mode (`REPL`) script was still in flight (an assistant
 * `tool_use` for `REPL` with no completed `tool_result`, or a trailing
 * interrupted `REPL` tool_result). When true, resuming must NOT auto-start a
 * model turn — it must wait for the user's next prompt.
 */
export function didSessionEndDuringCodeModeScript(
  messages: readonly ResumedTranscriptMessageLike[] | undefined,
): boolean {
  if (!messages || messages.length === 0) return false
  const pendingReplToolUseIds = new Set<string>()
  let lastMeaningfulWasInterruptedRepl = false

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === 'object' &&
            (block as { type?: unknown }).type === 'tool_use' &&
            (block as { name?: unknown }).name === 'REPL' &&
            typeof (block as { id?: unknown }).id === 'string'
          ) {
            pendingReplToolUseIds.add((block as { id: string }).id)
          }
        }
      }
      lastMeaningfulWasInterruptedRepl = false
    } else if (msg.type === 'user') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        let sawReplResult = false
        let sawInterruptedRepl = false
        let sawNonResultUserText = false
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          const rec = block as {
            type?: unknown
            tool_use_id?: unknown
            is_error?: unknown
            content?: unknown
          }
          if (
            rec.type === 'tool_result' &&
            typeof rec.tool_use_id === 'string'
          ) {
            if (pendingReplToolUseIds.has(rec.tool_use_id)) {
              sawReplResult = true
              pendingReplToolUseIds.delete(rec.tool_use_id)
              const text =
                typeof rec.content === 'string'
                  ? rec.content
                  : JSON.stringify(rec.content ?? '')
              if (
                rec.is_error === true &&
                /interrupt|abort|ended/i.test(text)
              ) {
                sawInterruptedRepl = true
              }
            }
          } else if (rec.type === 'text') {
            sawNonResultUserText = true
          }
        }
        if (sawNonResultUserText) {
          lastMeaningfulWasInterruptedRepl = false
        } else if (sawReplResult) {
          lastMeaningfulWasInterruptedRepl = sawInterruptedRepl
        }
      } else if (typeof content === 'string' && content.trim().length > 0) {
        lastMeaningfulWasInterruptedRepl = false
      }
    }
  }

  return pendingReplToolUseIds.size > 0 || lastMeaningfulWasInterruptedRepl
}

const NO_SUCH_TOOL_PREFIX = '<tool_use_error>Error: No such tool available: '
const REPL_UNAVAILABLE_PREFIX = 'Error: REPL tool is not available'
const REPL_TOOL_NAMES_FOR_INFERENCE = new Set(['REPL', 'Eval'])
const ORDINARY_PRIMITIVE_TOOLS_FOR_INFERENCE = new Set([
  'Bash',
  'PowerShell',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'NotebookEdit',
  'Agent',
  'WebFetch',
  'WebSearch',
])

function extractToolResultBlockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0]
    if (typeof first === 'string') return first
    if (
      first &&
      typeof first === 'object' &&
      (first as { type?: unknown }).type === 'text' &&
      typeof (first as { text?: unknown }).text === 'string'
    ) {
      return (first as { text: string }).text
    }
  }
  return ''
}

/**
 * Official 2.1.328 (`m` + `_` / `g` @328432100): infer whether a resumed
 * session was running in Code Mode (`replMode`) from historical tool calls in
 * its transcript when explicit `replMode` metadata is absent.
 *
 * Returns `true` when the last completed pool-identifying tool call was a
 * successful `REPL` / `Eval` call, `false` when it was an ordinary primitive
 * tool call that was in the active pool, or `undefined` when inconclusive.
 */
export function inferReplModeFromMessages(
  messages: readonly ResumedTranscriptMessageLike[] | undefined,
): boolean | undefined {
  if (!messages || messages.length === 0) return undefined
  try {
    const replResult = new Set<string>()
    const inPool = new Set<string>()
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object' || msg.type !== 'user') continue
      const content = msg.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (
          !block ||
          typeof block !== 'object' ||
          (block as { type?: unknown }).type !== 'tool_result'
        ) {
          continue
        }
        const rec = block as {
          tool_use_id?: unknown
          is_error?: unknown
          content?: unknown
        }
        if (typeof rec.tool_use_id !== 'string') continue
        const text = extractToolResultBlockText(rec.content)
        if (rec.is_error !== true) {
          if (
            !text.startsWith(NO_SUCH_TOOL_PREFIX) &&
            !text.startsWith(REPL_UNAVAILABLE_PREFIX)
          ) {
            replResult.add(rec.tool_use_id)
          }
          inPool.add(rec.tool_use_id)
          continue
        }
        if (
          !text.startsWith(NO_SUCH_TOOL_PREFIX) &&
          !text.startsWith(REPL_UNAVAILABLE_PREFIX)
        ) {
          inPool.add(rec.tool_use_id)
        }
      }
    }

    let inferred: boolean | undefined
    for (const msg of messages) {
      if (
        !msg ||
        typeof msg !== 'object' ||
        msg.type !== 'assistant' ||
        (msg as { isVirtual?: unknown }).isVirtual === true
      ) {
        continue
      }
      const content = msg.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (
          !block ||
          typeof block !== 'object' ||
          (block as { type?: unknown }).type !== 'tool_use'
        ) {
          continue
        }
        const rec = block as { name?: unknown; id?: unknown }
        if (typeof rec.name !== 'string' || typeof rec.id !== 'string') continue
        if (
          REPL_TOOL_NAMES_FOR_INFERENCE.has(rec.name) &&
          replResult.has(rec.id)
        ) {
          inferred = true
        } else if (
          ORDINARY_PRIMITIVE_TOOLS_FOR_INFERENCE.has(rec.name) &&
          inPool.has(rec.id)
        ) {
          inferred = false
        }
      }
    }
    return inferred
  } catch {
    return undefined
  }
}

function isSandboxHostListsBlockingCodeMode(): boolean {
  const maybeFn = (
    optInModule as { sandboxHostListsBlockCodeMode?: () => boolean }
  ).sandboxHostListsBlockCodeMode
  return typeof maybeFn === 'function' ? maybeFn() === true : false
}

function buildCodeModeTakenOutReminder(header: string): string {
  return [
    header,
    'Do not call REPL or Eval. They may still be in your tool list, but every call to them is refused. Disregard their descriptions, including the statement that you have no other tools.',
    'Use your other tools instead.',
    'The variables and functions that your earlier scripts defined are gone.',
    `If this conversation later continues in a session that gives you no tools other than REPL and Eval, ${CODE_MODE_NAME} is on there: disregard this reminder.`,
  ].join('\n- ')
}

/**
 * Official `planCodeModeFromSession` (`chunk@328409226`): determines how to
 * reconcile the current Code Mode opt-in state with a resumed session's
 * `replMode` flag (falling back to inferring `replMode` from historical
 * `REPL` tool calls when explicit metadata is absent), handles `sdkUrlWorker`
 * degradation, and whether to wait for the user's next prompt (#2316).
 */
export function planCodeModeFromSession(
  session: {
    replMode?: boolean
    sessionId?: string
    source?: string
    headless?: boolean
    withinSession?: boolean
    sdkUrlWorker?: boolean
    permissionMode?: string
    fromPicker?: boolean
    messages?: readonly ResumedTranscriptMessageLike[]
  },
  onNotice?: (message: string) => void,
): CodeModeResumePlan {
  const canRun = codeModeBeforePin() && !isSandboxHostListsBlockingCodeMode()
  const resolvedReplMode =
    session.replMode ?? inferReplModeFromMessages(session.messages) ?? false
  const isResumedCodeMode = resolvedReplMode === true
  const waitForNextPrompt =
    isResumedCodeMode && didSessionEndDuringCodeModeScript(session.messages)
  const interruptedScriptNotice = waitForNextPrompt
    ? buildCodeModeInterruptedScriptNotice({
        permissionMode: session.permissionMode,
        fromPicker: session.fromPicker,
      })
    : undefined
  const autoBackgroundEligible =
    isResumedCodeMode &&
    shouldRunCodeModeScriptInBackground(session.permissionMode, true)

  if (!canRun && session.sdkUrlWorker !== true) {
    if (!isResumedCodeMode) {
      return { pin: undefined, switched: false }
    }
    const optIn = getCodeModeOptInState()
    const base = `This session was started in ${CODE_MODE_EXPERIMENTAL_NAME}`
    const resumeId =
      session.source === 'store' || session.source === undefined
        ? session.sessionId
        : undefined
    const resumeArg = resumeId ? `--resume ${resumeId}` : undefined
    const exitPrefix = session.withinSession === true ? 'exit and ' : ''
    const envName = CODE_MODE_ENV_VAR

    if (optIn.state === 'refused') {
      const reason = codeModeRefusalReasonText(optIn.why)
      const tail =
        resumeArg === undefined
          ? ''
          : optIn.why === 'declined'
            ? ` To resume it, ${exitPrefix}${formatCodeModeCommand(1, resumeArg, 'step')} and choose Yes.`
            : ''
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which ${reason}, so it can't be resumed.${tail}`,
        refusedWhy: `opt_in_refused_${optIn.why}`,
      }
    }
    if (optIn.state === 'on') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which can't be turned on again until you quit Claude Code, so it can't be resumed here. To resume it, quit and ${resumeArg === undefined ? `start Claude Code again with ${envName}=1 set` : formatCodeModeCommand(1, resumeArg, 'step')}.`,
        refusedWhy: 'opt_in_on_but_mode_unavailable',
      }
    }
    if (optIn.turnedOffIn === 'managed') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which your organization's settings don't allow, so it can't be resumed.`,
        refusedWhy: 'opt_in_off_managed',
      }
    }
    if (optIn.turnedOffIn === 'settings') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which ${envName} in your settings turns off, so it can't be resumed. To resume it, remove that value (from ~/.claude/settings.json, ~/.claude.json or the file given to --settings) and set the variable to 1 in your shell or in ~/.claude/settings.json.`,
        refusedWhy: 'opt_in_off_settings',
      }
    }
    const howToResume =
      resumeArg === undefined
        ? `To resume it, ${exitPrefix}start Claude Code with ${envName}=1 set.`
        : `To resume it, ${exitPrefix}${formatCodeModeCommand(1, resumeArg, 'step')}.`
    if (optIn.turnedOffIn === 'shell') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, but ${envName} in your shell turns ${CODE_MODE_NAME} off, so it can't be resumed.\n${howToResume}`,
        refusedWhy: 'opt_in_off_shell',
      }
    }
    if (session.headless === true) {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which ${codeModeRefusalReasonText('entrypoint')}, so it can't be resumed here.${resumeArg === undefined ? '' : ` Resume it in the terminal: ${formatCodeModeCommand(1, resumeArg)}`}`,
        refusedWhy: 'not_asked_headless',
      }
    }
    if (session.source !== undefined && session.source !== 'store') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which is off, so it can't be resumed.\n${howToResume}`,
        refusedWhy: 'not_from_store',
      }
    }
    return {
      pin: undefined,
      switched: false,
      refused: `${base}, which is off, so it can't be resumed.\n${howToResume}`,
      refusedWhy: 'not_asked',
    }
  }

  const currentlyOn = isCodeModeEnabled()
  if (!isResumedCodeMode) {
    if (!canRun) {
      return { pin: undefined, switched: false }
    }
    onNotice?.(
      `${CODE_MODE_NAME} is on, but this session isn't using it, so it continues with the ordinary tools. New sessions use ${CODE_MODE_NAME}.`,
    )
    return currentlyOn
      ? { pin: false, switched: true }
      : { pin: undefined, switched: false }
  }
  if (!canRun) {
    const notice = `This session was started in ${CODE_MODE_EXPERIMENTAL_NAME}, which isn't available where it runs now. It continues with the ordinary tools and stays out of ${CODE_MODE_NAME} from now on.`
    onNotice?.(notice)
    return {
      pin: undefined,
      switched: false,
      declined: true,
      takenOut: {
        notice,
        reminder: buildCodeModeTakenOutReminder(
          `${CODE_MODE_NAME} is off in this session.`,
        ),
      },
    }
  }
  return currentlyOn
    ? {
        pin: undefined,
        switched: false,
        ...(waitForNextPrompt ? { waitForNextPrompt: true } : {}),
        ...(interruptedScriptNotice ? { interruptedScriptNotice } : {}),
        ...(autoBackgroundEligible ? { autoBackgroundEligible: true } : {}),
      }
    : {
        pin: undefined,
        unpin: true,
        switched: true,
        ...(waitForNextPrompt ? { waitForNextPrompt: true } : {}),
        ...(interruptedScriptNotice ? { interruptedScriptNotice } : {}),
        ...(autoBackgroundEligible ? { autoBackgroundEligible: true } : {}),
      }
}

/**
 * Official `applyCodeModePlan`: pins or unpins Code Mode for a resumed session
 * and persists the resulting `replMode` state to session storage.
 */
export function applyCodeModePlan(plan: CodeModeResumePlan): void {
  if (plan.unpin) {
    unpinCodeMode()
  } else if (plan.pin !== undefined) {
    pinCodeMode(plan.pin)
  }
  try {
    saveReplMode(isCodeModeEnabled())
  } catch {
    // Best-effort outside full session storage lifecycle
  }
}

/**
 * Official `cloudMoveRefusal`: blocks moving an active Code Mode session to the cloud.
 */
export function cloudMoveRefusal(): string | undefined {
  if (isCodeModeEnabled()) {
    return `This session was started in ${CODE_MODE_EXPERIMENTAL_NAME}, which the move to the cloud can't carry yet, so it can't continue in the cloud.`
  }
  return undefined
}
