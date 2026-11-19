import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildAgentViewRelaunchEnv } from '../fleetDispatchDefaults.js'
import {
  formatPeekDisplayText,
  getPeekReplyErrorOrHint,
  isApprovalPromptText,
  isSessionWaitingOnPermission,
  PEEK_WAITING_PERMISSION_HINT,
  shouldBlockPeekReplyForPermission,
  truncateLinesWithEllipsis,
} from '../helpers.js'
import {
  flushFleetComposerDraftOnExit,
  handOverFleetComposerDraft,
} from '../useFleetComposerDraftPersistence.js'

const ROOT = join(import.meta.dir, '..', '..', '..', '..')

describe('Wave 319-321 Group 4 — AgentView & FleetView Alignments', () => {
  test('#1762: peek reply stays in box with hint when session waits on permission prompt', () => {
    expect(isApprovalPromptText('approve Bash(rm -rf /tmp/x)')).toBe(true)
    expect(isApprovalPromptText('running tests · approve Bash(npm test)')).toBe(
      true,
    )
    expect(isApprovalPromptText('waiting for your reply')).toBe(false)

    const waiting = isSessionWaitingOnPermission({
      status: 'waiting',
      backend: 'local',
      tempo: 'blocked',
      needs: 'approve Bash(git push)',
      hasQuestions: false,
    })
    expect(waiting).toBe(true)

    expect(
      shouldBlockPeekReplyForPermission({
        waitingOnPermission: true,
        replyInput: 'yes please',
        peekMode: 'prompt',
      }),
    ).toBe(true)
    // /stop in prompt mode is allowed through
    expect(
      shouldBlockPeekReplyForPermission({
        waitingOnPermission: true,
        replyInput: '/stop',
        peekMode: 'prompt',
      }),
    ).toBe(false)

    expect(
      getPeekReplyErrorOrHint({
        waitingOnPermission: true,
        replyInput: 'yes please',
        peekMode: 'prompt',
        replyError: null,
      }),
    ).toBe(PEEK_WAITING_PERMISSION_HINT)
    expect(
      getPeekReplyErrorOrHint({
        waitingOnPermission: true,
        replyInput: '/stop',
        peekMode: 'prompt',
        replyError: null,
      }),
    ).toBeNull()
  })

  test('#1763: flushFleetComposerDraftOnExit never deletes another agent view saved draft when empty', async () => {
    let deleteCalled = false
    let writeCalled = false
    const mockStorage = {
      write: async () => {
        writeCalled = true
        return { ok: true as const, value: undefined }
      },
      delete: async () => {
        deleteCalled = true
        return { ok: true as const, value: undefined }
      },
    }

    const ok = await flushFleetComposerDraftOnExit(
      '/tmp/shared-repo',
      { query: '', mode: 'prompt', collapsed: [] },
      mockStorage as never,
    )
    expect(ok).toBe(true)
    expect(deleteCalled).toBe(false)
    expect(writeCalled).toBe(false)
  })

  test('#1764 & #1904: handOverFleetComposerDraft flushes dirty/non-empty draft, skips untouched empty view', async () => {
    let deleteCalled = false
    const mockStorage = {
      write: async () => ({ ok: true as const, value: undefined }),
      delete: async () => {
        deleteCalled = true
        return { ok: true as const, value: undefined }
      },
    }

    // #1904: empty & untouched on update relaunch -> do NOT touch disk / do NOT erase another view's draft
    const untouched = handOverFleetComposerDraft(
      '/tmp/shared-repo',
      { query: '', mode: 'prompt', collapsed: [] },
      false,
      mockStorage as never,
    )
    expect(untouched).toBeUndefined()
    expect(deleteCalled).toBe(false)

    // #1764: non-empty draft on update relaunch -> flush immediately so restarted view gets its own text
    const withText = handOverFleetComposerDraft(
      '/tmp/shared-repo',
      { query: 'my draft prompt', mode: 'prompt', collapsed: [] },
      false,
      mockStorage as never,
    )
    expect(withText).toBeDefined()
    await withText
  })

  test('#1765: peek preview truncates overflow with ellipsis and preserves **, backticks, tags in approval commands', () => {
    const approvalCmd = 'approve Bash(echo **bold** `cmd` <tag>)'
    expect(
      formatPeekDisplayText(approvalCmd, { preserveRawMarkup: true }),
    ).toBe(approvalCmd)

    // Ordinary non-approval text strips tags and inline markdown wrappers
    expect(
      formatPeekDisplayText('Run **build** with `bun` <status>ok</status>', {
        preserveRawMarkup: false,
      }),
    ).toBe('Run build with bun ok')

    const longLine = 'alpha beta gamma delta epsilon zeta eta theta iota kappa'
    const truncated = truncateLinesWithEllipsis(longLine, 16, 2)
    const lines = truncated.split('\n')
    expect(lines.length).toBe(2)
    expect(lines[1]!.endsWith('\u2026')).toBe(true)
  })

  test('#1890: AgentView relaunch & createRoot propagate screen reader mode', () => {
    const envWithSr = buildAgentViewRelaunchEnv({
      mode: 'manual',
      baseEnv: {},
      screenReaderEnv: { CLAUDE_AX_SCREEN_READER: '1' },
    })
    expect(envWithSr.CLAUDE_AX_SCREEN_READER).toBe('1')

    const envWithoutSr = buildAgentViewRelaunchEnv({
      mode: 'manual',
      baseEnv: {},
      screenReaderEnv: {},
    })
    expect(envWithoutSr.CLAUDE_AX_SCREEN_READER).toBeUndefined()

    const agentViewSrc = readFileSync(
      join(ROOT, 'src/screens/AgentView.tsx'),
      'utf8',
    )
    expect(agentViewSrc).toContain(
      'isScreenReaderEnabled: isScreenReaderModeEnabled()',
    )
  })
})
