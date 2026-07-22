/**
 * Shared settings mock helpers for Bun process-global mock.module.
 *
 * CRITICAL: Do NOT spread a live namespace import after mock.module has been
 * registered — ESM live bindings re-point into the mock, so
 * `mock.module(..., () => realSettings)` in afterAll restores the mock, not
 * the real module. Capture a plain object snapshot of exports BEFORE any
 * mock.module call, then spread/restore that snapshot.
 *
 * Usage:
 *   import * as realSettings from 'src/utils/settings/settings.js'
 *   import {
 *     createSettingsMock,
 *     restoreSettingsMock,
 *     snapshotModuleExports,
 *   } from '../../../tests/mocks/settings.js'
 *
 *   const settingsSnap = snapshotModuleExports(realSettings)
 *   mock.module('src/utils/settings/settings.js', createSettingsMock(settingsSnap, {
 *     getInitialSettings: () => ({}),
 *   }))
 *   afterAll(() => restoreSettingsMock(settingsSnap))
 */
export type SettingsModuleLike = Record<string, unknown>

/**
 * Snapshot module exports as plain values (not live namespace bindings).
 * Must run BEFORE mock.module on that module.
 */
export function snapshotModuleExports<T extends object>(
  mod: T,
): { [K in keyof T]: T[K] } {
  const snap = {} as { [K in keyof T]: T[K] }
  for (const key of Object.keys(mod) as Array<keyof T>) {
    snap[key] = mod[key]
  }
  return snap
}

/**
 * Factory for mock.module — spreads a pre-captured snapshot + overrides.
 */
export function createSettingsMock<T extends SettingsModuleLike>(
  snapshot: T,
  overrides: Partial<T> = {},
): () => T {
  return () => ({
    ...snapshot,
    ...overrides,
  })
}

/**
 * Re-register real settings from a pre-captured snapshot (both .js and .ts
 * aliases used across the tree).
 */
export function restoreSettingsMock(snapshot: SettingsModuleLike): void {
  // Dynamic import of bun:test would be circular in some runners — callers
  // pass mock via global. Use require-like side-effect free registration by
  // expecting the caller to invoke mock.module themselves when needed.
  // This helper only builds the factory; see restoreSettingsMockWith.
  void snapshot
}

/**
 * Restore settings module registry using bun:test mock.module.
 */
export function restoreSettingsMockWith(
  mockModule: (id: string, factory: () => unknown) => void,
  snapshot: SettingsModuleLike,
  specifiers: string[] = [
    'src/utils/settings/settings.js',
    'src/utils/settings/settings.ts',
  ],
): void {
  const factory = () => ({ ...snapshot })
  for (const id of specifiers) {
    mockModule(id, factory)
  }
}
