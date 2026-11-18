import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { resolveSelectCancelAction } from '../CustomSelect/select.js'
import { getResumedCompactBoundaryInfo } from '../Message.js'

describe('Wave 4B 2.1.301 alignment', () => {
  test('#865 resolveSelectCancelAction enters NORMAL from INSERT in vim mode before cancelling', () => {
    expect(
      resolveSelectCancelAction({
        vimModeEnabled: true,
        isInputFocused: true,
        inputVimMode: 'INSERT',
      }),
    ).toBe('enter-normal')

    expect(
      resolveSelectCancelAction({
        vimModeEnabled: true,
        isInputFocused: true,
        inputVimMode: 'NORMAL',
      }),
    ).toBe('cancel')

    expect(
      resolveSelectCancelAction({
        vimModeEnabled: false,
        isInputFocused: true,
        inputVimMode: 'INSERT',
      }),
    ).toBe('cancel')

    expect(
      resolveSelectCancelAction({
        vimModeEnabled: true,
        isInputFocused: false,
        inputVimMode: 'INSERT',
      }),
    ).toBe('cancel')
  })

  test('#869 REPL /rewind resets sentSkillNames and clears invokedSkills', () => {
    const replSrc = fs.readFileSync(
      path.resolve(__dirname, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(replSrc).toContain('resetSentSkillNames()')
    expect(replSrc).toContain('clearInvokedSkills(preservedAgentIds)')
  })

  test('#655 REPL defers unparking held-back dialogs for one macrotask on draft submit', () => {
    const replSrc = fs.readFileSync(
      path.resolve(__dirname, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(replSrc).toContain('heldBackReleasePending')
    expect(replSrc).toContain('isDialogHeldBack')
  })

  test('#870 getResumedCompactBoundaryInfo extracts savedIn/leadsToSummary and Message shows in fullscreen when resumed', () => {
    expect(
      getResumedCompactBoundaryInfo({
        compactMetadata: { trigger: 'auto', preTokens: 1000 },
      }),
    ).toBeNull()

    expect(
      getResumedCompactBoundaryInfo({
        compactMetadata: {
          trigger: 'auto',
          preTokens: 1000,
          savedIn: '~/.claude/projects/foo/session.jsonl',
          leadsToSummary: true,
        } as never,
      }),
    ).toEqual({
      leadsToSummary: true,
      savedIn: '~/.claude/projects/foo/session.jsonl',
    })

    const msgSrc = fs.readFileSync(
      path.resolve(__dirname, '../Message.tsx'),
      'utf8',
    )
    expect(msgSrc).toContain(
      'if (isFullscreenEnvEnabled() && resumedInfo === null)',
    )
    expect(msgSrc).toContain('leadsToSummary={resumedInfo?.leadsToSummary}')
    expect(msgSrc).toContain('savedIn={resumedInfo?.savedIn}')
  })
})
