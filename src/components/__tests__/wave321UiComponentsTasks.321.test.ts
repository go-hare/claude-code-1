import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getScreenReaderStartupQuietRemainingMs,
  markScreenReaderStartupQuietStart,
  resetScreenReaderStartupQuietForTests,
} from '../../../packages/@ant/ink/src/core/screenReaderStartupQuiet.js'
import {
  CONFIRM_STREAM_QUIET_GAP_MS,
  createConfirmStreamGuard,
} from '../ConfirmSelect.js'
import { shouldCompensateHeightShrinkage } from '../VirtualMessageList.js'

const ROOT = join(import.meta.dir, '..', '..', '..')

describe('Wave 321 Group 4 — Components, REPL, Tasks & Skills Alignments', () => {
  test('#1856: Settings/Config supports Auto (default) derivation and isDefaultValue', () => {
    const src = readFileSync(
      join(ROOT, 'src/components/Settings/Config.tsx'),
      'utf8',
    )
    expect(src).toContain('isDefaultValue?: boolean')
    expect(src).toContain('derivedDefaultPermissionIsAuto')
    expect(src).toContain("isDefaultValue ? ' (default)' : ''")
  })

  test('#1870: PermissionPrompt and BackgroundTasksDialog guard against null/undefined entries', () => {
    const permSrc = readFileSync(
      join(ROOT, 'src/components/permissions/PermissionPrompt.tsx'),
      'utf8',
    )
    const bgSrc = readFileSync(
      join(ROOT, 'src/components/tasks/BackgroundTasksDialog.tsx'),
      'utf8',
    )
    expect(permSrc).toContain('safeOptions')
    expect(bgSrc).toContain('Boolean(task)')
  })

  test('#1872: desktopDeepLink checks ~/Applications/Claude.app and CFBundleIdentifier', () => {
    const src = readFileSync(join(ROOT, 'src/utils/desktopDeepLink.ts'), 'utf8')
    expect(src).toContain('com.anthropic.claudefordesktop')
    expect(src).toContain('CFBundleIdentifier')
    expect(src).toContain("join(homedir(), 'Applications', 'Claude.app')")
  })

  test('#1875: screenReaderStartupQuiet uses monotonic performance.now()', () => {
    const src = readFileSync(
      join(ROOT, 'packages/@ant/ink/src/core/screenReaderStartupQuiet.ts'),
      'utf8',
    )
    expect(src).toContain('performance.now()')
    expect(src).not.toContain('Date.now()')

    resetScreenReaderStartupQuietForTests()
    const t0 = 1000
    markScreenReaderStartupQuietStart(t0)
    const env = { CLAUDE_AX_STARTUP_QUIET_MS: '1000' }
    expect(getScreenReaderStartupQuietRemainingMs(t0 + 250, env)).toBe(750)
    expect(getScreenReaderStartupQuietRemainingMs(t0 + 1200, env)).toBe(0)
  })

  test('#1876: REPL dialogHostUnmounted / dialogOverPanel restores command panel immediately', async () => {
    const { computeDialogPanelVisibility } = await import(
      '../../screens/REPL.js'
    )
    // Dialog opened over a command panel: panel stays hidden behind dialog
    const visOverPanel = computeDialogPanelVisibility({
      onScreenBlockingKind: 'permission',
      modalSlotActive: false,
      panelHidesPrompt: true,
      pinnedConsentShowing: false,
      dialogOverPanel: true,
      fullscreen: true,
    })
    expect(visOverPanel.abovePrompt).toBe(true)
    expect(visOverPanel.drawn).toBe(true)

    // Dialog closed over inactive panel: no dialog drawn above prompt
    const visClosed = computeDialogPanelVisibility({
      onScreenBlockingKind: null,
      modalSlotActive: false,
      panelHidesPrompt: false,
      pinnedConsentShowing: false,
      dialogOverPanel: false,
      fullscreen: true,
    })
    expect(visClosed.abovePrompt).toBe(false)
    expect(visClosed.inPane).toBe(false)
    expect(visClosed.drawn).toBe(false)

    // And when a dialog closes while toolJSX panel is open (panelHidesPrompt=true,
    // dialogOverPanel=false), REPL immediately restores the panel
    const replSrc = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(replSrc).toContain('dialogHostUnmounted')
    expect(replSrc).toContain('dialogOverPanel')
  })

  test('#1881: collapseBacklogTaskNotifications collapses excess backlog beyond cap', async () => {
    const {
      collapseBacklogTaskNotifications,
      DEFAULT_TASK_NOTIFICATION_BATCH_CAP,
    } = await import('../../utils/messageQueueManager.js')
    expect(DEFAULT_TASK_NOTIFICATION_BATCH_CAP).toBe(10)
    const cmds = Array.from({ length: 15 }, (_, i) => ({
      value: `<task-notification><task-id>t${i}</task-id><summary>Done ${i}</summary></task-notification>`,
      mode: 'task-notification' as const,
    }))
    // Cap = 10 -> keeps 9 individual + 1 folded summary entry = 10 total
    const collapsed = collapseBacklogTaskNotifications(cmds, 10)
    expect(collapsed.length).toBe(10)
    expect(String(collapsed[9]!.value)).toContain('6')
    expect(collapseBacklogTaskNotifications(cmds.slice(0, 5), 10).length).toBe(
      5,
    )
  })

  test('#1891: ConfirmSelect stream guard discards continuous burst starting in refuse window including trailing y', () => {
    const guard = createConfirmStreamGuard()
    // Keystroke arrives during refuse window
    expect(guard.shouldDropKey('a', true, 100)).toBe(true)
    // Continuous typing continues past refuse window with < quiet gap (including trailing 'y')
    expect(
      guard.shouldDropKey('b', false, 100 + CONFIRM_STREAM_QUIET_GAP_MS - 10),
    ).toBe(true)
    expect(
      guard.shouldDropKey(
        'y',
        false,
        100 + (CONFIRM_STREAM_QUIET_GAP_MS - 10) * 2,
      ),
    ).toBe(true)
    // After a real quiet gap, intentional 'y' is accepted
    expect(
      guard.shouldDropKey(
        'y',
        false,
        100 +
          (CONFIRM_STREAM_QUIET_GAP_MS - 10) * 2 +
          CONFIRM_STREAM_QUIET_GAP_MS +
          5,
      ),
    ).toBe(false)
  })

  test('#1908: VirtualMessageList compensates when tool result height shrinks by more than viewportHeight', () => {
    expect(shouldCompensateHeightShrinkage(120, 40, 30)).toBe(true)
    expect(shouldCompensateHeightShrinkage(60, 40, 30)).toBe(false)
    expect(shouldCompensateHeightShrinkage(undefined, 40, 30)).toBe(false)
    expect(shouldCompensateHeightShrinkage(40, 90, 30)).toBe(false)
  })

  test('#1919: LocalWorkflowTask enqueues task-notification on pause and stop', () => {
    const src = readFileSync(
      join(ROOT, 'src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts'),
      'utf8',
    )
    expect(src).toContain('enqueueWorkflowPausedNotice')
    expect(src).toContain('enqueueWorkflowStoppedNotice')
    expect(src).toContain('<task-notification>')
    expect(src).toContain('paused by the user')
    expect(src).toContain('stopped by the user')
  })

  test('#1920 & #1941: ModelPicker and Config use dynamic fast mode model name instead of hardcoded Opus', () => {
    const pickerSrc = readFileSync(
      join(ROOT, 'src/components/ModelPicker.tsx'),
      'utf8',
    )
    const configSrc = readFileSync(
      join(ROOT, 'src/components/Settings/Config.tsx'),
      'utf8',
    )
    expect(pickerSrc).toContain('modelDisplayString(currentModel)')
    expect(configSrc).toContain('modelDisplayString(mainLoopModel)')
  })

  test('#1937: upgrade command description says "Upgrade to Max or Ultra"', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/upgrade/index.ts'),
      'utf8',
    )
    expect(src).toContain('Upgrade to Max or Ultra')
  })

  test('#1956: LocalShellTask truncates notification summaries over 1000 characters head+tail', async () => {
    const { truncateNotificationSummary } = await import(
      '../../tasks/LocalShellTask/LocalShellTask.js'
    )
    const short = 'echo hello'
    expect(truncateNotificationSummary(short)).toBe(short)

    const long = 'A'.repeat(600) + 'B'.repeat(600) + 'C'.repeat(400)
    const truncated = truncateNotificationSummary(long)
    expect(truncated.length).toBeLessThan(long.length)
    expect(truncated.startsWith('A'.repeat(500))).toBe(true)
    expect(truncated.endsWith('C'.repeat(300))).toBe(true)
    expect(truncated).toContain('[800 characters truncated]')
  })

  test('#1957: artifact-design SKILL.md recommends Inter + Space Grotesk as defaults', () => {
    const doc = readFileSync(
      join(ROOT, 'src/skills/bundled/artifact-design/SKILL.md'),
      'utf8',
    )
    expect(doc).toContain(
      'Inter for text and Space Grotesk for headings are good defaults',
    )
    expect(doc).not.toContain('Inter or Space Grotesk as the "safe" face')
  })
})
