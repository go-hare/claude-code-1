import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSelectionClearKeyDownCapture } from '../ScrollKeybindingHandler.js'
import { computePreviewNotesColumns } from '../permissions/AskUserQuestionPermissionRequest/PreviewQuestionView.js'
import {
  formatRateLimitNotice,
  parseRetryAfterHeldUntilMs,
} from '../Settings/Usage.js'
import { pluginPaneDockColumns } from '../PluginRasterPanes.js'
import { findNoOpPermissionRuleWarnings } from '../LogoV2/LogoV2.js'
import {
  isHumanPromptQueueItem,
  retainWaitingRowsWhileLoading,
  selectWaitingTranscriptMessages,
} from '../messages/WaitingTranscriptMessages.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'

describe('Components 2.1.304–2.1.309 alignment', () => {
  test('#965 ApproveApiKey and Config wire refreshPolicyLimits on API key approval/toggle', () => {
    const approveSrc = readFileSync(
      join(import.meta.dir, '../ApproveApiKey.tsx'),
      'utf8',
    )
    expect(approveSrc).toContain('refreshPolicyLimits()')
    const configSrc = readFileSync(
      join(import.meta.dir, '../Settings/Config.tsx'),
      'utf8',
    )
    expect(configSrc).toContain('refreshPolicyLimits()')
  })

  test('#993 computePreviewNotesColumns adapts to narrow terminals instead of hardcoding 60', () => {
    // 80 cols: 80 - 30 - 4 - 6 ("Notes:") - 1 = 39
    expect(computePreviewNotesColumns(80)).toBe(39)
    // Very narrow terminal floors at 1
    expect(computePreviewNotesColumns(30)).toBe(1)
    const src = readFileSync(
      join(
        import.meta.dir,
        '../permissions/AskUserQuestionPermissionRequest/PreviewQuestionView.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('maxVisibleLines={5}')
    expect(src).toContain('columns={notesColumns}')
  })

  test('#997 VirtualMessageList uses getScrollTop() (no HEADROOM) and getFirstContentMarginTop', () => {
    const src = readFileSync(
      join(import.meta.dir, '../VirtualMessageList.tsx'),
      'utf8',
    )
    expect(src).toContain('getFirstContentMarginTop')
    expect(src).toContain('scrollToMessageElement')
    expect(src).toContain('const targetTop = s.getScrollTop();')
  })

  test('#999 createSelectionClearKeyDownCapture copies on Ctrl+C if lastCopiedRef.current is null (before mouse-up)', () => {
    let copied = 0
    let cleared = 0
    const selection = {
      hasSelection: () => true,
      clearSelection: () => {
        cleared++
      },
      copySelection: () => {
        copied++
        return 'selected text'
      },
    }
    const lastCopiedRef: { current: string | null } = { current: null }
    const handler = createSelectionClearKeyDownCapture(selection, lastCopiedRef)

    const makeCtrlC = () => ({
      key: 'c',
      name: 'c',
      ctrl: true,
      shift: false,
      meta: false,
      superKey: false,
      stopImmediatePropagation: () => {},
      preventDefault: () => {},
    })

    // Before mouse release: lastCopiedRef.current is null -> copies!
    handler(makeCtrlC())
    expect(copied).toBe(1)
    expect(cleared).toBe(0)

    // After mouse release (auto-copied): lastCopiedRef.current is non-null -> clears without re-copying!
    lastCopiedRef.current = 'selected text'
    handler(makeCtrlC())
    expect(copied).toBe(1)
    expect(cleared).toBe(1)
  })

  test('#1000 Usage rate limit notice includes end time when Retry-After is present', () => {
    expect(formatRateLimitNotice(undefined)).toBe(
      'requests temporarily limited — try again in a moment',
    )
    const heldUntil = parseRetryAfterHeldUntilMs(
      { 'retry-after': '120' },
      1_700_000_000_000,
    )
    expect(heldUntil).toBe(1_700_000_120_000)
    const notice = formatRateLimitNotice(heldUntil)
    expect(notice.startsWith('rate limited until ')).toBe(true)
  })

  test('#1013/#1058 ArtifactsMenu delete confirmation uses Select (1/Enter keep, 2 delete, Esc cancel; no y/n)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../commands/artifacts/ArtifactsMenu.tsx'),
      'utf8',
    )
    expect(src).toContain("label: 'No, keep it'")
    expect(src).toContain("label: 'Yes, delete it'")
    expect(src).toContain('This cannot be undone.')
    expect(src).not.toContain("input === 'y'")
    expect(src).not.toContain("input === 'n'")
  })

  test('#1047 findNoOpPermissionRuleWarnings flags Bash(command:...) and Read(path:...) rules', () => {
    const warnings = findNoOpPermissionRuleWarnings({
      alwaysDenyRules: {
        userSettings: [
          'Bash(command:rm -rf)',
          'Read(path:/etc/passwd)',
          'Bash(ls)',
        ],
        session: ['Bash(command:ignored)'],
      },
      alwaysAskRules: {
        localSettings: ['Edit(path:*.env)'],
      },
    })
    expect(warnings).toEqual([
      'Deny rule Bash(command:rm -rf) never matches · use Bash(…)',
      'Deny rule Read(path:/etc/passwd) never matches · use Read(…)',
      'Ask rule Edit(path:*.env) never matches · use Edit(…)',
    ])
  })

  test('#1059 pluginPaneDockColumns caps chosen and requested widths at 45% of terminal width and columns - 60', () => {
    // At 120 cols: min(floor(120 * 0.45)=54, 120-60=60) = 54
    expect(pluginPaneDockColumns(120, 80)).toBe(54)
    expect(pluginPaneDockColumns(120, undefined, 70)).toBe(54)
    // At 115 cols: min(floor(115 * 0.45)=51, 115-60=55) = 51
    expect(pluginPaneDockColumns(115, 60)).toBe(51)
    // Below floor 110 -> 0
    expect(pluginPaneDockColumns(109, 40)).toBe(0)
  })

  test('#1131 SubmitController overrides bash inputMode to prompt for key-bound slash commands', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../screens/repl/SubmitController.ts'),
      'utf8',
    )
    expect(src).toContain('inputModeOverride?: PromptInputMode')
    expect(src).toContain(
      "options?.fromKeybinding && input.trim().startsWith('/')",
    )
  })

  test('#1132 WaitingTranscriptMessages selects non-human queued messages for ctrl+o transcript', () => {
    const humanCmd: QueuedCommand = { value: 'hello', mode: 'prompt' }
    const peerCmd: QueuedCommand = {
      value: 'peer msg',
      mode: 'task-notification',
      agentId: 'agent-1' as never,
      origin: { kind: 'coordinator' },
    }
    expect(isHumanPromptQueueItem(humanCmd)).toBe(true)
    expect(isHumanPromptQueueItem(peerCmd)).toBe(false)

    const rows = selectWaitingTranscriptMessages({
      queuedCommands: [humanCmd, peerCmd],
      pendingTaskMessages: [],
      targetAgentId: 'agent-1',
      transcriptMessages: [],
      pendingToQueuedCache: new WeakMap(),
      normalizedCache: new WeakMap(),
    })
    expect(rows.length).toBe(1)

    const prev = { rows, transcriptLength: 3 }
    const retained = retainWaitingRowsWhileLoading(prev, [], 3, true)
    expect(retained.rows.length).toBe(1)
    const cleared = retainWaitingRowsWhileLoading(prev, [], 4, true)
    expect(cleared.rows.length).toBe(0)
  })
})
