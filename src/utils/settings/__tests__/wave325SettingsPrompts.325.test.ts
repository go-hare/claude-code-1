import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getMaxOutputTokensRecoveryPrompt,
  MAIN_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT,
  SUBAGENT_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT,
} from '../../../query/queryHelpers.js'
import {
  isLastTurnUserStarted,
  markPersonActivityForPromptSuggestion,
  resetUnattendedPromptSuggestionStateForTests,
  shouldBackOffUnattendedPromptSuggestion,
  UNATTENDED_PROMPT_SUGGESTION_BACKOFF_THRESHOLD,
} from '../../../services/PromptSuggestion/promptSuggestion.js'
import type { Message } from '../../../types/message.js'
import {
  getProjectConfigEntryForPath,
  walkHasTrustDialogAcceptedBounded,
} from '../../config.js'
import {
  emitMidTurnUserPromptOTelEvents,
  extractOtelUserPromptText,
} from '../../processUserInput/processTextPrompt.js'
import { scanLocalSettingsGitTracked } from '../localSettingsGitTracked.js'
import {
  notifyStrictPluginOnlyPolicyIfChanged,
  registerStrictPluginOnlyChangeCallback,
  resetStrictPluginOnlyChangeStateForTests,
} from '../pluginOnlyPolicy.js'
import { filterInvalidTeammateMode } from '../settings.js'

const savedPromptSuggestionEnv =
  process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION

afterEach(() => {
  resetStrictPluginOnlyChangeStateForTests()
  resetUnattendedPromptSuggestionStateForTests()
  if (savedPromptSuggestionEnv === undefined) {
    delete process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
  } else {
    process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = savedPromptSuggestionEnv
  }
})

