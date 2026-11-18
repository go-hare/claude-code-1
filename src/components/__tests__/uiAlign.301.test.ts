import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'

describe('2.1.299-301 UI components alignment', () => {
  test('#595 VirtualMessageList delays collapse on expanded row for double-click selection', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../VirtualMessageList.tsx'),
      'utf8',
    )
    expect(src).toContain('pendingClicks')
    expect(src).toContain('subscribeToSelectionChange')
    expect(src).toContain('hasTextSelection()')
    expect(src).toContain('onClickK(k, msg, e.cellIsBlank, expanded === true)')
  })

  test('#867 MarkdownTable renderVerticalFormat handles header-only tables when too wide', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../MarkdownTable.tsx'),
      'utf8',
    )
    expect(src).toContain('const headerOnly = rows.length === 0')
    expect(src).toContain(
      'const effectiveRows = headerOnly ? [token.header] : rows',
    )
  })

  test('#870 CompactBoundaryMessage supports leadsToSummary and savedIn path', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../messages/CompactBoundaryMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('Earlier messages are saved in {savedIn}')
    expect(src).toContain('for the summary')
  })

  test('#849 WorktreeExitDialog does not default hookBased commitCount to 0 and warns on unknown commits', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../WorktreeExitDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('let count: number | null = null;')
    expect(src).not.toContain('worktreeSession.hookBased ? 0 : null')
    expect(src).toContain(
      "A WorktreeCreate hook made this worktree, so Claude Code can't tell whether it has unpushed commits.",
    )
  })
})
