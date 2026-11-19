import { afterEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  bridgeBrokenParentChain,
  buildConversationChain,
  isLowMemoryReadError,
  loadTranscriptFile,
  streamTranscriptFileLowMemory,
} from '../../utils/sessionStorage.js'
import {
  BG_BARE_UNAPPROVED_KEY_MESSAGE,
  BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE,
  checkBareUnapprovedKeyForBg,
  checkDaemonCredentialForBgLaunch,
  deleteBgJobCredentialAnchor,
  getDaemonSignInPinPath,
  readBgJobCredentialAnchor,
  writeBgJobCredentialAnchor,
} from '../bgSessionCredential.js'
import {
  getDaemonGatewayMarkPath,
  hydrateGatewayMark,
  verifyProcessIdentityBeforeKill,
  writeGatewayMark,
  clearGatewayMark,
  type DispatchRequest,
} from '../bgWorker.js'
import { createEmptyQuitInputTracker } from '../clientAttach.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 326 Group 5A — Daemon & SessionStorage (#14, #15, #30, #31, #33, #61, #335, #340)', () => {
  test('#14 persists and hydrates daemon-level gateway-routed marker across folders', async () => {
    const short = 'deadbeef'
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const dir = mkdtempSync(join(tmpdir(), 'gw-mark-326-'))
    tempDirs.push(dir)
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      await writeGatewayMark(short)
      expect(getDaemonGatewayMarkPath(short, dir)).toContain('gateway-routed')
      const dispatch = {
        short,
        sessionId: `${short}-0000-0000-0000-000000000000`,
        cwd: '/tmp',
        source: 'shell',
        launch: { mode: 'fresh', args: [] },
        env: {},
        createdAt: Date.now(),
      } as unknown as DispatchRequest
      await hydrateGatewayMark(dispatch)
      expect(dispatch.gatewayRouted).toBe(true)
      await clearGatewayMark(short)
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
  })

  test('#15 verifyProcessIdentityBeforeKill blocks kill on reused or unverified PIDs', () => {
    expect(
      verifyProcessIdentityBeforeKill(
        12345,
        'Mon Jan  1 00:00:00 2026',
        () => 'Mon Jan  1 00:00:00 2026',
      ),
    ).toBe('safe')

    // Reused PID (e.g. SSH login started later)
    expect(
      verifyProcessIdentityBeforeKill(
        12345,
        'Mon Jan  1 00:00:00 2026',
        () => 'Tue Jan  2 12:34:56 2026',
      ),
    ).toBe('recycled')

    // Missing procStart on POSIX must not blindly kill
    if (process.platform !== 'win32') {
      expect(
        verifyProcessIdentityBeforeKill(
          12345,
          undefined,
          () => 'Mon Jan  1 00:00:00 2026',
        ),
      ).toBe('unverified')
    }
  })

  test('#30 bridges broken parentUuid chain after crash following empty reply', () => {
    const u1 = '00000000-0000-0000-0000-000000000001' as UUID
    const a1 = '00000000-0000-0000-0000-000000000002' as UUID
    const missingEmptyReply = '00000000-0000-0000-0000-000000000099' as UUID
    const u2 = '00000000-0000-0000-0000-000000000003' as UUID

    const messages = new Map<UUID, never>([
      [
        u1,
        {
          type: 'user',
          uuid: u1,
          parentUuid: null,
          isSidechain: false,
          timestamp: '2026-01-01T00:00:01.000Z',
          message: { role: 'user', content: 'turn 1' },
        } as never,
      ],
      [
        a1,
        {
          type: 'assistant',
          uuid: a1,
          parentUuid: u1,
          isSidechain: false,
          timestamp: '2026-01-01T00:00:02.000Z',
          message: {
            id: 'm1',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
          },
        } as never,
      ],
      [
        u2,
        {
          type: 'user',
          uuid: u2,
          parentUuid: missingEmptyReply,
          isSidechain: false,
          timestamp: '2026-01-01T00:00:05.000Z',
          message: { role: 'user', content: 'turn 2 after crash' },
        } as never,
      ],
    ])

    const bridged = bridgeBrokenParentChain(messages, u2)
    expect(bridged).toBe(1)

    const chain = buildConversationChain(messages, messages.get(u2)!)
    expect(chain.map(m => m.uuid)).toEqual([u1, a1, u2])
  })

  test('#31 detects low-memory read errors and streams transcript line-by-line preserving earlier history', async () => {
    expect(isLowMemoryReadError(new RangeError('Invalid string length'))).toBe(
      true,
    )
    expect(
      isLowMemoryReadError(Object.assign(new Error('oom'), { code: 'ENOMEM' })),
    ).toBe(true)
    expect(
      isLowMemoryReadError(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      ),
    ).toBe(false)

    const dir = mkdtempSync(join(tmpdir(), 'lowmem-326-'))
    tempDirs.push(dir)
    const file = join(dir, 'session.jsonl')
    const sid = '11111111-1111-1111-1111-111111111111'
    const u1 = '00000000-0000-0000-0000-000000000011'
    const u2 = '00000000-0000-0000-0000-000000000012'
    const rows = [
      JSON.stringify({
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        isSidechain: false,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'earlier history turn 1' },
      }),
      '{corrupt line that should be skipped}',
      JSON.stringify({
        type: 'user',
        uuid: u2,
        parentUuid: u1,
        sessionId: sid,
        isSidechain: false,
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'later turn 2' },
      }),
    ].join('\n')
    writeFileSync(file, `${rows}\n`, 'utf8')

    const streamed: unknown[] = []
    const stats = await streamTranscriptFileLowMemory(
      file,
      entries => streamed.push(...entries),
      { chunkBytes: 4096 },
    )
    expect(stats.linesParsed).toBe(2)
    expect(stats.linesSkipped).toBe(1)

    const loaded = await loadTranscriptFile(file, { lowMemoryMode: true })
    expect(loaded.messages.size).toBe(2)
    expect(loaded.messages.has(u1 as UUID)).toBe(true)
    expect(loaded.messages.has(u2 as UUID)).toBe(true)
  })

  test('#61 refuses agent-view resume when daemon lacks terminal API key/token and pins daemon sign-in', async () => {
    const err = checkDaemonCredentialForBgLaunch({
      callerEnv: { ANTHROPIC_API_KEY: 'sk-ant-terminal-key' },
      daemonRunning: true,
      daemonCredentialMatches: false,
    })
    expect(err).toBe(BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE)

    const ok = checkDaemonCredentialForBgLaunch({
      callerEnv: { ANTHROPIC_API_KEY: 'sk-ant-terminal-key' },
      daemonRunning: true,
      daemonCredentialMatches: true,
    })
    expect(ok).toBeNull()

    const baseDir = mkdtempSync(join(tmpdir(), 'signin-pin-326-'))
    tempDirs.push(baseDir)
    const short = 'cafebabe'
    const cred = `env-apikey:${'a'.repeat(16)}:${'b'.repeat(32)}`
    await writeBgJobCredentialAnchor(
      short,
      { CLAUDE_BG_SESSION_CREDENTIAL: cred },
      baseDir,
    )
    // Remove jobs/.anchors file to verify daemon/sign-in/<short> pin survives independently
    rmSync(join(baseDir, 'jobs', '.anchors', `${short}.json`), { force: true })
    expect(getDaemonSignInPinPath(short, baseDir)).toContain(
      join('daemon', 'sign-in', short),
    )
    const read = await readBgJobCredentialAnchor(short, baseDir)
    expect(read?.CLAUDE_BG_SESSION_CREDENTIAL).toBe(cred)
    await deleteBgJobCredentialAnchor(short, baseDir)
  })

  test('#335 refuses moving --bare unapproved-key session to bg and errors on --bare --bg when daemon lacks key', () => {
    // Interactive --bare move to bg (not --bare --bg)
    const moveErr = checkBareUnapprovedKeyForBg({
      isBareSession: true,
      hasBareFlagInBgLaunch: false,
      callerEnv: { ANTHROPIC_API_KEY: 'sk-ant-unapproved' },
      isApiKeyApproved: false,
      daemonRunning: false,
    })
    expect(moveErr).toBe(BG_BARE_UNAPPROVED_KEY_MESSAGE)

    // `claude --bare --bg` when daemon is running without the key
    const cliErr = checkBareUnapprovedKeyForBg({
      isBareSession: true,
      hasBareFlagInBgLaunch: true,
      callerEnv: { ANTHROPIC_API_KEY: 'sk-ant-unapproved' },
      isApiKeyApproved: false,
      daemonRunning: true,
      daemonHasMatchingKey: false,
    })
    expect(cliErr).toBe(BG_SHELL_CREDENTIAL_MISMATCH_MESSAGE)

    // `claude --bare --bg` when daemon is not running yet (inherits key)
    const coldOk = checkBareUnapprovedKeyForBg({
      isBareSession: true,
      hasBareFlagInBgLaunch: true,
      callerEnv: { ANTHROPIC_API_KEY: 'sk-ant-unapproved' },
      isApiKeyApproved: false,
      daemonRunning: false,
    })
    expect(coldOk).toBeNull()
  })

  test('#31 streamTranscriptFileLowMemory preserves multi-byte UTF-8 characters split across chunk boundaries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lowmem-utf8-326-'))
    tempDirs.push(dir)
    const file = join(dir, 'utf8-boundary.jsonl')
    const sid = '22222222-2222-2222-2222-222222222222'
    const u1 = '00000000-0000-0000-0000-000000000101'
    const marker = '🚀中文边界测试🎉'
    // Craft a row whose multi-byte UTF-8 sequence straddles byte offset 4096.
    const prefix = JSON.stringify({
      type: 'user',
      uuid: u1,
      parentUuid: null,
      sessionId: sid,
      isSidechain: false,
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'user', content: '' },
    })
    const padLen = Math.max(0, 4094 - Buffer.byteLength(prefix, 'utf8'))
    const content = `${'a'.repeat(padLen)}${marker}`
    const row = JSON.stringify({
      type: 'user',
      uuid: u1,
      parentUuid: null,
      sessionId: sid,
      isSidechain: false,
      timestamp: '2026-01-01T00:00:01.000Z',
      message: { role: 'user', content },
    })
    writeFileSync(file, `${row}\n`, 'utf8')

    const parsed: Array<{ message?: { content?: string } }> = []
    const stats = await streamTranscriptFileLowMemory(
      file,
      entries =>
        parsed.push(...(entries as Array<{ message?: { content?: string } }>)),
      { chunkBytes: 4096 },
    )
    expect(stats.linesParsed).toBe(1)
    expect(stats.linesSkipped).toBe(0)
    expect(parsed[0]?.message?.content).toBe(content)
    expect(parsed[0]?.message?.content).not.toContain('\uFFFD')
  })

  test('#30 bridgeBrokenParentChain does not bridge past compact_boundary and runs after preserved-segment relinks', async () => {
    const u1 = '00000000-0000-0000-0000-000000000201' as UUID
    const boundary = '00000000-0000-0000-0000-000000000202' as UUID
    const summary = '00000000-0000-0000-0000-000000000203' as UUID
    const missingPre = '00000000-0000-0000-0000-000000000299' as UUID

    const messages = new Map<UUID, never>([
      [
        u1,
        {
          type: 'user',
          uuid: u1,
          parentUuid: null,
          isSidechain: false,
          timestamp: '2026-01-01T00:00:01.000Z',
          message: { role: 'user', content: 'pre-compact' },
        } as never,
      ],
      [
        boundary,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: boundary,
          parentUuid: missingPre,
          isSidechain: false,
          timestamp: '2026-01-01T00:00:02.000Z',
          content: 'Conversation compacted',
        } as never,
      ],
      [
        summary,
        {
          type: 'user',
          uuid: summary,
          parentUuid: boundary,
          isSidechain: false,
          timestamp: '2026-01-01T00:00:03.000Z',
          message: { role: 'user', content: 'summary' },
        } as never,
      ],
    ])

    // Must stop at compact_boundary and not re-link it to pre-compact u1.
    expect(bridgeBrokenParentChain(messages, summary)).toBe(0)
    expect(
      (messages.get(boundary) as unknown as { parentUuid: UUID | null })
        .parentUuid,
    ).toBe(missingPre)

    // In loadTranscriptFile, preserved-segment relinks run before gap bridging.
    const dir = mkdtempSync(join(tmpdir(), 'relink-order-326-'))
    tempDirs.push(dir)
    const file = join(dir, 'relink.jsonl')
    const sid = '33333333-3333-3333-3333-333333333333'
    const pre1 = '00000000-0000-0000-0000-000000000301'
    const pre2 = '00000000-0000-0000-0000-000000000302'
    const cb = '00000000-0000-0000-0000-000000000303'
    const sum = '00000000-0000-0000-0000-000000000304'
    const after = '00000000-0000-0000-0000-000000000305'
    const missingMid = '00000000-0000-0000-0000-000000000399'
    const lines = [
      JSON.stringify({
        type: 'user',
        uuid: pre1,
        parentUuid: null,
        sessionId: sid,
        isSidechain: false,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'old' },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: pre2,
        parentUuid: pre1,
        sessionId: sid,
        isSidechain: false,
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          id: 'm-pre2',
          role: 'assistant',
          content: [{ type: 'text', text: 'preserved' }],
        },
      }),
      JSON.stringify({
        type: 'system',
        subtype: 'compact_boundary',
        uuid: cb,
        parentUuid: null,
        sessionId: sid,
        isSidechain: false,
        timestamp: '2026-01-01T00:00:03.000Z',
        content: 'Conversation compacted',
        compactMetadata: {
          trigger: 'auto',
          preTokens: 1000,
          preservedSegment: {
            headUuid: pre2,
            anchorUuid: sum,
            tailUuid: pre2,
          },
        },
      }),
      JSON.stringify({
        type: 'user',
        uuid: sum,
        parentUuid: cb,
        sessionId: sid,
        isSidechain: false,
        timestamp: '2026-01-01T00:00:04.000Z',
        message: { role: 'user', content: 'compact summary' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: after,
        parentUuid: missingMid,
        sessionId: sid,
        isSidechain: false,
        timestamp: '2026-01-01T00:00:05.000Z',
        message: { role: 'user', content: 'after crash' },
      }),
    ]
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
    const loaded = await loadTranscriptFile(file)
    // pre2 was relinked under sum, and after (missingMid) bridged onto post-boundary leaf
    expect(loaded.messages.get(pre2 as UUID)?.parentUuid).toBe(sum as UUID)
    expect(loaded.messages.get(after as UUID)?.parentUuid).not.toBe(
      pre1 as UUID,
    )
  })

  test('#340 createEmptyQuitInputTracker detects Kitty CSI u Ctrl+C×2, Ctrl+D×2, and /exit+Enter', () => {
    let now = 10_000
    const ctrlC = createEmptyQuitInputTracker(() => now)
    ctrlC.feed(Buffer.from('\x1b[99;5u'))
    expect(ctrlC.sawSignal()).toBe(false)
    now += 300
    ctrlC.feed(Buffer.from('\x1b[99;5u'))
    expect(ctrlC.sawSignal()).toBe(true)

    const ctrlD = createEmptyQuitInputTracker(() => now)
    ctrlD.feed(Buffer.from('\x1b[100;5u'))
    expect(ctrlD.sawSignal()).toBe(false)
    now += 300
    ctrlD.feed(Buffer.from('\x1b[100;5u'))
    expect(ctrlD.sawSignal()).toBe(true)

    const slashExit = createEmptyQuitInputTracker(() => now)
    slashExit.feed(Buffer.from('/exit\x1b[13u'))
    expect(slashExit.sawSignal()).toBe(true)
  })
})
