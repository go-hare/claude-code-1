/**
 * Shared mock for `src/utils/auth.js`. Use it via:
 *
 *   import { authMock } from '../../tests/mocks/auth'
 *   mock.module('src/utils/auth.js', authMock)
 *
 * Bun `mock.module` is process-global last-write-wins. Hand-listing a few
 * subscriber helpers wipes the other 60+ exports for every later file.
 * Snapshot the real module and override only the values suites pin.
 */
import * as realAuth from '../../src/utils/auth.js'
import { snapshotModuleExports } from './settings.js'

const authSnap = snapshotModuleExports(realAuth)

export const authMock = () => ({
  ...authSnap,
  // Mirrors the production contract: src/utils/auth.ts returns
  // Promise<boolean> ("did the access token change") and a token object that
  // carries scopes, subscriptionType, expiresAt, etc. Tests that branch on
  // these values must see the full shape so they can not silently drift away
  // from production.
  checkAndRefreshOAuthTokenIfNeeded: async () => false,
  getClaudeAIOAuthTokens: () => ({
    accessToken: 'token',
    refreshToken: null,
    expiresAt: null,
    scopes: ['user:inference'],
    subscriptionType: null,
    rateLimitTier: null,
  }),
  isClaudeAISubscriber: () => true,
  isProSubscriber: () => false,
  isMaxSubscriber: () => false,
  isTeamSubscriber: () => false,
})
