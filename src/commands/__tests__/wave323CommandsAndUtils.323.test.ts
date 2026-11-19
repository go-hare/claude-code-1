import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import diffCommand from '../diff/index.js'
import { isFastModePersistedToSettings } from '../fast/fast.js'
import {
  getAntAuthFallbackNotice,
  hasCustomXApiKeyHeader,
} from '../login/getAuthStatus.js'
import { fleetHostLogout } from '../logout/logout.js'
import stickersCommand from '../stickers/index.js'
import { call as stickersCall } from '../stickers/stickers.js'
import {
  AGENT_VIEW_ESC_CLEAR_HINT,
  AGENT_VIEW_RESTORE_HINT,
  restoreAgentViewKilledDraft,
  stepAgentViewEscapeDraft,
} from '../../screens/AgentView.js'
import {
  CHROME_SETUP_ABORTED_STEERING,
  CHROME_SETUP_CONNECT_FAILED_STEERING,
  CHROME_SETUP_INTERNAL_ERROR_STEERING,
  CHROME_SETUP_SKIPPED_STEERING,
} from '../../utils/claudeInChrome/installUpsell.js'
import {
  CLAUDE_IN_CHROME_POLICY_BLOCKED_MESSAGE,
  isChromeExplicitlyOptedIn,
} from '../../utils/claudeInChrome/setup.js'
import { resolveSandboxedGlabCwd } from '../../utils/ghPrStatus.js'
import {
  buildPerforceModeOffNotice,
  hasPerforceWorkspaceSettings,
} from '../../utils/perforceMode.js'
import { maskPickedFileReferences } from '../../utils/processUserInput/processUserInput.js'
import {
  extractSideQuestionResponse,
  filterNewSideQuestionMessages,
} from '../../utils/sideQuestion.js'
import type { Message } from '../../types/message.js'
import type { UUID } from 'crypto'

const savedCustomHeaders = process.env.ANTHROPIC_CUSTOM_HEADERS
const savedUseVertex = process.env.CLAUDE_CODE_USE_VERTEX
const savedFullscreen = process.env.CLAUDE_CODE_NO_FLICKER

afterEach(() => {
  if (savedCustomHeaders === undefined) {
    delete process.env.ANTHROPIC_CUSTOM_HEADERS
  } else {
    process.env.ANTHROPIC_CUSTOM_HEADERS = savedCustomHeaders
  }
  if (savedUseVertex === undefined) {
    delete process.env.CLAUDE_CODE_USE_VERTEX
  } else {
    process.env.CLAUDE_CODE_USE_VERTEX = savedUseVertex
  }
  if (savedFullscreen === undefined) {
    delete process.env.CLAUDE_CODE_NO_FLICKER
  } else {
    process.env.CLAUDE_CODE_NO_FLICKER = savedFullscreen
  }
})

