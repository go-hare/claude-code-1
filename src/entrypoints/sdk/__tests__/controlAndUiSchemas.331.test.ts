import { describe, expect, test } from 'bun:test'
import {
  dispatchPrintControlExtra,
  getTurnHandoffManager,
  getUpgradedRelayMarker,
  parseRemoteToolsAnnounce,
  parseSetChromeBrowserHintsControlRequest,
  type PrintControlExtraDeps,
  registerDesktopUiControlHandler,
  registerPrintControlExtensionHandler,
  resetTurnHandoffManager,
  resetUpgradedRelayMarker,
} from 'src/cli/printControlExtras.js'
import { setSharedBackendMode } from 'src/utils/sessionContextAls.js'
import { createSessionHost } from 'src/utils/sessionHost.js'
import { createRootSession, runWithSession } from 'src/utils/sessionRoot.js'
import {
  DESKTOP_UI_CONTROL_SUBTYPES,
  DesktopUiControlRequestSchema,
  isDesktopUiControlSubtype,
  SDK_EXTENDED_CONTROL_SUBTYPES,
  SDKControlRequestInnerSchema,
  SDKControlRequestSchema,
  SDKExtendedControlRequestSchema,
  StdoutMessageSchema,
} from '../controlSchemas.js'
import {
  SDK_EXTENDED_SYSTEM_SUBTYPES,
  SDKExtendedSystemEventSchema,
  SDKMessageSchema,
} from '../coreSchemas.js'

function createMockSession(id: string) {
  return createRootSession({
    host: createSessionHost(),
    id,
    project: {
      originalCwd: '/tmp/project',
      projectRoot: '/tmp/project',
      cwd: '/tmp/project',
    },
  })
}

function createHarness(overrides: Partial<PrintControlExtraDeps> = {}): {
  deps: PrintControlExtraDeps
  successes: Array<Record<string, unknown>>
  errors: string[]
  flush: () => Promise<void>
} {
  const successes: Array<Record<string, unknown>> = []
  const errors: string[] = []
  const pending: Array<Promise<void>> = []
  const deps: PrintControlExtraDeps = {
    getMcpClients: () => [],
    getPermissionContext: () => ({}),
    setPromptSuggestionEnabled: () => {},
    sendSuccess: (response?: Record<string, unknown>) => {
      successes.push(response ?? {})
    },
    sendError: (error: string) => {
      errors.push(error)
    },
    defer: (work: () => void | Promise<void>) => {
      const result = work()
      if (result && typeof result.then === 'function') {
        pending.push(result)
      }
    },
    errorMessage: (err: unknown) =>
      err instanceof Error ? err.message : String(err),
    ...overrides,
  }
  return {
    deps,
    successes,
    errors,
    flush: async () => {
      await Promise.all(pending.splice(0))
    },
  }
}

