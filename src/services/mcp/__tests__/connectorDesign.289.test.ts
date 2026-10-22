import { describe, expect, test } from 'bun:test'
import {
  applyConnectorDesignMembership,
  connectorDesignOmitsPersistentAllow,
  connectorDesignTokenlessWriteDeny,
  isFirstPartyDesignMcpServer,
} from '../connectorDesign.js'

const DESIGN_URL = 'https://api.anthropic.com/v1/design/mcp'
const TOKENLESS_MESSAGE =
  'writing without a plan_token is available only through the native Claude Design tool — call finalize_plan with writes (and deletes if needed), then pass the returned plan_token.'
const TOKENLESS_REASON =
  'tokenless design writes are native-tool-only — this connector surface has no reserved-path or grant-approval flow'

describe('isFirstPartyDesignMcpServer (gold jo)', () => {
  test('http and sse design URLs without Authorization', () => {
    expect(isFirstPartyDesignMcpServer({ type: 'http', url: DESIGN_URL })).toBe(
      true,
    )
    expect(isFirstPartyDesignMcpServer({ type: 'sse', url: DESIGN_URL })).toBe(
      true,
    )
  })

  test('rejects auth headers, other transports, hosts, and paths', () => {
    expect(
      isFirstPartyDesignMcpServer({
        type: 'http',
        url: DESIGN_URL,
        headers: { Authorization: 'Bearer x' },
      }),
    ).toBe(false)
    expect(
      isFirstPartyDesignMcpServer({
        type: 'http',
        url: DESIGN_URL,
        headers: { authorization: 'Bearer x' },
      }),
    ).toBe(false)
    expect(
      isFirstPartyDesignMcpServer({
        type: 'claudeai-proxy',
        url: DESIGN_URL,
      }),
    ).toBe(false)
    expect(
      isFirstPartyDesignMcpServer({
        type: 'http',
        url: 'http://api.anthropic.com/v1/design/mcp',
      }),
    ).toBe(false)
    expect(
      isFirstPartyDesignMcpServer({
        type: 'http',
        url: 'https://claude.ai/v1/design/mcp',
      }),
    ).toBe(false)
    expect(
      isFirstPartyDesignMcpServer({
        type: 'http',
        url: 'https://api.anthropic.com/v1/mcp',
      }),
    ).toBe(false)
    expect(
      isFirstPartyDesignMcpServer({
        type: 'http',
        url: 'https://api.anthropic.com:8443/v1/design/mcp',
      }),
    ).toBe(false)
    expect(
      isFirstPartyDesignMcpServer({ type: 'stdio', url: DESIGN_URL }),
    ).toBe(false)
  })
})

describe('connectorDesignTokenlessWriteDeny (gold Gr/Ui)', () => {
  test('denies tokenless write_files, create_support_js, and copy_files', () => {
    for (const operation of [
      'write_files',
      'create_support_js',
      'copy_files',
    ]) {
      const denied = connectorDesignTokenlessWriteDeny(true, operation, {
        project_id: 'p1',
      })
      expect(denied).toEqual({
        behavior: 'deny',
        message: `${operation}: ${TOKENLESS_MESSAGE}`,
        decisionReason: {
          type: 'safetyCheck',
          reason: TOKENLESS_REASON,
          classifierApprovable: false,
        },
      })
    }
  })

  test('a non-empty plan_token is not a tokenless write', () => {
    expect(
      connectorDesignTokenlessWriteDeny(true, 'write_files', {
        project_id: 'p1',
        plan_token: 'plan_tok',
      }),
    ).toBeNull()
  })

  test('empty plan_token still denies', () => {
    expect(
      connectorDesignTokenlessWriteDeny(true, 'write_files', {
        plan_token: '',
      })?.behavior,
    ).toBe('deny')
  })

  test('flag off or ops outside Ho do not deny', () => {
    expect(
      connectorDesignTokenlessWriteDeny(false, 'write_files', {}),
    ).toBeNull()
    for (const operation of [
      'finalize_plan',
      'delete_files',
      'add_member',
      'get_project',
    ]) {
      expect(
        connectorDesignTokenlessWriteDeny(true, operation, {
          project_id: 'p1',
        }),
      ).toBeNull()
    }
  })
})

describe('connector persistent allow (gold Kr / yo)', () => {
  test('second set includes finalize_plan, delete_files, and membership', () => {
    for (const operation of [
      'write_files',
      'create_support_js',
      'copy_files',
      'finalize_plan',
      'delete_files',
      'update_sharing',
      'add_member',
      'update_member_role',
    ]) {
      expect(connectorDesignOmitsPersistentAllow(true, operation)).toBe(true)
    }
    expect(connectorDesignOmitsPersistentAllow(true, 'get_project')).toBe(false)
    expect(connectorDesignOmitsPersistentAllow(false, 'finalize_plan')).toBe(
      false,
    )
  })

  test('membership note does not run when the flag is off', () => {
    const calls: unknown[] = []
    applyConnectorDesignMembership(
      false,
      'update_member_role',
      { project_id: 'p1' },
      (operation, projectId) => {
        calls.push([operation, projectId])
      },
    )
    expect(calls).toEqual([])
    applyConnectorDesignMembership(
      true,
      'update_sharing',
      { project_id: 'p1' },
      (operation, projectId) => {
        calls.push([operation, projectId])
      },
    )
    expect(calls).toEqual([['update_sharing', 'p1']])
  })
})
