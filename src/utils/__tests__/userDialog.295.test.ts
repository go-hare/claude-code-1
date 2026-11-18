import { describe, expect, test } from 'bun:test'
import {
  formatMcpPermissionDisplayName,
  buildUserDialogBlockedSummary,
} from '../userDialog.js'

describe('2.1.295 #445 MCP permission display name', () => {
  test('formatMcpPermissionDisplayName formats server and title-cased tool', () => {
    expect(
      formatMcpPermissionDisplayName('github', 'create_pull_request'),
    ).toBe('github \u2014 Create Pull Request')
  })

  test('buildUserDialogBlockedSummary renames mcp__server__tool but preserves claude-in-chrome & builtins', () => {
    expect(
      buildUserDialogBlockedSummary({
        tool_name: 'mcp__linear__list_issues',
        display_tool_name: 'mcp__linear__list_issues',
        action_description: 'List issues',
        tool_use_id: 'tu-1',
        request_id: 'req-1',
        input: {},
      }),
    ).toEqual({
      status_category: 'blocked',
      status_detail: 'Waiting on permission: linear \u2014 List Issues',
      needs_action: 'Approve or deny linear \u2014 List Issues',
    })

    expect(
      buildUserDialogBlockedSummary({
        tool_name: 'mcp__claude-in-chrome__read_page',
        display_tool_name: 'read_page',
        action_description: 'Read page',
        tool_use_id: 'tu-2',
        request_id: 'req-2',
        input: {},
      }),
    ).toEqual({
      status_category: 'blocked',
      status_detail: 'Waiting on permission: mcp__claude-in-chrome__read_page',
      needs_action: 'Approve or deny mcp__claude-in-chrome__read_page',
    })

    expect(
      buildUserDialogBlockedSummary({
        tool_name: 'Bash',
        display_tool_name: 'Bash',
        action_description: 'Run command',
        tool_use_id: 'tu-3',
        request_id: 'req-3',
        input: {},
      }),
    ).toEqual({
      status_category: 'blocked',
      status_detail: 'Waiting on permission: Bash',
      needs_action: 'Approve or deny Bash',
    })
  })
})
