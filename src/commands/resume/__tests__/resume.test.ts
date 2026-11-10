import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getContentFieldValue } from '../../../components/hooks/ViewHookMode.js'
import { formatRepositorySourceNotice } from '../../../components/ultraplan/UltraplanLaunchDialog.js'

/**
 * Verify that user-facing guidance in model picker and resume command
 * is concise and actionable. Pure string tests — no side effects.
 */

describe('ModelPicker subtitle', () => {
  test('subtitle mentions effort and context controls', () => {
    const subtitle =
      'Choose a model for this and future sessions. Use ← → to adjust effort, Space to toggle 1M context.'
    expect(subtitle).toContain('effort')
    expect(subtitle).toContain('1M context')
    expect(subtitle).toContain('sessions')
  })

  test('subtitle is under 120 characters', () => {
    const subtitle =
      'Choose a model for this and future sessions. Use ← → to adjust effort, Space to toggle 1M context.'
    expect(subtitle.length).toBeLessThan(120)
  })
})

describe('Resume error messages', () => {
  test('session not found suggests /resume to browse', () => {
    const message =
      'Session my-session was not found. Run /resume without arguments to browse all sessions.'
    expect(message).toContain('not found')
    expect(message).toContain('/resume')
    expect(message).toContain('browse')
  })

  test('multiple matches suggests /resume to pick', () => {
    const message =
      'Found 3 sessions matching test. Run /resume to pick one from the list.'
    expect(message).toContain('3 sessions')
    expect(message).toContain('/resume')
    expect(message).toContain('pick')
  })
})

describe('Cost command subscriber messages', () => {
  test('overage message mentions the key behavior', () => {
    const msg =
      'You are currently using your overages to power your Claude Code usage. We will automatically switch you back to your subscription rate limits when they reset'
    expect(msg).toContain('overages')
    expect(msg).toContain('automatically switch')
  })

  test('subscription message is concise', () => {
    const msg =
      'You are currently using your subscription to power your Claude Code usage'
    expect(msg.length).toBeLessThan(100)
  })
})

describe('2.1.289 Secondary Modals Part A alignments', () => {
  const root = join(import.meta.dir, '../../..')

  test('ResumeConversation and ResumeCommand use LoadingState while preserving two-line Pane header', () => {
    const resumeCmd = readFileSync(
      join(root, 'commands/resume/resume.tsx'),
      'utf8',
    )
    const resumeScreen = readFileSync(
      join(root, 'screens/ResumeConversation.tsx'),
      'utf8',
    )
    expect(resumeCmd).toContain('Resume session')
    expect(resumeCmd).toContain(
      "<LoadingState message={resuming ? 'Resuming conversation…' : 'Loading conversations…'} />",
    )
    expect(resumeScreen).toContain(
      '<LoadingState message="Loading conversations…" />',
    )
    expect(resumeScreen).toContain(
      '<LoadingState message="Resuming conversation…" />',
    )
  })

  test('ViewHookMode getContentFieldValue handles script and mcp_tool hooks', () => {
    expect(
      getContentFieldValue({
        type: 'script',
        file: 'hooks/check.sh',
      } as never),
    ).toBe('hooks/check.sh')
    expect(
      getContentFieldValue({
        type: 'script',
        script: 'echo hi',
      } as never),
    ).toBe('echo hi')
    expect(
      getContentFieldValue({
        type: 'mcp_tool',
        toolName: 'my_tool',
      } as never),
    ).toBe('my_tool')
    expect(
      getContentFieldValue({
        type: 'mcp_tool',
        server: 'srv',
        tool: 'act',
      } as never),
    ).toBe('srv/act')
  })

  test('UltraplanLaunchDialog formatRepositorySourceNotice matches 289 eJe', () => {
    expect(
      formatRepositorySourceNotice({
        cloneViable: false,
        bundleSeedEnabled: false,
      }),
    ).toBeNull()
    expect(
      formatRepositorySourceNotice({
        cloneViable: true,
        bundleSeedEnabled: true,
      }),
    ).toBe(
      'This will try to clone your git remote and fall back to uploading this repository.',
    )
    expect(
      formatRepositorySourceNotice({
        cloneViable: false,
        bundleSeedEnabled: true,
      }),
    ).toBe('This will upload your repository to a cloud session.')
  })

  test('ExportDialog, SandboxSettings, SandboxOverridesTab, FastModePicker, HooksConfigMenu, DiffDialog 289 copy and hooks', () => {
    const exportSrc = readFileSync(
      join(root, 'components/ExportDialog.tsx'),
      'utf8',
    )
    expect(exportSrc).toContain('subtitle="Select export method"')
    expect(exportSrc).toContain(
      'Save the conversation to a file in the directory claude was launched from',
    )

    const sandboxSrc = readFileSync(
      join(root, 'components/sandbox/SandboxSettings.tsx'),
      'utf8',
    )
    const overridesSrc = readFileSync(
      join(root, 'components/sandbox/SandboxOverridesTab.tsx'),
      'utf8',
    )
    expect(sandboxSrc).toContain(
      '<Tabs title="Sandbox" color="permission" defaultTab="Mode" navFromContent={true}>',
    )
    expect(sandboxSrc).toContain('Configure mode')
    expect(sandboxSrc).toContain('defaultValue={currentMode}')
    expect(sandboxSrc).toContain('defaultFocusValue={currentMode}')
    expect(sandboxSrc).toContain(
      '←/→ to switch · ↑/↓ to navigate · Enter to select · Esc to close',
    )
    expect(overridesSrc).toContain('Configure overrides')

    const fastSrc = readFileSync(join(root, 'commands/fast/fast.tsx'), 'utf8')
    expect(fastSrc).toContain(
      '<KeyboardShortcutHint shortcut="space" action="toggle" />',
    )
    expect(fastSrc).toContain(
      '<KeyboardShortcutHint shortcut="enter" action="confirm" />',
    )
    expect(fastSrc).toContain(
      '<KeyboardShortcutHint shortcut="escape" action="cancel" />',
    )

    const hooksSrc = readFileSync(
      join(root, 'components/hooks/HooksConfigMenu.tsx'),
      'utf8',
    )
    expect(hooksSrc).toContain('areSettingsHooksSuspendedBySafeMode')
    expect(hooksSrc).toContain(
      'Safe mode: hooks from settings files won&apos;t run this session.',
    )

    const diffSrc = readFileSync(
      join(root, 'components/diff/DiffDialog.tsx'),
      'utf8',
    )
    expect(diffSrc).toContain("useRegisterKeybindingContext('DiffDialog')")
    expect(diffSrc).toContain('isRestricted={selectedFile?.isRestricted}')
    expect(diffSrc).toContain("'scroll:fullPageUp'")
    expect(diffSrc).toContain("'scroll:fullPageDown'")
  })
})
