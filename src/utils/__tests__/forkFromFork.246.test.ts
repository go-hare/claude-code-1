/**
 * densable 2.1.246 HAVE #28 — /fork from already-forked/bg empty convo.
 *
 * Official keepParent spawn Kt @229814437:
 *   flush 10s → Qt snapshot to jobs/<short>/tmp/parent-transcript.jsonl
 *   → --resume snapshot --fork-session. forkSourceAlive when last
 *   message has timestamp. No "already-forked" / recordForkBoundaryLeaf
 *   string. tengu_background_already_bg @229813919 is /background Kr() only.
 *
 * Local spawnBackgroundSessionFork copies parent-transcript.jsonl
 * the same way. Fork-from-fork / already-bg empty edge is not a
 * separate official branch.
 *
 * Invent-ban: do not invent an already-forked special path.
 * HAVE (narrow: no already-forked invent).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const fork = readFileSync(
  join(import.meta.dir, '../spawnBackgroundSessionFork.ts'),
  'utf8',
)
const cmd = readFileSync(
  join(import.meta.dir, '../../commands/fork/fork.tsx'),
  'utf8',
)

describe('HAVE #28 fork-from-fork empty (2.1.246)', () => {
  test('local keepParent snapshot exists; no already-forked invent', () => {
    expect(fork).toContain('parent-transcript.jsonl')
    expect(fork).toContain(
      "Couldn't fork — this conversation is still being saved",
    )
    expect(fork).toContain('forkSourceAlive: hasBoundaryTs')
    expect(fork).toContain('forkBoundaryAt,')
    expect(fork).not.toContain('new Date().toISOString()')
    expect(fork).toContain('--fork-session')
    expect(cmd).toContain('spawnBackgroundSessionFork')
    expect(fork).not.toContain('already-forked')
    expect(fork).not.toContain('tengu_background_already_bg')
    expect(cmd).not.toContain('already-forked')
  })
})
