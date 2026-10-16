import { afterEach, describe, expect, test } from 'bun:test'

import {
  designConsentRetryAction,
  getDesignConsentPrompt,
  seedDesignConsentCache,
} from 'src/services/designConsent.js'
import { getSessionId } from 'src/bootstrap/state.js'
import {
  designSessionState,
  parseProjectCard,
  recordFinalizedDesignPlan,
  resetDesignProjectGrantForTests,
  seedDesignGrantProbe,
  seedDesignProjectCard,
} from 'src/services/designProjectGrant.js'
import { ToolStateSlots } from 'src/utils/toolState.js'
import {
  ClaudeDesignTool,
  needsDesignScopesMessage,
} from '../ClaudeDesignTool.js'
import { CLAUDE_DESIGN_TOOL_NAME } from '../prompt.js'
import {
  recordDiscoveredOperationHints,
  resetDiscoveredOperationHints,
  validateWriteOpArgs,
} from '../validateArguments.js'

let sessionSlots: ToolStateSlots | undefined

function session() {
  sessionSlots ??= new ToolStateSlots()
  return designSessionState({ toolState: sessionSlots })
}

function mainGrantContext(mode = 'default', permissionHook = false) {
  const sessionHooks = new Map<string, { hooks: Record<string, unknown> }>()
  if (permissionHook) {
    sessionHooks.set(getSessionId(), {
      hooks: { PermissionRequest: [{ matcher: '*' }] },
    })
  }
  sessionSlots ??= new ToolStateSlots()
  return {
    agentContext: { agentType: 'main' },
    toolState: sessionSlots,
    getAppState: () => ({
      toolPermissionContext: { mode },
      sessionHooks,
    }),
  } as never
}

const CARD = (name: string, url: string) =>
  JSON.stringify({
    name,
    sharing: { scope: 'invited' },
    url,
  })

