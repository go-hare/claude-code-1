import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import {
  askRemoteControlQuestion,
  ForcedStopRateTracker,
  formatUnansweredRemoteControlQuestion,
  parseArgs,
} from '../bridgeMain.js'
import {
  BoundedUUIDSet,
  extractInboundBridgePriority,
  getBridgeInitializeCommands,
  handleIngressMessage,
  toBridgeSlashCommands,
} from '../bridgeMessaging.js'
import { DEFAULT_POLL_CONFIG } from '../pollConfigDefaults.js'
import { classifyProactiveRemintResult } from '../remintRecovery.js'
import { classifyProxyConnectError } from '../remoteControlEndpointReason.js'
import { syncBridgeRateLimitInfo } from '../replBridgeHandle.js'
import {
  BRIDGE_SETTINGS_BINDING_ENV,
  computeBridgeSettingsBinding,
  verifyBridgeSettingsBinding,
} from '../sessionRunner.js'
import type { ReplBridgeHandle } from '../replBridge.js'

describe('Wave 319-321 bridge alignments (#1767, #1785/#1786/#1906/#1930, #1846, #1860, #1884/#1885/#1889, #1892, #1924)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bridge-321-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('#1767: reportMetadata clears remote rate_limit_info when limit is lifted', () => {
    test('clears rate_limit_info with null when status is allowed or reset time passed', () => {
      const reported: Array<Record<string, unknown>> = []
      const fakeHandle = {
        bridgeSessionId: 'cse_123',
        reportMetadata(meta: Record<string, unknown>) {
          reported.push(meta)
        },
      } as unknown as ReplBridgeHandle

      expect(
        syncBridgeRateLimitInfo(
          {
            status: 'rejected',
            resetsAt: 9_999_999_999,
            rateLimitType: 'five_hour',
          },
          fakeHandle,
          1_000_000,
        ),
      ).toBe(true)
      expect(reported.at(-1)).toEqual({
        rate_limit_info: {
          status: 'rejected',
          resetsAt: 9_999_999_999,
          rateLimitType: 'five_hour',
          isUsingOverage: false,
        },
      })

      expect(
        syncBridgeRateLimitInfo({ status: 'allowed' }, fakeHandle, 1_000_000),
      ).toBe(true)
      expect(reported.at(-1)).toEqual({ rate_limit_info: null })

      expect(
        syncBridgeRateLimitInfo(
          { status: 'rejected', resetsAt: 100 },
          fakeHandle,
          200_000,
        ),
      ).toBe(true)
      expect(reported.at(-1)).toEqual({ rate_limit_info: null })
    })
  })

  describe('#1785, #1786, #1906, #1930: first-run question input reader and consent handling', () => {
    test('#1786: piped "y" without trailing newline counts as yes when non-TTY', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const promise = askRemoteControlQuestion(
        'Enable Remote Control? (y/n) ',
        {
          input,
          output,
          isTTY: false,
        },
      )
      input.end('y')
      expect(await promise).toBe('y')
    })

    test('#1906: typed "y" without Enter followed by EOF on TTY returns undefined', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const promise = askRemoteControlQuestion(
        'Enable Remote Control? (y/n) ',
        {
          input,
          output,
          isTTY: true,
        },
      )
      input.end('y')
      expect(await promise).toBeUndefined()
    })

    test('#1785 & #1930: empty EOF and Ctrl+C return undefined and guidance message names next step', async () => {
      const emptyInput = new PassThrough()
      const out = new PassThrough()
      const p1 = askRemoteControlQuestion('Enable Remote Control? (y/n) ', {
        input: emptyInput,
        output: out,
        isTTY: false,
      })
      emptyInput.end()
      expect(await p1).toBeUndefined()

      const ctrlCInput = new PassThrough()
      const p2 = askRemoteControlQuestion('Enable Remote Control? (y/n) ', {
        input: ctrlCInput,
        output: out,
        isTTY: true,
      })
      ctrlCInput.write('\x03')
      expect(await p2).toBeUndefined()

      const msg = formatUnansweredRemoteControlQuestion(
        'Enable Remote Control?',
        "Run `claude remote-control` at a terminal and answer y once; it won't ask again.",
      )
      expect(msg).toContain('Remote Control did not start')
      expect(msg).toContain('Enable Remote Control?')
      expect(msg).toContain('claude remote-control')
    })

    test('bridgeMain persists remoteDialogSeen only after y/yes consent', () => {
      const src = readFileSync(
        join(import.meta.dir, '../bridgeMain.ts'),
        'utf8',
      )
      const checkIdx = src.indexOf("normalized !== 'y' && normalized !== 'yes'")
      const saveIdx = src.indexOf('remoteDialogSeen: true', checkIdx)
      expect(checkIdx).toBeGreaterThan(-1)
      expect(saveIdx).toBeGreaterThan(checkIdx)
    })
  })

  describe('#1846: claude remote-control --settings and SHA-256 binding verification', () => {
    test('parseArgs accepts --settings <file> and --settings=<file>', () => {
      expect(parseArgs(['--settings', '/tmp/a.json']).settings).toBe(
        '/tmp/a.json',
      )
      expect(parseArgs(['--settings=/tmp/b.json']).settings).toBe('/tmp/b.json')
      expect(parseArgs(['--settings']).error).toContain('--settings')
    })

    test('verifyBridgeSettingsBinding accepts unchanged file and rejects modified or damaged bindings', () => {
      const file = join(tempDir, 'settings.json')
      const original = JSON.stringify({ model: 'sonnet' })
      writeFileSync(file, original)
      const binding = computeBridgeSettingsBinding(file, original)
      expect(binding).toMatch(/^[0-9a-f]{64}:/)

      expect(
        verifyBridgeSettingsBinding(file, file, original, binding, {}),
      ).toEqual({ ok: true })

      const modified = verifyBridgeSettingsBinding(
        file,
        file,
        JSON.stringify({ model: 'opus' }),
        binding,
        {},
      )
      expect(modified.ok).toBe(false)
      if (!modified.ok) {
        expect(modified.error).toContain(
          'has changed since Remote Control started',
        )
        expect(modified.error).toContain('Restart `claude remote-control`')
      }

      const damaged = verifyBridgeSettingsBinding(
        file,
        file,
        original,
        'not-a-sha256:relative/path',
        { [BRIDGE_SETTINGS_BINDING_ENV]: 'not-a-sha256:relative/path' },
      )
      expect(damaged.ok).toBe(false)
      if (!damaged.ok) {
        expect(damaged.error).toContain('damaged')
      }
    })
  })

  describe('#1860: toBridgeSlashCommands deduplicates commands like /compact', () => {
    test('deduplicates repeated command names and filters hidden commands', () => {
      const cmds = getBridgeInitializeCommands([
        {
          name: 'compact',
          description: 'Compact conversation',
          loadedFrom: 'builtin',
        },
        {
          name: 'compact',
          description: 'Duplicate compact',
          loadedFrom: 'plugin',
        },
        { name: 'secret', description: 'Hidden', isHidden: true },
        {
          name: 'review',
          description: 'Fallback desc',
          menuDescription: 'Short menu desc',
          aliases: ['rev', 'compact'],
        },
      ])
      expect(cmds.map(c => c.name)).toEqual(['compact', 'review'])
      expect(cmds[0]?.builtin).toBe(true)
      expect(cmds[1]?.description).toBe('Short menu desc')
      expect(cmds[1]?.aliases).toEqual(['rev'])
      expect(toBridgeSlashCommands(cmds).length).toBe(2)
    })
  })

  describe('#1884, #1885, #1889: remint transient vs permanent, priority later, backfill closed guard', () => {
    test('#1884: classifyProactiveRemintResult distinguishes transient null from permanent login expiry', () => {
      expect(classifyProactiveRemintResult(null)).toBe('transient_null')
      expect(classifyProactiveRemintResult(undefined)).toBe('transient_null')
      expect(
        classifyProactiveRemintResult({
          terminal: false,
          reason: 'oauth_rejected',
        }),
      ).toBe('oauth_rejected')
      expect(
        classifyProactiveRemintResult({
          terminal: true,
          reason: 'session_stale_relogin',
        }),
      ).toBe('terminal_relogin')
      expect(
        classifyProactiveRemintResult({
          terminal: true,
          reason: 'request_rejected',
        }),
      ).toBe('terminal_other')
      expect(
        classifyProactiveRemintResult({
          worker_jwt: 'jwt',
          api_base_url: 'https://x',
        }),
      ).toBe('credentials')
    })

    test('#1885: handleIngressMessage preserves priority: "later" on inbound user messages', () => {
      const received: Array<Record<string, unknown>> = []
      const payload = JSON.stringify({
        type: 'user',
        uuid: '11111111-1111-4111-8111-111111111111',
        priority: 'later',
        message: { role: 'user', content: 'run after this turn' },
      })
      handleIngressMessage(
        payload,
        new BoundedUUIDSet(16),
        new BoundedUUIDSet(16),
        msg => {
          received.push(msg as unknown as Record<string, unknown>)
        },
      )
      expect(received).toHaveLength(1)
      expect(extractInboundBridgePriority(received[0])).toBe('later')
      expect(received[0]?.priority).toBe('later')
    })

    test('#1889: remoteBridgeCore guards history backfill completion with permanentlyClosed', () => {
      const src = readFileSync(
        join(import.meta.dir, '../remoteBridgeCore.ts'),
        'utf8',
      )
      expect(src).toContain('let permanentlyClosed = false')
      expect(src).toContain('if (tornDown || permanentlyClosed) return')
    })
  })

  describe('#1892: proxy connect_rejected vs connect_unreachable', () => {
    test('classifies HTTP 502 as connect_unreachable and 403/407 as connect_rejected', () => {
      const unreachable = classifyProxyConnectError(
        'HTTP/1.1 502 Bad Gateway\r\n',
      )
      expect(unreachable?.kind).toBe('connect_unreachable')
      expect(unreachable?.description).toContain('host is allowed')

      const rejected = classifyProxyConnectError('HTTP/1.1 403 Forbidden\r\n')
      expect(rejected?.kind).toBe('connect_rejected')
      expect(rejected?.description).toContain('not allowed')

      expect(classifyProxyConnectError(200)).toBeNull()
    })
  })

  describe('#1924: forced_stops_per_hour and ForcedStopRateTracker', () => {
    test('defaults forced_stops_per_hour to 3 and counts crashes within 1-hour sliding window', () => {
      expect(DEFAULT_POLL_CONFIG.forced_stops_per_hour).toBe(3)
      let now = 1_000_000
      const tracker = new ForcedStopRateTracker({ nowFn: () => now })
      expect(tracker.record('session_abc')).toBe(1)
      expect(tracker.record('session_abc')).toBe(2)
      expect(tracker.record('session_abc')).toBe(3)
      expect(tracker.record('session_abc')).toBe(4)
      // Advance past 1 hour: window resets
      now += 3_600_001
      expect(tracker.record('session_abc')).toBe(1)
    })
  })
})
