import { describe, expect, test } from 'bun:test'
import { stripWholeToolGrantsForAsk } from '../permissions.js'
import { shouldShowPersistentAllowOption } from '../showAlwaysAllow.js'
import type { PermissionUpdate } from '../PermissionUpdateSchema.js'

describe('densable 2.1.235 #12 suppressAlwaysAllowRule', () => {
  test('shouldShowPersistentAllowOption hides when ask.suppressAlwaysAllowRule', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: {
          behavior: 'ask',
          suppressAlwaysAllowRule: true,
        },
      }),
    ).toBe(false)
  })

  test('shouldShowPersistentAllowOption hides when tool.suppressesAlwaysAllowRule', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: { behavior: 'ask' },
        tool: { suppressesAlwaysAllowRule: () => true },
        input: {},
      }),
    ).toBe(false)
  })

  test('shouldShowPersistentAllowOption keeps when neither suppress nor org-cap', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        permissionResult: { behavior: 'ask' },
        tool: { suppressesAlwaysAllowRule: () => false },
        input: {},
        isAskCappedByOrg: false,
      }),
    ).toBe(true)
  })

  test('shouldShowPersistentAllowOption hides when org ask-capped', () => {
    expect(
      shouldShowPersistentAllowOption({
        baseAllowed: true,
        isAskCappedByOrg: true,
      }),
    ).toBe(false)
  })

  test('stripWholeToolGrantsForAsk removes bare tool allow, keeps scoped rules', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [
          { toolName: 'Bash' },
          { toolName: 'Bash', ruleContent: 'npm:*' },
          { toolName: 'Read' },
        ],
      },
      {
        type: 'addDirectories',
        destination: 'session',
        directories: ['/tmp'],
      },
    ]

    const stripped = stripWholeToolGrantsForAsk(updates, { name: 'Bash' })
    expect(stripped).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [
          { toolName: 'Bash', ruleContent: 'npm:*' },
          { toolName: 'Read' },
        ],
      },
      {
        type: 'addDirectories',
        destination: 'session',
        directories: ['/tmp'],
      },
    ])
  })

  test('stripWholeToolGrantsForAsk drops entire addRules when only bare tool allow', () => {
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
