/**
 * densable 2.1.223 #8 — resuming after mid-session /cd must not come back empty.
 *
 * SEA: lite list cwd = cHt(tail,"relocated","relocatedCwd") || first cwd;
 * reAppend keeps relocated stamp in tail; restoreSessionMetadata hydrates
 * currentSessionRelocatedCwd from log.relocatedCwd; loadConversationForResume
 * must surface relocatedCwd to that restore path.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { extractTypedJsonlField } from '../sessionStoragePortable.js'
import { parseSessionInfoFromLite } from '../listSessionsImpl.js'
import type { LiteSessionFile } from '../sessionStoragePortable.js'

describe('densable 2.1.223 #8 extractTypedJsonlField (cHt)', () => {
  test('finds last relocatedCwd from tail', () => {
    const tail = [
      '{"type":"user","cwd":"/old"}',
      '{"type":"relocated","sessionId":"s1","relocatedCwd":"/mid"}',
      '{"type":"tag","sessionId":"s1","tag":"x"}',
      '{"type":"relocated","sessionId":"s1","relocatedCwd":"/new"}',
    ].join('\n')
    expect(extractTypedJsonlField(tail, 'relocated', 'relocatedCwd')).toBe(
      '/new',
    )
  })

  test('ignores non-matching type lines that mention relocatedCwd', () => {
    const tail =
      '{"type":"user","text":"relocatedCwd"}' +
      '\n' +
      '{"type":"relocated","sessionId":"s1","relocatedCwd":"/ok"}'
    expect(extractTypedJsonlField(tail, 'relocated', 'relocatedCwd')).toBe(
      '/ok',
    )
  })
})

describe('densable 2.1.223 #8 parseSessionInfoFromLite cwd', () => {
  test('prefers relocated stamp over head cwd', () => {
    const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const head = `{"type":"user","sessionId":"${sid}","cwd":"/old/project","timestamp":"2026-01-01T00:00:00.000Z","message":{"content":"hello world"}}\n`
    const tail = `{"type":"last-prompt","sessionId":"${sid}","lastPrompt":"hello world"}\n{"type":"relocated","sessionId":"${sid}","relocatedCwd":"/new/project"}\n`
    const lite: LiteSessionFile = {
      head,
      tail,
      mtime: Date.now(),
      size: head.length + tail.length,
    }
    const info = parseSessionInfoFromLite(sid, lite, '/project-dir-key')
    expect(info).not.toBeNull()
    expect(info!.cwd).toBe('/new/project')
  })

  test('falls back to head cwd when no relocated stamp', () => {
    const sid = '11111111-2222-3333-4444-555555555555'
    const head = `{"type":"user","sessionId":"${sid}","cwd":"/only/old","timestamp":"2026-01-01T00:00:00.000Z","message":{"content":"hi there"}}\n`
    const tail = `{"type":"last-prompt","sessionId":"${sid}","lastPrompt":"hi there"}\n`
    const lite: LiteSessionFile = {
      head,
      tail,
      mtime: Date.now(),
      size: head.length + tail.length,
    }
    const info = parseSessionInfoFromLite(sid, lite)
    expect(info).not.toBeNull()
    expect(info!.cwd).toBe('/only/old')
  })
})

describe('densable 2.1.223 #8 resume entry hydrate wire', () => {
  test('loadConversationForResume returns relocatedCwd for restoreSessionMetadata', () => {
    const recovery = readFileSync(
      join(import.meta.dir, '../conversationRecovery.ts'),
      'utf8',
    )
    expect(recovery).toContain(
      'relocatedCwd: log?.relocatedCwd ?? relocatedFromJsonl',
    )
    expect(recovery).toContain('relocatedCwd?: string')
    expect(recovery).toContain('relocatedFromJsonl = loaded.relocatedCwd')
  })

  test('loadMessagesFromJsonlPath surfaces relocatedCwds', () => {
    const recovery = readFileSync(
      join(import.meta.dir, '../conversationRecovery.ts'),
      'utf8',
    )
    expect(recovery).toContain('relocatedCwds')
    expect(recovery).toMatch(
      /relocatedCwd:\s*sessionId\s*\?\s*relocatedCwds\.get\(sessionId\)/,
    )
  })

  test('loadFullLog no-leaf path hydrates relocated stamp', () => {
    const storage = readFileSync(
      join(import.meta.dir, '../sessionStorage.ts'),
      'utf8',
    )
    // Both empty-messages and no-leaf early returns must pin relocatedCwd.
    const noLeafBlocks = storage.split('if (!mostRecentLeaf)')
    expect(noLeafBlocks.length).toBeGreaterThan(1)
    expect(noLeafBlocks[1]!).toContain('relocatedCwd: relocated')
  })
})
