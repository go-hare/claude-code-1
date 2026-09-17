/**
 * densable 2.1.246 `os` / `Xt` / `is` — /tmp prefetch_ok file.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PREFETCH_NETWORK_STATE_FILE,
  PREFETCH_STATE_DIR,
  prefetchOkCount,
  readWarmupCompleteOs,
} from '../prefetchWarmup.js'

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('densable 2.1.246 os prefetch_ok', () => {
  test('source-locks official path + He default', () => {
    const src = readFileSync(
      join(import.meta.dir, '../prefetchWarmup.ts'),
      'utf8',
    )
    expect(PREFETCH_STATE_DIR).toBe('/tmp')
    expect(PREFETCH_NETWORK_STATE_FILE).toBe('ccr-byoc-prefetch-network.state')
    expect(src).toContain('PREFETCH_STATE_MAX_BYTES = 4096')
    expect(src).toContain('(?:^|\\s)([a-z_]+)=(\\S+)')
    const runner = readFileSync(
      join(import.meta.dir, '../rootRunner.ts'),
      'utf8',
    )
    expect(runner).toContain('opts.readWarmupComplete ?? readWarmupCompleteOs')
  })

  test('os is true when first-line ok>=1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-prefetch-'))
    temps.push(dir)
    writeFileSync(
      join(dir, PREFETCH_NETWORK_STATE_FILE),
      'phase=warm ok=1 last_ok_ts=2026-01-01T00:00:00Z\nignored=1\n',
    )
    expect(await readWarmupCompleteOs({ dir })).toBe(true)
  })

  test('os is false when missing, ok=0, or invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-prefetch-miss-'))
    temps.push(dir)
    expect(await readWarmupCompleteOs({ dir })).toBe(false)
    writeFileSync(join(dir, PREFETCH_NETWORK_STATE_FILE), 'ok=0')
    expect(await readWarmupCompleteOs({ dir })).toBe(false)
    writeFileSync(join(dir, PREFETCH_NETWORK_STATE_FILE), 'ok=nope')
    expect(await readWarmupCompleteOs({ dir })).toBe(false)
    expect(prefetchOkCount(undefined)).toBeUndefined()
  })
})
