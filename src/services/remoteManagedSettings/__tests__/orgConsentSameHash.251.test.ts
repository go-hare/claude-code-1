/**
 * densable 2.1.251 #43 — Zor same-hash skip + ie/ae storage surface.
 *
 * Gold: Zor 1902036136361ee3 / ie 47feb0b8b7232527 / ae 2b9551e9d6bcc052
 * Same org+account hash → org_record and Zor returns false (no re-prompt).
 *
 * Isolation: CLAUDE_CONFIG_DIR + saveGlobalConfig under NODE_ENV=test.
 * No process-global mock.module for settings.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGlobalConfig, saveGlobalConfig } from '../../../utils/config.js'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../../../utils/storageV5/hoverRestPin.js'
import {
  buildConsentBaseline,
  clearOrgConsentFile,
  consentStorageKey,
  getConsentIdentity,
  getOrgDangerousSettingsHash,
  hasDangerousSettingsChangedAgainstBaseline,
  hashSettingsDangerousProjection,
  recordOrgConsent,
  type ConsentStorage,
} from '../orgConsent.js'

const dangerousSettings = {
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
} as never

const sameDangerousSettings = {
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
} as never

const sandboxOnly = {
  sandbox: { bwrapPath: '/usr/bin/bwrap' },
} as never

describe('densable 2.1.251 #43 Zor/ie/ae same-hash skip', () => {
  let configHome: string
  let prevConfigDir: string | undefined
  let prevOauth: ReturnType<typeof getGlobalConfig>['oauthAccount']

  beforeEach(async () => {
    configHome = await mkdtemp(join(tmpdir(), 'org-consent-251-'))
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configHome
    prevOauth = getGlobalConfig().oauthAccount
    saveGlobalConfig(c => ({
      ...c,
      oauthAccount: {
        ...(c.oauthAccount ?? {}),
        organizationUuid: 'org-43',
        accountUuid: 'acct-43',
      } as never,
    }))
    resetHoverRestPinForTests()
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
    resetHoverRestPinForTests()
  })

  test('Zor: org_record same hash after sign-in wipe returns false', async () => {
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    // simulate refreshRemoteManagedSettings cache wipe: baseline from null payload
    const baseline = await buildConsentBaseline(null)
    expect(baseline.source).toBe('org_record')
    expect(
      hasDangerousSettingsChangedAgainstBaseline(
        baseline,
        sameDangerousSettings,
      ),
    ).toBe(false)
  })

  test('Zor: org_record empty new dangerous → false', async () => {
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const baseline = await buildConsentBaseline(null)
    expect(
      hasDangerousSettingsChangedAgainstBaseline(baseline, {} as never),
    ).toBe(false)
  })

  test('Zor: sandbox-only change differs from prior shell/env hash', async () => {
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const baseline = await buildConsentBaseline(null)
    expect(
      hasDangerousSettingsChangedAgainstBaseline(baseline, sandboxOnly),
    ).toBe(true)
  })

  test('ie returns null for wrong account on same org', async () => {
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const other = {
      organizationUuid: 'org-43',
      accountUuid: 'acct-other',
    }
    expect(await getOrgDangerousSettingsHash(other)).toBeNull()
  })

  test('ae legacy arm writes mode-owner file via atomicWrite path', async () => {
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const raw = await readFile(
      join(configHome, 'remote-settings-consent.json'),
      'utf8',
    )
    const parsed = JSON.parse(raw) as {
      version: number
      records: Record<
        string,
        { accountUuid: string; dangerousSettingsHash: string }
      >
    }
    expect(parsed.version).toBe(1)
    expect(parsed.records['org-43']?.accountUuid).toBe('acct-43')
    expect(parsed.records['org-43']?.dangerousSettingsHash).toBe(
      hashSettingsDangerousProjection(dangerousSettings),
    )
  })

  test('ae hover-rest arm uses r.write(Ee.state(re), P, {mode:384})', async () => {
    pinHoverRest(true)
    const writes: Array<{
      key: unknown
      value: string
      mode?: number
    }> = []
    const storage: ConsentStorage = {
      readText: async () => ({
        ok: true,
        value: { items: [{ found: false }] },
      }),
      write: async (key, value, opts) => {
        writes.push({ key, value, mode: opts?.mode })
        return { ok: true, value: { version: '1' } }
      },
    }
    await recordOrgConsent(getConsentIdentity(), dangerousSettings, storage)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.key).toEqual(consentStorageKey())
    expect(writes[0]?.mode).toBe(384)
    const body = JSON.parse(writes[0]!.value) as {
      records: Record<string, { dangerousSettingsHash: string }>
    }
    expect(body.records['org-43']?.dangerousSettingsHash).toBe(
      hashSettingsDangerousProjection(dangerousSettings),
    )
  })

  test('ie hover-rest arm reads via storage.readText([Ee.state(re)])', async () => {
    pinHoverRest(true)
    const hash = hashSettingsDangerousProjection(dangerousSettings)
    const storage: ConsentStorage = {
      readText: async reqs => {
        expect(reqs[0]).toEqual(consentStorageKey())
        return {
          ok: true,
          value: {
            items: [
              {
                found: true,
                value: JSON.stringify({
                  version: 1,
                  records: {
                    'org-43': {
                      accountUuid: 'acct-43',
                      dangerousSettingsHash: hash,
                      updatedAt: Date.now(),
                    },
                  },
                }),
              },
            ],
          },
        }
      },
      write: async () => ({ ok: true, value: { version: '1' } }),
    }
    const got = await getOrgDangerousSettingsHash(
      getConsentIdentity()!,
      storage,
    )
    expect(got).toBe(hash)
    const baseline = await buildConsentBaseline(null, storage)
    expect(baseline.source).toBe('org_record')
    expect(
      hasDangerousSettingsChangedAgainstBaseline(
        baseline,
        sameDangerousSettings,
      ),
    ).toBe(false)
  })
})
