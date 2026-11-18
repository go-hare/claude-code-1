import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  compactTranscriptFileAtomic,
  getProject,
  setLocalGcEnabled,
} from '../sessionStorage.js'

const tempDirs: string[] = []

afterEach(() => {
  setLocalGcEnabled(false)
  getProject()._resetFlushState()
  for (const d of tempDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe('2.1.304 #968 CLAUDE_CODE_TRANSCRIPT_LOCAL_GC scheduler + atomic compaction', () => {
  test('Project.performCompactTranscript compacts tombstone lines atomically when localGcEnabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-gc-304-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'transcript.jsonl')

    const lines = [
      JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'hi' } }),
      JSON.stringify({ type: 'tombstone', uuid: 't1' }),
      JSON.stringify({ type: 'tombstone', uuid: 't2' }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: { content: 'hello' },
      }),
    ]
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf8')

    setLocalGcEnabled(true)
    const project = getProject()
    project._setLocalGcThresholdsForTest({ minCompactFileBytes: 1 })
    await project.performCompactTranscript(filePath)

    const after = readFileSync(filePath, 'utf8')
    expect(after).toContain('"uuid":"u1"')
    expect(after).toContain('"uuid":"a1"')
    expect(after).not.toContain('"type":"tombstone"')
  })

  test('compactTranscriptFileAtomic preserves original file if source changes concurrently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-gc-concurrent-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'transcript.jsonl')
    const initial =
      JSON.stringify({ type: 'user', uuid: 'u1' }) +
      '\n' +
      JSON.stringify({ type: 'tombstone', uuid: 't1' }) +
      '\n'
    writeFileSync(filePath, initial, 'utf8')

    let mutated = false
    const res = await compactTranscriptFileAtomic(filePath, line => {
      if (!mutated) {
        mutated = true
        writeFileSync(
          filePath,
          initial + JSON.stringify({ type: 'user', uuid: 'u2' }) + '\n',
          'utf8',
        )
      }
      return !line.includes('tombstone')
    })

    expect(res.compacted).toBe(false)
    const after = readFileSync(filePath, 'utf8')
    expect(after).toContain('"uuid":"u2"')
  })
})
