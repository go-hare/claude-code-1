import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { getOauthAccountInfo } from '../../../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../../utils/config.js'
import {
  persistUsageSeed,
  readPersistedUsageSeed,
  USAGE_PERSIST_READ_TTL_MS,
  usageBodyHasPersistFields,
} from '../usage.js'

function currentAccountUuid(): string | undefined {
  return getOauthAccountInfo()?.accountUuid
}

const session = {
  five_hour: { utilization: 42, resets_at: '2026-09-03T00:00:00.000Z' },
}

describe('densable 2.1.243 #36 I()/V0a/K0a cachedUsageUtilization', () => {
  afterEach(() => {
    saveGlobalConfig(current => ({
      ...current,
      cachedUsageUtilization: undefined,
    }))
  })

  test('V0a writes last-known usage onto global config, K0a reads it', () => {
    persistUsageSeed(session, currentAccountUuid())
    const persisted = readPersistedUsageSeed()
    expect(persisted?.utilization).toEqual(session)
    expect(typeof persisted?.fetchedAtMs).toBe('number')
    expect(getGlobalConfig().cachedUsageUtilization?.utilization).toEqual(
      session,
    )
  })

  test('K0a clears the snapshot when accountUuid does not match', () => {
    saveGlobalConfig(current => ({
      ...current,
      cachedUsageUtilization: {
        fetchedAtMs: Date.now(),
        accountUuid:
          currentAccountUuid() === 'other-account'
            ? 'not-current-account'
            : 'other-account',
        utilization: session,
      },
    }))
    expect(readPersistedUsageSeed()).toBeNull()
    expect(getGlobalConfig().cachedUsageUtilization).toBeUndefined()
  })

  test('K0a drops a snapshot older than FNo (1h) without clearing disk', () => {
    saveGlobalConfig(current => ({
      ...current,
      cachedUsageUtilization: {
        fetchedAtMs: Date.now() - (USAGE_PERSIST_READ_TTL_MS + 1),
        ...(currentAccountUuid() !== undefined && {
          accountUuid: currentAccountUuid(),
        }),
        utilization: session,
      },
    }))
    expect(readPersistedUsageSeed()).toBeNull()
    expect(getGlobalConfig().cachedUsageUtilization?.utilization).toEqual(
      session,
    )
  })

  test('V0a debounce skips a rewrite within UNo (5m)', () => {
    persistUsageSeed(session, currentAccountUuid())
    const first = getGlobalConfig().cachedUsageUtilization
    persistUsageSeed(
      { five_hour: { utilization: 99, resets_at: null } },
      currentAccountUuid(),
    )
    expect(getGlobalConfig().cachedUsageUtilization).toEqual(first)
  })

  test('live body without q fields is not persistable', () => {
    expect(usageBodyHasPersistFields({})).toBe(false)
    expect(usageBodyHasPersistFields({ five_hour: session.five_hour })).toBe(
      true,
    )
    expect(
      usageBodyHasPersistFields({ extra_usage: { is_enabled: false } }),
    ).toBe(true)
  })

  test('I() is GlobalConfig cachedUsageUtilization, not a process Map', () => {
    const src = readFileSync(join(import.meta.dir, '../usage.ts'), 'utf8')
    expect(src).toContain('cachedUsageUtilization')
    expect(src).toContain('USAGE_PERSIST_WRITE_DEBOUNCE_MS = 300_000')
    expect(src).toContain('USAGE_PERSIST_READ_TTL_MS = 3_600_000')
    expect(src).not.toContain('persistedUsageByAccount')
  })
})
