/**
 * densable 2.1.224 #24 — org_record / consented_payload baseline.
 *
 * Isolation without process-global mock.module:
 * - CLAUDE_CONFIG_DIR env keys getClaudeConfigHomeDir memo (no mock pollution)
 * - saveGlobalConfig mutates TEST_GLOBAL_CONFIG_FOR_TESTING under NODE_ENV=test
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGlobalConfig, saveGlobalConfig } from '../../../utils/config.js'
import {
  buildConsentBaseline,
  clearOrgConsentFile,
  getConsentIdentity,
  getOrgDangerousSettingsHash,
  hasDangerousSettingsChangedAgainstBaseline,
  hashSettingsDangerousProjection,
  recordOrgConsent,
} from '../orgConsent.js'

const dangerousSettings = {
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
} as never

const sameDangerousSettings = {
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
} as never

const changedDangerousSettings = {
  env: { ANTHROPIC_API_KEY: 'sk-other' },
  hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
} as never

describe('densable 2.1.224 #24 org consent baseline', () => {
  let configHome: string
  let prevConfigDir: string | undefined
  let prevOauth: ReturnType<typeof getGlobalConfig>['oauthAccount']

  beforeEach(async () => {
    configHome = await mkdtemp(join(tmpdir(), 'org-consent-'))
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configHome
    prevOauth = getGlobalConfig().oauthAccount
    saveGlobalConfig(c => ({
      ...c,
      oauthAccount: {
        ...(c.oauthAccount ?? {}),
        organizationUuid: 'org-1',
        accountUuid: 'acct-1',
      } as never,
    }))
  })

  afterEach(async () => {
    await clearOrgConsentFile()
    await rm(configHome, { recursive: true, force: true })
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    saveGlobalConfig(c => ({
      ...c,
      oauthAccount: prevOauth,
    }))
  })

  test('getConsentIdentity reads org+account', () => {
    expect(getConsentIdentity()).toEqual({
      organizationUuid: 'org-1',
      accountUuid: 'acct-1',
    })
  })

  test('record + get org hash survives as org_record baseline', async () => {
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const hash = await getOrgDangerousSettingsHash(getConsentIdentity()!)
    expect(hash).not.toBeNull()
    expect(hash).toBe(hashSettingsDangerousProjection(dangerousSettings))

    const baseline = await buildConsentBaseline(null)
    expect(baseline.source).toBe('org_record')
    if (baseline.source === 'org_record') {
      expect(baseline.dangerousSettingsHash).toBe(hash as string)
    }

    expect(
      hasDangerousSettingsChangedAgainstBaseline(
        baseline,
        sameDangerousSettings,
      ),
    ).toBe(false)
  })

  test('changed dangerous projection re-prompts', async () => {
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const baseline = await buildConsentBaseline(null)
    expect(
      hasDangerousSettingsChangedAgainstBaseline(
        baseline,
        changedDangerousSettings,
      ),
    ).toBe(true)
  })

  test('without org record falls back to consented_payload content compare', async () => {
    const baseline = await buildConsentBaseline(dangerousSettings)
    expect(baseline.source).toBe('consented_payload')
    expect(
      hasDangerousSettingsChangedAgainstBaseline(
        baseline,
        sameDangerousSettings,
      ),
    ).toBe(false)
    expect(
      hasDangerousSettingsChangedAgainstBaseline(
        baseline,
        changedDangerousSettings,
      ),
    ).toBe(true)
  })

  test('wipe cache (null) without org_record would re-prompt — org_record prevents it', async () => {
    const legacy = {
      source: 'consented_payload' as const,
      settings: null,
    }
    expect(
      hasDangerousSettingsChangedAgainstBaseline(legacy, dangerousSettings),
    ).toBe(true)

    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const orgBaseline = await buildConsentBaseline(null)
    expect(
      hasDangerousSettingsChangedAgainstBaseline(
        orgBaseline,
        dangerousSettings,
      ),
    ).toBe(false)
  })
})
