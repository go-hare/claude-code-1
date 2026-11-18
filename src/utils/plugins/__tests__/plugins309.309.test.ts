import { afterEach, describe, expect, test } from 'bun:test'
import { scanFunctionHookSource } from '../functionHooksModules.js'
import {
  checkSyncedPluginListStatus,
  formatSyncedRefusalReason,
  recordCompleteSyncedPluginsList,
  resetSyncedLaneState,
} from '../syncedPluginCloudSync.js'

describe('plugins v2.1.309 (#1151, #1162)', () => {
  afterEach(() => {
    resetSyncedLaneState()
  })

  test('#1151: checkSyncedPluginListStatus returns list_unreadable on read error and not_listed when absent', () => {
    const errRes = checkSyncedPluginListStatus(
      'org-1',
      ['/tmp/synced'],
      '/tmp/synced/org-1/my-plugin',
      () => {
        throw new Error('EIO: disk read failed')
      },
    )
    expect(errRes).toBe('list_unreadable')
    expect(formatSyncedRefusalReason('list_unreadable')).toBe(
      "this session's record of the account's plugins could not be read",
    )

    recordCompleteSyncedPluginsList(
      'org-1',
      [
        {
          pluginId: 'p1',
          name: 'kept-plugin',
          description: '',
          version: null,
          updatedAt: null,
        },
      ],
      '/tmp/synced/org-1',
    )

    expect(
      checkSyncedPluginListStatus(
        'org-1',
        ['/tmp/synced'],
        '/tmp/synced/org-1/kept-plugin/skills/foo',
      ),
    ).toBeUndefined()

    expect(
      checkSyncedPluginListStatus(
        'org-1',
        ['/tmp/synced'],
        '/tmp/synced/org-1/removed-plugin/skills/foo',
      ),
    ).toBe('not_listed')
  })

  test('#1162: scanFunctionHookSource names the file on deep nesting refusal', () => {
    const deepSource =
      'export function register(on) {\n' +
      '  if (true) {\n'.repeat(2100) +
      '    return\n' +
      '  }\n'.repeat(2100) +
      '}\n'
    const res = scanFunctionHookSource(
      deepSource,
      '/path/to/mod/hooks/register.ts',
    )
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('/path/to/mod/hooks/register.ts')
  })
})
