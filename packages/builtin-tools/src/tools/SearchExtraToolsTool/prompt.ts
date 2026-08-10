import {
  getInitialMainLoopModel,
  getMainLoopModelOverride,
} from 'src/bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { Tool } from 'src/Tool.js'
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { BRIEF_TOOL_NAME } from '../BriefTool/prompt.js'
import { ENTER_WORKTREE_TOOL_NAME } from '../EnterWorktreeTool/constants.js'
import { SEND_USER_FILE_TOOL_NAME } from '../SendUserFileTool/prompt.js'
import { isForkSubagentEnabled } from 'src/utils/forkSubagentGate.js'
import { getInitialSettings } from 'src/utils/settings/settings.js'

export { SEARCH_EXTRA_TOOLS_TOOL_NAME } from './constants.js'

import { SEARCH_EXTRA_TOOLS_TOOL_NAME } from './constants.js'

/** densable `vL_` — default empty non_deferrable builtins list. */
const DEFAULT_NON_DEFERRABLE_BUILTINS: readonly string[] = []

/**
 * densable `EL_` — surface-pick object-shaped GrowthBook values by model id.
 * null / array / non-object → passthrough; object → first key (≠ `*`) whose
 * lowercase form is a substring of the model, else `t["*"]`.
 *
 * Model resolution matches densable: `qC()` mainLoopModelOverride, else
 * `FY()` initialMainLoopModel.
 */
export function surfacePickByModel(
  value: unknown,
  model: string | undefined | null,
): unknown {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return value
  }
  const t = value as Record<string, unknown>
  if (typeof model === 'string') {
    const o = model.toLowerCase()
    for (const key of Object.keys(t)) {
      if (key !== '*' && key.length > 0 && o.includes(key.toLowerCase())) {
        return t[key]
      }
    }
  }
  return t['*']
}

function resolveSurfaceModelForEl(): string | undefined {
  // densable: r=qC(), n=r!==void 0?r:FY()
  const override = getMainLoopModelOverride()
  const model = override !== undefined ? override : getInitialMainLoopModel()
  return typeof model === 'string' ? model : undefined
}

/**
 * densable `eGu` — union of GrowthBook `tengu_non_deferrable_builtins` (via
 * `EL_` surface pick) and settings `non_deferrable_builtins`. Empty → `vL_` ([]).
 */
export function getNonDeferrableBuiltins(): readonly string[] {
  const names = new Set<string>()
  try {
    const fromGb = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_non_deferrable_builtins',
      null as string[] | Record<string, string[]> | null,
    )
    // densable: let t=EL_(Xe(...)); if(Array.isArray(t)) ...
    const picked = surfacePickByModel(fromGb, resolveSurfaceModelForEl())
    if (Array.isArray(picked)) {
      for (const name of picked) {
        if (typeof name === 'string') names.add(name)
      }
    }
  } catch {
    // ignore GB failures
  }
  try {
    const fromSettings = getInitialSettings().non_deferrable_builtins
    if (Array.isArray(fromSettings)) {
      for (const name of fromSettings) {
        if (typeof name === 'string') names.add(name)
      }
    }
  } catch {
    // ignore settings failures
  }
  if (names.size === 0) return DEFAULT_NON_DEFERRABLE_BUILTINS
  return [...names]
}

/**
 * densable `nrr` — remote_trigger entrypoint (PushNotification always-load arm).
 */
function isRemoteTriggerEntrypoint(): boolean {
  return process.env.CLAUDE_CODE_ENTRYPOINT === 'remote_trigger'
}

/**
 * densable `jKe` — kairos dynamic loop gate (ScheduleWakeup always-load arm).
 */
function isKairosLoopDynamicEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_dynamic', false)
}

/**
 * densable `tCo` / T3_+v3_|E3_+w3_ — ToolSearch prompt.
 * Model fetches schemas via this tool, then calls deferred tools **directly**
 * (API expands tool_reference). No ExecuteExtraTool indirection.
 */
const PROMPT_HEAD = `Fetches full schema definitions for deferred tools so they can be called.
`