describe('gold 2.1.289 ClaudeDesign tool', () => {
  afterEach(() => {
    sessionSlots = undefined
    seedDesignConsentCache(null)
    resetDesignProjectGrantForTests()
  })

  test('wire name is ClaudeDesign', () => {
    expect(ClaudeDesignTool.name).toBe(CLAUDE_DESIGN_TOOL_NAME)
    expect(CLAUDE_DESIGN_TOOL_NAME).toBe('ClaudeDesign')
  })

  test('list is read-only; write_files is not', () => {
    expect(
      ClaudeDesignTool.isReadOnly({ operation: 'list', arguments: {} }),
    ).toBe(true)
    expect(
      ClaudeDesignTool.isReadOnly({
        operation: 'write_files',
        arguments: {},
      }),
    ).toBe(false)
  })

  test('WRITE_OP_SCHEMAS rejects an unknown write-tier operation', () => {
    expect(validateWriteOpArgs('mint_grant', { project_id: 'p1' })).toContain(
      'unrecognized operation',
    )
    expect(validateWriteOpArgs('mint_grant', { project_id: 'p1' })).toContain(
      'WRITE_OP_SCHEMAS',
    )
  })

  test('WRITE_OP_SCHEMAS rejects a discovered write op without a local schema', () => {
    resetDiscoveredOperationHints()
    recordDiscoveredOperationHints([
      {
        name: 'brand_new_write',
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
    ])
    expect(validateWriteOpArgs('brand_new_write', {})).toContain(
      "can't validate its arguments (it needs a WRITE_OP_SCHEMAS entry)",
    )
    resetDiscoveredOperationHints()
  })

  test('finalize_plan scope project rejects writes/deletes', () => {
    expect(
      validateWriteOpArgs('finalize_plan', {
        project_id: 'abc',
        scope: 'project',
        writes: ['index.html'],
      }),
    ).toBe(
      'ClaudeDesign finalize_plan: scope "project" takes no writes/deletes — a project-scoped plan covers every path in the project.',
    )
  })

  test('write_files content field suggests data', () => {
    expect(
      validateWriteOpArgs('write_files', {
        project_id: 'p1',
        files: [{ path: 'a.html', content: '<p/>' }],
      }),
    ).toContain("did you mean 'data'?")
  })

  test('validateInput requires finalize_plan project_id charset and length', async () => {
    const missing = await ClaudeDesignTool.validateInput!({
      operation: 'finalize_plan',
      arguments: {},
    })
    expect(missing).toMatchObject({ result: false, errorCode: 1 })
    expect(missing.message).toContain('project_id is required')

    const charset = await ClaudeDesignTool.validateInput!({
      operation: 'finalize_plan',
      arguments: { project_id: 'bad/id' },
    })
    expect(charset.result).toBe(false)
    expect(charset.message).toContain('charset')

    const tooLong = await ClaudeDesignTool.validateInput!({
      operation: 'finalize_plan',
      arguments: { project_id: 'a'.repeat(79) },
    })
    expect(tooLong.result).toBe(false)
    expect(tooLong.message).toContain('longer than any server-issued')

    const ok = await ClaudeDesignTool.validateInput!({
      operation: 'finalize_plan',
      arguments: { project_id: 'proj_1.ok-id', writes: ['a.html'] },
    })
    expect(ok).toEqual({ result: true })
  })

  test('checkPermissions denies tokenless copy_files and project-scope finalize_plan', async () => {
    const copy = await ClaudeDesignTool.checkPermissions!(
      { operation: 'copy_files', arguments: { project_id: 'p1' } },
      {} as never,
    )
    expect(copy.behavior).toBe('deny')
    expect((copy as { message?: string }).message).toContain(
      'copying without a plan_token',
    )

    const scope = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'finalize_plan',
        arguments: { project_id: 'p1', scope: 'project' },
      },
      {} as never,
    )
    expect(scope.behavior).toBe('deny')
    expect((scope as { message?: string }).message).toContain(
      'no longer supported',
    )
  })

  test('checkPermissions asks consent for write ops', async () => {
    seedDesignConsentCache(false)
    const ask = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: { project_id: 'p1', files: [{ path: 'a.html', data: 'x' }] },
      },
      {} as never,
    )
    expect(ask.behavior).toBe('ask')
    expect((ask as { message?: string }).message).toContain(
      getDesignConsentPrompt(),
    )
    expect((ask as { message?: string }).message).toContain(
      'Connect to Claude Design?',
    )
    const updated = (ask as { updatedInput?: Record<string, unknown> })
      .updatedInput
    expect(updated?.__consentBitShown).toBe('agent_design_projects')
    expect(updated?.__projectGrantAskShown).toBeUndefined()
    expect(updated?.__projectGrantServerObserved).toBeUndefined()
    expect(updated?.__reservedTargetsAskShown).toBeUndefined()
    expect(updated?.__finalizePlanAskShown).toBeUndefined()
    expect(
      (ask as { decisionReason?: { reason?: string } }).decisionReason?.reason,
    ).toBe(
      'design agent consent — approving records a server-side grant for Claude agents to read and write your design projects',
    )
  })

  test('a granted consent bit does not ask again and does not stamp the bit', async () => {
    seedDesignConsentCache(true)
    const ask = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: { project_id: 'p1', files: [{ path: 'a.html', data: 'x' }] },
      },
      {} as never,
    )
    expect(ask.behavior).toBe('deny')
    expect((ask as { message?: string }).message).toContain(
      'not available in subagent or PermissionRequest-hook sessions',
    )
    expect((ask as { message?: string }).message).not.toContain(
      'Connect to Claude Design?',
    )
  })

  test('a main-thread write with consent asks for the durable project grant', async () => {
    seedDesignConsentCache(true)
    seedDesignGrantProbe([])
    seedDesignProjectCard({
      name: 'Site',
      sharingLabel: 'private: invited members only',
      url: 'https://claude.ai/design/p/p1',
    })
    const ask = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: { project_id: 'p1', files: [{ path: 'a.html', data: 'x' }] },
      },
      {
        agentContext: { agentType: 'main' },
        getAppState: () => ({
          toolPermissionContext: { mode: 'default' },
        }),
      } as never,
    )
    expect(ask.behavior).toBe('ask')
    expect((ask as { message?: string }).message).toContain(
      'lets Claude write to ANY file in the project "Site"',
    )
    const updated = (ask as { updatedInput?: Record<string, unknown> })
      .updatedInput
    expect(updated?.__projectGrantAskShown).toBe('p1')
    expect(updated?.__projectGrantServerObserved).toBeUndefined()
    expect(updated?.__reservedTargetsAskShown).toBeUndefined()
    expect(updated?.__finalizePlanAskShown).toBeUndefined()
    expect(updated?.__consentBitShown).toBeNull()
    expect(
      (ask as { serverApprovalWatch?: { kind: string; projectId: string } })
        .serverApprovalWatch,
    ).toEqual({ kind: 'design_project_grant', projectId: 'p1' })
  })

  test('a missing consent bit denies an empty write batch before the prompt', async () => {
    seedDesignConsentCache(false)
    const ask = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: { project_id: 'p1', files: [] },
      },
      {} as never,
    )
    expect(ask.behavior).toBe('deny')
    expect((ask as { message?: string }).message).toContain(
      'names no target paths',
    )
    expect((ask as { message?: string }).message).not.toContain(
      'Connect to Claude Design?',
    )
  })

  test('a missing consent bit denies a reserved path before the prompt', async () => {
    seedDesignConsentCache(false)
    const ask = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          files: [{ path: 'claude.md', data: 'x' }],
        },
      },
      {} as never,
    )
    expect(ask.behavior).toBe('deny')
    expect((ask as { message?: string }).message).toContain(
      'always require per-batch approval',
    )
  })

  test('a missing consent bit asks before a read', async () => {
    seedDesignConsentCache(false)
    const ask = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'read_file',
        arguments: { project_id: 'p1', path: 'a.html' },
      },
      {} as never,
    )
    expect(ask.behavior).toBe('ask')
    expect((ask as { message?: string }).message).toContain(
      'Connect to Claude Design?',
    )
    seedDesignConsentCache(true)
    const allowed = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'read_file',
        arguments: { project_id: 'p1', path: 'a.html' },
      },
      {} as never,
    )
    expect(allowed.behavior).toBe('allow')
    const allowedInput = (allowed as { updatedInput?: Record<string, unknown> })
      .updatedInput
    expect(allowedInput?.__projectGrantAskShown).toBeUndefined()
    expect(allowedInput?.__projectGrantServerObserved).toBeUndefined()
    expect(allowedInput?.__reservedTargetsAskShown).toBeUndefined()
    expect(allowedInput?.__finalizePlanAskShown).toBeUndefined()
  })

  test('checkPermissions zeros injected grant stamps on the updated input', async () => {
    seedDesignConsentCache(true)
    const allowed = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'read_file',
        arguments: { project_id: 'p1', path: 'a.html' },
        __projectGrantAskShown: 'injected',
        __projectGrantServerObserved: true,
        __reservedTargetsAskShown: true,
        __finalizePlanAskShown: true,
      } as never,
      {} as never,
    )
    expect(allowed.behavior).toBe('allow')
    const updated = (allowed as { updatedInput?: Record<string, unknown> })
      .updatedInput
    expect(updated?.__projectGrantAskShown).toBeUndefined()
    expect(updated?.__projectGrantServerObserved).toBeUndefined()
    expect(updated?.__reservedTargetsAskShown).toBeUndefined()
    expect(updated?.__finalizePlanAskShown).toBeUndefined()

    seedDesignConsentCache(true)
    const finalize = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'finalize_plan',
        arguments: { project_id: 'p1', writes: ['a.html'] },
        __projectGrantAskShown: 'injected',
        __reservedTargetsAskShown: true,
      } as never,
      {} as never,
    )
    expect(finalize.behavior).toBe('ask')
    const asked = (finalize as { updatedInput?: Record<string, unknown> })
      .updatedInput
    expect(asked?.__finalizePlanAskShown).toBe(true)
    expect(asked?.__projectGrantAskShown).toBeUndefined()
    expect(asked?.__reservedTargetsAskShown).toBeUndefined()
    expect(asked?.__projectGrantServerObserved).toBeUndefined()
  })

  test('needs_consent posts only after the shown bit was approved', () => {
    expect(
      designConsentRetryAction({
        shown: 'agent_design_projects',
        askCanReachUser: true,
        bodyConsent: 'agent_design_projects',
      }),
    ).toBe('post_and_retry')
    expect(
      designConsentRetryAction({
        shown: null,
        askCanReachUser: true,
        bodyConsent: 'agent_design_projects',
      }),
    ).toBe('not_shown')
    expect(
      designConsentRetryAction({
        shown: 'agent_design_projects',
        askCanReachUser: false,
        bodyConsent: 'agent_design_projects',
      }),
    ).toBe('no_prompt')
  })

  test('parseProjectCard rejects spoof marks in the name and URL', () => {
    const url = 'https://claude.ai/design/p/p1'
    expect(parseProjectCard(CARD('Site', url), 'p1')).toEqual({
      name: 'Site',
      sharingLabel: 'private: invited members only',
      url,
    })
    expect(parseProjectCard(CARD('Site\u200D', url), 'p1')).toBeNull()
    expect(parseProjectCard(CARD('Site\uDB40\uDC20', url), 'p1')).toBeNull()
    expect(
      parseProjectCard(
        CARD('Site', 'https://claude.ai/design\uFE0F/p/p1'),
        'p1',
      ),
    ).toBeNull()
  })

  test('an approved plan allows the listed write and delete', async () => {
    seedDesignConsentCache(true)
    seedDesignGrantProbe([])
    expect(
      recordFinalizedDesignPlan(session(), 'tok', {
        projectId: 'p1',
        writes: ['foo/bar.html'],
        deletes: ['gone.html'],
      }),
    ).toBe(true)
    const write = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          plan_token: 'tok',
          files: [{ path: 'foo/./bar.html', data: 'x' }],
        },
      },
      mainGrantContext(),
    )
    expect(write.behavior).toBe('allow')
    const slash = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          plan_token: 'tok',
          files: [{ path: 'foo\\bar.html', data: 'x' }],
        },
      },
      mainGrantContext(),
    )
    expect(slash.behavior).toBe('allow')
    const removed = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'delete_files',
        arguments: {
          project_id: 'p1',
          plan_token: 'tok',
          paths: ['gone.html'],
        },
      },
      mainGrantContext(),
    )
    expect(removed.behavior).toBe('allow')
    const other = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          plan_token: 'tok',
          files: [{ path: 'nope.html', data: 'x' }],
        },
      },
      mainGrantContext(),
    )
    expect(other.behavior).toBe('ask')
  })

  test('plan mode and a PermissionRequest hook do not take the plan allow', async () => {
    seedDesignConsentCache(true)
    seedDesignGrantProbe([])
    recordFinalizedDesignPlan(session(), 'tok', {
      projectId: 'p1',
      writes: ['a.html'],
      deletes: [],
    })
    const planMode = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          plan_token: 'tok',
          files: [{ path: 'a.html', data: 'x' }],
        },
      },
      mainGrantContext('plan'),
    )
    expect(planMode.behavior).toBe('ask')
    const hooked = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          files: [{ path: 'a.html', data: 'x' }],
        },
      },
      mainGrantContext('default', true),
    )
    expect(hooked.behavior).toBe('deny')
    expect((hooked as { message?: string }).message).toContain(
      'not available in subagent or PermissionRequest-hook sessions',
    )
  })

  test('an expired approved plan is not reused', async () => {
    seedDesignConsentCache(true)
    seedDesignGrantProbe([])
    recordFinalizedDesignPlan(
      session(),
      'tok',
      {
        projectId: 'p1',
        writes: ['a.html'],
        deletes: [],
        serverExpiresAtMs: 1_000,
      },
      0,
    )
    const expired = await ClaudeDesignTool.checkPermissions!(
      {
        operation: 'write_files',
        arguments: {
          project_id: 'p1',
          plan_token: 'tok',
          files: [{ path: 'a.html', data: 'x' }],
        },
      },
      mainGrantContext(),
    )
    expect(expired.behavior).toBe('ask')
  })

  test('403 needs_design_scopes messages', () => {
    expect(needsDesignScopesMessage(false)).toBe(
      "Claude Design rejected this session's claude.ai credential (HTTP 403): it does not carry Claude Design access. Run /design login to authorize Claude Design, then retry.",
    )
    expect(needsDesignScopesMessage(true)).toContain(
      '/design login cannot run in this non-interactive session',
    )
  })
})
