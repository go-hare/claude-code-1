/**
 * densable 2.1.227 d2p/transcriptHasBytes — empty vs non-empty transcript for
 * /tui freshIfNoTranscript relaunch.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { transcriptHasBytes } from '../sessionStorage.js'

describe('transcriptHasBytes', () => {
  const root = join(
    tmpdir(),
    `cc-transcript-has-bytes-${process.pid}-${Date.now()}`,
  )

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('false when path missing', async () => {
    expect(await transcriptHasBytes(join(root, 'missing.jsonl'))).toBe(false)
  })

  test('false when file empty', async () => {
    await mkdir(root, { recursive: true })
    const p = join(root, 'empty.jsonl')
    await writeFile(p, '')
    expect(await transcriptHasBytes(p)).toBe(false)
  })

  test('true when file has bytes', async () => {
    await mkdir(root, { recursive: true })
    const p = join(root, 'full.jsonl')
    await writeFile(p, '{"type":"user"}\n')
    expect(await transcriptHasBytes(p)).toBe(true)
  })
})
