/**
 * densable 2.1.251 #43 ae persist (se / oe / an.atomicWrite 384 / Ee.state write).
 * Leaf-only — no settings.ts mock.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, stat, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGlobalConfig, saveGlobalConfig } from '../../../utils/config.js'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../../../utils/storageV5/hoverRestPin.js'
import type { StorageV5Result } from '../../../utils/storageV5/createLocalFsBackend.js'
import {
  clearOrgConsentFile,
  consentStorageKey,
  getConsentIdentity,
  getOrgDangerousSettingsHash,
  hashSettingsDangerousProjection,
  recordOrgConsent,
  type ConsentStorage,
} from '../orgConsent.js'

const dangerousSettings = {
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
} as never

describe('densable 2.1.251 #43 ae persist', () => {
  let configHome: string
  let prevConfigDir: string | undefined
  let prevOauth: ReturnType<typeof getGlobalConfig>['oauthAccount']

  beforeEach(async () => {
    configHome = await mkdtempJoin()
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

  test('ae legacy arm writes remote-settings-consent.json mode 384', async () => {
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const path = join(configHome, 'remote-settings-consent.json')
    const st = await stat(path)
    // mode is platform-dependent on Windows; owner-rw bit still set
    expect((st.mode & 0o400) !== 0).toBe(true)
    const raw = await readFile(path, 'utf-8')
    const body = JSON.parse(raw) as {
      version: number
      records: Record<string, { dangerousSettingsHash: string }>
    }
    expect(body.version).toBe(1)
    expect(body.records['org-1']?.dangerousSettingsHash).toBe(
      hashSettingsDangerousProjection(dangerousSettings),
    )
  })

  test('ae same hash within He does not rewrite updatedAt', async () => {
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const path = join(configHome, 'remote-settings-consent.json')
    const first = JSON.parse(await readFile(path, 'utf-8')) as {
      records: Record<string, { updatedAt: number }>
    }
    const t0 = first.records['org-1']!.updatedAt
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const second = JSON.parse(await readFile(path, 'utf-8')) as {
      records: Record<string, { updatedAt: number }>
    }
    expect(second.records['org-1']!.updatedAt).toBe(t0)
  })

  test('oe oversized file is unreadable and ae does not overwrite', async () => {
    const path = join(configHome, 'remote-settings-consent.json')
    await mkdir(configHome, { recursive: true })
    // densable x=1048576; body > x → unreadable, no overwrite
    await writeFile(path, 'x'.repeat(1_048_576 + 8), 'utf-8')
    await recordOrgConsent(getConsentIdentity(), dangerousSettings)
    const after = await readFile(path, 'utf-8')
    expect(after.startsWith('x')).toBe(true)
    expect(await getOrgDangerousSettingsHash(getConsentIdentity()!)).toBeNull()
  })

  test('ae hover-rest arm writes via storage.write(Ee.state(re), P, {mode:384})', async () => {
    pinHoverRest(true)
    const writes: Array<{ key: unknown; value: string; mode?: number }> = []
    const storage: ConsentStorage = {
      readText: async () =>
        ({
          ok: true,
          value: { items: [{ found: false, totalBytes: 0 }] },
        }) as StorageV5Result<{
          items: Array<{ found: boolean; totalBytes: number; value?: string }>
        }>,
      write: async (key, value, opts) => {
        writes.push({
          key,
          value:
            typeof value === 'string'
              ? value
              : Buffer.from(value).toString('utf8'),
          mode: opts?.mode,
        })
        return { ok: true, value: { version: '1' } }
      },
    }
    await recordOrgConsent(getConsentIdentity(), dangerousSettings, storage)
    expect(writes).toHaveLength(1)
    expect(writes[0]!.key).toEqual(consentStorageKey())
    expect(writes[0]!.mode).toBe(384)
    const body = JSON.parse(writes[0]!.value) as {
      version: number
      records: Record<string, { dangerousSettingsHash: string }>
    }
    expect(body.version).toBe(1)
    expect(body.records['org-1']?.dangerousSettingsHash).toBe(
      hashSettingsDangerousProjection(dangerousSettings),
    )
  })
})

async function mkdtempJoin(): Promise<string> {
  const { mkdtemp } = await import('fs/promises')
  return mkdtemp(join(tmpdir(), 'org-consent-251-'))
}
