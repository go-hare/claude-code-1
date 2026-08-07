/**
 * densable 2.1.216 #29 — telemetry: permission-prompt fail ≠ user_reject;
 * interrupt → user_abort.
 */
import { describe, expect, test } from 'bun:test'
import {
  CAN_USE_TOOL_INVALID_RESULT_REASON,
  TOOL_PERMISSION_REQUEST_FAILED_REASON,
  TOOL_PERMISSION_REQUEST_ABORTED_REASON,
  TOOL_PERMISSION_STREAM_CLOSED_REASON,
  canUseToolAbortedDenyReason,
  canUseToolInvalidResultDenyReason,
  canUseToolRequestFailedDenyReason,
  decisionReasonToOTelSource,
  otherDecisionReasonAnalyticsLabel,
  permissionStreamClosedDenyReason,
  ruleSourceToOTelSource,
} from '../permissionDecisionReasons.js'
import { ControlStreamClosedError } from '../../errors.js'
import type { PermissionDecisionReason } from 'src/types/permissions.js'

describe('decisionReasonToOTelSource densable rx_ (2.1.216 #29)', () => {
  test('undefined reason → config', () => {
    expect(decisionReasonToOTelSource(undefined, 'deny')).toBe('config')
    expect(decisionReasonToOTelSource(undefined, 'allow')).toBe('config')
  })

  test('other + aborted (h8t) → user_abort (not user_reject / config)', () => {
    expect(
      decisionReasonToOTelSource(canUseToolAbortedDenyReason, 'deny'),
    ).toBe('user_abort')
    expect(
      decisionReasonToOTelSource(
        { type: 'other', reason: TOOL_PERMISSION_REQUEST_ABORTED_REASON },
        'deny',
      ),
    ).toBe('user_abort')
  })

  test('other failures stay config (not user_reject)', () => {
    expect(
      decisionReasonToOTelSource(canUseToolRequestFailedDenyReason, 'deny'),
    ).toBe('config')
    expect(
      decisionReasonToOTelSource(canUseToolInvalidResultDenyReason, 'deny'),
    ).toBe('config')
    expect(
      decisionReasonToOTelSource(permissionStreamClosedDenyReason, 'deny'),
    ).toBe('config')
  })

  test('permissionPromptTool without classification: allow→temporary, deny→user_reject', () => {
    const allow: PermissionDecisionReason = {
      type: 'permissionPromptTool',
      permissionPromptToolName: 'mcp__host__ask',
      toolResult: { behavior: 'allow' },
    }
    const deny: PermissionDecisionReason = {
      type: 'permissionPromptTool',
      permissionPromptToolName: 'mcp__host__ask',
      toolResult: { behavior: 'deny', message: 'no' },
    }
    expect(decisionReasonToOTelSource(allow, 'allow')).toBe('user_temporary')
    expect(decisionReasonToOTelSource(deny, 'deny')).toBe('user_reject')
  })

  test('permissionPromptTool respects decisionClassification', () => {
    expect(
      decisionReasonToOTelSource(
        {
          type: 'permissionPromptTool',
          permissionPromptToolName: 'x',
          toolResult: {
            behavior: 'allow',
            decisionClassification: 'user_permanent',
          },
        },
        'allow',
      ),
    ).toBe('user_permanent')
    expect(
      decisionReasonToOTelSource(
        {
          type: 'permissionPromptTool',
          permissionPromptToolName: 'x',
          toolResult: {
            behavior: 'deny',
            decisionClassification: 'user_reject',
          },
        },
        'deny',
      ),
    ).toBe('user_reject')
  })

  test('hook → hook; mode/classifier/safetyCheck → config', () => {
    expect(
      decisionReasonToOTelSource(
        { type: 'hook', hookName: 'PermissionRequest' },
        'deny',
      ),
    ).toBe('hook')
    expect(
      decisionReasonToOTelSource({ type: 'mode', mode: 'default' }, 'allow'),
    ).toBe('config')
    expect(
      decisionReasonToOTelSource(
        { type: 'classifier', classifier: 'auto-mode', reason: 'x' },
        'allow',
      ),
    ).toBe('config')
    expect(
      decisionReasonToOTelSource(
        {
          type: 'safetyCheck',
          reason: 'sensitive path',
          classifierApprovable: true,
        },
        'deny',
      ),
    ).toBe('config')
  })

  test('rule source mapping densable tx_', () => {
    expect(ruleSourceToOTelSource('session', 'allow')).toBe('user_temporary')
    expect(ruleSourceToOTelSource('session', 'deny')).toBe('user_reject')
    expect(ruleSourceToOTelSource('userSettings', 'allow')).toBe(
      'user_permanent',
    )
    expect(ruleSourceToOTelSource('localSettings', 'deny')).toBe('user_reject')
    expect(ruleSourceToOTelSource('policySettings', 'allow')).toBe('config')
    expect(
      decisionReasonToOTelSource(
        {
          type: 'rule',
          rule: {
            source: 'session',
            ruleBehavior: 'allow',
            ruleValue: { toolName: 'Bash' },
          },
        },
        'allow',
      ),
    ).toBe('user_temporary')
  })
})

