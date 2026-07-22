/**
 * Shared slowOperations mock helpers for Bun process-global mock.module.
 *
 * CRITICAL: `slowLogging` is a tagged-template function used by fsOperations
 * (`using _ = slowLogging\`fs.mkdirSync(...)\``). Thin stubs that set
 * `slowLogging: { enabled: false }` crash settings/config writes and break
 * /tui persistence in co-suites.
 *
 * Capture a plain snapshot BEFORE mock.module, spread it, override only what
 * you need, and restore the snapshot in afterAll.
 *
 * Usage:
 *   import * as realSlow from 'src/utils/slowOperations.js'
 *   import {
 *     createSlowOperationsMock,
 *     restoreSlowOperationsMock,
 *     snapshotModuleExports,
 *   } from '../../../tests/mocks/slowOperations.js'
 *
 *   const snap = snapshotModuleExports(realSlow)
 *   mock.module('src/utils/slowOperations.ts', createSlowOperationsMock(snap))
 *   afterAll(() => restoreSlowOperationsMock(mock.module, snap))
 */
import { snapshotModuleExports } from './settings.js'

export { snapshotModuleExports }

/** No-op template tag matching real slowLoggingExternal. */
export function noopSlowLogging(
  _strings: TemplateStringsArray,
  ..._values: unknown[]
): { [Symbol.dispose](): void } {
  return { [Symbol.dispose]() {} }
}

export type SlowOperationsModuleLike = Record<string, unknown>

export function createSlowOperationsMock<T extends SlowOperationsModuleLike>(
  snapshot: T,
  overrides: Partial<T> = {},
): () => T {
  return () => ({
    ...snapshot,
    // Always ensure slowLogging is callable even if snapshot is incomplete.
    slowLogging: snapshot.slowLogging ?? noopSlowLogging,
    ...overrides,
  })
}

export function restoreSlowOperationsMock(
  mockModule: (id: string, factory: () => unknown) => void,
  snapshot: SlowOperationsModuleLike,
  specifiers: string[] = [
    'src/utils/slowOperations.ts',
    'src/utils/slowOperations.js',
  ],
): void {
  const factory = () => ({ ...snapshot })
  for (const id of specifiers) {
    mockModule(id, factory)
  }
}
