import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CLIPBOARD_COPY_STATUS,
  formatCopyClipboardSummary,
  resolveClipboardCopyOutcome,
} from '../copy/copy.js'
import { maskPastedOAuthCode } from '../design-login/designLogin.js'
import { formatExportClipboardMessage } from '../export/export.js'
import { checkMemoryFileReadOnlyWarning } from '../memory/memory.js'
import { call as callPlan } from '../plan/plan.js'
import {
  createSerializedPrivacyToggleController,
  verifyPrivacyAccountUnchanged,
} from '../privacy-settings/privacy-settings.js'
import { untrustedAddedFolder } from '../add-dir/validation.js'

describe('Wave 326 Group 4D: Commands & Sub-Wave 326-I Wiring', () => {
  test('#46: /plan <description> preserves description when already in plan mode', async () => {
    const doneCalls: Array<{ msg?: string; opts?: { shouldQuery?: boolean } }> =
      []
    const ctx = {
      getAppState: () => ({
        toolPermissionContext: { mode: 'plan' },
      }),
      setAppState: () => {},
    } as unknown as Parameters<typeof callPlan>[1]

    await callPlan(
      (msg, opts) => {
        doneCalls.push({ msg, opts: opts as { shouldQuery?: boolean } })
      },
      ctx,
      'refactor the auth flow',
    )

    expect(doneCalls).toHaveLength(1)
    expect(doneCalls[0]?.msg).toBe('Already in plan mode.')
    expect(doneCalls[0]?.opts?.shouldQuery).toBe(true)
  })

  test('#71: serialized privacy toggle controller prevents double-press inversion, ignores post-Esc keys, and reports failures', async () => {
    const saved: boolean[] = []
    const states: Array<{
      enabled: boolean
      saving: boolean
      error: string | null
    }> = []
    const chosen: boolean[] = []
    let releaseFirst!: () => void
    let callCount = 0

    const controller = createSerializedPrivacyToggleController({
      initialEnabled: false,
      confirmSave: async () => ({ ok: true }),
      saveSetting: async enabled => {
        callCount += 1
        if (callCount === 1) {
          await new Promise<void>(resolve => {
            releaseFirst = resolve
          })
        }
        saved.push(enabled)
      },
      onStateChange: s => states.push(s),
      onChoose: v => chosen.push(v),
    })

    // Rapid double toggle while first save is in flight: false -> true -> false
    const p1 = controller.toggle()
    await Promise.resolve()
    const p2 = controller.toggle()
    expect(controller.getDisplayed()).toBe(false)
    releaseFirst()
    await Promise.all([p1, p2])
    expect(saved).toEqual([true, false])
    expect(controller.getDisplayed()).toBe(false)

    // Keys after close (Esc) are ignored
    controller.close()
    await controller.toggle()
    expect(saved).toEqual([true, false])
    expect(controller.isClosed()).toBe(true)

    // Save error reverts displayed value and surfaces error message
    const failStates: Array<{
      enabled: boolean
      saving: boolean
      error: string | null
    }> = []
    const failController = createSerializedPrivacyToggleController({
      initialEnabled: true,
      confirmSave: async () => ({ ok: true }),
      saveSetting: async () => {
        throw new Error('503 Service Unavailable')
      },
      onStateChange: s => failStates.push(s),
      onChoose: () => {},
    })
    await failController.toggle()
    expect(failController.getDisplayed()).toBe(true)
    expect(failStates.at(-1)?.error).toContain(
      "Couldn't save your privacy setting.",
    )
    expect(failStates.at(-1)?.error).toContain('503 Service Unavailable')
  })

  test('#72 & #73: verifyPrivacyAccountUnchanged detects account switch & privacy-settings clears grove cache', async () => {
    expect(
      await verifyPrivacyAccountUnchanged(
        { accountUuid: 'acct-1', accessToken: 'tok-1' },
        async () => ({ accountUuid: 'acct-2', accessToken: 'tok-2' }),
      ),
    ).toBe('changed')

    expect(
      await verifyPrivacyAccountUnchanged(
        { accountUuid: 'acct-1', accessToken: 'tok-1' },
        async () => ({ accountUuid: 'acct-1', accessToken: 'tok-1' }),
      ),
    ).toBe('same')

    const src = readFileSync(
      join(import.meta.dir, '../privacy-settings/privacy-settings.tsx'),
      'utf8',
    )
    expect(src).toContain('getGroveSettings.cache.clear?.()')
    expect(src).toContain('The signed-in account changed.')
  })

  test('#152: checkMemoryFileReadOnlyWarning warns for read-only memory files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-mem-ro-'))
    const file = join(dir, 'CLAUDE.md')
    try {
      writeFileSync(file, '# notes\n', 'utf8')
      expect(await checkMemoryFileReadOnlyWarning(file)).toBe('')
      chmodSync(file, 0o444)
      const warning = await checkMemoryFileReadOnlyWarning(file)
      // Under non-root macOS/Linux, W_OK fails with EACCES -> read-only warning
      if (process.getuid?.() !== 0) {
        expect(warning).toContain(
          'This file is read-only, so your changes may not save.',
        )
      }
    } finally {
      try {
        chmodSync(file, 0o644)
      } catch {
        // ignore
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#177: /copy and /export report honest clipboard status over SSH / OSC 52 / tmux', () => {
    expect(CLIPBOARD_COPY_STATUS.osc52).toBe(
      "sent to your terminal's clipboard",
    )
    expect(resolveClipboardCopyOutcome('', 'osc52', {})).toBe('none')
    expect(resolveClipboardCopyOutcome('\x1b]52;c;YQ==\x07', 'osc52', {})).toBe(
      'osc52',
    )
    expect(
      resolveClipboardCopyOutcome('\x1b]52;c;YQ==\x07', 'native', {
        SSH_CONNECTION: '1 2 3 4',
      }),
    ).toBe('osc52')

    expect(formatCopyClipboardSummary('osc52', 12, 2)).toBe(
      "Sent to your terminal's clipboard (12 characters, 2 lines)",
    )
    expect(formatCopyClipboardSummary('none', 1, 1)).toBe(
      'Not copied to clipboard (1 character, 1 line)',
    )
    expect(formatExportClipboardMessage('osc52', {})).toBe(
      "Conversation sent to your terminal's clipboard · if paste fails, /export to a file",
    )
    expect(
      formatExportClipboardMessage('native', { SSH_TTY: '/dev/pts/0' }),
    ).toContain("sent to your terminal's clipboard")
    expect(formatExportClipboardMessage('tmux-buffer', {})).toBe(
      'Conversation copied to tmux buffer · paste with prefix + ]',
    )
  })

  test('#268: /design-login and OAuthFlowStep mask pasted OAuth code', () => {
    expect(maskPastedOAuthCode('secretCode#state123')).toBe(
      '*******************',
    )
    expect(maskPastedOAuthCode('')).toBe('')
    const oauthStepSrc = readFileSync(
      join(import.meta.dir, '../install-github-app/OAuthFlowStep.tsx'),
      'utf8',
    )
    expect(oauthStepSrc).toContain('mask="*"')
  })

  test('#238, #67, #16, #51, #299, #101, #323: production main call-chain wiring verification', () => {
    const logoutSrc = readFileSync(
      join(import.meta.dir, '../logout/logout.tsx'),
      'utf8',
    )
    expect(logoutSrc).toContain('revokeOAuthRefreshTokenWithRetry')
    expect(logoutSrc).toContain('formatRevokeUnconfirmedMessage')
    expect(logoutSrc).toContain('finalMessage:')

    const addDirSrc = readFileSync(
      join(import.meta.dir, '../add-dir/add-dir.tsx'),
      'utf8',
    )
    expect(addDirSrc).toContain('persistPermissionUpdates')
    expect(addDirSrc).toContain('onPersistError')
    expect(addDirSrc).toContain('AddedFolderTrustPrompt')
    expect(addDirSrc).toContain('folderToTrustBeforeAdding')

    const clearSrc = readFileSync(
      join(import.meta.dir, '../clear/clear.ts'),
      'utf8',
    )
    expect(clearSrc).toContain('clearCachedModelMaxTokensCeilings()')

    const sandboxSrc = readFileSync(
      join(import.meta.dir, '../sandbox-toggle/sandbox-toggle.tsx'),
      'utf8',
    )
    expect(sandboxSrc).toContain('clearSandboxRootMoveHold()')

    const autofixSrc = readFileSync(
      join(import.meta.dir, '../autofix-pr/launchAutofixPr.ts'),
      'utf8',
    )
    expect(autofixSrc).toContain('archiveRemoteSession')
    expect(autofixSrc).toContain('Stop it here:')

    // #323 untrustedAddedFolder returns folder descriptor when checkPersistedTrust=false
    const tmpDir = mkdtempSync(join(tmpdir(), 'claude-untrusted-dir-'))
    try {
      const result = untrustedAddedFolder(tmpDir, false)
      expect(result).toBeDefined()
      expect(result?.path).toBeTruthy()
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
