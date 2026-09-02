/**
 * densable waitingFor / y2A — Host open-stack status text.
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  clearPermissionConfirms,
  registerPermissionConfirm,
} from '../permissionConfirmRegistry.js'
import {
  GOLD_Y2A_WAITING,
  resolveHostWaitingFor,
} from '../permissionWaiting.js'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import { PERMISSION_ASK_USER_QUESTION_KIND } from '../specs/permissionKinds.js'
import { GOAL_PROPOSAL_KIND } from '../specs/jsuKinds.js'

const replSrc = readFileSync(
  join(import.meta.dir, '../../screens/REPL.tsx'),
  'utf8',
)
const messagesSrc = readFileSync(
  join(import.meta.dir, '../../components/Messages.tsx'),
  'utf8',
)

function fakeConfirm(partial: {
  toolUseID: string
  toolName: string
  input?: Record<string, unknown>
}): ToolUseConfirm {
  return {
    toolUseID: partial.toolUseID,
    tool: {
      name: partial.toolName,
      userFacingName: () => partial.toolName,
    },
    input: partial.input ?? {},
  } as unknown as ToolUseConfirm
}

describe('resolveHostWaitingFor (densable y2A)', () => {
  beforeEach(() => clearPermissionConfirms())
  afterEach(() => clearPermissionConfirms())

  test('y2A exact strings', () => {
    expect(GOLD_Y2A_WAITING[PERMISSION_ASK_USER_QUESTION_KIND]).toBe(
      'input needed',
    )
    expect(resolveHostWaitingFor(PERMISSION_ASK_USER_QUESTION_KIND, {})).toBe(
      'input needed',
    )
    expect(resolveHostWaitingFor(GOAL_PROPOSAL_KIND, {})).toBe('goal proposal')
    expect(resolveHostWaitingFor('refusal_fallback_prompt', {})).toBe(
      'dialog open',
    )
    expect(resolveHostWaitingFor('sandbox_network_access', {})).toBe(
      'sandbox request',
    )
    expect(resolveHostWaitingFor('mcp_url_elicitation', {})).toBe(
      'input needed',
    )
  })

  test('managed / soft → dialog open', () => {
    expect(resolveHostWaitingFor('managed_settings_security', {})).toBe(
      'dialog open',
    )
    expect(resolveHostWaitingFor('cost_threshold', {})).toBe('dialog open')
  })

  test('permission_* P1u approve via registry', () => {
    registerPermissionConfirm(
      fakeConfirm({
        toolUseID: 'tu-1',
        toolName: 'Bash',
        input: { command: 'ls -la' },
      }),
    )
    expect(
      resolveHostWaitingFor('permission_bash', {
        requestId: 'tu-1',
        toolName: 'Bash',
      }),
    ).toBe('approve Bash: ls -la')
  })

  test('ExitPlanMode → approve plan', () => {
    expect(
      resolveHostWaitingFor('permission_exit_plan_mode_v2', {
        toolName: 'ExitPlanModeV2',
      }),
    ).toBe('approve plan')
  })

  test('ask is never approve AskUserQuestion', () => {
    expect(
      resolveHostWaitingFor(PERMISSION_ASK_USER_QUESTION_KIND, {
        toolName: 'AskUserQuestion',
      }),
    ).toBe('input needed')
  })
})

describe('REPL Host waitingFor wiring', () => {
  test('uses resolveHostWaitingFor / y2A', () => {
    expect(replSrc).toContain('resolveHostWaitingFor')
    expect(replSrc).toContain('hostWaiting')
    expect(replSrc).not.toContain('toolUseConfirmQueue.length > 0')
  })

  test('Messages has no toolUseConfirmQueue prop', () => {
    expect(messagesSrc).not.toContain('toolUseConfirmQueue')
    expect(replSrc).toContain('suppressMessageAnimation={')
    expect(replSrc).not.toContain('toolUseConfirmQueue={')
  })

  test('DialogHost owns P1u permission bg emit (not REPL queue)', () => {
    const hostSrc = readFileSync(
      join(import.meta.dir, '../DialogHost.tsx'),
      'utf8',
    )
    expect(hostSrc).toContain('resolveHostWaitingFor')
    expect(hostSrc).toContain("emitBgNeedsInput(label, 'permission')")
    expect(replSrc).not.toContain("emitBgNeedsInput(hostLabel, 'permission')")
    expect(replSrc).toContain(
      'densable P1u permission needs emit lives on DialogHost',
    )
  })
})
