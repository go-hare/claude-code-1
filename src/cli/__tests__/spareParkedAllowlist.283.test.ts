/**
 * densable 2.1.283 parked spare control_request allowlist (ly / uy / cy / my).
 *
 * GOLD SEA /tmp/official-283/package/claude:
 *   ly object @198974334
 *   print loop `if(MYe()&&!my(T.request.subtype)){je(T,Vmt()==="failed"?cy:uy);continue}`
 *     @199127457
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isSpareParkedControlAllowed,
  markSpareClaimFailed,
  markSpareParked,
  NOT_CLAIMED_CONTROL_FAILED,
  NOT_CLAIMED_CONTROL_PARKED,
  parkedControlRejectMessage,
  shouldRejectParkedControl,
  SPARE_PARKED_CONTROL_ALLOWLIST,
} from '../spareClaim.js'
import { getBootstrapSessionHost } from '../../utils/sessionHost.js'

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('densable 2.1.283 parked spare control allowlist', () => {
  test('gold ly true/false keys 1:1', () => {
    const allowed = Object.entries(SPARE_PARKED_CONTROL_ALLOWLIST)
      .filter(([, v]) => v)
      .map(([k]) => k)
    const denied = Object.entries(SPARE_PARKED_CONTROL_ALLOWLIST)
      .filter(([, v]) => !v)
      .map(([k]) => k)
    expect(allowed).toEqual([
      'claim_session',
      'initialize',
      'interrupt',
      'end_session',
      'cancel_async_message',
      'set_permission_mode',
      'set_model',
      'set_max_thinking_tokens',
      'apply_flag_settings',
      'set_mcp_permission_mode_override',
      'reload_plugins',
      'reload_skills',
      'reload_output_styles',
      'claude_authenticate',
      'claude_oauth_callback',
      'claude_oauth_wait_for_completion',
      'mcp_authenticate',
      'mcp_oauth_callback_url',
      'mcp_clear_auth',
      'register_device_hooks',
      'upload_device_hook_template',
      'remote_tools_announce',
      'set_chrome_browser_hints',
      'select_chrome_browser',
      'set_prompt_suggestions_paused',
      'rename_session',
      'generate_session_title',
      'message_rated',
      'submit_feedback',
      'mcp_status',
      'get_context_usage',
      'get_usage',
      'get_session_cost',
      'list_models',
      'get_binary_version',
      'get_settings',
      'get_hooks_listing',
      'list_permission_rules',
      'get_status',
      'get_plan',
      'stop_task',
      'background_tasks',
      'get_memory_dialog',
      'get_skills_dialog',
      'get_chrome_dialog',
      'get_chrome_browsers',
      'get_sandbox_dialog',
      'export_conversation',
    ])
    expect(denied).toEqual([
      'set_cwd',
      'update_settings',
      'add_directory',
      'register_repo_root',
      'seed_read_state',
      'stage_file',
      'read_file',
      'file_suggestions',
      'get_workspace_diff',
      'rewind_files',
      'mcp_set_servers',
      'mcp_reconnect',
      'mcp_toggle',
      'mcp_read_resource',
      'mcp_call',
      'side_question',
      'ultrareview_launch',
      'fork_conversation',
      'rewind_conversation',
      'poll_event',
      'prefetch_attachments',
      'channel_enable',
      'remote_control',
      'set_color',
      'turn_handoff',
      'ui_attach',
      'ui_detach',
      'ui_render',
      'ui_press',
      'ui_input',
      'ui_select',
      'ui_panes',
      'ui_pane_show',
      'ui_pane_focus',
      'ui_close',
      'ui_scroll',
      'ui_focus',
      'ui_client_module',
      'ui_client_press',
      'ui_message',
    ])
  })

  test('my: unknown subtype defaults allow; listed false rejects', () => {
    expect(isSpareParkedControlAllowed('claim_session')).toBe(true)
    expect(isSpareParkedControlAllowed('initialize')).toBe(true)
    expect(isSpareParkedControlAllowed('set_cwd')).toBe(false)
    expect(isSpareParkedControlAllowed('rewind_files')).toBe(false)
    expect(isSpareParkedControlAllowed('not_a_gold_subtype')).toBe(true)
    expect(isSpareParkedControlAllowed(undefined)).toBe(true)
  })

  test('parked spare rejects denied subtypes with uy; failed uses cy', () => {
    const host = getBootstrapSessionHost().launchOptions
    host.reset()
    markSpareParked()
    expect(shouldRejectParkedControl('claim_session')).toBe(false)
    expect(shouldRejectParkedControl('set_cwd')).toBe(true)
    expect(parkedControlRejectMessage()).toBe(NOT_CLAIMED_CONTROL_PARKED)
    markSpareClaimFailed()
    expect(shouldRejectParkedControl('set_cwd')).toBe(true)
    expect(parkedControlRejectMessage()).toBe(NOT_CLAIMED_CONTROL_FAILED)
    host.reset()
    expect(shouldRejectParkedControl('set_cwd')).toBe(false)
  })

  test('print.ts early-guards control_request while MYe before interrupt', () => {
    const print = src('src/cli/print.ts')
    const guard = print.indexOf(
      'shouldRejectParkedControl(msg.request.subtype)',
    )
    const interrupt = print.indexOf("msg.request.subtype === 'interrupt'")
    expect(guard).toBeGreaterThan(0)
    expect(interrupt).toBeGreaterThan(guard)
    expect(print).toContain('parkedControlRejectMessage()')
    expect(print).toContain(
      'sendControlResponseError(msg, parkedControlRejectMessage())',
    )
  })

  test('print.ts stream-json sandbox-required writes O6 then stderr', () => {
    const print = src('src/cli/print.ts')
    const spare = src('src/cli/spareClaim.ts')
    expect(spare).toContain('Sandbox required but unavailable')
    expect(print).toContain('SANDBOX_REQUIRED_UNAVAILABLE')
    expect(print).toContain('buildErrorDuringExecutionResult')
    expect(print).toContain('SANDBOX_FAIL_IF_UNAVAILABLE_HINT')
    expect(print).toContain('isEvalConfined')
    const o6 = print.indexOf('buildErrorDuringExecutionResult(getSessionId()')
    const stderr = print.indexOf('Error: sandbox required but unavailable')
    expect(o6).toBeGreaterThan(0)
    expect(stderr).toBeGreaterThan(o6)
  })
})
