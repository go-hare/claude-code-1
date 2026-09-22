/**
 * Shared snapshot mocks for LocalAgent/LocalShell task tests.
 *
 * Incomplete `{ abortSpeculation }` / `{ registerCleanup }` stubs wipe the
 * rest of those modules for every later file under Bun last-write-wins.
 */
import * as realAbortController from '../../src/utils/abortController.js'
import * as realCleanupRegistry from '../../src/utils/cleanupRegistry.js'
import * as realXml from '../../src/constants/xml.js'
import * as realCollapseReadSearch from '../../src/utils/collapseReadSearch.js'
import * as realSpeculation from '../../src/services/PromptSuggestion/speculation.js'
import { snapshotModuleExports } from './settings.js'

const speculationSnap = snapshotModuleExports(realSpeculation)
const cleanupRegistrySnap = snapshotModuleExports(realCleanupRegistry)
const abortControllerSnap = snapshotModuleExports(realAbortController)
const xmlSnap = snapshotModuleExports(realXml)
const collapseReadSearchSnap = snapshotModuleExports(realCollapseReadSearch)

export function speculationMock(overrides: Record<string, unknown> = {}) {
  return {
    ...speculationSnap,
    abortSpeculation: () => {},
    ...overrides,
  }
}

export function cleanupRegistryMock(overrides: Record<string, unknown> = {}) {
  return {
    ...cleanupRegistrySnap,
    registerCleanup: () => {
      const unreg = (): void => {}
      return Object.assign(unreg, { [Symbol.dispose]: unreg })
    },
    ...overrides,
  }
}

/** Restore real cleanupRegistry after process-global task stubs. */
export function restoreCleanupRegistryModule(): typeof cleanupRegistrySnap {
  return { ...cleanupRegistrySnap }
}

export function abortControllerMock(overrides: Record<string, unknown> = {}) {
  return {
    ...abortControllerSnap,
    createAbortController: () => new AbortController(),
    createChildAbortController: (parent?: AbortController) => {
      const ac = new AbortController()
      parent?.signal.addEventListener('abort', () => ac.abort())
      return ac
    },
    ...overrides,
  }
}

export function xmlMock(overrides: Record<string, unknown> = {}) {
  return {
    ...xmlSnap,
    ...overrides,
  }
}

export function collapseReadSearchMock(
  overrides: Record<string, unknown> = {},
) {
  return {
    ...collapseReadSearchSnap,
    getSearchExtraToolsOrReadInfo: () => undefined,
    getToolSearchOrReadInfo: () => undefined,
    ...overrides,
  }
}