describe('Official 2.1.331 extended control_request schemas', () => {
  const validExtendedControlRequests: ReadonlyArray<{
    subtype: string
    [key: string]: unknown
  }> = [
    {
      subtype: 'comparison_fork',
      turn_id: 'turn-1',
      model: 'claude-sonnet-4-6',
      prompt: 'compare options',
    },
    {
      subtype: 'worker_shutting_down',
      reason: 'scale_in',
      grace_ms: 5000,
      worker_epoch: 3,
    },
    { subtype: 'upgrade_relay_marker', marker: 'relay-v2', epoch: 4 },
    {
      subtype: 'register_device_hooks',
      hooks: [{ event: 'PreToolUse', command: 'echo ok' }],
      device_id: 'dev-1',
    },
    {
      subtype: 'upload_device_hook_template',
      template_id: 'tpl-1',
      name: 'audit',
      content: '#!/bin/sh\nexit 0\n',
    },
    {
      subtype: 'remote_control_work_secret',
      secret: 'sec_123456',
      expires_at: 1800000000,
    },
    {
      subtype: 'remote_tools_announce',
      instance_id: 'inst-1',
      host: { name: 'workstation', epoch: 'epoch-1', home_dir: '/home/dev' },
      tools: [
        { name: 'Read', protocol_versions: [1] },
        { name: 'Bash', protocol_versions: [1, 2] },
      ],
      passthrough: [{ name: 'mcp__docs__search' }],
      plumbing: ['read_file'],
    },
    { subtype: 'get_status', include_mcp: true, include_tasks: true },
    { subtype: 'list_permission_rules', scope: 'session' },
    { subtype: 'get_sandbox_dialog', dialog_kind: 'overview' },
    { subtype: 'get_chrome_browsers' },
    { subtype: 'select_chrome_browser', device_id: 'chrome-main' },
    {
      subtype: 'set_chrome_browser_hints',
      localDeviceIds: ['dev-1'],
      preferredDeviceId: 'dev-1',
      hostPlatform: 'darwin',
    },
    { subtype: 'get_chrome_dialog' },
    { subtype: 'list_cloud_sessions', limit: 25, cursor: 'cur-1' },
    { subtype: 'get_cloud_session', session_id: 'csess-1' },
    { subtype: 'get_cloud_session_transcript', session_id: 'csess-1' },
    {
      subtype: 'update_cloud_session',
      session_id: 'csess-1',
      title: 'Renamed',
      archived: false,
    },
    {
      subtype: 'start_shell_task',
      command: 'echo hi',
      cwd: '/tmp',
      background: true,
    },
    {
      subtype: 'submit_feedback',
      rating: 'positive',
      comment: 'great',
      message_id: 'msg-1',
    },
    {
      subtype: 'submit_survey_feedback',
      survey_id: 'surv-1',
      answers: { q1: 5 },
    },
    { subtype: 'reload_connectors', server_names: ['github'] },
    { subtype: 'plugin_install', plugin: 'my-plugin', scope: 'user' },
    {
      subtype: 'export_conversation',
      format: 'markdown',
      path: '/tmp/out.md',
    },
    {
      subtype: 'read_file',
      path: 'src/index.ts',
      max_bytes: 4096,
      encoding: 'utf-8',
    },
    { subtype: 'list_directory', path: 'src' },
    {
      subtype: 'mcp_read_resource',
      server: 'docs',
      uri: 'docs://readme',
    },
    { subtype: 'set_prompt_suggestions_paused', paused: true },
    { subtype: 'set_has_subscribers', has_subscribers: true },
    { subtype: 'set_message_waiting', waiting: false },
    { subtype: 'set_color', color: '#3366ff' },
    { subtype: 'dictate', action: 'start' },
    { subtype: 'dev_intent', intent: 'refactor' },
    {
      subtype: 'log_host_events',
      events: [{ name: 'host_ping', ts: 123 }],
    },
    {
      subtype: 'turn_handoff',
      action: 'export',
      session_id: 'sess-handoff-1',
      stopped: false,
      continues: true,
      relay_marker: { uuid: 'rm-1', content: 'relay-content' },
      file_names: [{ fileUuid: 'f-1', name: 'a.ts' }],
      memory_context: { uuid: 'mc-1', version: 'v1', content: 'notes' },
    },
  ]

  test('covers and parses every single SDK_EXTENDED_CONTROL_SUBTYPES entry', () => {
    const covered = new Set(
      validExtendedControlRequests.map(req => String(req.subtype)),
    )
    expect(covered.size).toBe(SDK_EXTENDED_CONTROL_SUBTYPES.length)
    for (const subtype of SDK_EXTENDED_CONTROL_SUBTYPES) {
      expect(covered.has(subtype)).toBe(true)
    }

    for (const payload of validExtendedControlRequests) {
      const parsedExt = SDKExtendedControlRequestSchema().parse(payload)
      expect(String(parsedExt.subtype)).toBe(payload.subtype)

      const parsedInner = SDKControlRequestInnerSchema().parse(payload)
      expect(String(parsedInner.subtype)).toBe(payload.subtype)

      const parsedEnvelope = SDKControlRequestSchema().parse({
        type: 'control_request',
        request_id: `req-${payload.subtype}`,
        request: payload,
      })
      expect(String(parsedEnvelope.request.subtype)).toBe(payload.subtype)
    }
  })

  test('rejects malformed extended control_request payloads', () => {
    const invalidPayloads: ReadonlyArray<Record<string, unknown>> = [
      { subtype: 'worker_shutting_down', grace_ms: -1 },
      { subtype: 'upgrade_relay_marker', marker: '' },
      { subtype: 'register_device_hooks', hooks: 'not-an-array' },
      { subtype: 'upload_device_hook_template', template_id: 't1', name: 'n' },
      { subtype: 'remote_control_work_secret', secret: '' },
      { subtype: 'remote_tools_announce', instance_id: 'i1', tools: [] },
      { subtype: 'select_chrome_browser' },
      { subtype: 'set_chrome_browser_hints', localDeviceIds: 'bad' },
      { subtype: 'list_cloud_sessions', limit: 0 },
      { subtype: 'get_cloud_session', session_id: '' },
      { subtype: 'get_cloud_session_transcript' },
      { subtype: 'update_cloud_session', session_id: 's1', archived: 'yes' },
      { subtype: 'start_shell_task', command: '' },
      { subtype: 'submit_survey_feedback', survey_id: 's1', answers: null },
      { subtype: 'plugin_install', plugin: '' },
      { subtype: 'read_file', path: 'a.ts', max_bytes: 0 },
      { subtype: 'read_file', path: 'a.ts', encoding: 'latin1' },
      { subtype: 'list_directory' },
      { subtype: 'mcp_read_resource', server: 's' },
      { subtype: 'set_prompt_suggestions_paused', paused: 'true' },
      { subtype: 'set_has_subscribers', has_subscribers: 1 },
      { subtype: 'set_message_waiting' },
      { subtype: 'set_color', color: 123 },
      { subtype: 'dictate', action: '' },
      { subtype: 'dev_intent', intent: '' },
      { subtype: 'log_host_events', events: 'not-array' },
      { subtype: 'turn_handoff', action: 'invalid_action' },
      { subtype: 'turn_handoff', stopped: 'yes' },
      { subtype: 'turn_handoff', continues: 1 },
    ]

    for (const payload of invalidPayloads) {
      expect(SDKExtendedControlRequestSchema().safeParse(payload).success).toBe(
        false,
      )
      expect(SDKControlRequestInnerSchema().safeParse(payload).success).toBe(
        false,
      )
    }
  })
})

