/**
 * Shared installPrompt mock — always spread real exports so co-running
 * installPrompt.test / binaryTakeover / /daemon command still resolve
 * setDaemonInstallPromptDismissed and shouldRetireStaleDaemonBinary.
 *
 * Usage:
 *   import * as realInstallPrompt from 'src/daemon/installPrompt.js'
 *   import { createInstallPromptMock } from '../../../tests/mocks/installPrompt.js'
 *   mock.module('src/daemon/installPrompt.js', createInstallPromptMock(realInstallPrompt, {
 *     ensureDaemonRunning: async () => ({ ok: true }),
 *   }))
 */
import type * as InstallPrompt from 'src/daemon/installPrompt.js'

export type InstallPromptModule = typeof InstallPrompt

export function createInstallPromptMock(
  real: InstallPromptModule,
  overrides: Partial<InstallPromptModule> = {},
): () => InstallPromptModule {
  return () => ({
    ...real,
    ...overrides,
  })
}
