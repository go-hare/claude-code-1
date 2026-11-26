import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  formatInvisibleRemovedNotice,
  shouldHoldInvisibleRemovalForReview,
  stripInvisibleFromPromptInput,
} from '../invisibleStrip.js'
import {
  isWithinPermissionKeyGuard,
  PERMISSION_MOUNT_SETTLE_MS,
  PERMISSION_SUBMIT_GUARD_MS,
  recordPromptSubmitTime,
  resetPromptSubmitTimeForTests,
} from '../../permissions/submitGuard.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('Wave 316-318 UI / Components alignment', () => {
  beforeEach(() => {
    resetPromptSubmitTimeForTests()
  })

  test('#1489 invisibleStrip removes zero-width/tags/selectors and sends plain prompts without holding for review', () => {
    const dirty = 'hello\u200B world\uFE0F'
    const res = stripInvisibleFromPromptInput(dirty, {})
    expect(res.input).toBe('hello world')
    expect(res.removed.removedTotal).toBe(2)
    expect(res.removed.removedByClass.zeroWidth).toBe(1)
    expect(res.removed.removedByClass.selectors).toBe(1)
    expect(
      shouldHoldInvisibleRemovalForReview(res.input, res.removed, 'prompt'),
    ).toBe(false)
    expect(
      formatInvisibleRemovedNotice(res.removed.removedTotal, 'cleaned'),
    ).toBe('Removed 2 invisible characters from your prompt')
  })

  test('#1489 commands, bash mode, bidi, and empty-after-strip still hold for review', () => {
    const cmd = stripInvisibleFromPromptInput('/help\u200B', {})
    expect(
      shouldHoldInvisibleRemovalForReview(cmd.input, cmd.removed, 'prompt'),
    ).toBe(true)
    expect(
      formatInvisibleRemovedNotice(cmd.removed.removedTotal, 'review'),
    ).toContain('review and press Enter to send')

    const bidi = stripInvisibleFromPromptInput('hello\u202E', {})
    expect(
      shouldHoldInvisibleRemovalForReview(bidi.input, bidi.removed, 'prompt'),
    ).toBe(true)

    const empty = stripInvisibleFromPromptInput('\u200B\uFEFF', {})
    expect(
      shouldHoldInvisibleRemovalForReview(empty.input, empty.removed, 'prompt'),
    ).toBe(true)
    expect(
      formatInvisibleRemovedNotice(empty.removed.removedTotal, 'empty'),
    ).toContain('nothing left to send')
  })

  test('#1499 PromptInputFooterLeftSide checks voiceKeyShortcut !== "" and uses per-session RootSessionSlot counter across remounts', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/PromptInput/PromptInputFooterLeftSide.tsx'),
      'utf8',
    )
    expect(src).toContain('voiceFooterHintCounted: false')
    expect(src).toContain('new RootSessionSlot<PromptFooterLeftSessionState>')
    expect(src).toContain("voiceKeyShortcut === ''")
    expect(src).toContain("voiceKeyShortcut !== ''")
  })

  test('#1502 Onboarding.tsx uses maxWidth={70} instead of fixed width={70}', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/Onboarding.tsx'),
      'utf8',
    )
    expect(src).toContain('<Box flexDirection="column" maxWidth={70}>')
    expect(src).toContain('<Box flexDirection="column" maxWidth={70} gap={1}>')
    expect(src).not.toContain('width={70}')
  })

  test('#1503 useDebouncedDigitInput.ts supports enterConfirms and acceptAfterPause=false (no auto-submit)', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/FeedbackSurvey/useDebouncedDigitInput.ts'),
      'utf8',
    )
    expect(src).toContain('enterConfirms = true')
    expect(src).toContain('acceptAfterPause = true')
    expect(src).toContain('if (!enabled || !acceptAfterPause')
    expect(src).toContain('useInput(')
  })

  test('#1580 Feedback.tsx adds step === "submitting" inputGuide and share-aware hideInputGuide', () => {
    const src = readFileSync(join(ROOT, 'src/components/Feedback.tsx'), 'utf8')
    expect(src).toContain(
      "hideInputGuide={step === 'done' && mode !== 'share'}",
    )
    expect(src).toContain("step === 'submitting' ?")
  })

  test('#1665 ConfirmAdminUsageRequest.tsx sends request in one step on mount', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/ConfirmAdminUsageRequest.tsx'),
      'utf8',
    )
    expect(src).toContain('useEffect(() => {')
    expect(src).toContain('onConfirm()')
    expect(src).not.toContain('Select')
  })

  test('#1676 AutoModeRulesTab.tsx uses standard <Dialog> for env-first-confirm, delete, and details', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/permissions/rules/AutoModeRulesTab.tsx'),
      'utf8',
    )
    expect(src).toContain('<Dialog title="Replace the built-in environment?"')
    expect(src).toContain('<Dialog title="Delete auto mode rule?"')
    expect(src).toContain('<Dialog title="Rule details"')
  })

  test('#1622 submitGuard blocks keys right after submit and before mount settle', () => {
    const t0 = 10_000
    recordPromptSubmitTime(t0)
    expect(
      isWithinPermissionKeyGuard(
        t0 - 1000,
        t0 + PERMISSION_SUBMIT_GUARD_MS - 1,
      ),
    ).toBe(true)
    expect(
      isWithinPermissionKeyGuard(
        t0 - 1000,
        t0 + PERMISSION_SUBMIT_GUARD_MS + 1,
      ),
    ).toBe(false)

    resetPromptSubmitTimeForTests()
    expect(
      isWithinPermissionKeyGuard(t0, t0 + PERMISSION_MOUNT_SETTLE_MS - 1),
    ).toBe(true)
    expect(
      isWithinPermissionKeyGuard(t0, t0 + PERMISSION_MOUNT_SETTLE_MS + 1),
    ).toBe(false)
  })

  test('#1652 ShellDetailDialog.tsx uses useElapsedTime for live runtime', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/tasks/ShellDetailDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("from '../../hooks/useElapsedTime.js'")
    expect(src).toContain(
      "useElapsedTime(shell.startTime, shell.status === 'running', 1000, 0, shell.endTime)",
    )
    expect(src).toContain('<Text>{elapsedTime}</Text>')
  })

  test('#1649 MCPListPanel.tsx filters unavailable MCP tools in cloud sessions', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/mcp/MCPListPanel.tsx'),
      'utf8',
    )
    expect(src).toContain('getIsRemoteMode')
    expect(src).toContain('filterToolsByDenyRules')
    expect(src).toContain('availableMcpTools')
  })
})
