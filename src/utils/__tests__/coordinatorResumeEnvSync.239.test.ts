/**
 * densable coordinator resume — env sync when lazy module is incomplete.
 * Locks print/sessionRestore fallback to syncCoordinatorModeEnvFromSession.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { syncCoordinatorModeEnvFromSession } from '../residualFinalEnvGates.js'

describe('coordinator resume env sync when module null', () => {
  test('syncCoordinatorModeEnvFromSession flips and is idempotent', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(syncCoordinatorModeEnvFromSession('coordinator', env)).toBe(
      'Entered coordinator mode to match resumed session.',
    )
    expect(env.CLAUDE_CODE_COORDINATOR_MODE).toBe('1')
    expect(
      syncCoordinatorModeEnvFromSession('coordinator', env),
    ).toBeUndefined()
    expect(syncCoordinatorModeEnvFromSession('normal', env)).toBe(
      'Exited coordinator mode to match resumed session.',
    )
    expect(env.CLAUDE_CODE_COORDINATOR_MODE).toBeUndefined()
    expect(syncCoordinatorModeEnvFromSession(undefined, env)).toBeUndefined()
  })

  test('print.ts falls back to syncCoordinatorModeEnvFromSession', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../cli/print.ts'),
      'utf8',
    )
    expect(src).toContain('syncCoordinatorModeEnvFromSession')
    expect(src).toMatch(
      /coordinatorMod\s*\?\s*coordinatorMod\.matchSessionMode[\s\S]*?:\s*syncCoordinatorModeEnvFromSession/,
    )
  })

  test('sessionRestore.ts syncs env when modeApi is null', () => {
    const src = readFileSync(
      join(import.meta.dir, '../sessionRestore.ts'),
      'utf8',
    )
    expect(src).toContain('syncCoordinatorModeEnvFromSession')
    expect(src).toMatch(
      /modeApi\s*\?\s*context\.modeApi\.matchSessionMode[\s\S]*?:\s*syncCoordinatorModeEnvFromSession/,
    )
  })

  test('matchSessionMode delegates env flip to residualFinalEnvGates', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../coordinator/coordinatorMode.ts'),
      'utf8',
    )
    expect(src).toContain('syncCoordinatorModeEnvFromSession(sessionMode)')
  })
})
