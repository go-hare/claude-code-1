import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearFeedbackDraft,
  getFeedbackDraft,
  setFeedbackDraft,
} from '../../components/Feedback.js'
import { computeDiffStatsBetweenMessages } from '../../components/MessageSelector.js'
import type { Message } from '../../types/message.js'
import {
  awaitInFlightFileHistoryCopy,
  formatRewindSkippedLinksMessage,
  isPathBehindSymlinkInSandboxWritableRoot,
  REWIND_SKIPPED_LINKS_REASON,
} from '../fileHistory.js'

const U1 = '00000000-0000-4000-8000-000000000001' as UUID
const U2 = '00000000-0000-4000-8000-000000000002' as UUID
const U3 = '00000000-0000-4000-8000-000000000003' as UUID

describe('Wave 326 Group 4C — FileHistory, /rewind & /feedback', () => {
  test('#36 awaitInFlightFileHistoryCopy resolves immediately when no copy is active', async () => {
    await expect(
      awaitInFlightFileHistoryCopy('non-existent-session-id'),
    ).resolves.toBeUndefined()
  })

  test('#37 computeDiffStatsBetweenMessages marks turns with Bash tool calls as hasUncheckedFiles', () => {
    const messages = [
      {
        type: 'user',
        uuid: U1,
        message: { role: 'user', content: 'run tests' },
      },
      {
        type: 'assistant',
        uuid: U2,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Bash',
              input: { command: 'touch foo' },
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: U3,
        message: { role: 'user', content: 'next prompt' },
      },
    ] as unknown as Message[]

    const stats = computeDiffStatsBetweenMessages(messages, U1, U3)
    expect(stats?.filesChanged).toEqual([])
    expect(stats?.hasUncheckedFiles).toBe(true)
  })

  test('#37 computeDiffStatsBetweenMessages leaves hasUncheckedFiles undefined for pure text turns', () => {
    const messages = [
      {
        type: 'user',
        uuid: U1,
        message: { role: 'user', content: 'explain this' },
      },
      {
        type: 'assistant',
        uuid: U2,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is an explanation.' }],
        },
      },
      {
        type: 'user',
        uuid: U3,
        message: { role: 'user', content: 'thanks' },
      },
    ] as unknown as Message[]

    const stats = computeDiffStatsBetweenMessages(messages, U1, U3)
    expect(stats?.filesChanged).toEqual([])
    expect(stats?.hasUncheckedFiles).toBeUndefined()
  })

  test('#305 isPathBehindSymlinkInSandboxWritableRoot skips paths behind symlinks inside writable roots', async () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'rewind-sandbox-326-'))
    const outside = mkdtempSync(join(tmpdir(), 'rewind-outside-326-'))
    try {
      const linkDir = join(root, 'linked')
      symlinkSync(outside, linkDir)
      const targetThroughLink = join(linkDir, 'secret.txt')
      writeFileSync(join(outside, 'secret.txt'), 'protected')

      const realDir = join(root, 'normal')
      mkdirSync(realDir)
      const normalTarget = join(realDir, 'ok.txt')
      writeFileSync(normalTarget, 'ok')

      expect(
        await isPathBehindSymlinkInSandboxWritableRoot(targetThroughLink, [
          root,
        ]),
      ).toBe(true)
      // Accessing the same symlinked subdir via a symlinked workspace alias
      // (similar to /var -> /private/var) must STILL detect it is inside the writable root
      const aliasParent = mkdtempSync(join(tmpdir(), 'rewind-alias-326-'))
      try {
        const aliasRoot = join(aliasParent, 'ws-alias')
        symlinkSync(root, aliasRoot)
        expect(
          await isPathBehindSymlinkInSandboxWritableRoot(
            join(aliasRoot, 'linked', 'secret.txt'),
            [root],
          ),
        ).toBe(true)
      } finally {
        rmSync(aliasParent, { recursive: true, force: true })
      }
      expect(
        await isPathBehindSymlinkInSandboxWritableRoot(normalTarget, [root]),
      ).toBe(false)
      expect(
        await isPathBehindSymlinkInSandboxWritableRoot(targetThroughLink, [
          join(root, 'unrelated'),
        ]),
      ).toBe(false)
      expect(REWIND_SKIPPED_LINKS_REASON).toContain(
        'behind a link in a folder that sandboxed commands can write',
      )
      expect(formatRewindSkippedLinksMessage(2)).toContain('skipped 2 files:')
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('#44 Feedback draft store preserves typed text across remounts and clears on submit/cancel', () => {
    const sid = 'session-feedback-326'
    clearFeedbackDraft(sid)
    expect(getFeedbackDraft(sid)).toBe('')
    setFeedbackDraft(sid, 'Steps to reproduce: ...')
    expect(getFeedbackDraft(sid)).toBe('Steps to reproduce: ...')
    clearFeedbackDraft(sid)
    expect(getFeedbackDraft(sid)).toBe('')
  })
})
