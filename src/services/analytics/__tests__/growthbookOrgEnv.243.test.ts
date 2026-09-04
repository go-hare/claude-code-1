/**
 * densable 2.1.243 #44 — official `Qf` env pin for AUTH_TOKEN sessions.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { resolveGrowthBookIdentityIds } from '../growthbook.js'

const PREV_ORG = process.env.CLAUDE_CODE_ORGANIZATION_UUID
const PREV_ACCT = process.env.CLAUDE_CODE_ACCOUNT_UUID

afterEach(() => {
  if (PREV_ORG === undefined) {
    delete process.env.CLAUDE_CODE_ORGANIZATION_UUID
  } else {
    process.env.CLAUDE_CODE_ORGANIZATION_UUID = PREV_ORG
  }
  if (PREV_ACCT === undefined) {
    delete process.env.CLAUDE_CODE_ACCOUNT_UUID
  } else {
    process.env.CLAUDE_CODE_ACCOUNT_UUID = PREV_ACCT
  }
})

describe('densable 2.1.243 #44 Qf org/account env pin', () => {
  test('oauth wins over env', () => {
    process.env.CLAUDE_CODE_ORGANIZATION_UUID = 'env-org'
    process.env.CLAUDE_CODE_ACCOUNT_UUID = 'env-acct'
    expect(
      resolveGrowthBookIdentityIds({
        organizationUuid: 'oauth-org',
        accountUuid: 'oauth-acct',
      }),
    ).toEqual({
      organizationUUID: 'oauth-org',
      accountUUID: 'oauth-acct',
    })
  })

  test('AUTH_TOKEN / no oauth falls back to env pin', () => {
    process.env.CLAUDE_CODE_ORGANIZATION_UUID = 'env-org'
    process.env.CLAUDE_CODE_ACCOUNT_UUID = 'env-acct'
    expect(resolveGrowthBookIdentityIds({})).toEqual({
      organizationUUID: 'env-org',
      accountUUID: 'env-acct',
    })
  })

  test('empty env does not invent ids', () => {
    delete process.env.CLAUDE_CODE_ORGANIZATION_UUID
    delete process.env.CLAUDE_CODE_ACCOUNT_UUID
    expect(resolveGrowthBookIdentityIds({})).toEqual({})
  })
})
