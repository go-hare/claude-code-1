/**
 * densable 2.1.283 thinking.display outbound.
 * Gold aNr @178430578; request builder Td.display=Zg @184956900;
 * DAt @184815660; display:"updates" @184957981.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { growthbookMock } from '../../../tests/mocks/growthbook'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

const settingsSnap = snapshotModuleExports(realSettings)
const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  ...growthbookMock(),
  getFeatureValue_CACHED_MAY_BE_STALE: () => true,
}))

let showThinkingSummaries: boolean | undefined
mock.module('src/utils/settings/settings.js', () => ({
  ...settingsSnap,
  getSettingsWithErrors: () => ({
    settings: { showThinkingSummaries },
    errors: [],
  }),
}))
afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../model/providers.js'
import {
  isThinkingDisplay,
  resolveOutgoingThinkingDisplay,
  resolveThinkingDisplay,
  resolveThinkingDisplayMode,
  shouldSendThinkingDisplayUpdates,
  THINKING_DISPLAY_CHOICES,
} from '../thinking.js'

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

afterEach(() => {
  showThinkingSummaries = undefined
  delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  delete process.env.CLAUDE_CODE_HIPAA
  delete process.env.CLAUDE_CODE_THINKING_DISPLAY_UPDATES
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
})

describe('densable 2.1.283 thinking.display outbound', () => {
  test('g$e choices summarized|omitted|highlights', () => {
    expect([...THINKING_DISPLAY_CHOICES]).toEqual([
      'summarized',
      'omitted',
      'highlights',
    ])
    expect(isThinkingDisplay('summarized')).toBe(true)
    expect(isThinkingDisplay('updates')).toBe(false)
  })

  test('aNr: explicit wins; interactive summarized iff setting; print text omitted', () => {
    expect(
      resolveThinkingDisplay({
        explicitDisplay: 'highlights',
        isNonInteractive: true,
        outputFormat: 'text',
        verbose: false,
      }),
    ).toBe('highlights')
    expect(
      resolveThinkingDisplay({
        explicitDisplay: undefined,
        isNonInteractive: false,
        outputFormat: 'text',
        verbose: false,
        showThinkingSummaries: true,
      }),
    ).toBe('summarized')
    expect(
      resolveThinkingDisplay({
        explicitDisplay: undefined,
        isNonInteractive: false,
        outputFormat: 'text',
        verbose: false,
        showThinkingSummaries: false,
      }),
    ).toBeUndefined()
    expect(
      resolveThinkingDisplay({
        explicitDisplay: undefined,
        isNonInteractive: true,
        outputFormat: 'text',
        verbose: false,
      }),
    ).toBe('omitted')
  })

  test('Zg puts display on adaptive/enabled thinking when experimental betas + ISP', () => {
    expect(
      resolveOutgoingThinkingDisplay('summarized', 'claude-opus-4-6'),
    ).toBe('summarized')
    expect(resolveOutgoingThinkingDisplay('omitted', 'claude-opus-4-6')).toBe(
      'omitted',
    )
    expect(
      resolveOutgoingThinkingDisplay('highlights', 'claude-opus-4-6', true),
    ).toBe('omitted')
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
    expect(
      resolveOutgoingThinkingDisplay('summarized', 'claude-opus-4-6'),
    ).toBeUndefined()
  })

  test('DAt: summarized/highlights → thinking_and_connector_text; implicit omitted → none', () => {
    expect(resolveThinkingDisplayMode('summarized', false)).toBe(
      'thinking_and_connector_text',
    )
    expect(resolveThinkingDisplayMode('highlights', true)).toBe(
      'thinking_and_connector_text',
    )
    expect(resolveThinkingDisplayMode('omitted', false)).toBe('none')
    expect(resolveThinkingDisplayMode(undefined, false)).toBe('connector_text')
    process.env.CLAUDE_CODE_THINKING_DISPLAY_UPDATES = '0'
    expect(resolveThinkingDisplayMode(undefined, false)).toBe('none')
  })

  test('connector_text updates gate: firstParty + ISP + no oauth-keyless + no extraBody thinking', () => {
    const firstPartyOk =
      getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()
    expect(
      shouldSendThinkingDisplayUpdates({
        thinkingType: 'adaptive',
        model: 'claude-opus-4-6',
        extraBodyHasThinking: false,
        simulateProxy: false,
        oauthWithoutApiKey: false,
        displayUpdatesRejected: false,
      }),
    ).toBe(firstPartyOk)
    expect(
      shouldSendThinkingDisplayUpdates({
        thinkingType: 'adaptive',
        model: 'claude-opus-4-6',
        extraBodyHasThinking: false,
        simulateProxy: false,
        oauthWithoutApiKey: true,
        displayUpdatesRejected: false,
      }),
    ).toBe(false)
    expect(
      shouldSendThinkingDisplayUpdates({
        thinkingType: 'disabled',
        model: 'claude-opus-4-6',
        extraBodyHasThinking: false,
        simulateProxy: false,
        oauthWithoutApiKey: false,
        displayUpdatesRejected: false,
      }),
    ).toBe(false)
  })

  test('request/UI path source-lock: display on thinking param when set', () => {
    const thinking = src('src/utils/thinking.ts')
    expect(thinking).toContain('densable `aNr` @178430578')
    expect(thinking).toContain('display?: ThinkingDisplay')
    expect(thinking).toContain('displayExplicit?: boolean')

    const main = src('src/main.tsx')
    expect(main).toContain('resolveThinkingDisplay({')
    expect(main).toContain('thinkingConfig.display = display')
    expect(main).toContain("'--thinking-display <display>'")

    const claude = src('src/services/api/claude.ts')
    expect(claude).toContain('resolveOutgoingThinkingDisplay(')
    expect(claude).toContain('display: wireDisplay')
    expect(claude).toContain("display: 'updates'")
    expect(claude).toContain('THINKING_DISPLAY_UPDATES_BETA_HEADER')
    expect(claude).toContain('dropRedactThinkingBeta')
    const betas = src('src/constants/betas.ts')
    expect(betas).toContain('thinking-display-updates-2026-08-18')
  })
})