describe('Wave 325 Group 2 — Settings / Trust / Prompts / OTel / PromptSuggestion', () => {
  test('#2298: filterInvalidTeammateMode strips invalid value and emits warning', () => {
    const raw: Record<string, unknown> = { teammateMode: 'bogus-mode' }
    const warnings = filterInvalidTeammateMode(raw, '/tmp/settings.json')
    expect(raw.teammateMode).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.path).toBe('teammateMode')
    expect(warnings[0]?.severity).toBe('warning')
    expect(warnings[0]?.message).toContain('"bogus-mode"')

    const valid: Record<string, unknown> = { teammateMode: 'tmux' }
    expect(filterInvalidTeammateMode(valid, '/tmp/settings.json')).toEqual([])
    expect(valid.teammateMode).toBe('tmux')
  })

  test('#2318: extractOtelUserPromptText preserves all text blocks across merged queued / image messages', () => {
    expect(extractOtelUserPromptText('hello')).toBe('hello')
    const withImageAndMergedText = [
      { type: 'text' as const, text: '<ide_selection>foo</ide_selection>' },
      { type: 'text' as const, text: 'First queued prompt' },
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: 'image/png' as const,
          data: 'AAAA',
        },
      },
      { type: 'text' as const, text: 'Second follow-up prompt' },
    ]
    expect(extractOtelUserPromptText(withImageAndMergedText)).toBe(
      'First queued prompt\nSecond follow-up prompt',
    )
  })

  test('#2317: emitMidTurnUserPromptOTelEvents emits for non-meta prompts and skips meta/non-prompt', () => {
    const emitted = emitMidTurnUserPromptOTelEvents(
      [
        { mode: 'prompt', value: 'mid-turn nudge', uuid: 'u1' },
        { mode: 'prompt', value: 'meta ignored', uuid: 'u2', isMeta: true },
        { mode: 'task-notification', value: 'bg done', uuid: 'u3' },
      ],
      'turn-prompt-id-123',
    )
    expect(emitted).toBe(1)
  })

  test('#2324: scanLocalSettingsGitTracked detects committed settings.local.json from deep subfolder', () => {
    const repo = mkdtempSync(join(tmpdir(), 'cc-325-localgit-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], {
        cwd: repo,
      })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
      mkdirSync(join(repo, 'packages', 'sub', 'deep'), { recursive: true })
      mkdirSync(join(repo, 'packages', '.claude'), { recursive: true })
      writeFileSync(
        join(repo, 'packages', '.claude', 'settings.local.json'),
        '{}',
      )
      execFileSync(
        'git',
        ['add', '-f', 'packages/.claude/settings.local.json'],
        { cwd: repo },
      )
      execFileSync('git', ['commit', '-q', '-m', 'commit local settings'], {
        cwd: repo,
      })

      const verdict = scanLocalSettingsGitTracked(
        join(repo, 'packages', 'sub', 'deep'),
      )
      expect(verdict).toBe('tracked')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('#2332: strictPluginOnlyCustomization hot-reload notifies registered cache-clear callbacks', () => {
    const observed: unknown[] = []
    const unsub = registerStrictPluginOnlyChangeCallback(policy => {
      observed.push(policy)
    })
    expect(notifyStrictPluginOnlyPolicyIfChanged(undefined)).toBe(false)
    expect(observed).toEqual([])

    expect(notifyStrictPluginOnlyPolicyIfChanged(['skills', 'agents'])).toBe(
      true,
    )
    expect(observed).toEqual([['skills', 'agents']])

    // Same effective set (reordered) does not fire again
    expect(notifyStrictPluginOnlyPolicyIfChanged(['agents', 'skills'])).toBe(
      false,
    )
    expect(observed).toHaveLength(1)

    expect(notifyStrictPluginOnlyPolicyIfChanged(true)).toBe(true)
    expect(observed).toEqual([['skills', 'agents'], true])
    unsub()
  })

  test('#2339: Windows drive-letter case mismatch still matches saved hasTrustDialogAccepted', () => {
    const projects = {
      'C:/Users/alice/repo': { hasTrustDialogAccepted: true },
    } as unknown as Record<string, import('../../config.js').ProjectConfig>
    expect(
      getProjectConfigEntryForPath(projects, 'c:/Users/alice/repo')
        ?.hasTrustDialogAccepted,
    ).toBe(true)
    expect(
      walkHasTrustDialogAcceptedBounded(
        { projects },
        'c:/Users/alice/repo/packages/app',
        'C:/Users/alice/repo',
      ),
    ).toBe(true)
    expect(
      walkHasTrustDialogAcceptedBounded(
        { projects },
        'd:/Users/alice/other',
        'D:/Users/alice/other',
      ),
    ).toBe(false)
  })

  test('#2342: subagent max_output_tokens_recovery asks for the whole answer more briefly', () => {
    const subPrompt = getMaxOutputTokensRecoveryPrompt(true)
    const mainPrompt = getMaxOutputTokensRecoveryPrompt(false)
    expect(subPrompt).toBe(SUBAGENT_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT)
    expect(subPrompt).toContain('give the whole answer again, more briefly')
    expect(mainPrompt).toBe(MAIN_MAX_OUTPUT_TOKENS_RECOVERY_PROMPT)
    expect(mainPrompt).not.toBe(subPrompt)
  })

  test('#2366: prompt suggestion backs off after 8 consecutive unattended turns and resets on user activity', () => {
    delete process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
    expect(UNATTENDED_PROMPT_SUGGESTION_BACKOFF_THRESHOLD).toBe(8)

    const bgMessages = [
      {
        type: 'user',
        origin: { kind: 'task-notification' },
        message: {
          role: 'user',
          content: '<task-notification>done</task-notification>',
        },
      },
    ] as unknown as Message[]
    const humanMessages = [
      {
        type: 'user',
        message: { role: 'user', content: 'next step please' },
      },
    ] as unknown as Message[]

    expect(isLastTurnUserStarted(bgMessages)).toBe(false)
    expect(isLastTurnUserStarted(humanMessages)).toBe(true)

    const state = { personSeenAt: 0, unattendedTurns: 0 }
    // Turns 1..8: never backed off
    for (let i = 1; i <= 8; i++) {
      expect(shouldBackOffUnattendedPromptSuggestion(bgMessages, state)).toBe(
        false,
      )
    }
    // Turns 9..15: backed off; turn 16 (power of 2): allowed; turn 17: backed off
    for (let i = 9; i <= 15; i++) {
      expect(shouldBackOffUnattendedPromptSuggestion(bgMessages, state)).toBe(
        true,
      )
    }
    expect(shouldBackOffUnattendedPromptSuggestion(bgMessages, state)).toBe(
      false,
    )
    expect(shouldBackOffUnattendedPromptSuggestion(bgMessages, state)).toBe(
      true,
    )

    // Keypress / terminal focus resets the streak immediately
    markPersonActivityForPromptSuggestion(Date.now() + 1000)
    expect(shouldBackOffUnattendedPromptSuggestion(bgMessages, state)).toBe(
      false,
    )
    expect(state.unattendedTurns).toBe(1)
  })
})