describe('Official 2.1.331 Desktop App multi-pane ui_* control schemas', () => {
  const validUiRequests: ReadonlyArray<{
    subtype: string
    [key: string]: unknown
  }> = [
    { subtype: 'ui_attach', surface: 'desktop', client_id: 'c1' },
    { subtype: 'ui_detach', client_id: 'c1' },
    { subtype: 'ui_pane_show', id: 'pane-diff', surface: 'desktop' },
    { subtype: 'ui_pane_focus', id: 'pane-diff' },
    { subtype: 'ui_panes', surface: 'desktop' },
    {
      subtype: 'ui_render',
      component: 'DiffView',
      instance_id: 'inst-1',
      props: { file: 'a.ts' },
    },
    {
      subtype: 'ui_toast',
      message: 'Saved!',
      level: 'success',
      duration_ms: 2500,
    },
    {
      subtype: 'ui_notify',
      id: 'notif-1',
      message: 'Build finished',
      level: 'info',
    },
    { subtype: 'ui_notify_cancel', id: 'notif-1' },
    { subtype: 'ui_status', status: 'ready', payload: { panes: 2 } },
    { subtype: 'ui_input', text: 'hello world' },
    { subtype: 'ui_press', key: 'Enter' },
    { subtype: 'ui_scroll', delta: -120 },
    { subtype: 'ui_select', index: 2, value: 'item-2' },
    { subtype: 'ui_focus', focused: true },
    { subtype: 'ui_close', id: 'pane-diff' },
    { subtype: 'ui_invalidate', id: 'pane-diff', reason: 'resize' },
    { subtype: 'ui_message', plugin: 'p1', data: { ok: true } },
    { subtype: 'ui_log', message: 'mounted', level: 'debug' },
    { subtype: 'ui_placed', id: 'pane-diff', bounds: { x: 0, y: 0 } },
    { subtype: 'ui_prompt_edit', text: 'draft', cursor: 5 },
    { subtype: 'ui_prompt_paint', decorations: [] },
    { subtype: 'ui_prompt_autocomplete', query: '@src', items: ['src/a.ts'] },
    { subtype: 'ui_client_module', plugin: 'p1', module: 'index.js' },
    { subtype: 'ui_client_press', plugin: 'p1', element: 'btn-1' },
    {
      subtype: 'ui_client_fault',
      plugin: 'p1',
      phase: 'render',
      reason: 'boom',
    },
  ]

  test('covers and parses every single DESKTOP_UI_CONTROL_SUBTYPES entry', () => {
    const covered = new Set(validUiRequests.map(req => String(req.subtype)))
    expect(covered.size).toBe(DESKTOP_UI_CONTROL_SUBTYPES.length)
    for (const subtype of DESKTOP_UI_CONTROL_SUBTYPES) {
      expect(covered.has(subtype)).toBe(true)
      expect(isDesktopUiControlSubtype(subtype)).toBe(true)
    }
    expect(isDesktopUiControlSubtype('get_status')).toBe(false)

    for (const payload of validUiRequests) {
      const parsedUi = DesktopUiControlRequestSchema().parse(payload)
      expect(String(parsedUi.subtype)).toBe(payload.subtype)

      const parsedInner = SDKControlRequestInnerSchema().parse(payload)
      expect(String(parsedInner.subtype)).toBe(payload.subtype)
    }
  })

  test('rejects malformed Desktop ui_* payloads', () => {
    const invalidUiPayloads: ReadonlyArray<Record<string, unknown>> = [
      { subtype: 'ui_pane_show', id: '' },
      { subtype: 'ui_pane_focus' },
      { subtype: 'ui_toast', message: 'x', duration_ms: -10 },
      { subtype: 'ui_toast', message: 'x', level: 'invalid-level' },
      { subtype: 'ui_notify' },
      { subtype: 'ui_notify_cancel', id: '' },
      { subtype: 'ui_input', text: 42 },
      { subtype: 'ui_press' },
      { subtype: 'ui_scroll', delta: 'down' },
      { subtype: 'ui_select', index: -1 },
      { subtype: 'ui_focus', focused: 'yes' },
      { subtype: 'ui_prompt_edit', cursor: -1 },
      { subtype: 'ui_unknown_surface_op' },
    ]

    for (const payload of invalidUiPayloads) {
      expect(DesktopUiControlRequestSchema().safeParse(payload).success).toBe(
        false,
      )
      expect(SDKControlRequestInnerSchema().safeParse(payload).success).toBe(
        false,
      )
    }
  })
})

