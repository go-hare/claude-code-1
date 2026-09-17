/**
 * densable 2.1.246 HAVE #47 — concurrent /ultrareview + cloud git bleed.
 *
 * Official "another launch" @229082394 is settings-sync race:
 *   "another launch of this session sent its settings first"
 *   — not an uncommitted-diff isolation contract.
 * Per-launch seed_bundle_file_id exists. No client isolation body
 * for concurrent worktree launches sharing dirty files.
 *
 * Invent-ban: cloud-side isolation / second bundle locker.
 * HAVE (narrow: no dirty-tree isolation invent).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const srcRoot = join(import.meta.dir, '../..')
const teleport = readFileSync(join(srcRoot, 'utils/teleport.tsx'), 'utf8')
const review = readFileSync(
  join(srcRoot, 'commands/review/reviewRemote.ts'),
  'utf8',
)

describe('HAVE #47 ultrareview git bleed (2.1.246)', () => {
  test('per-launch bundle exists; no concurrent isolation contract', () => {
    expect(teleport).toContain('seed_bundle_file_id')
    expect(teleport).toContain('uncommitted changes')
    expect(review).toContain("source: 'ultrareview'")
    expect(teleport).not.toContain(
      'another launch of this session sent its settings first',
    )
    expect(teleport).not.toContain('bundle isolation')
    expect(review).not.toContain('bundle isolation')
  })
})
