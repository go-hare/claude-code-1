import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkHoldIdleFileFresh,
  DEFAULT_MAX_HOLD_MS,
  formatRootHelp,
  HOLD_IDLE_FILE_FRESH_MS,
  parseRootArgs,
  readHoldIdleFile,
  readMaxHoldMs,
  retryReleaseSessionOnTransientDisconnect,
} from '../rootRunner.js'
import {
  classifyRepositoryThrottle,
  FetchThrottledError,
  REPOSITORY_THROTTLE_LABELS,
} from '../gitPrepare.js'

describe('self-hosted-runner 2.1.311–2.1.314 alignment (#1223, #1273, #1421)', () => {
  const origHoldFile = process.env.SELF_HOSTED_RUNNER_HOLD_IDLE_FILE
  const origMaxHold = process.env.SELF_HOSTED_RUNNER_MAX_HOLD_MS
  let tempDir: string | undefined

  afterEach(() => {
    if (origHoldFile === undefined) {
      delete process.env.SELF_HOSTED_RUNNER_HOLD_IDLE_FILE
    } else {
      process.env.SELF_HOSTED_RUNNER_HOLD_IDLE_FILE = origHoldFile
    }
    if (origMaxHold === undefined) {
      delete process.env.SELF_HOSTED_RUNNER_MAX_HOLD_MS
    } else {
      process.env.SELF_HOSTED_RUNNER_MAX_HOLD_MS = origMaxHold
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  test('#1223: parses --hold-idle-file and --max-hold-min and documents them in help', () => {
    const parsed = parseRootArgs([
      '--hold-idle-file',
      '/tmp/hold.marker',
      '--max-hold-min',
      '45',
    ])
    expect(parsed.envSetByFlag.has('SELF_HOSTED_RUNNER_HOLD_IDLE_FILE')).toBe(
      true,
    )
    expect(parsed.envSetByFlag.has('SELF_HOSTED_RUNNER_MAX_HOLD_MS')).toBe(true)
    expect(readHoldIdleFile()).toBe('/tmp/hold.marker')
    expect(readMaxHoldMs()).toBe(45 * 60 * 1000)

    delete process.env.SELF_HOSTED_RUNNER_MAX_HOLD_MS
    expect(readMaxHoldMs()).toBe(DEFAULT_MAX_HOLD_MS)

    const help = formatRootHelp()
    expect(help).toContain('--hold-idle-file <path>')
    expect(help).toContain('--max-hold-min <n>')
    expect(help).toContain('SELF_HOSTED_RUNNER_HOLD_IDLE_FILE')
    expect(help).toContain('SELF_HOSTED_RUNNER_MAX_HOLD_MS')
  })

  test('#1223: rejects invalid --hold-idle-file / --max-hold-min and checks mtime freshness', async () => {
    expect(() => parseRootArgs(['--hold-idle-file'])).toThrow(
      /requires a file path/,
    )
    expect(() => parseRootArgs(['--max-hold-min', '-1'])).toThrow(
      /non-negative number of minutes/,
    )

    tempDir = mkdtempSync(join(tmpdir(), 'shr-hold-'))
    const marker = join(tempDir, 'hold.txt')
    writeFileSync(marker, 'alive')
    const now = Date.now()
    expect(await checkHoldIdleFileFresh(marker, now)).toBe(true)

    const staleTime = new Date(now - HOLD_IDLE_FILE_FRESH_MS - 5000)
    utimesSync(marker, staleTime, staleTime)
    expect(await checkHoldIdleFileFresh(marker, now)).toBe(false)

    await expect(
      checkHoldIdleFileFresh('relative/path.txt', now),
    ).rejects.toThrow(/could not be checked/)
  })

  test('#1273: FetchThrottledError + classifyRepositoryThrottle cover exit 75 and HTTP 429', () => {
    expect(
      classifyRepositoryThrottle(
        'git fetch failed',
        75,
        'https://github.com/a/b',
      ),
    ).toBe('refused_by_git_wrapper')
    expect(
      classifyRepositoryThrottle(
        "git fetch failed: fatal: unable to access 'https://github.com/a/b': The requested URL returned error: 429",
        1,
        'https://github.com/a/b',
      ),
    ).toBe('http_429')
    const err = new FetchThrottledError('throttled', 'http_429')
    expect(err.name).toBe('FetchThrottledError')
    expect(err.throttle).toBe('http_429')
    expect(REPOSITORY_THROTTLE_LABELS.refused_by_git_wrapper).toContain('75')
    expect(REPOSITORY_THROTTLE_LABELS.http_429).toContain('429')
  })

  test('#1421: retryReleaseSessionOnTransientDisconnect retries transient no-response disconnects and stops on HTTP response', async () => {
    const logs: string[] = []
    let calls = 0
    const ac = new AbortController()
    const res = await retryReleaseSessionOnTransientDisconnect({
      sessionId: 'sess-1',
      onStatus: line => logs.push(line),
      stop: ac.signal,
      waitsMs: [1, 2, 4],
      release: async () => {
        calls++
        if (calls < 3) {
          const e = Object.assign(new Error('socket reset'), {
            code: 'ECONNRESET',
          })
          throw e
        }
        return { released: true }
      },
    })
    expect(res).toEqual({ released: true })
    expect(calls).toBe(3)
    expect(logs.length).toBe(2)
    expect(logs[0]).toContain('ReleaseSession got no answer (ECONNRESET)')

    const httpErr = Object.assign(new Error('server error'), {
      code: 'ECONNRESET',
      response: { status: 500 },
    })
    await expect(
      retryReleaseSessionOnTransientDisconnect({
        sessionId: 'sess-2',
        onStatus: () => {},
        stop: ac.signal,
        waitsMs: [1],
        release: mock(async () => {
          throw httpErr
        }),
      }),
    ).rejects.toThrow('server error')
  })
})
