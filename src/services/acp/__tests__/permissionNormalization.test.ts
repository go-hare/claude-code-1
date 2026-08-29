import { describe, expect, test } from 'bun:test'
import type { PermissionUpdate } from '../../../types/permissions.js'
import { normalizeDurablePermissionChangeSet } from '../permissionNormalization.js'

describe('normalizeDurablePermissionChangeSet', () => {
  test('snapshots a valid addRules bundle', () => {
    const suggestions: PermissionUpdate[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }],
        behavior: 'allow',
        destination: 'session',
      },
    ]
    const changeSet = normalizeDurablePermissionChangeSet(suggestions)
    expect(changeSet?.updates).toEqual(suggestions)
    expect(changeSet?.updates).not.toBe(suggestions)
  })

  test('omits unknown update types and forced-ask bundles', () => {
    expect(
      normalizeDurablePermissionChangeSet([
        { type: 'mystery', destination: 'session' },
      ]),
    ).toBeUndefined()
    expect(
      normalizeDurablePermissionChangeSet(
        [
          {
            type: 'addRules',
            rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }],
            behavior: 'allow',
            destination: 'session',
          },
        ],
        true,
      ),
    ).toBeUndefined()
  })
})
