/**
 * densable 2.1.289 design bearer selection (`f` / `c(e)`).
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../../utils/storageV5/hoverRestPin.js'
import { authMock } from '../../../tests/mocks/auth'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

type Login = {
  accessToken: string
  refreshToken: string | null
  scopes: string[]
} | null

let login: Login = null
let designSlot: { accessToken: string } | null = null

mock.module('src/utils/auth.js', () => ({
  ...authMock(),
  getClaudeAIOAuthTokens: () => login,
}))

const realDesignOauth = await import('src/cli/handlers/designOauth.js')
const designOauthSnap = snapshotModuleExports(realDesignOauth)
mock.module('src/cli/handlers/designOauth.js', () => ({
  ...designOauthSnap,
  readDesignOauth: async () => designSlot,
}))

afterAll(() => {
  resetHoverRestPinForTests()
  mock.module('src/utils/auth.js', authMock)
  mock.module('src/cli/handlers/designOauth.js', () => ({ ...designOauthSnap }))
})

const { designRequestAuth, resolveDesignAccessToken } = await import(
  '../designConsent.js'
)

const handleCredentials = {
  claudeAiOauth: {
    accessToken: 'handle',
    refreshToken: 'hr',
    scopes: ['user:design:read'],
  },
}

describe('resolveDesignAccessToken', () => {
  test('refreshable login carrying user:design:read wins over /design login', async () => {
    login = {
      accessToken: 'main',
      refreshToken: 'r',
      scopes: ['user:design:read'],
    }
    designSlot = { accessToken: 'design' }
    expect(await resolveDesignAccessToken()).toBe('main')
  })

  test('login without design scope falls to the /design login credential', async () => {
    login = { accessToken: 'main', refreshToken: 'r', scopes: [] }
    designSlot = { accessToken: 'design' }
    expect(await resolveDesignAccessToken()).toBe('design')
  })

  test('scoped login without refresh token does not count as design-scoped', async () => {
    login = {
      accessToken: 'main',
      refreshToken: null,
      scopes: ['user:design:read'],
    }
    designSlot = { accessToken: 'design' }
    expect(await resolveDesignAccessToken()).toBe('design')
  })

  test('no /design login credential falls back to the plain login token', async () => {
    login = { accessToken: 'main', refreshToken: null, scopes: [] }
    designSlot = null
    expect(await resolveDesignAccessToken()).toBe('main')
  })

  test('nothing at all → null', async () => {
    login = null
    designSlot = null
    expect(await resolveDesignAccessToken()).toBeNull()
  })

  test('F() false still uses the global login token', async () => {
    resetHoverRestPinForTests()
    login = {
      accessToken: 'global',
      refreshToken: 'r',
      scopes: ['user:design:read'],
    }
    designSlot = { accessToken: 'design' }
    expect(await resolveDesignAccessToken(handleCredentials)).toBe('global')
    expect(await designRequestAuth(handleCredentials)).toEqual({
      headers: { Authorization: 'Bearer global' },
    })
  })

  test('F() true reads oauth tokens from the credentials handle', async () => {
    resetHoverRestPinForTests()
    pinHoverRest(true)
    login = {
      accessToken: 'global',
      refreshToken: 'r',
      scopes: ['user:design:read'],
    }
    designSlot = { accessToken: 'design' }
    expect(await resolveDesignAccessToken(handleCredentials)).toBe('handle')
    expect(await designRequestAuth(handleCredentials)).toEqual({
      headers: { Authorization: 'Bearer handle' },
    })
    resetHoverRestPinForTests()
  })
})
