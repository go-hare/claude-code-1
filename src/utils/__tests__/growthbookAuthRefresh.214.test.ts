import { describe, expect, test } from 'bun:test'
import {
  decideGrowthBookAuthRefresh,
  isSameGrowthBookAuthAccount,
} from '../growthbookAuthRefresh.js'

describe('isSameGrowthBookAuthAccount', () => {
  test('true when both account and org match', () => {
    expect(
      isSameGrowthBookAuthAccount(
        { accountUuid: 'a1', organizationUuid: 'o1' },
        { accountUuid: 'a1', organizationUuid: 'o1' },
      ),
    ).toBe(true)
  })

  test('true when both sides have no account (undefined===undefined)', () => {
    expect(
      isSameGrowthBookAuthAccount(
        { accountUuid: undefined, organizationUuid: undefined },
        { accountUuid: undefined, organizationUuid: undefined },
      ),
    ).toBe(true)
  })

  test('false when account rotates', () => {
    expect(
      isSameGrowthBookAuthAccount(
        { accountUuid: 'a1', organizationUuid: 'o1' },
        { accountUuid: 'a2', organizationUuid: 'o1' },
      ),
    ).toBe(false)
  })

  test('false when org rotates', () => {
    expect(
      isSameGrowthBookAuthAccount(
        { accountUuid: 'a1', organizationUuid: 'o1' },
        { accountUuid: 'a1', organizationUuid: 'o2' },
      ),
    ).toBe(false)
  })
})

describe('decideGrowthBookAuthRefresh', () => {
  const stamped = {
    authorization: 'Bearer old',
    accountUuid: 'a1',
    organizationUuid: 'o1',
  }

  test('none when client was not created with auth', () => {
    expect(
      decideGrowthBookAuthRefresh({
        clientCreatedWithAuth: false,
        stamped,
        currentAuthorization: 'Bearer new',
        currentAccountUuid: 'a1',
        currentOrganizationUuid: 'o1',
      }),
    ).toEqual({ action: 'none' })
  })

  test('none when Authorization missing (error path)', () => {
    expect(
      decideGrowthBookAuthRefresh({
        clientCreatedWithAuth: true,
        stamped,
        currentAuthorization: undefined,
        currentAccountUuid: 'a1',
        currentOrganizationUuid: 'o1',
      }),
    ).toEqual({ action: 'none' })
  })

  test('none when Authorization unchanged (token not rotated)', () => {
    expect(
      decideGrowthBookAuthRefresh({
        clientCreatedWithAuth: true,
        stamped,
        currentAuthorization: 'Bearer old',
        currentAccountUuid: 'a1',
        currentOrganizationUuid: 'o1',
      }),
    ).toEqual({ action: 'none' })
  })

  test('recreate + preserveLogged when same account, Authorization rotated', () => {
    expect(
      decideGrowthBookAuthRefresh({
        clientCreatedWithAuth: true,
        stamped,
        currentAuthorization: 'Bearer new',
        currentAccountUuid: 'a1',
        currentOrganizationUuid: 'o1',
      }),
    ).toEqual({
      action: 'recreate',
      sameAccount: true,
      preserveLoggedExposures: true,
    })
  })

  test('recreate + clear logged when account switched', () => {
    expect(
      decideGrowthBookAuthRefresh({
        clientCreatedWithAuth: true,
        stamped,
        currentAuthorization: 'Bearer new',
        currentAccountUuid: 'a2',
        currentOrganizationUuid: 'o1',
      }),
    ).toEqual({
      action: 'recreate',
      sameAccount: false,
      preserveLoggedExposures: false,
    })
  })

  test('recreate when stamp had no Authorization but current has one', () => {
    // densable: o !== undefined && o !== oji (oji was void after unauth create)
    expect(
      decideGrowthBookAuthRefresh({
        clientCreatedWithAuth: true,
        stamped: {
          authorization: undefined,
          accountUuid: undefined,
          organizationUuid: undefined,
        },
        currentAuthorization: 'Bearer now',
        currentAccountUuid: 'a1',
        currentOrganizationUuid: 'o1',
      }),
    ).toEqual({
      action: 'recreate',
      sameAccount: false,
      preserveLoggedExposures: false,
    })
  })
})
