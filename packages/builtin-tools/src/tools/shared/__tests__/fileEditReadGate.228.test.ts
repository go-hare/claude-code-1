/**
 * densable 2.1.228 #17 — thin subprocess wrapper for unit gate tests.
 *
 * The runner uses mock.module (process-global). Running it in-process would
 * poison co-loaded suite files (same pattern as promptEngineeringAudit).
 */
import { describe, expect, test } from 'bun:test'
import { relative, resolve } from 'node:path'

const PROJECT_ROOT = resolve(__dirname, '../../../../../../')
const RUNNER_ABS = resolve(__dirname, 'fileEditReadGate.228.runner.ts')
const RUNNER_REL = './' + relative(PROJECT_ROOT, RUNNER_ABS).replace(/\\/g, '/')

describe('densable 2.1.228 #17 fileEditReadGate unit', () => {
  test('runs unit gate checks in isolated subprocess', async () => {
    const proc = Bun.spawn(['bun', 'test', RUNNER_REL], {
      cwd: PROJECT_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await proc.exited
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      const stdout = await new Response(proc.stdout).text()
      const output = (stderr + '\n' + stdout).slice(-4000)
      throw new Error(
        `fileEditReadGate unit subprocess failed (exit ${code}):\n${output}`,
      )
    }
    expect(code).toBe(0)
  }, 60_000)
})
