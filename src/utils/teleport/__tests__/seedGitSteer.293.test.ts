import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { refuseSeedSteerEnv } from '../seedGitSteer.js'

describe('2.1.293 #300 seedGitSteer nested checkout / missing settings tolerance', () => {
  test('does not refuse when workTree .claude/settings.json does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-steer-293-'))
    try {
      const nested = join(dir, 'nested-repo')
      mkdirSync(nested, { recursive: true })
      const hit = refuseSeedSteerEnv({ workTree: nested })
      expect(hit).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('still refuses when workTree .claude/settings.json is malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-steer-293-bad-'))
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true })
      writeFileSync(join(dir, '.claude', 'settings.json'), '{bad json', 'utf8')
      const hit = refuseSeedSteerEnv({ workTree: dir })
      expect(hit).toEqual({ kind: 'unreadable' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
