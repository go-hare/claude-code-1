import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  evaluateRespawnTranscriptGate,
  FORK_TRANSCRIPT_NEVER_MATERIALIZED,
  transcriptHasMessages,
} from '../transcriptProbe.js'

describe('transcriptProbe densable NPn/Xyr', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  test('NPn: user/assistant line → true; empty → false', async () => {
    dir = join(tmpdir(), `tp-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const empty = join(dir, 'empty.jsonl')
    writeFileSync(empty, '', 'utf8')
    expect(await transcriptHasMessages(empty)).toBe(false)

    const withUser = join(dir, 'user.jsonl')
    writeFileSync(
      withUser,
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })}\n`,
      'utf8',
    )
    expect(await transcriptHasMessages(withUser)).toBe(true)

    const missing = join(dir, 'nope.jsonl')
    expect(await transcriptHasMessages(missing)).toBe(false)
  })

  test('Xyr refuse: none isolation + same session + no messages', async () => {
    dir = join(tmpdir(), `tp2-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'sess-id-1.jsonl')
    writeFileSync(path, '', 'utf8')

    const gate = await evaluateRespawnTranscriptGate({
      short: 'abcd1234',
      sessionId: 'sess-id-1',
      resumeSessionId: 'sess-id-1',
      cwd: dir,
      bgIsolation: 'none',
      linkScanPath: path,
    })
    expect(gate.allow).toBe(false)
    if (!gate.allow) {
      expect(gate.errorCode).toBe(FORK_TRANSCRIPT_NEVER_MATERIALIZED)
      expect(gate.error).toContain('no saved transcript')
    }
  })

  test('forceRefusalRetry bypasses refuse', async () => {
    dir = join(tmpdir(), `tp3-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'sess-id-1.jsonl')
    writeFileSync(path, '', 'utf8')

    const gate = await evaluateRespawnTranscriptGate({
      short: 'abcd1234',
      sessionId: 'sess-id-1',
      resumeSessionId: 'sess-id-1',
      cwd: dir,
      bgIsolation: 'none',
      linkScanPath: path,
      forceRefusalRetry: true,
    })
    expect(gate.allow).toBe(true)
  })

  test('has messages allows resume', async () => {
    dir = join(tmpdir(), `tp4-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    // densable IAe: linkScanPath must end with `${sessionId}.jsonl` to use as-is
    const path = join(dir, 'sess-id-1.jsonl')
    writeFileSync(
      path,
      `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'ok' } })}\n`,
      'utf8',
    )

    const gate = await evaluateRespawnTranscriptGate({
      short: 'abcd1234',
      sessionId: 'sess-id-1',
      resumeSessionId: 'sess-id-1',
      cwd: dir,
      bgIsolation: 'none',
      linkScanPath: path,
    })
    expect(gate.allow).toBe(true)
    if (gate.allow) expect(gate.probe.hasMessages).toBe(true)
  })

  test('BJe: non-refuse empty path renames orphan transcript', async () => {
    dir = join(tmpdir(), `tp5-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'sess-id-1.jsonl')
    writeFileSync(path, '', 'utf8')

    // isolation worktree → not refuse; BJe should quarantine empty file
    const gate = await evaluateRespawnTranscriptGate({
      short: 'abcd1234',
      sessionId: 'sess-id-1',
      resumeSessionId: 'sess-id-1',
      cwd: dir,
      bgIsolation: 'worktree',
      linkScanPath: path,
    })
    expect(gate.allow).toBe(true)
    // original empty path should be gone (renamed)
    const { existsSync, readdirSync } = await import('fs')
    expect(existsSync(path)).toBe(false)
    const orphans = readdirSync(dir).filter(f => f.includes('.orphaned-'))
    expect(orphans.length).toBe(1)
  })

  test('BJe quarantineOrphanTranscript renames .jsonl', async () => {
    const { quarantineOrphanTranscript } = await import('../transcriptProbe.js')
    dir = join(tmpdir(), `tp6-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'x.jsonl')
    writeFileSync(path, 'hi', 'utf8')
    const ok = await quarantineOrphanTranscript(path)
    expect(ok).toBe(true)
    const { existsSync, readdirSync } = await import('fs')
    expect(existsSync(path)).toBe(false)
    expect(readdirSync(dir).some(f => f.includes('.orphaned-'))).toBe(true)
  })

  test('214 #30: directory named *.jsonl is not a transcript', async () => {
    const {
      probeTranscriptPresence,
      transcriptHasMessages,
      probeResumeTranscript,
    } = await import('../transcriptProbe.js')
    dir = join(tmpdir(), `tp-dir-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    // Unreadable-as-transcript: folder with a .jsonl name (session store detritus)
    const asDir = join(dir, 'sess-id-1.jsonl')
    mkdirSync(asDir, { recursive: true })
    expect(await probeTranscriptPresence(asDir)).toBe('none')
    expect(await transcriptHasMessages(asDir)).toBe(false)

    // Real file elsewhere under projectsScan must still win uniquely
    const projects = join(dir, 'projects')
    const badProj = join(projects, 'bad-hash')
    const goodProj = join(projects, 'good-hash')
    mkdirSync(join(badProj, 'sess-id-1.jsonl'), { recursive: true })
    mkdirSync(goodProj, { recursive: true })
    writeFileSync(
      join(goodProj, 'sess-id-1.jsonl'),
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })}\n`,
      'utf8',
    )
    // Point CLAUDE_CONFIG_DIR at dir so projectsScan uses our fixture
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      const probe = await probeResumeTranscript('sess-id-1', dir)
      expect(probe.hasMessages).toBe(true)
      expect(probe.via).toBe('projectsScan')
      expect(probe.path).toBe(join(goodProj, 'sess-id-1.jsonl'))
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
    }
  })

  test('Xyr $ resolve: initial ?? queued ?? intent; skipIntent drops intent', async () => {
    const { resolveRespawnLaunchPrompt } = await import('../transcriptProbe.js')
    expect(
      resolveRespawnLaunchPrompt({
        initialPrompt: 'init',
        queuedPrompt: 'queued',
        intent: 'intent',
      }),
    ).toBe('init')
    expect(
      resolveRespawnLaunchPrompt({
        queuedPrompt: 'queued',
        intent: 'intent',
      }),
    ).toBe('queued')
    expect(resolveRespawnLaunchPrompt({ intent: 'intent' })).toBe('intent')
    expect(
      resolveRespawnLaunchPrompt({
        intent: 'intent',
        skipIntentReplay: true,
      }),
    ).toBeUndefined()
    expect(
      resolveRespawnLaunchPrompt({
        queuedPrompt: 'queued',
        intent: 'intent',
        skipIntentReplay: true,
      }),
    ).toBe('queued')
    expect(resolveRespawnLaunchPrompt({ intent: '  ' })).toBeUndefined()
    // densable N alone (no messages) still skips intent
    expect(
      resolveRespawnLaunchPrompt({
        intent: 'intent',
        skipIntentReplay: true, // N: resumeSessionId !== sessionId
      }),
    ).toBeUndefined()
  })

  test('gpn queue + clearQueuedPrompt densable void 0', async () => {
    const { queueRespawnInitialPrompt, clearQueuedPrompt } = await import(
      '../transcriptProbe.js'
    )
    const { getJobDirPath, readBgJobState, writeBgJobState } = await import(
      '../jobState.js'
    )
    // Isolate jobs dir under temp via CLAUDE_CONFIG_DIR if supported
    const prev = process.env.CLAUDE_CONFIG_DIR
    dir = join(tmpdir(), `tp7-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      const short = 'gpnshort1'
      mkdirSync(getJobDirPath(short), { recursive: true })
      writeBgJobState(short, {
        state: 'stopped',
        detail: '',
        tempo: 'idle',
        output: null,
        children: null,
        linkScanOffset: 0,
        template: 'bg',
        respawnFlags: [],
        intent: 'orig intent',
        sessionId: 'sess-gpn-1',
        resumeSessionId: 'sess-gpn-1',
        cwd: dir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        firstTerminalAt: null,
      })
      const state = readBgJobState(short)!
      expect(await queueRespawnInitialPrompt(short, state, 'queued turn')).toBe(
        true,
      )
      expect(readBgJobState(short)?.queuedPrompt).toBe('queued turn')
      expect(await clearQueuedPrompt(short)).toBe(true)
      expect(readBgJobState(short)?.queuedPrompt).toBeUndefined()
      expect(await clearQueuedPrompt(short)).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
    }
  })
})
