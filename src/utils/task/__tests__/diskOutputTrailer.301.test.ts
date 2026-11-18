import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DiskTaskOutput,
  EBUSY_RETRY_DELAYS_MS,
  _clearOutputsForTest,
  appendTaskOutputTrailer,
  flushTaskOutput,
  getTaskOutputPath,
} from '../diskOutput.js'

describe('diskOutput #881 trailer & EBUSY backoff schedule', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await _clearOutputsForTest()
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('EBUSY_RETRY_DELAYS_MS matches [50, 100, 200, 400, 800, 1600]', () => {
    expect([...EBUSY_RETRY_DELAYS_MS]).toEqual([50, 100, 200, 400, 800, 1600])
  })

  test('DiskTaskOutput.appendTrailer writes closing [killed] and [exited with code ...] lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-trailer-'))
    dirs.push(dir)
    const file = join(dir, 'task1.output')
    const out = new DiskTaskOutput('task1', file)
    out.append('hello\n')
    out.appendTrailer('\n[killed]\n', 'killed')
    await out.flush()
    expect(readFileSync(file, 'utf8')).toBe('hello\n\n[killed]\n')
  })

  test('appendTaskOutputTrailer writes [killed] and [exited with code N] via task registry map', async () => {
    const id1 = `trailer-killed-${Date.now()}`
    const id2 = `trailer-exit-${Date.now()}`
    appendTaskOutputTrailer(id1, 'killed')
    appendTaskOutputTrailer(id2, { exitCode: 42 })
    await flushTaskOutput(id1)
    await flushTaskOutput(id2)
    expect(readFileSync(getTaskOutputPath(id1), 'utf8')).toBe('\n[killed]\n')
    expect(readFileSync(getTaskOutputPath(id2), 'utf8')).toBe(
      '\n[exited with code 42]\n',
    )
  })
})
