import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  resetStateForTests,
  setSessionPersistenceDisabled,
  switchSession,
} from '../../bootstrap/state.js'
import { asSessionId } from '../../types/ids.js'
import {
  formatPrintBlockedModelStderrWarning,
  shouldEmitModelPolicyCatalogNotesOnStartup,
} from '../model/modelAllowlist.js'
import {
  clearNotChainParentForTests,
  compactTranscriptFileAtomic,
  isNotChainParent,
  isTrailingNoReplyNote,
  markNotChainParent,
  readExactFromHandle,
  stripUnresumedInterruptedMessages,
  wasTurnStoppedByHook,
  writeExactToHandle,
  writeFileAtomicDurably,
} from '../sessionStorage.js'
import {
  _resetEphemeralToolResultsForTests,
  cleanupEphemeralToolResultsDirs,
  getToolResultsDir,
  isEphemeralToolResultsMode,
  persistToolResult,
} from '../toolResultStorage.js'
import {
  DEFAULT_HARBOR_KITE_LIMITS,
  shouldSkipLocalHopCount,
} from '../udsOutboundPacer.js'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  clearNotChainParentForTests()
  setSessionPersistenceDisabled(false)
  resetStateForTests()
  _resetEphemeralToolResultsForTests()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Wave 323 Group 5A: sessionStorage / toolResultStorage / modelAllowlist / udsOutboundPacer', () => {
  test('#1981/#2142 markNotChainParent & stripUnresumedInterruptedMessages preserve real user prompts', () => {
    const u1 = '00000000-0000-4000-8000-000000000001'
    const a1 = '00000000-0000-4000-8000-000000000002'
    const u2 = '00000000-0000-4000-8000-000000000003'
    const sentinel = '00000000-0000-4000-8000-000000000004'

    const u2Msg = {
      type: 'user',
      uuid: u2,
      message: { role: 'user', content: 'second real prompt' },
    }
    const msgs = [
      {
        type: 'user',
        uuid: u1,
        message: { role: 'user', content: 'first' },
      },
      {
        type: 'assistant',
        uuid: a1,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
        },
      },
      u2Msg,
      {
        type: 'assistant',
        uuid: sentinel,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'No response requested.' }],
        },
      },
    ] as any[]

    stripUnresumedInterruptedMessages(msgs, {
      kind: 'interrupted_prompt',
      message: u2Msg as any,
      loaderSentinelUuid: sentinel,
    })

    // #1981: unresumed interrupted prompt is excluded from parentUuid chain
    expect(isNotChainParent(u2)).toBe(true)
    expect(isNotChainParent(a1)).toBe(false)
    // #2142: real user prompt stays visible, synthetic loader sentinel is removed
    expect(msgs.map((m: any) => m.uuid)).toEqual([u1, a1, u2])

    markNotChainParent(a1)
    expect(isNotChainParent(a1)).toBe(true)
  })

  test('#1992 getToolResultsDir prefers pinned getSessionProjectDir() over cwd', async () => {
    const pinned = await makeTempDir('w323-pinned-')
    switchSession(asSessionId('sess-123'), pinned)
    expect(getToolResultsDir()).toBe(join(pinned, 'sess-123', 'tool-results'))
  })

  test('#2102 --no-session-persistence isolates tool-results in ephemeral dir and cleans it up', async () => {
    const pinned = await makeTempDir('w323-ephem-')
    switchSession(asSessionId('sess-abc'), pinned)
    setSessionPersistenceDisabled(true)
    expect(isEphemeralToolResultsMode()).toBe(true)

    const dir = getToolResultsDir()
    expect(dir).not.toContain(join(pinned, 'sess-abc'))

    const saved = await persistToolResult('big-tool-output', 'toolu_1')
    expect('filepath' in saved).toBe(true)
    if ('filepath' in saved) {
      expect(await readFile(saved.filepath, 'utf8')).toBe('big-tool-output')
      await cleanupEphemeralToolResultsDirs()
      await expect(stat(saved.filepath)).rejects.toThrow()
    }
  })

  test('#2064 readExactFromHandle, writeExactToHandle, and writeFileAtomicDurably', async () => {
    const dir = await makeTempDir('w323-io-')
    const file = join(dir, 'sample.jsonl')
    await writeFileAtomicDurably(file, '{"a":1}\n{"b":2}\n')
    expect(await readFile(file, 'utf8')).toBe('{"a":1}\n{"b":2}\n')

    const fh = await open(file, 'r+')
    try {
      const buf = Buffer.alloc(7)
      const ok = await readExactFromHandle(fh, buf, 7, 0)
      expect(ok).toBe(true)
      expect(buf.toString('utf8')).toBe('{"a":1}')
      await writeExactToHandle(fh, Buffer.from('{"a":9}'), 0)
    } finally {
      await fh.close()
    }
    expect(await readFile(file, 'utf8')).toBe('{"a":9}\n{"b":2}\n')
  })

  test('#2078 wasTurnStoppedByHook detects hook_stopped_continuation & stop_hook_summary', () => {
    expect(
      wasTurnStoppedByHook([
        {
          type: 'user',
          message: { role: 'user', content: 'hi' },
        },
        {
          type: 'attachment',
          attachment: { type: 'hook_stopped_continuation' },
        },
      ] as any[]),
    ).toBe(true)

    expect(
      wasTurnStoppedByHook([
        {
          type: 'system',
          subtype: 'stop_hook_summary',
          preventedContinuation: true,
        },
      ] as any[]),
    ).toBe(true)

    expect(
      wasTurnStoppedByHook([
        {
          type: 'user',
          message: { role: 'user', content: 'normal prompt' },
        },
      ] as any[]),
    ).toBe(false)
  })

  test('#2144 isTrailingNoReplyNote detects trailing file-arrival / queueTranscriptOnly rows', () => {
    expect(
      isTrailingNoReplyNote([
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'all done' }],
            stop_reason: 'end_turn',
          },
        },
        {
          type: 'user',
          isMeta: true,
          queueTranscriptOnly: true,
          message: { role: 'user', content: 'file arrived' },
        },
      ] as any[]),
    ).toBe(true)

    expect(
      isTrailingNoReplyNote([
        {
          type: 'user',
          message: { role: 'user', content: 'real user message' },
        },
      ] as any[]),
    ).toBe(false)
  })

  test('#2104 compactTranscriptFileAtomic rejects mid-line snapshots & concurrent writes', async () => {
    const dir = await makeTempDir('w323-compact-')
    const file = join(dir, 'transcript.jsonl')

    // Missing trailing newline -> aborted as snapshot_mid_line
    await writeFile(file, '{"type":"user","uuid":"1"}', 'utf8')
    const midLine = await compactTranscriptFileAtomic(file, () => true)
    expect(midLine.compacted).toBe(false)
    expect(midLine.abortedReason).toBe('snapshot_mid_line')

    // Valid transcript with substantial reclaimable payload -> compacted atomically
    const keepLine = '{"type":"user","uuid":"keep"}'
    const dropLine = `{"type":"progress","pad":"${'x'.repeat(20_000)}"}`
    await writeFile(file, `${keepLine}\n${dropLine}\n`, 'utf8')
    const ok = await compactTranscriptFileAtomic(file, line =>
      line.includes('"keep"'),
    )
    expect(ok.compacted).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(`${keepLine}\n`)

    // Concurrent rewrite during predicate evaluation -> aborted as source_changed
    await writeFile(file, `${keepLine}\n${dropLine}\n`, 'utf8')
    const { writeFileSync } = await import('fs')
    let mutated = false
    const replaced = await compactTranscriptFileAtomic(file, line => {
      if (!mutated) {
        mutated = true
        writeFileSync(file, '{"concurrent":true}\n', 'utf8')
      }
      return line.includes('"keep"')
    })
    expect(replaced.compacted).toBe(false)
    expect(replaced.abortedReason).toBe('source_changed')
    expect(await readFile(file, 'utf8')).toBe('{"concurrent":true}\n')
  })

  test('#2133/#2134 print blocked-model stderr warning & catalog notes gate', () => {
    // When requested model is allowed (no policy block), returns null
    expect(
      formatPrintBlockedModelStderrWarning(
        'claude-opus-4-7',
        'claude-opus-4-7',
      ),
    ).toBeNull()
    expect(shouldEmitModelPolicyCatalogNotesOnStartup(true)).toBe(false)
    expect(shouldEmitModelPolicyCatalogNotesOnStartup(false)).toBe(true)
  })

  test('#2164 local same-machine limits raised to 100000 and local hops uncounted', () => {
    expect(DEFAULT_HARBOR_KITE_LIMITS.maxDesktopForwards).toBe(100_000)
    expect(DEFAULT_HARBOR_KITE_LIMITS.maxLocalRelays).toBe(100_000)
    expect(DEFAULT_HARBOR_KITE_LIMITS.countLocalHops).toBe(false)
    expect(shouldSkipLocalHopCount({ verifiedLocal: true })).toBe(true)
    expect(shouldSkipLocalHopCount({ verifiedLocal: false })).toBe(false)
  })
})
