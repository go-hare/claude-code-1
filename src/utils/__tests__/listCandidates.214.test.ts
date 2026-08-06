/**
 * densable 2.1.214 #30 — listCandidates skips non-file *.jsonl entries
 * (directories / unreadable) so reopen/list does not treat folders as sessions.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listCandidates } from '../listSessionsImpl.js'

describe('listCandidates densable #30 isFile guard', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  test('skips directory named <uuid>.jsonl; keeps real file', async () => {
    dir = join(tmpdir(), `lc214-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    // unreadable folder masquerading as a session file
    mkdirSync(join(dir, `${uuid}.jsonl`), { recursive: true })
    const goodId = '11111111-2222-3333-4444-555555555555'
    writeFileSync(join(dir, `${goodId}.jsonl`), '{"type":"user"}\n', 'utf8')

    const cands = await listCandidates(dir, true)
    expect(cands.map(c => c.sessionId).sort()).toEqual([goodId])
    expect(cands[0]!.filePath.endsWith(`${goodId}.jsonl`)).toBe(true)
  })

  test('doStat=false still filters non-files via withFileTypes', async () => {
    dir = join(tmpdir(), `lc214b-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    mkdirSync(join(dir, `${uuid}.jsonl`), { recursive: true })
    const cands = await listCandidates(dir, false)
    expect(cands).toEqual([])
  })
})
