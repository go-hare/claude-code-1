/**
 * densable 2.1.247 #16 — hook/bg DiskTaskOutput write-fail drops the queue
 * at hlo and surfaces the lost-output notice.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DiskTaskOutput,
  UNWRITTEN_CHARS_DROP_THRESHOLD,
  UNWRITTEN_OUTPUT_NOTICE,
  _clearOutputsForTest,
  formatLostOutputNotice,
} from '../diskOutput.js'

const dirs: string[] = []

afterEach(async () => {
  await _clearOutputsForTest()
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-disk-247-'))
  dirs.push(dir)
  return dir
}

describe('densable 2.1.247 #16 DiskTaskOutput write fail', () => {
  test('RTe / hlo constants match official SEA', () => {
    expect(UNWRITTEN_OUTPUT_NOTICE).toBe(`
[output omitted: it could not be written to disk]
`)
    expect(UNWRITTEN_CHARS_DROP_THRESHOLD).toBe(16_777_216)
  })

  test('formatLostOutputNotice is the official getStdout failing||lostOutput copy', () => {
    expect(formatLostOutputNotice(12, '/tmp/t.output')).toBe(
      'Output truncated (12KB total). The full output could not all be saved to /tmp/t.output; that file may be missing or incomplete.',
    )
  })

  test('permanent open fail above hlo drops the queue and keeps RTe', async () => {
    const dir = await makeDir()
    const blocked = join(dir, 'as-dir')
    await mkdir(blocked)
    const output = new DiskTaskOutput('blocked', blocked)
    output.append('x'.repeat(UNWRITTEN_CHARS_DROP_THRESHOLD + 8))
    await output.flush()
    expect(output.lostOutput).toBe(true)
    expect(output.unwrittenChars).toBe(UNWRITTEN_OUTPUT_NOTICE.length)
  })
})