describe('Official 2.1.331 SDKExtendedSystemEventSchema', () => {
  const base = {
    type: 'system' as const,
    uuid: '00000000-0000-4000-8000-000000000331',
    session_id: 'sess-331',
  }

  const validSystemEvents: ReadonlyArray<{
    subtype: string
    [key: string]: unknown
  }> = [
    { ...base, subtype: 'turn_handoff_available', worker_epoch: 2 },
    { ...base, subtype: 'turn_preempted', reason: 'user_interrupt' },
    {
      ...base,
      subtype: 'post_turn_summary',
      summarizes_uuid: 'u-1',
      status_category: 'completed',
      status_detail: 'done',
      is_noteworthy: true,
      title: 'Finished edits',
      description: 'Updated schemas',
      recent_action: 'edited files',
      needs_action: 'none',
      artifact_urls: [],
    },
    { ...base, subtype: 'away_summary', summary: '2 tasks finished' },
    { ...base, subtype: 'memory_recall', memory_paths: ['mem/a.md'], count: 1 },
    { ...base, subtype: 'memory_saved', memory_path: 'mem/b.md' },
    {
      ...base,
      subtype: 'model_fallback',
      trigger: 'model_not_found',
      original_model: 'model-a',
      fallback_model: 'model-b',
      content: 'fell back',
    },
    {
      ...base,
      subtype: 'model_consent_fallback',
      original_model: 'model-a',
      fallback_model: 'model-b',
    },
    {
      ...base,
      subtype: 'model_refusal_fallback',
      original_model: 'model-a',
      fallback_model: 'model-b',
    },
    { ...base, subtype: 'model_refusal_no_fallback', model: 'model-a' },
    {
      ...base,
      subtype: 'instruction_size_warning',
      path: 'CLAUDE.md',
      char_count: 50000,
      threshold: 40000,
    },
    { ...base, subtype: 'late_allow_not_run', tool_name: 'Bash' },
    {
      ...base,
      subtype: 'permission_check_status',
      status: 'checking',
      tool_name: 'Edit',
    },
    {
      ...base,
      subtype: 'permission_denied',
      tool_name: 'Bash',
      reason: 'rule',
    },
    { ...base, subtype: 'permission_retry', tool_name: 'Bash', attempt: 2 },
    {
      ...base,
      subtype: 'per_turn_effort_changed',
      effort: 'high',
      previous_effort: 'medium',
    },
    { ...base, subtype: 'background_tasks_changed', tasks: [] },
    {
      ...base,
      subtype: 'commands_changed',
      commands: [{ name: 'help', description: 'Show help' }],
    },
    { ...base, subtype: 'session_metadata', metadata: { env: 'cloud' } },
    { ...base, subtype: 'session_state_changed', state: 'running' },
    {
      ...base,
      subtype: 'session_title_changed',
      title: 'Fix tests',
      source: 'ai',
    },
    { ...base, subtype: 'session_writes_lost', lost_count: 1 },
    {
      ...base,
      subtype: 'vcs_state_changed',
      branch: 'main',
      head_sha: 'abc1234',
      dirty: false,
    },
    { ...base, subtype: 'shell_cwd', cwd: '/repo', previous_cwd: '/tmp' },
    {
      ...base,
      subtype: 'code_change_published',
      commit_sha: 'deadbeef',
      files_changed: ['src/a.ts'],
    },
    {
      ...base,
      subtype: 'cloud_session_delta',
      cloud_session_id: 'cs-1',
      delta: { status: 'active' },
    },
    {
      ...base,
      subtype: 'file_attachments_missing',
      missing_files: ['missing.png'],
    },
    {
      ...base,
      subtype: 'file_snapshot',
      message_id: 'm1',
      files: [{ path: 'a.ts', hash: 'h1' }],
    },
    {
      ...base,
      subtype: 'files_persisted',
      files: [{ filename: 'a.ts', file_id: 'f1' }],
      failed: [],
      processed_at: '2026-11-27T00:00:00Z',
    },
    {
      ...base,
      subtype: 'scheduled_task_fire',
      task_id: 'cron-1',
      schedule: '*/5 * * * *',
    },
    { ...base, subtype: 'peer_message_hold', peer_id: 'p1', held: true },
    {
      ...base,
      subtype: 'inherited_asks_settled',
      settled_count: 3,
      approved_count: 2,
      denied_count: 1,
    },
    { ...base, subtype: 'feedback_draft_queued', draft_id: 'draft-1' },
    { ...base, subtype: 'prompt_draft_activity', active: true, length: 42 },
    {
      ...base,
      subtype: 'message_rated',
      message_uuid: 'm-1',
      sentiment: 'positive',
      surface: 'assistant_text',
    },
    { ...base, subtype: 'mirror_error', error: 'disk full' },
    { ...base, subtype: 'informational', content: 'Connected', level: 'info' },
    { ...base, subtype: 'agents_killed', agent_ids: ['a1', 'a2'] },
    { ...base, subtype: 'api_error', error: 'rate_limit', error_status: 429 },
    {
      ...base,
      subtype: 'api_retry',
      attempt: 1,
      max_retries: 3,
      retry_delay_ms: 1000,
      error_status: 529,
      error: 'overloaded',
    },
    {
      ...base,
      subtype: 'task_list_statuses',
      tasks: [{ task_id: 't1', status: 'running' }],
    },
    { ...base, subtype: 'task_summary', detail: 'Running tests' },
    {
      ...base,
      subtype: 'thinking_tokens',
      estimated_tokens: 500,
      estimated_tokens_delta: 50,
    },
    {
      ...base,
      subtype: 'turn_duration',
      duration_ms: 1234,
      api_duration_ms: 900,
    },
  ]

  test('covers and parses every single SDK_EXTENDED_SYSTEM_SUBTYPES entry', () => {
    const covered = new Set(validSystemEvents.map(ev => String(ev.subtype)))
    expect(covered.size).toBe(SDK_EXTENDED_SYSTEM_SUBTYPES.length)
    for (const subtype of SDK_EXTENDED_SYSTEM_SUBTYPES) {
      expect(covered.has(subtype)).toBe(true)
    }

    for (const event of validSystemEvents) {
      const parsed = SDKExtendedSystemEventSchema().parse(event)
      expect(parsed.type).toBe('system')
      expect(String(parsed.subtype)).toBe(event.subtype)

      // R1-P1-2: SDKMessageSchema and StdoutMessageSchema accept every extended system event
      const parsedSdk = SDKMessageSchema().parse(event)
      expect(parsedSdk.type).toBe('system')
      const parsedStdout = StdoutMessageSchema().parse(event)
      expect(parsedStdout.type).toBe('system')
    }
  })

  test('rejects malformed system events', () => {
    expect(
      SDKExtendedSystemEventSchema().safeParse({
        ...base,
        subtype: 'turn_duration',
        duration_ms: -1,
      }).success,
    ).toBe(false)
    expect(
      SDKExtendedSystemEventSchema().safeParse({
        ...base,
        subtype: 'unknown_system_event',
      }).success,
    ).toBe(false)
    expect(
      SDKExtendedSystemEventSchema().safeParse({
        ...base,
        type: 'assistant',
        subtype: 'away_summary',
        summary: 'hi',
      }).success,
    ).toBe(false)
  })
})

