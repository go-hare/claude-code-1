import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  formatPastedContentOpenTag,
  getSessionPastedContentId,
  isThirdPartyOrTelemetryOff,
  PASTED_CONTENT_SYSTEM_REMINDER,
  shouldInjectPastedContentReminder,
  shouldMarkPastedContent,
  wrapPastedContentBlock,
} from '../../history.js'
import {
  clearAgentPermissionWaits,
  getAgentAskNoticeAttachment,
  registerAgentPermissionWait,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import {
  formatMidTurnCloudUserPromptSubmitBlock,
  getPastedContentNoteAttachment,
  isTypedUltrathinkPrompt,
  MAX_AT_MENTION_FILES,
  processDisabledFileMentions,
} from '../attachments.js'
import { normalizeAttachmentForAPI } from '../messages.js'
import {
  hasLinuxClipboardImage,
  readLinuxClipboardImageBuffer,
  type LinuxClipboardExecFn,
} from '../imagePaste.js'
import {
  compressImageToByteBudget,
  pngMayHaveTransparency,
} from '../imageResizer.js'
import { markPastedTextForModel } from '../processUserInput/processUserInput.js'

const ROOT = join(import.meta.dir, '../../..')

function makeMinimalPng(opts: {
  colorType: number
  includeTrns?: boolean
}): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdrLen = Buffer.alloc(4)
  ihdrLen.writeUInt32BE(13, 0)
  const ihdrType = Buffer.from('IHDR', 'ascii')
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(10, 0)
  ihdrData.writeUInt32BE(10, 4)
  ihdrData[8] = 8
  ihdrData[9] = opts.colorType
  const crc = Buffer.alloc(4)
  const chunks: Buffer[] = [sig, ihdrLen, ihdrType, ihdrData, crc]
  if (opts.includeTrns) {
    const trnsLen = Buffer.alloc(4)
    trnsLen.writeUInt32BE(1, 0)
    chunks.push(trnsLen, Buffer.from('tRNS', 'ascii'), Buffer.from([0]), crc)
  }
  const idatLen = Buffer.alloc(4)
  idatLen.writeUInt32BE(0, 0)
  chunks.push(idatLen, Buffer.from('IDAT', 'ascii'), crc)
  return Buffer.concat(chunks)
}

