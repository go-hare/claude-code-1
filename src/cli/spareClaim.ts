/**
 * densable 2.1.283 `--await-claim` park/claim host wrappers.
 *
 * GOLD SEA /tmp/official-283/package/claude:
 *   `_zr` / `markSpareParked` @175552296
 *   `Szr` claiming, `bzr` claimed, `wzr` failed, `Mk` parked, `MYe` any spare
 *   parked control allowlist `ly` / `uy` / `cy` / `my` @198972656
 *   unclaimed user first message O6 @199187468
 */

import { randomUUID } from 'crypto'
import { EMPTY_USAGE } from '@ant/model-provider'
import type { ScopedMcpServerConfig } from '../services/mcp/types.js'
import { getBootstrapSessionHost } from '../utils/sessionHost.js'
import { isEnvTruthy } from '../utils/envUtils.js'

export type SpareClaimState = 'parked' | 'claiming' | 'claimed' | 'failed'

/** densable uy @198974330 */
export const NOT_CLAIMED_CONTROL_PARKED =
  'not_claimed: this process is a spare waiting for claim_session; send this request after the claim'

/** densable cy @198974330 */
export const NOT_CLAIMED_CONTROL_FAILED =
  'not_claimed: the claim of this spare failed; discard the process and start the session cold'

/** densable first-message string @82013740 / O6 enqueue @199187468 */
export const NOT_CLAIMED_BEFORE_FIRST_MESSAGE =
  'not_claimed: this process was started with --await-claim and has not been claimed; send claim_session before the first message'

/** densable failed first-message string @82013740 / O6 enqueue @199187468 */
export const NOT_CLAIMED_FAILED =
  'not_claimed: the claim of this spare failed; discard it and start the session normally'

/** densable `bgt` @198662378 — print stream-json sandbox-required O6 prefix. */
export const SANDBOX_REQUIRED_UNAVAILABLE = 'Sandbox required but unavailable'

/** densable O6 failIfUnavailable tail @199034114 */
export const SANDBOX_FAIL_IF_UNAVAILABLE_HINT =
  'Set sandbox.failIfUnavailable=false to allow unsandboxed execution.'

/**
 * densable `ly` @198972656 — parked process allows these control subtypes
 * (`true`) and rejects the rest (`false` / missing → `my` default true only
 * for keys on the object; gold `my`: Object.hasOwn(ly,e)?ly[e]:!0).
 *
 * Unknown subtypes are allowed (gold default true). False keys are refused
 * until claim.
 */
export const PARKED_CONTROL_SUBTYPE_ALLOWLIST: Record<string, boolean> = {
  claim_session: true,
  initialize: true,
  interrupt: true,
  end_session: true,
  cancel_async_message: true,
  set_permission_mode: true,
  set_model: true,
  set_max_thinking_tokens: true,
  apply_flag_settings: true,
  set_mcp_permission_mode_override: true,
  reload_plugins: true,
  reload_skills: true,
  reload_output_styles: true,
  claude_authenticate: true,
  claude_oauth_callback: true,
  claude_oauth_wait_for_completion: true,
  mcp_authenticate: true,
  mcp_oauth_callback_url: true,
  mcp_clear_auth: true,
  register_device_hooks: true,
  upload_device_hook_template: true,
  remote_tools_announce: true,
  set_chrome_browser_hints: true,
  select_chrome_browser: true,
  set_prompt_suggestions_paused: true,
  rename_session: true,
  generate_session_title: true,
  message_rated: true,
  submit_feedback: true,
  mcp_status: true,
  get_context_usage: true,
  get_usage: true,
  get_session_cost: true,
  list_models: true,
  get_binary_version: true,
  get_settings: true,
  get_hooks_listing: true,
  list_permission_rules: true,
  get_status: true,
  get_plan: true,
  stop_task: true,
  background_tasks: true,
  get_memory_dialog: true,
  get_skills_dialog: true,
  get_chrome_dialog: true,
  get_chrome_browsers: true,
  get_sandbox_dialog: true,
  export_conversation: true,
  set_cwd: false,
  update_settings: false,
  add_directory: false,
  register_repo_root: false,
  seed_read_state: false,
  stage_file: false,
  read_file: false,
  file_suggestions: false,
  get_workspace_diff: false,
  rewind_files: false,
  mcp_set_servers: false,
  mcp_reconnect: false,
  mcp_toggle: false,
  mcp_read_resource: false,
  mcp_call: false,
  side_question: false,
  ultrareview_launch: false,
  fork_conversation: false,
  rewind_conversation: false,
  poll_event: false,
  prefetch_attachments: false,
  channel_enable: false,
  remote_control: false,
  set_color: false,
  turn_handoff: false,
  ui_attach: false,
  ui_detach: false,
  ui_render: false,
  ui_press: false,
  ui_input: false,
  ui_select: false,
  ui_panes: false,
  ui_pane_show: false,
  ui_pane_focus: false,
  ui_close: false,
  ui_scroll: false,
  ui_focus: false,
  ui_client_module: false,
  ui_client_press: false,
  ui_message: false,
}

/** densable `my` @198974365 */
export function isParkedControlSubtypeAllowed(subtype: unknown): boolean {
  return typeof subtype === 'string' &&
    Object.hasOwn(PARKED_CONTROL_SUBTYPE_ALLOWLIST, subtype)
    ? PARKED_CONTROL_SUBTYPE_ALLOWLIST[subtype]!
    : true
}

