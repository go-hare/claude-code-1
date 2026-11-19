import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CD_TRUST_SHORT_WINDOW_WARNING,
  isTrustPromptCutOff,
} from '../../../commands/cd/CdTrustPrompt.js'
import {
  readCdDisclosures,
  shouldShowCdDisclosures,
} from '../../../commands/cd/cdDisclosures.js'
import {
  ANTHROPIC_API_KEY_NOT_USED_HINT,
  isAnthropicApiKeyEnvUnused,
} from '../../../commands/login/getAuthStatus.js'
import {
  ANTHROPIC_API_KEY_STILL_USED_MESSAGE,
  formatLoginDoneMessage,
} from '../../../commands/login/oauthTokenEnvWarning.js'
import {
  isNonConsoleOrganizationType,
  NOT_CONSOLE_ACCOUNT_MESSAGE,
  validateManualAuthCodeInput,
} from '../../ConsoleOAuthFlow.js'
import {
  CONFIRM_SELECT_ARM_MS,
  confirmSelectRefused,
} from '../../ConfirmSelect.js'
import { createAutoDefaultNudgeStrayTypingGuard } from '../../../dialog/dialogs/AutoDefaultNudgeDialog.js'
import {
  isSessionExiting,
  markSessionExiting,
  resetSessionExitingForTest,
} from '../../../dialog/useDialogMailboxBridge.js'
import { TRUST_DIALOG_DECLINE_EXIT_MESSAGE } from '../TrustDialog.js'
import { formatTrustSettingsFilesDisclosure } from '../utils.js'