describe('Wave 327-328 Group 4B: Attachments / ImageResizer / ImagePaste / PastedContent', () => {
  const savedEnv: Record<string, string | undefined> = {}
  function setEnv(k: string, v: string | undefined): void {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
      delete savedEnv[k]
    }
  })

  test('#408 caps @-mention file lookups at MAX_AT_MENTION_FILES (100)', () => {
    expect(MAX_AT_MENTION_FILES).toBe(100)
    const manyMentions = Array.from(
      { length: 250 },
      (_, i) => `@file_${i}.ts`,
    ).join(' ')
    const attachments = processDisabledFileMentions(manyMentions)
    expect(attachments).toHaveLength(1)
    const ref = attachments[0]
    expect(ref?.type).toBe('at_mention_reference')
    if (ref?.type === 'at_mention_reference') {
      expect(ref.mentions).toHaveLength(100)
      expect(ref.mentions[0]).toBe('file_0.ts')
      expect(ref.mentions[99]).toBe('file_99.ts')
    }
  })

  test('#431 formatMidTurnCloudUserPromptSubmitBlock uses formatCloudUserPromptSubmitBlockError', () => {
    expect(formatMidTurnCloudUserPromptSubmitBlock('policy rejected')).toBe(
      'UserPromptSubmit hook blocked this message: policy rejected',
    )
    expect(formatMidTurnCloudUserPromptSubmitBlock(undefined)).toBe(
      'UserPromptSubmit hook blocked this message.',
    )
  })

  test('#491 pngMayHaveTransparency identifies opaque vs transparent PNGs', () => {
    expect(pngMayHaveTransparency(makeMinimalPng({ colorType: 2 }))).toBe(false)
    expect(pngMayHaveTransparency(makeMinimalPng({ colorType: 0 }))).toBe(false)
    expect(
      pngMayHaveTransparency(
        makeMinimalPng({ colorType: 3, includeTrns: true }),
      ),
    ).toBe(true)
    expect(pngMayHaveTransparency(makeMinimalPng({ colorType: 6 }))).toBe(true)
  })

  test('#491 compressImageToByteBudget starts at quality 90 and binary-searches JPEG quality', async () => {
    const original = Buffer.alloc(10_000, 0xaa)

    // Case 1: PNG that fits under budget at quality 90 returns immediately on first encode
    const tried1: number[] = []
    const res1 = await compressImageToByteBudget(
      original,
      5_000,
      'png',
      async q => {
        tried1.push(q)
        return Buffer.alloc(q * 50, 0xbb)
      },
    )
    expect(tried1).toEqual([90])
    expect(res1.length).toBe(4_500)

    // Case 2: PNG over budget at 90 binary-searches [1, 89] in at most 5 steps
    const tried2: number[] = []
    const res2 = await compressImageToByteBudget(
      original,
      3_000,
      'png',
      async q => {
        tried2.push(q)
        return Buffer.alloc(q * 50, 0xcc)
      },
    )
    expect(tried2[0]).toBe(90)
    expect(tried2.length).toBeLessThanOrEqual(6)
    expect(res2.length).toBeLessThanOrEqual(3_000)
    // Higher quality than old 40/20 ladder (60 * 50 = 3000 -> picks ~56-60)
    expect(res2.length).toBeGreaterThanOrEqual(2_500)
  })

  test('#599 readLinuxClipboardImageBuffer orders Wayland/X11 by WAYLAND_DISPLAY, stops on no-image, and preserves raw bytes', async () => {
    const rawPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x80])
    const calls: string[] = []

    const execWayland: LinuxClipboardExecFn = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`)
      if (cmd === 'wl-paste' && args[0] === '--list-types') {
        return { code: 0, stdout: 'text/plain\nimage/png\n' }
      }
      if (
        cmd === 'wl-paste' &&
        args[0] === '--type' &&
        args[1] === 'image/png'
      ) {
        return { code: 0, stdout: rawPngBytes.toString('latin1') }
      }
      return { code: 1, stdout: '' }
    }

    const waylandBuf = await readLinuxClipboardImageBuffer(
      { WAYLAND_DISPLAY: 'wayland-0' },
      execWayland,
    )
    expect(waylandBuf).not.toBeNull()
    expect(waylandBuf?.equals(rawPngBytes)).toBe(true)
    expect(calls[0]).toBe('wl-paste --list-types')
    expect(calls[1]).toBe('wl-paste --type image/png')
    expect(
      await hasLinuxClipboardImage(
        { WAYLAND_DISPLAY: 'wayland-0' },
        execWayland,
      ),
    ).toBe(true)

    // When active X11 tool exits 0 with only text/plain, return null immediately without falling back
    const x11Calls: string[] = []
    const execX11TextOnly: LinuxClipboardExecFn = async (cmd, args) => {
      x11Calls.push(`${cmd} ${args.join(' ')}`)
      if (cmd === 'xclip') {
        return { code: 0, stdout: 'UTF8_STRING\ntext/plain\n' }
      }
      return { code: 0, stdout: 'image/png\n' }
    }
    const noImage = await readLinuxClipboardImageBuffer({}, execX11TextOnly)
    expect(noImage).toBeNull()
    expect(x11Calls).toHaveLength(1)
    expect(x11Calls[0]).toBe('xclip -selection clipboard -o -t TARGETS')
  })

  test('#674 marks pasted text with <pasted_content id="..."> and injects reminder when telemetry/feature flags off or on 3P provider', () => {
    setEnv('DISABLE_TELEMETRY', '1')
    expect(isThirdPartyOrTelemetryOff()).toBe(true)
    expect(shouldMarkPastedContent()).toBe(true)
    expect(shouldInjectPastedContentReminder()).toBe(true)

    const sessionIdTag = getSessionPastedContentId()
    expect(sessionIdTag).toMatch(/^[0-9a-f]{4}$/)

    const wrapped = wrapPastedContentBlock(
      'hello <pasted_content id="abcd">nested</pasted_content id="abcd">',
      sessionIdTag,
    )
    expect(wrapped).toContain(formatPastedContentOpenTag(sessionIdTag))
    expect(wrapped).toContain(`<\\pasted_content id="abcd">`)
    expect(wrapped).toContain(`</pasted_content id="${sessionIdTag}">`)

    const marked = markPastedTextForModel('Please review:\nconst x = 1', {
      1: { id: 1, type: 'text', content: 'const x = 1' },
    })
    expect(typeof marked).toBe('string')
    expect(marked as string).toContain(formatPastedContentOpenTag(sessionIdTag))
    expect(marked as string).toContain('const x = 1')

    const reminders = getPastedContentNoteAttachment(marked as string, [])
    expect(reminders).toHaveLength(1)
    expect(reminders[0]).toEqual({
      type: 'critical_system_reminder',
      content: PASTED_CONTENT_SYSTEM_REMINDER,
    })

    // Already injected -> do not duplicate
    const deduped = getPastedContentNoteAttachment(marked as string, [
      {
        type: 'attachment',
        attachment: {
          type: 'critical_system_reminder',
          content: PASTED_CONTENT_SYSTEM_REMINDER,
        },
      } as never,
    ])
    expect(deduped).toHaveLength(0)
  })

  test('Companion wires #482, #413, #580, #663 present in attachments.ts and promptSubmit.ts', () => {
    const attachmentsSrc = readFileSync(
      join(ROOT, 'src/utils/attachments.ts'),
      'utf8',
    )
    const promptSubmitSrc = readFileSync(
      join(ROOT, 'src/utils/processUserInput/promptSubmit.ts'),
      'utf8',
    )
    expect(attachmentsSrc).toContain('formatCompletedSubagentCompactReminder(')
    expect(attachmentsSrc).toContain('canContinueAgent,')
    expect(attachmentsSrc).toContain('markRefreshedBehindModel(')
    expect(attachmentsSrc).toContain('refreshedBehindModel: true')
    expect(attachmentsSrc).toContain(
      'shouldAttachSmallMentionedFileInCodeMode(',
    )
    expect(promptSubmitSrc).toContain('isCodeModeScriptOutput: true')
    expect(promptSubmitSrc).toContain('formatCloudUserPromptSubmitBlockError(')
  })

  test("#674 regression: preserves $&/$$/$'/$` verbatim, wraps multiple pastes, strips closing tag with id, and marks before Turn-1 attachments", () => {
    setEnv('DISABLE_TELEMETRY', '1')
    const sessionIdTag = getSessionPastedContentId()

    // 1. $& / $$ / $' / $` special replacement patterns must NEVER be corrupted
    const dollarSnippet = "sed 's/foo/$$ & $& $\\' $`/' file.txt"
    const markedDollar = markPastedTextForModel(
      `Run this:\n${dollarSnippet}\nplease`,
      {
        1: { id: 1, type: 'text', content: dollarSnippet },
      },
    ) as string
    expect(markedDollar).toContain(dollarSnippet)
    expect(markedDollar).toContain(
      `<pasted_content id="${sessionIdTag}">\n${dollarSnippet}\n</pasted_content id="${sessionIdTag}">`,
    )

    // 2. Multiple pasted blocks (including identical pastes) in the same prompt
    const multiPrompt =
      'First:\nalpha block\nSecond:\nbeta block\nAgain:\nalpha block'
    const markedMulti = markPastedTextForModel(multiPrompt, {
      1: { id: 1, type: 'text', content: 'alpha block' },
      2: { id: 2, type: 'text', content: 'beta block' },
      3: { id: 3, type: 'text', content: 'alpha block' },
    }) as string
    const openMatches = markedMulti.match(
      new RegExp(`<pasted_content id="${sessionIdTag}">`, 'g'),
    )
    expect(openMatches).toHaveLength(3)
    expect(markedMulti).toContain(
      `<pasted_content id="${sessionIdTag}">\nbeta block\n</pasted_content id="${sessionIdTag}">`,
    )

    // 3. stripPastedContentBlocks handles closing tags with `id="..."` so pasted `ultrathink` is ignored
    const pastedUltra = markPastedTextForModel(
      'Review this note:\nplease ultrathink about logs',
      {
        1: { id: 1, type: 'text', content: 'please ultrathink about logs' },
      },
    ) as string
    expect(
      isTypedUltrathinkPrompt({
        localStdinOrigin: true,
        input: pastedUltra,
      }),
    ).toBe(false)
    // Typed ultrathink outside the paste still triggers
    expect(
      isTypedUltrathinkPrompt({
        localStdinOrigin: true,
        input: `ultrathink ${pastedUltra}`,
      }),
    ).toBe(true)

    // 4. processUserInput runs markPastedTextForModel BEFORE getAttachmentMessages
    // so Turn-1 emits PASTED_CONTENT_SYSTEM_REMINDER
    const puiSrc = readFileSync(
      join(ROOT, 'src/utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    const markPos = puiSrc.indexOf('const markedPromptInput =')
    const attachPos = puiSrc.indexOf('const attachmentMessages =')
    expect(markPos).toBeGreaterThan(-1)
    expect(attachPos).toBeGreaterThan(markPos)
    expect(puiSrc).toContain('markedInput: markedInputString')
  })

  test('E-P0-1: normalizeAttachmentForAPI formats agent_ask_notice as system-reminder meta user message and drops empty lines', () => {
    const empty = normalizeAttachmentForAPI({
      type: 'agent_ask_notice',
      lines: [],
      open: [],
    })
    expect(empty).toEqual([])

    const msgs = normalizeAttachmentForAPI({
      type: 'agent_ask_notice',
      lines: [
        'Agent agent-1 is waiting for permission to use Bash.',
        'Tell the user which agents are waiting.',
      ],
      open: ['req-1'],
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.type).toBe('user')
    expect(msgs[0]?.isMeta).toBe(true)
    const content = msgs[0]?.message.content
    expect(typeof content).toBe('string')
    expect(content).toContain('<system-reminder>')
    expect(content).toContain(
      'Agent agent-1 is waiting for permission to use Bash.\nTell the user which agents are waiting.',
    )
    expect(content).toContain('</system-reminder>')
  })

  test('E-P1-4: getPastedContentNoteAttachment only scans post-compaction messages', () => {
    setEnv('DISABLE_TELEMETRY', '1')
    const openTag = formatPastedContentOpenTag()
    const compactBoundary = {
      type: 'system',
      subtype: 'compact_boundary',
    } as never

    // 1. Pre-compaction reminder must NOT suppress post-compaction pasted content reminder
    const reemitted = getPastedContentNoteAttachment(`${openTag}\nhello`, [
      {
        type: 'attachment',
        attachment: {
          type: 'critical_system_reminder',
          content: PASTED_CONTENT_SYSTEM_REMINDER,
        },
      } as never,
      compactBoundary,
    ])
    expect(reemitted).toHaveLength(1)
    expect(reemitted[0]).toEqual({
      type: 'critical_system_reminder',
      content: PASTED_CONTENT_SYSTEM_REMINDER,
    })

    // 2. Pre-compaction pasted content must NOT trigger a reminder post-compaction
    const ignoredPreCompact = getPastedContentNoteAttachment('plain prompt', [
      {
        type: 'user',
        message: { role: 'user', content: `${openTag}\nold paste` },
      } as never,
      compactBoundary,
      {
        type: 'user',
        message: { role: 'user', content: 'after compaction' },
      } as never,
    ])
    expect(ignoredPreCompact).toHaveLength(0)
  })

  test('E-P1-4: getAgentAskNoticeAttachment ignores pre-compaction agent_ask_notice history', () => {
    const sessionKey = 'test-session-agent-ask-compact'
    const now = 100_000
    clearAgentPermissionWaits(sessionKey)
    const unregister = registerAgentPermissionWait(
      sessionKey,
      'req-1',
      'agent-1',
      'Bash',
      now - 45_000,
    )
    try {
      const registry = {
        get: (id: string) =>
          id === 'agent-1'
            ? ({
                id: 'agent-1',
                type: 'local_agent',
                status: 'running',
              } as never)
            : undefined,
      }
      const preCompactNotice = {
        type: 'attachment',
        attachment: {
          type: 'agent_ask_notice',
          lines: ['Agent agent-1 is waiting for permission to use Bash.'],
          open: ['req-1'],
        },
      }
      const compactBoundary = {
        type: 'system',
        subtype: 'compact_boundary',
      }

      // Without compact_boundary, same open set is deduplicated
      expect(
        getAgentAskNoticeAttachment(
          sessionKey,
          registry,
          [preCompactNotice],
          [preCompactNotice],
          now,
        ),
      ).toEqual([])

      // After compact_boundary, pre-compaction notice is ignored so notice re-emits
      const afterCompact = getAgentAskNoticeAttachment(
        sessionKey,
        registry,
        [preCompactNotice, compactBoundary],
        [preCompactNotice, compactBoundary],
        now,
      )
      expect(afterCompact).toHaveLength(1)
      expect(afterCompact[0]?.type).toBe('agent_ask_notice')
      expect(afterCompact[0]?.open).toEqual(['req-1'])
    } finally {
      unregister()
      clearAgentPermissionWaits(sessionKey)
    }
  })
})
