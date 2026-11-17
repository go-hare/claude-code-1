/**
 * Shared snapshot mocks for the oauth / teleport / cron surface used by
 * launch+api command tests.
 *
 * Bun `mock.module` is process-global last-write-wins. Hand-listing
 * `getOauthConfig` / `getOAuthHeaders` / `getOrganizationUUID` wipes the
 * rest of those modules for every later file. Snapshot the real exports and
 * override only the values a suite pins.
 */
import * as realOauthClient from '../../src/services/oauth/client.js'
import * as realOauthConfig from '../../src/constants/oauth.js'
import * as realCron from '../../src/utils/cron.js'
import * as realTeleportApi from '../../src/utils/teleport/api.js'
import { snapshotModuleExports } from './settings.js'

const oauthConfigSnap = snapshotModuleExports(realOauthConfig)
const oauthClientSnap = snapshotModuleExports(realOauthClient)
const teleportApiSnap = snapshotModuleExports(realTeleportApi)
const cronSnap = snapshotModuleExports(realCron)

export function oauthConfigMock(overrides: Record<string, unknown> = {}) {
  return {
    ...oauthConfigSnap,
    ...overrides,
  }
}

export function oauthClientMock(overrides: Record<string, unknown> = {}) {
  return {
    ...oauthClientSnap,
    ...overrides,
  }
}

export function teleportApiMock(overrides: Record<string, unknown> = {}) {
  return {
    ...teleportApiSnap,
    ...overrides,
  }
}

export function cronMock(overrides: Record<string, unknown> = {}) {
  return {
    ...cronSnap,
    ...overrides,
  }
}

/** Valid workspace-key prefix so live `prepareWorkspaceApiRequest` can run. */
export const TEST_WORKSPACE_API_KEY = 'sk-ant-api03-test-workspace-key'

export function restoreOauthConfigMock() {
  return { ...oauthConfigSnap }
}

export function restoreOauthClientMock() {
  return { ...oauthClientSnap }
}

export function restoreTeleportApiMock() {
  return { ...teleportApiSnap }
}

export function restoreCronMock() {
  return { ...cronSnap }
}
