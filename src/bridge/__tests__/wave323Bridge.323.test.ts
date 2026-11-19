import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { validateFlagSettingsSandboxOrError } from '../../cli/mainBootstrap.js'
import { formatPrintEndedClaudeAiLoginWarning } from '../../cli/print.js'
import { HybridTransport } from '../../cli/transports/HybridTransport.js'
import {
  computeNetworkInterfacesFingerprint,
  SSETransport,
} from '../../cli/transports/SSETransport.js'
import { buildDroppedPeerMessageHoldFrame } from '../../utils/peerAdmission.js'
import { DEFAULT_DIALOG_ACTION_DESCRIPTIONS } from '../../utils/userDialog.js'
import { BRIDGE_POINTER_TTL_MS } from '../bridgePointer.js'
import { listIntentToAddFiles } from '../buildWorkspaceDiffResponse.js'
import { buildNamedInlinedImagePathRefs } from '../inboundAttachments.js'
import {
  extractInboundMessageFields,
  hasUntypedAtMentionMetadata,
  normalizeUntypedMentionBlocks,
} from '../inboundMessages.js'
import { toolSummary } from '../sessionRunner.js'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Wave 323 Group 5A: bridge / transports / print / mainBootstrap', () => {
  test('#2031/#2178 --settings sandbox JSON & schema validation blocks startup', () => {
    // #2178: broken JSON containing "sandbox" even with enabled:false
    const malformed = validateFlagSettingsSandboxOrError(
      '{ "sandbox": { "enabled": false, } }',
      '--settings',
    )
    expect(malformed).not.toBeNull()
    expect(malformed).toContain('sandbox')

    // #2178: unicode-escaped "sandbox" in broken JSON
    const escaped = validateFlagSettingsSandboxOrError(
      '{ "\\u0073andbox": { "enabled": false, } }',
      '--settings',
    )
    expect(escaped).not.toBeNull()

    // #2031: valid JSON with sandbox.enabled:true and invalid schema field
    const invalidSchema = validateFlagSettingsSandboxOrError(
      JSON.stringify({
        sandbox: { enabled: true, network: { allowedDomains: 'not-an-array' } },
      }),
      '--settings',
    )
    expect(invalidSchema).not.toBeNull()
    expect(invalidSchema).toContain('sandbox')

    // Valid JSON with valid sandbox config passes
    expect(
      validateFlagSettingsSandboxOrError(
        JSON.stringify({ sandbox: { enabled: true } }),
        '--settings',
      ),
    ).toBeNull()
  })

  test('#2008 print ended claude.ai login warning mentions MCP logins & plugin secrets', () => {
    const msg = formatPrintEndedClaudeAiLoginWarning('Acme Corp')
    expect(msg).toContain('Acme Corp')
    expect(msg).toContain('claude auth logout')
    expect(msg).toContain('MCP server logins')
    expect(msg).toContain('plugin secrets')
  })

  test('#2066 untyped @mention metadata sets textNotTyped and normalizes blocks', () => {
    const msg = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'check @src/foo.ts' },
          { type: 'text', text: 'see', textNotTyped: true },
        ],
      },
      metadata: { textNotTyped: true },
    } as any

    expect(hasUntypedAtMentionMetadata(msg)).toBe(true)
    const fields = extractInboundMessageFields(msg)
    expect(fields?.textNotTyped).toBe(true)
    const normalized = normalizeUntypedMentionBlocks(msg.message.content)
    expect(normalized.hadUntypedMention).toBe(true)
    expect(normalized.blocks.length).toBeGreaterThan(0)
  })

  test('#2080 listIntentToAddFiles detects git add -N intent-to-add files before first commit', async () => {
    const repo = await makeTempDir('w323-git-ita-')
    execFileSync('git', ['init', '-q'], { cwd: repo })
    await writeFile(join(repo, 'newfile.ts'), 'export const x = 42\n', 'utf8')
    execFileSync('git', ['add', '-N', 'newfile.ts'], { cwd: repo })

    const ita = await listIntentToAddFiles(repo)
    expect(ita).toEqual(['newfile.ts'])
  })

  test('#2101 buildDroppedPeerMessageHoldFrame produces dropped peer_message_hold payload', () => {
    const frame = buildDroppedPeerMessageHoldFrame({
      sessionId: 'sess-1',
      lane: 'bridge',
      from: 'peer-a',
      outcome: 'rate-limited',
    })
    expect(frame.type).toBe('system')
    expect(frame.subtype).toBe('peer_message_hold')
    expect(frame.state).toBe('dropped')
    expect(frame.from).toBe('peer-a')
  })

  test('#2111 SSETransport network fingerprint & onNetworkChange reconnect hook', () => {
    const fp = computeNetworkInterfacesFingerprint()
    expect(typeof fp).toBe('string')
    const sse = new SSETransport(new URL('http://127.0.0.1:9/events'), {})
    expect(typeof sse.onNetworkChange).toBe('function')
    sse.close()
  })

  test('#2112 fable_overage_consent_prompt is registered in DEFAULT_DIALOG_ACTION_DESCRIPTIONS', () => {
    expect(
      DEFAULT_DIALOG_ACTION_DESCRIPTIONS.fable_overage_consent_prompt,
    ).toBe('choose: continue Fable 5 on usage credits or switch models')
  })

  test('#2114 BRIDGE_POINTER_TTL_MS is 30 days', () => {
    expect(BRIDGE_POINTER_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  test('#2117 toolSummary tolerates non-string command/file_path fields without throwing', () => {
    expect(() => toolSummary('Bash', { command: ['echo', 'hi'] })).not.toThrow()
    expect(() =>
      toolSummary('Read', { file_path: 12345 as unknown as string }),
    ).not.toThrow()
    expect(toolSummary('Bash', { command: 'ls -la' })).toBe('Running ls -la')
  })

  test('#2143 buildNamedInlinedImagePathRefs injects @path when user names attached image', () => {
    const refs = buildNamedInlinedImagePathRefs(
      'please inspect diagram.png carefully',
      [{ path: '/tmp/uploads/diagram.png', fileName: 'diagram.png' }],
    )
    expect(refs).toBe('@"/tmp/uploads/diagram.png" ')

    const none = buildNamedInlinedImagePathRefs('unrelated text', [
      { path: '/tmp/uploads/diagram.png', fileName: 'diagram.png' },
    ])
    expect(none).toBe('')
  })

  test('#2145 HybridTransport.close flushes buffered stream_events instead of dropping them', async () => {
    const posted: unknown[] = []
    const transport = new HybridTransport(
      new URL('ws://127.0.0.1:9/v2/session_ingress/ws/sess-hybrid-1'),
      {},
      'sess-hybrid-1',
    )
    const internal = transport as unknown as {
      uploader: {
        enqueue: (ev: unknown) => void
        flush: () => Promise<void>
        close: () => Promise<void>
      }
      streamEventBuffer: unknown[]
    }
    internal.uploader = {
      enqueue: ev => posted.push(ev),
      flush: async () => {},
      close: async () => {},
    }
    internal.streamEventBuffer = [
      { type: 'stream_event', event: { type: 'content_block_delta' } },
    ]
    await transport.close()
    expect(posted.length).toBe(1)
  })
})