// Matches isDeferredToolsDeltaEnabled in searchExtraTools.ts (not imported —
// searchExtraTools.ts imports from this file). When enabled: tools announced
// via system-reminder attachments. When disabled: prepended
// <available-deferred-tools> block (pre-gate behavior).
function getToolLocationHint(): string {
  const deltaEnabled =
    process.env.USER_TYPE === 'ant' ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_glacier_2xr', false)
  return deltaEnabled
    ? 'Deferred tools appear by name in <system-reminder> messages.'
    : 'Deferred tools appear by name in <available-deferred-tools> messages.'
}

// densable E3_ (InputValidationError branch) — always use the stronger form.
const PROMPT_TAIL = ` Until fetched, only the name is known — there is no parameter schema, so calling the tool fails with InputValidationError. When any instruction, system reminder, or other tool's description names a deferred tool, fetch it with query "select:<name>" before calling it. This tool takes a query, matches it against the deferred tool list, and returns the matched tools' complete JSONSchema definitions inside a <functions> block. Once a tool's schema appears in that result, it is callable exactly like any tool defined at the top of the prompt.
Result format: each matched tool appears as one <function>{"description": "...", "name": "...", "parameters": {...}}</function> line inside the <functions> block — the same encoding as the tool list at the top of this prompt.
Query forms:
- "select:Read,Edit,Grep" — fetch these exact tools by name
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms`

/**
 * densable `TX` — opt-in defer policy (not CORE_TOOLS whitelist).
 *
 * Order (SEA 2.1.221):
 * 1. alwaysLoad === true → never defer
 * 2. eGu() non_deferrable list → never defer
 * 3. isMcp → always defer
 * 4. ToolSearch (dw) → never defer
 * 5. Agent + fork subagent enabled → never defer
 * 6. Brief / SendUserFile → never defer
 * 7. PushNotification + remote_trigger entrypoint → never defer
 * 8. ScheduleWakeup + tengu_kairos_loop_dynamic → never defer
 * 9. EnterWorktree + SESSION_KIND=bg → never defer
 * 10. else shouldDefer === true
 */
export function isDeferredTool(tool: Tool): boolean {
  // densable: if(e.alwaysLoad===!0)return!1
  if (tool.alwaysLoad === true) return false

  // densable: if(eGu().includes(e.name))return!1
  if (getNonDeferrableBuiltins().includes(tool.name)) return false

  // densable: if(e.isMcp===!0)return!0
  if (tool.isMcp === true) return true

  // densable: if(e.name===dw)return!1 — ToolSearch itself is never deferred
  if (tool.name === SEARCH_EXTRA_TOOLS_TOOL_NAME) return false

  // densable: if(e.name===Qo){if(isForkSubagentEnabled())return!1}
  if (tool.name === AGENT_TOOL_NAME) {
    if (isForkSubagentEnabled()) return false
  }

  // densable: if(e.name===b3_)return!1 — Brief / SendUserMessage
  if (tool.name === BRIEF_TOOL_NAME) return false

  // densable: if(e.name===S3_)return!1 — SendUserFile
  if (tool.name === SEND_USER_FILE_TOOL_NAME) return false

  // densable: if(e.name===Mre&&nrr())return!1 — PushNotification + remote_trigger
  if (tool.name === 'PushNotification' && isRemoteTriggerEntrypoint()) {
    return false
  }

  // densable: if(e.name===k_&&jKe())return!1 — ScheduleWakeup + kairos loop dynamic
  if (tool.name === 'ScheduleWakeup' && isKairosLoopDynamicEnabled()) {
    return false
  }

  // densable: if(e.name===Lre&&SESSION_KIND==="bg")return!1
  if (
    tool.name === ENTER_WORKTREE_TOOL_NAME &&
    process.env.CLAUDE_CODE_SESSION_KIND === 'bg'
  ) {
    return false
  }

  // densable: return e.shouldDefer===!0
  return tool.shouldDefer === true
}

/**
 * Format one deferred-tool line for the <available-deferred-tools> user
 * message. Search hints (tool.searchHint) are not rendered — the
 * hints A/B (exp_xenhnnmn0smrx4, stopped Mar 21) showed no benefit.
 */
export function formatDeferredToolLine(tool: Tool): string {
  return tool.name
}

export function getPrompt(): string {
  return PROMPT_HEAD + getToolLocationHint() + PROMPT_TAIL
}