describe('Wave 326 Group 4C — Trust, Onboarding, Auth & Exit', () => {
  test('#251 formatTrustSettingsFilesDisclosure annotates command-running and env-var files and omits settings on backstop', () => {
    const normal = formatTrustSettingsFilesDisclosure({
      settingsFiles: ['.claude/settings.json', '.claude/settings.local.json'],
      commandRunningFiles: new Set(['.claude/settings.json']),
      envVarFiles: ['.claude/settings.json', '.claude/settings.local.json'],
      hasMcpServers: true,
      isBackstop: false,
    })
    expect(normal).toEqual([
      '.claude/settings.json (runs commands and sets environment variables)',
      '.claude/settings.local.json (sets environment variables)',
      '.mcp.json here or above (MCP servers)',
    ])

    const backstop = formatTrustSettingsFilesDisclosure({
      settingsFiles: ['.claude/settings.json'],
      commandRunningFiles: new Set(['.claude/settings.json']),
      envVarFiles: ['.claude/settings.json'],
      hasMcpServers: true,
      isBackstop: true,
    })
    expect(backstop).toEqual(['.mcp.json here or above (MCP servers)'])
  })

  test('#251 readCdDisclosures populates settingsFiles and triggers shouldShowCdDisclosures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-disclosures-326-'))
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true })
      writeFileSync(
        join(dir, '.claude', 'settings.json'),
        JSON.stringify({ theme: 'light' }),
      )
      const disclosures = readCdDisclosures(dir)
      expect(disclosures.settingsFiles).toEqual(['.claude/settings.json'])
      expect(shouldShowCdDisclosures(disclosures, false)).toBe(true)
      expect(shouldShowCdDisclosures(disclosures, true)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#252 TRUST_DIALOG_DECLINE_EXIT_MESSAGE explains why Claude Code did not start', () => {
    expect(TRUST_DIALOG_DECLINE_EXIT_MESSAGE).toContain(
      "Claude Code didn't start because this folder isn't trusted.",
    )
    expect(TRUST_DIALOG_DECLINE_EXIT_MESSAGE).toContain('choose Yes')
  })

  test('#348 isTrustPromptCutOff refuses Yes only in fullscreen when content exceeds available rows', () => {
    expect(CD_TRUST_SHORT_WINDOW_WARNING).toBe(
      'To trust this folder, first make the window taller',
    )
    expect(
      isTrustPromptCutOff({
        fullscreen: false,
        contentHeight: 30,
        availableRows: 12,
      }),
    ).toBe(false)
    expect(
      isTrustPromptCutOff({
        fullscreen: true,
        contentHeight: 20,
        availableRows: 16,
      }),
    ).toBe(true)
    expect(
      isTrustPromptCutOff({
        fullscreen: true,
        contentHeight: 10,
        availableRows: 24,
      }),
    ).toBe(false)
  })

  test('#25 & #26 AutoDefaultNudge stray-typing guard locks Enter until navigation and preserves draft', () => {
    const now = 1000
    expect(confirmSelectRefused(now, CONFIRM_SELECT_ARM_MS, now + 100)).toBe(
      true,
    )
    expect(
      confirmSelectRefused(
        now,
        CONFIRM_SELECT_ARM_MS,
        now + CONFIRM_SELECT_ARM_MS,
      ),
    ).toBe(false)

    const guard = createAutoDefaultNudgeStrayTypingGuard()
    expect(guard.isEnterLocked()).toBe(false)
    guard.capturePrintable('fix the bug')
    expect(guard.isEnterLocked()).toBe(true)
    expect(guard.getDraft()).toBe('fix the bug')
    guard.backspace()
    expect(guard.getDraft()).toBe('fix the bu')
    guard.unlockByNavigation()
    expect(guard.isEnterLocked()).toBe(false)
    expect(guard.getDraft()).toBe('fix the bu')
  })

  test('#57 Console sign-in rejects non-Console subscription organization types', () => {
    expect(isNonConsoleOrganizationType('api_individual')).toBe(false)
    expect(isNonConsoleOrganizationType('api_team')).toBe(false)
    expect(isNonConsoleOrganizationType('claude_pro')).toBe(true)
    expect(isNonConsoleOrganizationType('claude_max')).toBe(true)
    expect(isNonConsoleOrganizationType('claude_enterprise')).toBe(true)
    expect(isNonConsoleOrganizationType(undefined)).toBe(false)
    expect(NOT_CONSOLE_ACCOUNT_MESSAGE).toContain(
      "isn't for an Anthropic Console account",
    )
    expect(NOT_CONSOLE_ACCOUNT_MESSAGE).toContain(
      'Nothing on this computer changed',
    )
  })

  test('#58 & #59 ANTHROPIC_API_KEY precedence warnings on /login done and unused env hint', () => {
    const stillUsed = formatLoginDoneMessage(true, { apiKeyStillUsed: true })
    expect(stillUsed).toBe(ANTHROPIC_API_KEY_STILL_USED_MESSAGE)
    expect(stillUsed).toContain('turn off "Use custom API key" in /config')

    const normal = formatLoginDoneMessage(true, { apiKeyStillUsed: false })
    expect(normal).toBe('Login successful')

    expect(ANTHROPIC_API_KEY_NOT_USED_HINT).toBe(
      'ANTHROPIC_API_KEY not used here · turn on "Use custom API key" in /config',
    )
    expect(typeof isAnthropicApiKeyEnvUnused()).toBe('boolean')
  })

  test('#266 validateManualAuthCodeInput returns targeted guidance for URLs, OTPs, and incomplete codes', () => {
    const localUrl = validateManualAuthCodeInput(
      'http://localhost:54321/callback?code=abc',
    )
    expect(localUrl.ok).toBe(false)
    if (!localUrl.ok) {
      expect(localUrl.problem).toContain(
        'only works in a browser on this machine',
      )
    }

    const webUrl = validateManualAuthCodeInput(
      'https://claude.ai/magic-link#xyz',
    )
    expect(webUrl.ok).toBe(false)
    if (!webUrl.ok) {
      expect(webUrl.problem).toContain("That's a web address, not the code")
    }

    const otp = validateManualAuthCodeInput('123 456')
    expect(otp.ok).toBe(false)
    if (!otp.ok) {
      expect(otp.problem).toContain('verification code')
    }

    const missingHash = validateManualAuthCodeInput('only-auth-code-no-state')
    expect(missingHash.ok).toBe(false)
    if (!missingHash.ok) {
      expect(missingHash.problem).toContain('including the # in the middle')
    }

    const valid = validateManualAuthCodeInput('  authCode123#state456  ')
    expect(valid).toEqual({
      ok: true,
      authorizationCode: 'authCode123',
      state: 'state456',
    })
  })

  test('#108 markSessionExiting tracks exiting state cleanly', () => {
    resetSessionExitingForTest()
    expect(isSessionExiting()).toBe(false)
    markSessionExiting()
    expect(isSessionExiting()).toBe(true)
    resetSessionExitingForTest()
    expect(isSessionExiting()).toBe(false)
  })
})
