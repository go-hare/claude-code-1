/**
 * densable 2.1.289 remoteHomeSettingsMode field + /config row.
 * Gold: Gi Connections after remoteControl; hKe gated
 * `hZ(B8())||mode==="forward"`; persist gcn; key=value cannot enable.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getRemoteHomeSettingsMode,
  isRemoteHomeSettingsCapabilityOpen,
  parseRemoteHomeSettingsMode,
  persistRemoteHomeSettingsMode,
  probeRemoteHomeSettingsCapability,
  REMOTE_HOME_SETTINGS_GRANT_BLOCKERS,
  saveGlobalConfig,
  getGlobalConfig,
} from '../config.js'

const root = join(import.meta.dir, '../..')

afterEach(() => {
  saveGlobalConfig(current => {
    if (current.remoteHomeSettingsMode === undefined) return current
    const next = { ...current }
    delete next.remoteHomeSettingsMode
    return next
  })
})

describe('densable 2.1.289 remoteHomeSettingsMode', () => {
  test('Nme parses only forward / keep_local', () => {
    expect(parseRemoteHomeSettingsMode('forward')).toBe('forward')
    expect(parseRemoteHomeSettingsMode('keep_local')).toBe('keep_local')
    expect(parseRemoteHomeSettingsMode('unspecified')).toBeUndefined()
    expect(parseRemoteHomeSettingsMode(undefined)).toBeUndefined()
  })

  test('hse is unsupported; hZ is closed', () => {
    expect(probeRemoteHomeSettingsCapability(true)).toBe('unsupported')
    expect(isRemoteHomeSettingsCapabilityOpen()).toBe(false)
  })

  test('qAr grant-blocker copy is gold', () => {
    expect(REMOTE_HOME_SETTINGS_GRANT_BLOCKERS.unsupported).toBe(
      'Could not turn this on: forwarding settings to cloud sessions is not available in this version',
    )
    expect(REMOTE_HOME_SETTINGS_GRANT_BLOCKERS.flag_off).toBe(
      'Could not turn this on: forwarding settings to cloud sessions is not enabled for you right now',
    )
  })

  test('gcn keep_local writes GlobalConfig; forward is refused', async () => {
    expect(getRemoteHomeSettingsMode()).toBeUndefined()
    expect(await persistRemoteHomeSettingsMode('keep_local')).toBe('written')
    expect(getRemoteHomeSettingsMode()).toBe('keep_local')
    expect(getGlobalConfig().remoteHomeSettingsMode).toBe('keep_local')
    expect(await persistRemoteHomeSettingsMode('forward')).toBe('refused')
    expect(getRemoteHomeSettingsMode()).toBe('keep_local')
  })

  test('gcn confirms with lZt disk re-read, not the memory cache', () => {
    const src = readFileSync(join(root, 'utils/config.ts'), 'utf8')
    const persist = src.slice(
      src.indexOf('export async function persistRemoteHomeSettingsMode'),
    )
    const reader = src.slice(
      src.indexOf('export async function readStoredRemoteHomeSettingsMode'),
      src.indexOf('export function probeRemoteHomeSettingsCapability'),
    )
    expect(persist).toContain('readStoredRemoteHomeSettingsMode')
    expect(persist).toContain("return 'unconfirmed'")
    expect(persist).toContain("return 'not_stored'")
    expect(persist.indexOf('readStoredRemoteHomeSettingsMode')).toBeLessThan(
      persist.indexOf("if (persisted) return 'written'"),
    )
    expect(persist).not.toContain('getRemoteHomeSettingsMode() === mode')
    expect(reader).toContain("namespace: 'globalConfig'")
    expect(reader).toContain('isHoverRestOn()')
    expect(reader).toContain('global config not readable through storage')
  })

  test('/config row is gated and consentGated; shorthand cannot enable', () => {
    const config = readFileSync(
      join(root, 'components/Settings/Config.tsx'),
      'utf8',
    )
    expect(config).toContain("id: 'remoteHomeSettings'")
    expect(config).toContain(
      'label: "Use this machine\'s settings in cloud sessions"',
    )
    expect(config).toContain(
      "globalConfig.remoteHomeSettingsMode === 'forward'",
    )
    expect(config).toContain('consentGated: true')
    expect(config).toContain('grantBlocker:')
    expect(config).toContain('REMOTE_HOME_SETTINGS_GRANT_BLOCKERS')
    expect(config).toContain('setRemoteHomeSettingsNotice')
    expect(config).toContain('remoteHomeSettingsNotice')
    expect(config).toContain('showConfigChangeResult')
    expect(config).toContain('` ⚠ ${remoteHomeSettingsNotice}`')
    expect(config).not.toContain(
      'text: REMOTE_HOME_SETTINGS_GRANT_BLOCKERS[blocker]',
    )
    expect(config).toContain(
      'Turn this on from the /config panel, which shows what will be sent',
    )
    expect(config).toContain(
      'Cloud settings forwarding is not available right now; nothing was changed',
    )
    const catalog = readFileSync(join(root, 'utils/configCatalog.ts'), 'utf8')
    expect(catalog).toContain("'remoteHomeSettings'")
    const compact = catalog.indexOf("'remoteControl'")
    const home = catalog.indexOf("'remoteHomeSettings'")
    expect(home).toBeGreaterThan(compact)
  })
})