/** densable `td()` — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB truthy. */
export function isSubprocessEnvScrubEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB)
}

/** densable `Vmt`. */
export function getSpareClaimState(): SpareClaimState | undefined {
  return getBootstrapSessionHost().launchOptions.spareClaimState()
}

/** densable `Mk`. */
export function isSpareParked(): boolean {
  return getSpareClaimState() === 'parked'
}

/** densable `MYe`. */
export function isSpareUnclaimed(): boolean {
  const e = getSpareClaimState()
  return e === 'parked' || e === 'claiming' || e === 'failed'
}

/** densable `_zr` / `markSpareParked`. */
export function markSpareParked(): void {
  const e = getBootstrapSessionHost().launchOptions
  e.replaceSpareClaimState('parked')
  e.replaceSpareParkedAtMs(Date.now())
}

/** densable `Szr` / `markSpareClaiming`. */
export function markSpareClaiming(): number | undefined {
  const e = getBootstrapSessionHost().launchOptions
  const t = e.spareParkedAtMs()
  e.replaceSpareClaimState('claiming')
  return t === undefined ? undefined : Date.now() - t
}

/** densable `bzr` / `markSpareClaimed`. */
export function markSpareClaimed(): void {
  getBootstrapSessionHost().launchOptions.replaceSpareClaimState('claimed')
}

/** densable `wzr` / `markSpareClaimFailed`. */
export function markSpareClaimFailed(): void {
  getBootstrapSessionHost().launchOptions.replaceSpareClaimState('failed')
}

/**
 * densable Xt @192086918 — stdio MCP configs held back at spare boot
 * (`Mk()?Qr(nt, stdio && !chrome && !computer-use && scope!==project/local)`).
 * Connected on claim via print host `startDeferredMcpServers`.
 */
let heldBackMcpConfigs: Record<string, ScopedMcpServerConfig> | undefined

export function holdBackMcpConfigsForClaim(
  configs: Record<string, ScopedMcpServerConfig>,
): void {
  heldBackMcpConfigs = configs
}

export function takeHeldBackMcpConfigs(): Record<
  string,
  ScopedMcpServerConfig
> {
  const next = heldBackMcpConfigs ?? {}
  heldBackMcpConfigs = undefined
  return next
}

export function isClaimSessionRequest(request: unknown): boolean {
  return (
    typeof request === 'object' &&
    request !== null &&
    (request as { subtype?: unknown }).subtype === 'claim_session'
  )
}

export function parkedControlRefusalMessage(): string {
  return getSpareClaimState() === 'failed'
    ? NOT_CLAIMED_CONTROL_FAILED
    : NOT_CLAIMED_CONTROL_PARKED
}

export function unclaimedUserRefusalMessage(): string {
  return getSpareClaimState() === 'failed'
    ? NOT_CLAIMED_FAILED
    : NOT_CLAIMED_BEFORE_FIRST_MESSAGE
}

/** densable `O6` @179000667 */
export function buildErrorDuringExecutionResult(
  sessionId: string,
  errors: string[],
): {
  type: 'result'
  subtype: 'error_during_execution'
  duration_ms: 0
  duration_api_ms: 0
  is_error: true
  num_turns: 0
  stop_reason: null
  session_id: string
  total_cost_usd: 0
  usage: typeof EMPTY_USAGE
  modelUsage: Record<string, never>
  permission_denials: []
  uuid: string
  errors: string[]
} {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: true,
    num_turns: 0,
    stop_reason: null,
    session_id: sessionId,
    total_cost_usd: 0,
    usage: EMPTY_USAGE,
    modelUsage: {},
    permission_denials: [],
    uuid: randomUUID(),
    errors,
  }
}

export function buildNotClaimedExecutionResult(
  sessionId: string,
): ReturnType<typeof buildErrorDuringExecutionResult> {
  return buildErrorDuringExecutionResult(sessionId, [
    unclaimedUserRefusalMessage(),
  ])
}

/** Alias gold `ly` for parked-init tests. */
export const SPARE_PARKED_CONTROL_ALLOWLIST = PARKED_CONTROL_SUBTYPE_ALLOWLIST
export const isSpareParkedControlAllowed = isParkedControlSubtypeAllowed
export const parkedControlRejectMessage = parkedControlRefusalMessage
export function shouldRejectParkedControl(subtype: unknown): boolean {
  return isSpareUnclaimed() && !isParkedControlSubtypeAllowed(subtype)
}

export type MinimalClaimSessionRequest = {
  subtype: 'claim_session'
  cwd?: string
  include_initialize?: boolean
}

/**
 * Minimal wait+bind kept for awaitClaimInit.283 tests. Full body is
 * handleClaimSessionRequest in claimSession.ts.
 */
export function bindMinimalClaimSession(
  request: MinimalClaimSessionRequest,
  setCwd: (path: string) => void,
):
  | { kind: 'ok'; response: { status: 'ok'; cwd?: string } }
  | { kind: 'error'; message: string } {
  if (!isSpareParked()) {
    return {
      kind: 'error',
      message:
        'not_a_spare: claim_session is only accepted by a process started with --await-claim that has not been claimed yet',
    }
  }
  markSpareClaiming()
  if (typeof request.cwd === 'string' && request.cwd.length > 0) {
    setCwd(request.cwd)
  }
  markSpareClaimed()
  return {
    kind: 'ok',
    response: {
      status: 'ok',
      ...(typeof request.cwd === 'string' && request.cwd.length > 0
        ? { cwd: request.cwd }
        : {}),
    },
  }
}
