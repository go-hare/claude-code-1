import { describe, expect, test } from 'bun:test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { LogOption } from '../../types/logs.js'
import {
  formatRewindFailedPathsMessage,
  formatRewindSkippedLinksMessage,
} from '../../utils/fileHistory.js'
import {
  schedulePostAltScreenWorktreeNotice,
  shouldWritePostAltScreenWorktreeMessage,
} from '../ExitFlow.js'
import {
  buildFeedbackConsentOptions,
  buildFeedbackDoneOptions,
  resolveFeedbackCloseMessage,
} from '../Feedback.js'
import {
  buildLogMetadata,
  computeLogSelectorVisibleCount,
} from '../LogSelector.js'
import { shouldCloseResumeLoadErrorOnKey } from '../ResumeTask.js'

describe('Wave 327-328 Rewind / Feedback / Lists / Teleport / ExitFlow', () => {
  test('#381: Enter does not close /teleport load error screen; Esc and Ctrl+C do', () => {
    expect(shouldCloseResumeLoadErrorOnKey('network', { return: true })).toBe(
      false,
    )
    expect(shouldCloseResumeLoadErrorOnKey('auth', { return: true })).toBe(
      false,
    )
    expect(shouldCloseResumeLoadErrorOnKey('network', { escape: true })).toBe(
      true,
    )
    expect(
      shouldCloseResumeLoadErrorOnKey('network', { ctrl: true }, 'c'),
    ).toBe(true)
    expect(shouldCloseResumeLoadErrorOnKey(null, { escape: true })).toBe(false)
  })

  test('#396: /rewind formats per-file restore failures and caps inline list to 3 paths', () => {
    const single = formatRewindFailedPathsMessage(['src/a.ts'])
    expect(single).toBe(
      "Couldn't restore 1 file: the backup is missing or the file can't be written.\n  src/a.ts",
    )

    const many = formatRewindFailedPathsMessage([
      'a.ts',
      'b.ts',
      'c.ts',
      'd.ts',
    ])
    expect(many).toContain("Couldn't restore 4 files:")
    expect(many).toContain('  a.ts')
    expect(many).toContain('  c.ts')
    expect(many).not.toContain('  d.ts')

    const skipped = formatRewindSkippedLinksMessage(2, ['link1.ts', 'link2.ts'])
    expect(skipped).toContain('skipped 2 files')
    expect(skipped).toContain('  link1.ts')
  })

  test('#446: ItemList reclaims focus and handles arrows/Enter when rows load late', async () => {
    const src = await readFile(join(import.meta.dir, '../ItemList.tsx'), 'utf8')
    expect(src).toContain(
      'useFocusReclaim(listRef, !isDisabled && options.length > 0)',
    )
    expect(src).toContain('if (prevLen === 0 && options.length > 0)')
    expect(src).toContain("event.name === 'down'")
    expect(src).toContain("event.name === 'up'")
  })

  test('#456: TeleportResumeWrapper observes fresh error state instead of stale closure', async () => {
    const src = await readFile(
      join(import.meta.dir, '../TeleportResumeWrapper.tsx'),
      'utf8',
    )
    expect(src).toContain('Couldn&apos;t resume the session')
    expect(src).toContain('reportedErrorRef')
    expect(src).toContain('notice={errorNotice}')
    // Ensure stale `else if (error)` inside handleSelect is gone
    const handleSelectSection = src.slice(
      src.indexOf('const handleSelect = async'),
      src.indexOf('const handleCancel ='),
    )
    expect(handleSelectSection).not.toContain('if (error)')
  })

  test('#461: buildLogMetadata truncates long branch names and project paths to maxWidth', () => {
    const log = {
      date: '2026-11-19',
      messages: [],
      firstPrompt: 'Fix bug',
      messageCount: 12,
      created: new Date('2026-11-19T00:00:00Z'),
      modified: new Date('2026-11-19T00:00:00Z'),
      gitBranch:
        'feature/very-long-branch-name-that-would-otherwise-wrap-across-multiple-terminal-lines',
      projectPath:
        '/Users/developer/workspace/organization/monorepo/packages/deeply/nested/project',
    } as unknown as LogOption

    const full = buildLogMetadata(log, { showProjectPath: true })
    expect(full.length).toBeGreaterThan(60)

    const truncated = buildLogMetadata(log, {
      showProjectPath: true,
      maxWidth: 45,
    })
    expect(truncated.length).toBeLessThanOrEqual(45)
  })

  test('#463: LogSelector inside modal uses 6-line header so it does not drop 1 visible session', () => {
    // With maxHeight = 20, footerLines = 2:
    // Inline: (20 - 8 - 2) / 3 = 3; Modal: (20 - 6 - 2) / 3 = 4 (+1 session!)
    const inlineCount = computeLogSelectorVisibleCount({
      maxHeight: 20,
      isInsideModal: false,
      showAdditionalFilterLine: false,
    })
    const modalCount = computeLogSelectorVisibleCount({
      maxHeight: 20,
      isInsideModal: true,
      showAdditionalFilterLine: false,
    })
    expect(inlineCount).toBe(3)
    expect(modalCount).toBe(4)
  })

  test('#469: ExitFlow writes Worktree kept notice after alt-screen exit', () => {
    expect(
      shouldWritePostAltScreenWorktreeMessage(
        'Worktree kept. Your work is saved at /tmp/wt on branch feat',
        true,
      ),
    ).toBe(true)
    expect(shouldWritePostAltScreenWorktreeMessage('Goodbye!', true)).toBe(
      false,
    )
    expect(
      shouldWritePostAltScreenWorktreeMessage(
        'Worktree kept at /tmp/wt',
        false,
      ),
    ).toBe(false)

    const written: string[] = []
    const emit = schedulePostAltScreenWorktreeNotice(
      'Worktree kept. Your work is saved at /tmp/wt',
      text => written.push(text),
    )
    // Calling emit twice only prints once
    emit()
    emit()
    expect(written).toEqual([
      '\nWorktree kept. Your work is saved at /tmp/wt\n',
    ])
  })

  test('#608: /bug and /feedback never say cancelled after the report was sent', () => {
    expect(resolveFeedbackCloseMessage({ step: 'done', mode: 'post' })).toEqual(
      {
        message: 'Feedback / bug report submitted',
        display: 'system',
      },
    )
    expect(
      resolveFeedbackCloseMessage({
        step: 'done',
        mode: 'bundle',
        bundlePath: '/tmp/bundle.zip',
      }),
    ).toEqual({
      message: 'Feedback bundle saved to `/tmp/bundle.zip`',
      display: 'system',
    })
    expect(
      resolveFeedbackCloseMessage({ step: 'done', mode: 'share' }),
    ).toEqual({
      message: undefined,
      display: 'skip',
    })
    expect(
      resolveFeedbackCloseMessage({ step: 'submitting', mode: 'post' }),
    ).toEqual({
      message: 'Stopped sending the report · Anthropic may already have it',
      display: 'system',
    })
    expect(
      resolveFeedbackCloseMessage({ step: 'userInput', mode: 'post' }),
    ).toEqual({
      message: 'Feedback cancelled',
      display: 'system',
    })
  })

  test('#609: TranscriptSharePrompt handles Escape key to dismiss', async () => {
    const src = await readFile(
      join(import.meta.dir, '../FeedbackSurvey/TranscriptSharePrompt.tsx'),
      'utf8',
    )
    expect(src).toContain('if (key.escape)')
    expect(src).toContain("handleSelect('no')")
  })

  test('#668: /bug asks Yes/No with No first before sending, and Close first before opening GitHub', () => {
    const consentPost = buildFeedbackConsentOptions('post')
    expect(consentPost[0]).toEqual({
      label: 'No, edit the report',
      value: 'edit',
    })
    expect(consentPost[1]).toEqual({ label: 'Yes, send it', value: 'send' })

    const consentBundle = buildFeedbackConsentOptions('bundle')
    expect(consentBundle[0]!.value).toBe('edit')
    expect(consentBundle[1]).toEqual({ label: 'Yes, save it', value: 'send' })

    const doneWithGithub = buildFeedbackDoneOptions({
      hideGitHubIssue: false,
      title: 'Bug title',
    })
    expect(doneWithGithub[0]).toEqual({ label: 'Close', value: 'close' })
    expect(doneWithGithub[1]).toEqual({
      label: 'Open a GitHub issue',
      value: 'issue',
    })

    const doneWithoutGithub = buildFeedbackDoneOptions({
      hideGitHubIssue: true,
      title: 'Bug title',
    })
    expect(doneWithoutGithub).toEqual([{ label: 'Close', value: 'close' }])
  })
})
