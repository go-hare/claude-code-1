/**
 * densable 2.1.228 #17 — thin subprocess wrapper for Write/Edit .call() tests.
 *
 * The runner uses mock.module (process-global) + real tmpdir I/O. Isolate so
 * co-loaded suite files are not poisoned (same pattern as promptEngineeringAudit).
 */
import { describe, expect, test } from 'bun:test'
import { relative, resolve } from 'node:path'

const PROJECT_ROOT = resolve(__dirname, '../../../../../../')
const RUNNER_ABS = resolve(__dirname, 'fileEditReadGate.call.228.runner.ts')
const RUNNER_REL = './' + relative(PROJECT_ROOT, RUNNER_ABS).replace(/\\/g, '/')

describe('densable 2.1.228 #17 FileWriteTool/FileEditTool.call', () => {
  test('runs call integration checks in isolated subprocess', async () => {
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
        `fileEditReadGate call subprocess failed (exit ${code}):\n${output}`,
      )
    }
    expect(code).toBe(0)
  }, 60_000)
})