describe('dispatchPrintControlExtra 2.1.331 handlers & multi-tenant isolation', () => {
  test('worker_shutting_down marks TurnHandoffManager shutdown when admitted and returns epoch', () => {
    const session = createMockSession('sess-shutdown-1')
    runWithSession(session, () => {
      resetTurnHandoffManager(session)
      const manager = getTurnHandoffManager(session)
      expect(manager.multiTenantShutdownAborted).toBe(false)

      const h = createHarness({ turnHandoffAdmission: { admitted: true } })
      const handled = dispatchPrintControlExtra(
        'worker_shutting_down',
        { reason: 'drain', grace_ms: 3000, worker_epoch: 7 },
        h.deps,
      )
      expect(handled).toBe(true)
      expect(h.errors).toHaveLength(0)
      expect(manager.multiTenantShutdownAborted).toBe(true)
      expect(h.successes).toEqual([
        {
          status: 'acknowledged',
          multi_tenant_worker_shutdown: true,
          worker_epoch: 7,
        },
      ])
    })
  })

  test('upgrade_relay_marker stores per-RootSession marker and shares with forks', () => {
    const sessionA = createMockSession('sess-relay-a')
    const sessionB = createMockSession('sess-relay-b')
    const forkA = sessionA.withProject({ cwd: '/tmp/project/sub' })

    runWithSession(sessionA, () => {
      resetUpgradedRelayMarker(sessionA)
      expect(getUpgradedRelayMarker(sessionA)).toBeUndefined()

      const bad = createHarness()
      expect(
        dispatchPrintControlExtra('upgrade_relay_marker', {}, bad.deps),
      ).toBe(true)
      expect(bad.errors[0]).toContain('marker')

      const h = createHarness()
      expect(
        dispatchPrintControlExtra(
          'upgrade_relay_marker',
          { marker: 'relay-marker-42', epoch: 5 },
          h.deps,
        ),
      ).toBe(true)
      expect(h.errors).toHaveLength(0)
      expect(h.successes).toEqual([
        { status: 'upgraded', marker: 'relay-marker-42', epoch: 5 },
      ])
      expect(getUpgradedRelayMarker(sessionA)).toBe('relay-marker-42')
      expect(getUpgradedRelayMarker(forkA)).toBe('relay-marker-42')
      expect(getUpgradedRelayMarker(sessionB)).toBeUndefined()
    })
  })

  test('get_status returns live session status on full trust and refuses remote transport', async () => {
    const session = createMockSession('sess-status-live')
    await runWithSession(session, async () => {
      resetTurnHandoffManager(session)
      getTurnHandoffManager(session).markMultiTenantWorkerShutdown()

      const hFull = createHarness({ controlConnectionTrustLevel: 'full' })
      expect(dispatchPrintControlExtra('get_status', {}, hFull.deps)).toBe(true)
      await hFull.flush()
      expect(hFull.errors).toHaveLength(0)
      expect(hFull.successes).toHaveLength(1)
      expect(hFull.successes[0]).toMatchObject({
        session_id: 'sess-status-live',
        worker_epoch: 0,
        multi_tenant_worker_shutdown: true,
        shared_backend: false,
      })

      const hRemote = createHarness({ isRemoteTransport: true })
      expect(dispatchPrintControlExtra('get_status', {}, hRemote.deps)).toBe(
        true,
      )
      expect(hRemote.errors[0]).toContain('not available on this connection')
      expect(hRemote.successes).toHaveLength(0)
    })
  })

  test('comparison_fork acknowledges by default and delegates per-SessionHost when registered', async () => {
    const sessionA = createMockSession('sess-fork-a')
    const sessionB = createMockSession('sess-fork-b')

    const defaultH = createHarness()
    runWithSession(sessionA, () => {
      expect(
        dispatchPrintControlExtra(
          'comparison_fork',
          { turn_id: 't1', model: 'claude-opus-4-6' },
          defaultH.deps,
        ),
      ).toBe(true)
    })
    expect(defaultH.successes).toEqual([
      {
        status: 'acknowledged',
        subtype: 'comparison_fork',
        turn_id: 't1',
        model: 'claude-opus-4-6',
      },
    ])

    const callsA: Array<{ subtype: string; turnId: unknown }> = []
    const unsubscribeA = runWithSession(sessionA, () =>
      registerPrintControlExtensionHandler(async (subtype, req) => {
        callsA.push({ subtype, turnId: req.turn_id })
        return { status: 'forked', fork_id: 'fork-from-A' }
      }),
    )

    try {
      const hA = createHarness()
      await runWithSession(sessionA, async () => {
        expect(
          dispatchPrintControlExtra(
            'comparison_fork',
            { turn_id: 'turn-A' },
            hA.deps,
          ),
        ).toBe(true)
        await hA.flush()
      })
      expect(callsA).toEqual([{ subtype: 'comparison_fork', turnId: 'turn-A' }])
      expect(hA.successes).toEqual([
        { status: 'forked', fork_id: 'fork-from-A' },
      ])

      // Session B has a distinct SessionHost and must NOT see Session A's handler
      const hB = createHarness()
      runWithSession(sessionB, () => {
        expect(
          dispatchPrintControlExtra(
            'comparison_fork',
            { turn_id: 'turn-B' },
            hB.deps,
          ),
        ).toBe(true)
      })
      expect(hB.successes).toEqual([
        {
          status: 'acknowledged',
          subtype: 'comparison_fork',
          turn_id: 'turn-B',
        },
      ])
    } finally {
      unsubscribeA()
    }
  })

  test('list_permission_rules returns active rules cleanly and respects trust levels', () => {
    const permContext = {
      mode: 'default',
      alwaysAllowRules: { session: ['Read', 'Bash(git status)'] },
      alwaysDenyRules: { policySettings: ['Bash(rm -rf)'] },
      alwaysAskRules: { userSettings: ['Write'] },
    }

    const hFull = createHarness({
      controlConnectionTrustLevel: 'full',
      getPermissionContext: () => permContext,
    })
    expect(
      dispatchPrintControlExtra(
        'list_permission_rules',
        { scope: 'session' },
        hFull.deps,
      ),
    ).toBe(true)
    expect(hFull.errors).toHaveLength(0)
    expect(hFull.successes[0]).toEqual({
      state: { context: permContext },
      rules: {
        allow: ['Read', 'Bash(git status)'],
        deny: ['Bash(rm -rf)'],
        ask: ['Write'],
      },
      scope: 'session',
    })

    const hRedacted = createHarness({
      controlConnectionTrustLevel: 'redacted',
      getPermissionContext: () => permContext,
    })
    expect(
      dispatchPrintControlExtra('list_permission_rules', {}, hRedacted.deps),
    ).toBe(true)
    expect(
      (hRedacted.successes[0]?.state as { withheld?: boolean })?.withheld,
    ).toBe(true)

    const hRefused = createHarness({
      controlConnectionTrustLevel: 'refused',
      getPermissionContext: () => permContext,
    })
    expect(
      dispatchPrintControlExtra('list_permission_rules', {}, hRefused.deps),
    ).toBe(true)
    expect(hRefused.errors[0]).toContain('not available on this connection')
  })

  test('ui_pane_show handles unattached surface gracefully and isolates handlers across two concurrent SessionHosts', async () => {
    const sessionHostA = createMockSession('sess-ui-host-a')
    const sessionHostB = createMockSession('sess-ui-host-b')

    // Without any UI handler attached -> graceful { handled: false, subtype }
    const unattached = createHarness()
    runWithSession(sessionHostA, () => {
      expect(
        dispatchPrintControlExtra(
          'ui_pane_show',
          { id: 'pane-1', surface: 'desktop' },
          unattached.deps,
        ),
      ).toBe(true)
    })
    expect(unattached.errors).toHaveLength(0)
    expect(unattached.successes).toEqual([
      { handled: false, subtype: 'ui_pane_show' },
    ])

    // Attach distinct handlers to Host A and Host B concurrently
    const seenA: Array<Record<string, unknown>> = []
    const seenB: Array<Record<string, unknown>> = []
    const unsubA = runWithSession(sessionHostA, () =>
      registerDesktopUiControlHandler((subtype, req) => {
        seenA.push({ subtype, ...req })
        return { handled: true, host: 'A', shown_id: req.id }
      }),
    )
    const unsubB = runWithSession(sessionHostB, () =>
      registerDesktopUiControlHandler(async (subtype, req) => {
        await Promise.resolve()
        seenB.push({ subtype, ...req })
        return { handled: true, host: 'B', shown_id: req.id }
      }),
    )

    try {
      const hA = createHarness()
      const hB = createHarness()

      await Promise.all([
        runWithSession(sessionHostA, async () => {
          expect(
            dispatchPrintControlExtra(
              'ui_pane_show',
              { id: 'pane-A', surface: 'desktop' },
              hA.deps,
            ),
          ).toBe(true)
          await hA.flush()
        }),
        runWithSession(sessionHostB, async () => {
          expect(
            dispatchPrintControlExtra(
              'ui_pane_show',
              { id: 'pane-B', surface: 'desktop' },
              hB.deps,
            ),
          ).toBe(true)
          await hB.flush()
        }),
      ])

      expect(seenA).toEqual([
        { subtype: 'ui_pane_show', id: 'pane-A', surface: 'desktop' },
      ])
      expect(seenB).toEqual([
        { subtype: 'ui_pane_show', id: 'pane-B', surface: 'desktop' },
      ])
      expect(hA.successes).toEqual([
        { handled: true, host: 'A', shown_id: 'pane-A' },
      ])
      expect(hB.successes).toEqual([
        { handled: true, host: 'B', shown_id: 'pane-B' },
      ])
    } finally {
      unsubA()
      unsubB()
    }

    // After unsubscribing, Host A falls back cleanly to { handled: false, subtype }
    const afterUnsub = createHarness()
    runWithSession(sessionHostA, () => {
      expect(
        dispatchPrintControlExtra(
          'ui_pane_show',
          { id: 'pane-after' },
          afterUnsub.deps,
        ),
      ).toBe(true)
    })
    expect(afterUnsub.successes).toEqual([
      { handled: false, subtype: 'ui_pane_show' },
    ])
  })

  test('Desktop ui_* control requests are refused when trustLevel is redacted or refused without invoking DesktopUiControlHandler (P1-4)', () => {
    const session = createMockSession('sess-ui-trust')
    let handlerCalls = 0
    const unsub = runWithSession(session, () =>
      registerDesktopUiControlHandler((subtype, req) => {
        handlerCalls += 1
        return { handled: true, subtype, id: req.id }
      }),
    )

    try {
      runWithSession(session, () => {
        for (const [subtype, payload] of [
          ['ui_pane_show', { id: 'pane-secret', surface: 'desktop' }],
          ['ui_input', { text: 'injected input' }],
        ] as const) {
          const hRedacted = createHarness({
            controlConnectionTrustLevel: 'redacted',
          })
          expect(
            dispatchPrintControlExtra(subtype, payload, hRedacted.deps),
          ).toBe(true)
          expect(hRedacted.successes).toHaveLength(0)
          expect(hRedacted.errors).toEqual([
            `${subtype} is not available on this connection`,
          ])

          const hRefused = createHarness({
            controlConnectionTrustLevel: 'refused',
          })
          expect(
            dispatchPrintControlExtra(subtype, payload, hRefused.deps),
          ).toBe(true)
          expect(hRefused.successes).toHaveLength(0)
          expect(hRefused.errors).toEqual([
            `${subtype} is not available on this connection`,
          ])

          const hRemote = createHarness({ isRemoteTransport: true })
          expect(
            dispatchPrintControlExtra(subtype, payload, hRemote.deps),
          ).toBe(true)
          expect(hRemote.successes).toHaveLength(0)
          expect(hRemote.errors).toEqual([
            `${subtype} is not available on this connection`,
          ])
        }

        expect(handlerCalls).toBe(0)

        // Full trust still dispatches to the registered handler
        const hFull = createHarness({ controlConnectionTrustLevel: 'full' })
        expect(
          dispatchPrintControlExtra(
            'ui_pane_show',
            { id: 'pane-ok', surface: 'desktop' },
            hFull.deps,
          ),
        ).toBe(true)
        expect(handlerCalls).toBe(1)
        expect(hFull.errors).toHaveLength(0)
        expect(hFull.successes).toEqual([
          { handled: true, subtype: 'ui_pane_show', id: 'pane-ok' },
        ])
      })
    } finally {
      unsub()
    }
  })

  test('worker_shutting_down, comparison_fork, and upgrade_relay_marker refuse on refused trust with zero state mutation (P2-4)', () => {
    const session = createMockSession('sess-refused-extras')
    let extHandlerCalls = 0
    const unsubExt = runWithSession(session, () =>
      registerPrintControlExtensionHandler(() => {
        extHandlerCalls += 1
        return { status: 'forked' }
      }),
    )

    try {
      runWithSession(session, () => {
        resetTurnHandoffManager(session)
        resetUpgradedRelayMarker(session)
        const manager = getTurnHandoffManager(session)
        expect(manager.multiTenantShutdownAborted).toBe(false)
        expect(getUpgradedRelayMarker(session)).toBeUndefined()

        const hShutdown = createHarness({
          controlConnectionTrustLevel: 'refused',
        })
        expect(
          dispatchPrintControlExtra(
            'worker_shutting_down',
            { reason: 'drain', worker_epoch: 9 },
            hShutdown.deps,
          ),
        ).toBe(true)
        expect(hShutdown.successes).toHaveLength(0)
        expect(hShutdown.errors).toEqual([
          'worker_shutting_down is not available on this connection',
        ])
        expect(manager.multiTenantShutdownAborted).toBe(false)

        const hFork = createHarness({
          controlConnectionTrustLevel: 'refused',
        })
        expect(
          dispatchPrintControlExtra(
            'comparison_fork',
            { turn_id: 'turn-refused', model: 'claude-sonnet-4-6' },
            hFork.deps,
          ),
        ).toBe(true)
        expect(hFork.successes).toHaveLength(0)
        expect(hFork.errors).toEqual([
          'comparison_fork is not available on this connection',
        ])
        expect(extHandlerCalls).toBe(0)

        const hMarker = createHarness({
          controlConnectionTrustLevel: 'refused',
        })
        expect(
          dispatchPrintControlExtra(
            'upgrade_relay_marker',
            { marker: 'spoofed-marker', epoch: 99 },
            hMarker.deps,
          ),
        ).toBe(true)
        expect(hMarker.successes).toHaveLength(0)
        expect(hMarker.errors).toEqual([
          'upgrade_relay_marker is not available on this connection',
        ])
        expect(getUpgradedRelayMarker(session)).toBeUndefined()
      })
    } finally {
      unsubExt()
    }
  })

  test('R1-P1-1: controlSchemas wire contracts match printControlExtras parsers verbatim', () => {
    const announcePayload = {
      subtype: 'remote_tools_announce' as const,
      instance_id: 'inst-wire-1',
      host: { name: 'workstation-1', epoch: 'ep-1', home_dir: '/home/u' },
      tools: [{ name: 'Read', protocol_versions: [1] }],
      passthrough: [{ name: 'mcp__srv__tool' }],
      plumbing: ['read_file'],
    }
    const parsedAnnounceSchema =
      SDKExtendedControlRequestSchema().parse(announcePayload)
    const parsedAnnounceRuntime = parseRemoteToolsAnnounce(
      parsedAnnounceSchema as Record<string, unknown>,
    )
    expect(parsedAnnounceRuntime.ok).toBe(true)

    const hintsPayload = {
      subtype: 'set_chrome_browser_hints' as const,
      localDeviceIds: ['dev-1', 'dev-2'],
      preferredDeviceId: 'dev-1',
      hostPlatform: 'darwin' as const,
    }
    const parsedHintsSchema =
      SDKExtendedControlRequestSchema().parse(hintsPayload)
    const parsedHintsRuntime = parseSetChromeBrowserHintsControlRequest(
      parsedHintsSchema as Record<string, unknown>,
    )
    expect(parsedHintsRuntime.ok).toBe(true)
  })

  test('R1-P1-11: turn_handoff rejects refused trust and worker_shutting_down requires admission or sharedBackend', () => {
    const session = createMockSession('sess-handoff-hardening')
    runWithSession(session, () => {
      resetTurnHandoffManager(session)
      const manager = getTurnHandoffManager(session)

      // 1. turn_handoff rejected on refused trust even if turnHandoffAdmission is admitted
      const hRefused = createHarness({
        controlConnectionTrustLevel: 'refused',
        turnHandoffAdmission: { admitted: true },
      })
      expect(
        dispatchPrintControlExtra(
          'turn_handoff',
          { action: 'export', session_id: 'sess-handoff-hardening' },
          hRefused.deps,
        ),
      ).toBe(true)
      expect(hRefused.successes).toHaveLength(0)
      expect(hRefused.errors).toEqual([
        'turn_handoff is not available on this connection',
      ])

      // 2. worker_shutting_down rejected without admission or sharedBackend -> zero mutation
      setSharedBackendMode(false)
      const hUnadmitted = createHarness()
      expect(
        dispatchPrintControlExtra(
          'worker_shutting_down',
          { reason: 'drain', worker_epoch: 5 },
          hUnadmitted.deps,
        ),
      ).toBe(true)
      expect(hUnadmitted.successes).toHaveLength(0)
      expect(hUnadmitted.errors[0]).toContain('turn_handoff_disabled:')
      expect(manager.multiTenantShutdownAborted).toBe(false)

      // 3. worker_shutting_down succeeds when sharedBackend is active on a managed cloud worker
      setSharedBackendMode(true)
      try {
        const hShared = createHarness({
          turnHandoffAdmission: { admitted: false, reason: 'shared_backend' },
        })
        expect(
          dispatchPrintControlExtra(
            'worker_shutting_down',
            { reason: 'scale_in', worker_epoch: 8 },
            hShared.deps,
          ),
        ).toBe(true)
        expect(hShared.errors).toHaveLength(0)
        expect(manager.multiTenantShutdownAborted).toBe(true)
      } finally {
        setSharedBackendMode(false)
      }
    })
  })
})