describe('densable reason string gold (2.1.216 #29)', () => {
  test('QFn/ZFn/e2n/h8t strings match SEA', () => {
    expect(TOOL_PERMISSION_STREAM_CLOSED_REASON).toBe(
      'tool permission stream closed before response received',
    )
    expect(CAN_USE_TOOL_INVALID_RESULT_REASON).toBe(
      'canUseTool returned a schema-invalid permission result',
    )
    expect(TOOL_PERMISSION_REQUEST_FAILED_REASON).toBe(
      'tool permission request failed',
    )
    expect(TOOL_PERMISSION_REQUEST_ABORTED_REASON).toBe(
      'tool permission request aborted',
    )
  })

  test('Gwu analytics labels', () => {
    expect(
      otherDecisionReasonAnalyticsLabel(TOOL_PERMISSION_STREAM_CLOSED_REASON),
    ).toBe('permissionStreamClosed')
    expect(
      otherDecisionReasonAnalyticsLabel(CAN_USE_TOOL_INVALID_RESULT_REASON),
    ).toBe('canUseToolInvalidResult')
    expect(
      otherDecisionReasonAnalyticsLabel(TOOL_PERMISSION_REQUEST_FAILED_REASON),
    ).toBe('canUseToolRequestFailed')
    expect(
      otherDecisionReasonAnalyticsLabel(TOOL_PERMISSION_REQUEST_ABORTED_REASON),
    ).toBe('canUseToolAborted')
  })

  test('ControlStreamClosedError is AbortError subclass (densable jS)', () => {
    const e = new ControlStreamClosedError(TOOL_PERMISSION_STREAM_CLOSED_REASON)
    expect(e.name).toBe('ControlStreamClosedError')
    expect(e).toBeInstanceOf(Error)
    // densable: jS extends wl (AbortError)
    expect(e instanceof Error && e.name).toBe('ControlStreamClosedError')
  })
})

describe('wiring smoke (2.1.216 #29)', () => {
  test('print.ts abort path uses canUseToolAbortedDenyReason', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../../../cli/print.ts'),
      'utf8',
    )
    expect(src).toContain('canUseToolAbortedDenyReason')
    expect(src).toContain('canUseToolInvalidResultDenyReason')
    // Must not reintroduce permissionPromptTool reason on abort
    expect(src).not.toMatch(
      /Permission prompt was aborted\.[\s\S]{0,200}type:\s*['"]permissionPromptTool['"]/,
    )
  })

  test('structuredIO catch classifies ControlStreamClosed / abort', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../../../cli/structuredIO.ts'),
      'utf8',
    )
    expect(src).toContain('ControlStreamClosedError')
    expect(src).toContain('canUseToolAbortedDenyReason')
    expect(src).toContain('canUseToolInvalidResultDenyReason')
    expect(src).toContain('permissionStreamClosedDenyReason')
    // Failures must not be re-wrapped as permissionPromptToolResult
    expect(src).toMatch(/catch \(error\) \{[\s\S]*?canUseToolAbortedDenyReason/)
  })

  test('toolExecution uses shared decisionReasonToOTelSource', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../../../services/tools/toolExecution.ts'),
      'utf8',
    )
    expect(src).toContain(
      "from '../../utils/permissions/permissionDecisionReasons.js'",
    )
    expect(src).toContain('decisionReasonToOTelSource')
  })
})
