/**
 * densable 2.1.289 ht — hasPermissionsToUseTool Agent overflow allow.
 * Isolated subprocess so yoloClassifier mock.module does not pollute
 * classifierWait.289 in the same bun-test process.
 */
import { describe, expect, test } from 'bun:test'
import { relative, resolve } from 'path'

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..')
const RUNNER_ABS = resolve(__dirname, 'agentTranscriptTooLong.289.runner.ts')
const RUNNER_REL = './' + relative(PROJECT_ROOT, RUNNER_ABS).replace(/\\/g, '/')

describe('densable 2.1.289 hasPermissionsToUseTool transcriptTooLong', () => {
  test('Agent allows; Bash headless aborts; classifierOnly denies', async () => {
    const proc = Bun.spawn(
      ['bun', 'test', '--feature', 'TRANSCRIPT_CLASSIFIER', RUNNER_REL],
      {
        cwd: PROJECT_ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const code = await proc.exited
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      const stdout = await new Response(proc.stdout).text()
      throw new Error(
        `ht runner failed (exit ${code}):\n${(stderr + '\n' + stdout).slice(-4000)}`,
      )
    }
    expect(code).toBe(0)
  }, 60_000)
})
