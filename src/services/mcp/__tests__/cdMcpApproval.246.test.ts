import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { collectPendingProjectMcpApprovals } from '../../mcpServerApproval.js'

describe('densable 2.1.246 Te/Rt /cd MCP pending', () => {
  test('Te/le strictMcpConfig returns empty', async () => {
    const pending = await collectPendingProjectMcpApprovals({
      strictMcpConfig: true,
    })
    expect(pending.pendingServers).toEqual([])
    expect(pending.pluginServerNames.size).toBe(0)
  })

  test('Rt settings-error backstop attaches us skipped notice (source-lock)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../mcpServerApproval.tsx'),
      'utf8',
    )
    const rt = src.slice(
      src.indexOf('export async function collectPendingMcpApprovalsForCd'),
    )
    expect(rt).toContain('mcpProjectApprovalSkippedNotice(errors)')
    expect(rt).toContain('skipNotice:')
    expect(src).toContain('skipNotice?: McpApprovalSkipWarning')
  })
})