describe('Wave 323 Commands, REPL Utils & AgentView', () => {
  test('#1975 Perforce startup notice fires when Perforce settings exist and mode is off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p4-test-'))
    try {
      expect(hasPerforceWorkspaceSettings(dir, {})).toBe(false)
      expect(buildPerforceModeOffNotice(dir, {})).toBeNull()

      writeFileSync(join(dir, '.p4config'), 'P4PORT=ssl:p4:1666\n')
      expect(hasPerforceWorkspaceSettings(dir, {})).toBe(true)
      const notice = buildPerforceModeOffNotice(dir, {})
      expect(notice?.key).toBe('perforce-mode-off')
      expect(notice?.text).toContain('CLAUDE_CODE_PERFORCE_MODE=1')

      expect(
        buildPerforceModeOffNotice(dir, { CLAUDE_CODE_PERFORCE_MODE: '1' }),
      ).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#2003 custom X-Api-Key header suppresses ant auth login billing notice', () => {
    expect(hasCustomXApiKeyHeader('X-Api-Key: sk-test-123')).toBe(true)
    expect(hasCustomXApiKeyHeader('x-api-key: sk-test-123\nX-Foo: bar')).toBe(
      true,
    )
    expect(hasCustomXApiKeyHeader('X-Other: foo')).toBe(false)
    expect(
      getAntAuthFallbackNotice({ customHeaders: 'X-Api-Key: sk-test-123' }),
    ).toBeNull()
  })

  test('#2036 fast mode is session-only on Vertex (not persisted to user settings)', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(isFastModePersistedToSettings()).toBe(false)
  })

  test('#2060 /diff is immediate in fullscreen when invoked without args', () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '1'
    expect(diffCommand.immediate('', 'fullscreen')).toBe(true)
    expect(diffCommand.immediate('')).toBe(true)
    expect(diffCommand.immediate('', 'inline')).toBe(false)
  })

  test('#2070, #2084, #2099 Chrome policy message omits admin remedy and setup tells users to restart with claude --chrome', () => {
    expect(CLAUDE_IN_CHROME_POLICY_BLOCKED_MESSAGE).toBe(
      "Claude in Chrome is disabled by your organization's policy.",
    )
    expect(CLAUDE_IN_CHROME_POLICY_BLOCKED_MESSAGE.toLowerCase()).not.toContain(
      'admin',
    )
    expect(isChromeExplicitlyOptedIn(true, {})).toBe(true)
    expect(
      isChromeExplicitlyOptedIn(false, { CLAUDE_CODE_ENABLE_CFC: '1' }),
    ).toBe(false)
    for (const msg of [
      CHROME_SETUP_SKIPPED_STEERING,
      CHROME_SETUP_CONNECT_FAILED_STEERING,
      CHROME_SETUP_ABORTED_STEERING,
      CHROME_SETUP_INTERNAL_ERROR_STEERING,
    ]) {
      expect(msg).toContain('claude --chrome')
      expect(msg).not.toContain('/chrome completes')
    }
  })

  test('#2075 /btw filters out earlier parent conversation replies and API errors', () => {
    const parentUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UUID
    const newUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as UUID
    const parentReply = {
      type: 'assistant',
      uuid: parentUuid,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'earlier reply' }],
      },
    } as unknown as Message
    const freshReply = {
      type: 'assistant',
      uuid: newUuid,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'side answer' }],
      },
    } as unknown as Message

    const filtered = filterNewSideQuestionMessages(
      [parentReply, freshReply],
      new Set([parentUuid]),
    )
    expect(extractSideQuestionResponse(filtered)).toEqual({
      response: 'side answer',
      synthetic: false,
    })
  })

  test('#2129 AgentView Esc requires second press to clear prompt and ctrl+y restores it', () => {
    const first = stepAgentViewEscapeDraft({
      simpleView: false,
      queryIsFilter: false,
      dispatchInput: 'fix flaky test',
      currentHint: null,
    })
    expect(first.action).toBe('arm')
    expect(first.nextHint).toBe(AGENT_VIEW_ESC_CLEAR_HINT)

    const second = stepAgentViewEscapeDraft({
      simpleView: false,
      queryIsFilter: false,
      dispatchInput: 'fix flaky test',
      currentHint: AGENT_VIEW_ESC_CLEAR_HINT,
    })
    expect(second.action).toBe('clear')
    expect(second.killedText).toBe('fix flaky test')
    expect(second.nextHint).toBe(AGENT_VIEW_RESTORE_HINT)

    expect(restoreAgentViewKilledDraft('', second.killedText!)).toBe(
      'fix flaky test',
    )
  })

  test('#2181 GitLab MR badge refuses repositories outside the sandboxed session checkout', async () => {
    const refused = await resolveSandboxedGlabCwd({
      sandboxEnabled: true,
      originalCwd: '/repo-a',
      currentCwd: '/repo-b',
      resolveGitRoot: dir => dir,
      resolveRealpath: async dir => dir,
      checkLocalGlabConfig: async () => 'none',
    })
    expect(refused).toBeNull()

    const allowed = await resolveSandboxedGlabCwd({
      sandboxEnabled: true,
      originalCwd: '/repo-a',
      currentCwd: '/repo-a/sub',
      resolveGitRoot: () => '/repo-a',
      resolveRealpath: async dir => dir,
      checkLocalGlabConfig: async () => 'none',
    })
    expect(allowed).toBe('/repo-a')

    const localConfigBlocked = await resolveSandboxedGlabCwd({
      sandboxEnabled: true,
      originalCwd: '/repo-a',
      currentCwd: '/repo-a',
      resolveGitRoot: () => '/repo-a',
      resolveRealpath: async dir => dir,
      checkLocalGlabConfig: async () => 'found',
    })
    expect(localConfigBlocked).toBeNull()
  })

  test('#2192 /stickers reports sticker pack all claimed without opening browser', async () => {
    expect(stickersCommand.description).toBe(
      'Check Claude Code sticker availability',
    )
    const res = await stickersCall()
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.value).toContain('Claude Code sticker pack')
      expect(res.value).toContain('All claimed for now. Thanks for the love.')
    }
  })

  test('#2194 maskPickedFileReferences blanks /skill and @file between picked files or after picked file + link', () => {
    const betweenPickedFiles =
      '@[a.ts](claude-ref:file_1 "a.ts") /commit @secret.env @[b.ts](claude-ref:file_2 "b.ts")'
    const maskedBetween = maskPickedFileReferences(betweenPickedFiles)
    expect(maskedBetween).not.toContain('/commit')
    expect(maskedBetween).not.toContain('@secret.env')

    const afterPickedAndLink =
      '@[a.ts](claude-ref:file_1 "a.ts") [link](https://example.com) /commit @secret.env'
    const maskedAfterLink = maskPickedFileReferences(afterPickedAndLink)
    expect(maskedAfterLink).not.toContain('/commit')
    expect(maskedAfterLink).not.toContain('@secret.env')

    const plain = 'please run /commit and check @src/index.ts'
    expect(maskPickedFileReferences(plain)).toBe(plain)
  })

  test('#2206 fleetHostLogout helper is exported and callable', () => {
    expect(typeof fleetHostLogout).toBe('function')
  })
})
