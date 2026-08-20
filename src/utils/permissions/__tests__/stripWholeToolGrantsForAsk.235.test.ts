/**
 * densable 2.1.235 #12 — stripWholeToolGrantsForAsk (jze).
 */
import { describe, expect, test } from 'bun:test'
import { stripWholeToolGrantsForAsk } from '../permissions.js'
import type { PermissionUpdate } from '../../../types/permissions.js'

describe('stripWholeToolGrantsForAsk (2.1.235 #12)', () => {
  test('removes bare whole-tool allow, keeps domain/path-scoped rules', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [
          { toolName: 'WebFetch' },
          { toolName: 'WebFetch', ruleContent: 'domain:example.com' },
          { toolName: 'Edit', ruleContent: '/tmp/x.ts' },
        ],
      },
      {
        type: 'addDirectories',
        destination: 'session',
        directories: ['/tmp'],
      },
    ]

    const stripped = stripWholeToolGrantsForAsk(updates, { name: 'WebFetch' })
    expect(stripped).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [
          { toolName: 'WebFetch', ruleContent: 'domain:example.com' },
          { toolName: 'Edit', ruleContent: '/tmp/x.ts' },
        ],
      },
      {
        type: 'addDirectories',
        destination: 'session',
        directories: ['/tmp'],
      },
    ])
  })

  test('drops addRules update entirely when only bare tool allow remains', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [{ toolName: 'Monitor' }],
      },
    ]
    expect(stripWholeToolGrantsForAsk(updates, { name: 'Monitor' })).toEqual([])
  })
})
