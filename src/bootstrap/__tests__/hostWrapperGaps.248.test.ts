/**
 * densable 2.1.248 leftover STATE wrappers for Ie / ce bags already on host.
 * Gold: gold-248-ie-wrappers / gold-248-host-missing / gold-248-turn-map.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  getBootstrapSession,
  getBootstrapSessionHost,
  resetSessionHostForTests,
} from '../../utils/sessionHost.js'
import {
  getCliSessionConfigCarried,
  getDisableSlashCommands,
  getFlagSettingsExpectedContent,
  getHasStreamingInput,
  getPermissionPromptToolName,
  getPrintOutputFormat,
  getPromptIndex,
  getSearchToolsOptIn,
  getThinkingDisplayExplicit,
  getWizardOperatorToolsEnabled,
  incrementPromptIndex,
  isPollEventIngressWired,
  isSingleShotPrintSession,
  markPollEventIngressWired,
  regenerateSessionId,
  resetStateForTests,
  setCliSessionConfigCarried,
  setDisableSlashCommands,
  setFlagSettingsExpectedContent,
  setHasStreamingInput,
  setPermissionPromptToolName,
  setPrintOutputFormat,
  setPromptId,
  setSearchToolsOptIn,
  setSingleShotPrintSession,
  setThinkingDisplayExplicit,
  setWizardOperatorToolsEnabled,
} from '../state.js'

const stateSrc = () =>
  readFileSync(join(import.meta.dir, '../state.ts'), 'utf8')

describe('248 host wrapper gaps (Ie + requestJournal)', () => {
  afterEach(() => {
    resetStateForTests()
    resetSessionHostForTests()
  })

  test('promptIndex wrappers go through requestJournal; clear resets index', () => {
    const src = stateSrc()
    expect(src).toContain(
      'function Dvt(){return n().requestJournal.promptIndex()}',
    )
    expect(src).toContain(
      'function mTn(){return n().requestJournal.incrementPromptIndex()}',
    )
    expect(src).not.toMatch(/STATE\.promptIndex/)

    expect(getPromptIndex()).toBe(0)
    expect(incrementPromptIndex()).toBe(1)
    expect(getPromptIndex()).toBe(1)
    expect(getBootstrapSession().requestJournal.promptIndex()).toBe(1)

    setPromptId('p1')
    regenerateSessionId()
    expect(getPromptIndex()).toBe(0)
    expect(getBootstrapSession().requestJournal.promptIndex()).toBe(0)
  })

  test('Ie leftover wrappers from gold-248-ie-wrappers / host-missing', () => {
    const src = stateSrc()
    expect(src).toContain(
      'function xEn(){return n().host.launchOptions.printOutputFormat()}',
    )
    expect(src).toContain(
      'function bvt(){return n().host.launchOptions.thinkingDisplayExplicit()}',
    )
    expect(src).toContain(
      'function s7e(){return n().host.launchOptions.hasStreamingInput()}',
    )
    expect(src).toContain(
      'function NEn(){return n().host.launchOptions.singleShotPrintSession()}',
    )
    expect(src).toContain(
      'function WEn(){return n().host.launchOptions.pollEventIngressWired()}',
    )
    expect(src).toContain(
      'function xwn(){return n().host.launchOptions.cliSessionConfigCarried()}',
    )
    expect(src).toContain(
      'function vg(){return n().host.launchOptions.disableSlashCommands()}',
    )
    expect(src).not.toContain('export function getSessionStartType')

    const opts = getBootstrapSessionHost().launchOptions
    setPrintOutputFormat('stream-json')
    expect(getPrintOutputFormat()).toBe('stream-json')
    expect(opts.printOutputFormat()).toBe('stream-json')

    setThinkingDisplayExplicit(true)
    expect(getThinkingDisplayExplicit()).toBe(true)
    expect(opts.thinkingDisplayExplicit()).toBe(true)

    setPermissionPromptToolName('AskUserQuestion')
    expect(getPermissionPromptToolName()).toBe('AskUserQuestion')

    setHasStreamingInput(true)
    expect(getHasStreamingInput()).toBe(true)
    expect(opts.hasStreamingInput()).toBe(true)

    setSingleShotPrintSession(true)
    expect(isSingleShotPrintSession()).toBe(true)

    expect(isPollEventIngressWired()).toBe(false)
    markPollEventIngressWired()
    expect(isPollEventIngressWired()).toBe(true)
    expect(opts.pollEventIngressWired()).toBe(true)

    setSearchToolsOptIn(true)
    expect(getSearchToolsOptIn()).toBe(true)

    setWizardOperatorToolsEnabled(true)
    expect(getWizardOperatorToolsEnabled()).toBe(true)
    expect(() => setWizardOperatorToolsEnabled(false)).toThrow(/test-only/)

    setCliSessionConfigCarried(true)
    expect(getCliSessionConfigCarried()).toBe(true)

    setDisableSlashCommands(true)
    expect(getDisableSlashCommands()).toBe(true)

    setFlagSettingsExpectedContent({ a: 1 })
    expect(getFlagSettingsExpectedContent()).toEqual({ a: 1 })
  })
})
