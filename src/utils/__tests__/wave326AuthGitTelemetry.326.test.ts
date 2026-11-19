import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { PassThrough } from 'stream'
import {
  attachOAuthManualCodePrompt,
  parsePastedOAuthCode,
} from '../../cli/handlers/auth.js'
import {
  clearGitStatusPrefetchForTesting,
  getGitStatus,
  prefetchGitStatusForCompaction,
} from '../../context.js'
import {
  isCoworkCloudEntrypoint,
  isTelemetryDeferredForFirstTurn,
  releaseDeferredTelemetryForFirstTurn,
  resetSessionCountMetricForTesting,
  shouldDeferTelemetryUntilFirstTurn,
} from '../../entrypoints/init.js'
import {
  createFileStateCacheWithSizeLimit,
  fileStateContentHash,
  fileStateContentMatches,
} from '../fileStateCache.js'
import { buildStrictGitEnv, sanitizeStrictGitPath } from '../git.js'
import {
  createTimestampTolerantLockFs,
  isTimestampRejectionError,
} from '../lockfile.js'
import { SAFE_ENV_VARS } from '../managedEnvConstants.js'
import { shouldIncludeOtelHostResource } from '../telemetry/instrumentation.js'

describe('Wave 326 Group 2 — Auth / Lockfile / Git / Telemetry / FileStateCache', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of [
      'OTEL_RESOURCE_INCLUDE_HOST',
      'CLAUDE_CODE_ENABLE_TELEMETRY',
      'CLAUDE_CODE_REMOTE',
      'OTEL_LOGS_EXPORTER',
      'OTEL_METRICS_EXPORTER',
      'OTEL_TRACES_EXPORTER',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_IS_COWORK',
    ]) {
      savedEnv[k] = process.env[k]
    }
    resetSessionCountMetricForTesting()
    clearGitStatusPrefetchForTesting()
    getGitStatus.cache.clear?.()
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetSessionCountMetricForTesting()
    clearGitStatusPrefetchForTesting()
    getGitStatus.cache.clear?.()
  })

  test('#9 OTEL_RESOURCE_INCLUDE_HOST is off by default and opts in when telemetry is active and non-remote/non-console', () => {
    expect(SAFE_ENV_VARS.has('OTEL_RESOURCE_INCLUDE_HOST')).toBe(true)

    delete process.env.OTEL_RESOURCE_INCLUDE_HOST
    process.env.CLAUDE_CODE_ENABLE_TELEMETRY = '1'
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.OTEL_LOGS_EXPORTER
    delete process.env.OTEL_METRICS_EXPORTER
    delete process.env.OTEL_TRACES_EXPORTER

    expect(shouldIncludeOtelHostResource()).toBe(false)

    process.env.OTEL_RESOURCE_INCLUDE_HOST = '1'
    expect(shouldIncludeOtelHostResource()).toBe(true)

    process.env.OTEL_METRICS_EXPORTER = 'console'
    expect(shouldIncludeOtelHostResource()).toBe(false)

    delete process.env.OTEL_METRICS_EXPORTER
    process.env.CLAUDE_CODE_REMOTE = '1'
    expect(shouldIncludeOtelHostResource()).toBe(false)
  })

  test('#333 Cowork cloud sessions defer telemetry until first turn', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_cowork'
    expect(isCoworkCloudEntrypoint()).toBe(true)
    expect(shouldDeferTelemetryUntilFirstTurn()).toBe(true)
    expect(isTelemetryDeferredForFirstTurn()).toBe(false)

    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    expect(isCoworkCloudEntrypoint()).toBe(false)
    expect(shouldDeferTelemetryUntilFirstTurn()).toBe(false)

    releaseDeferredTelemetryForFirstTurn()
    expect(isTelemetryDeferredForFirstTurn()).toBe(false)
  })

  test('#60 timestamp-rejection lockfile errors are tolerated so Console logout and token refresh do not break', async () => {
    expect(
      isTimestampRejectionError(
        Object.assign(new Error('nope'), { code: 'EPERM' }),
      ),
    ).toBe(true)
    expect(
      isTimestampRejectionError(
        Object.assign(new Error('nope'), { code: 'EINVAL' }),
      ),
    ).toBe(true)
    expect(
      isTimestampRejectionError(
        Object.assign(new Error('nope'), { code: 'ENOENT' }),
      ),
    ).toBe(false)

    const fakeFs = {
      utimes: (
        _p: unknown,
        _a: unknown,
        _m: unknown,
        cb: (err: NodeJS.ErrnoException | null) => void,
      ) => {
        cb(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
      },
      utimesSync: () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
    } as unknown as typeof import('fs')

    const tolerant = createTimestampTolerantLockFs(fakeFs)
    const asyncErr = await new Promise<NodeJS.ErrnoException | null>(
      resolve => {
        tolerant.utimes('/tmp/lock', new Date(), new Date(), err =>
          resolve(err),
        )
      },
    )
    expect(asyncErr).toBeNull()
    expect(() =>
      tolerant.utimesSync('/tmp/lock', new Date(), new Date()),
    ).not.toThrow()
  })

  test('#64 claude auth login parses pasted codes and echoes via TTY readline prompt', () => {
    expect(parsePastedOAuthCode('  abc123#state456 \n')).toEqual({
      authorizationCode: 'abc123',
      state: 'state456',
    })
    expect(parsePastedOAuthCode('bareCodeOnly')).toEqual({
      authorizationCode: 'bareCodeOnly',
      state: '',
    })
    expect(parsePastedOAuthCode('   ')).toBeNull()

    const input = Object.assign(new PassThrough(), { isTTY: true })
    const output = Object.assign(new PassThrough(), { isTTY: true })
    const chunks: string[] = []
    output.on('data', chunk => chunks.push(chunk.toString('utf8')))

    const submitted: Array<{ authorizationCode: string; state: string }> = []
    const close = attachOAuthManualCodePrompt(
      {
        handleManualAuthCodeInput: params => {
          submitted.push(params)
        },
      },
      { input, output },
    )
    input.write('codeXYZ#st789\n')
    close()

    expect(submitted).toEqual([
      { authorizationCode: 'codeXYZ', state: 'st789' },
    ])
    expect(chunks.join('')).toContain('Paste code here if prompted > ')
  })

  test('#241 FileStateCache normalizes CRLF hashes, Windows drive letters, and retains hash metadata across compaction', () => {
    expect(fileStateContentHash('a\r\nb\r\n')).toBe(
      fileStateContentHash('a\nb\n'),
    )

    const cache = createFileStateCacheWithSizeLimit(10)
    cache.set('C:\\Work\\file.ts', {
      content: 'line1\r\nline2\r\n',
      timestamp: 100,
      offset: undefined,
      limit: undefined,
    })

    const entry = cache.get('c:\\Work\\file.ts')
    expect(entry).toBeDefined()
    expect(fileStateContentMatches(entry!, 'line1\nline2\n')).toBe(true)

    cache.clearForCompaction()
    expect(cache.size).toBe(0)
    const beforeCompact = cache.readBeforeCompaction('C:\\Work\\file.ts')
    expect(beforeCompact).toBeDefined()
    expect(beforeCompact?.content).toBe('')
    expect(beforeCompact?.contentHash).toBe(
      fileStateContentHash('line1\nline2\n'),
    )
    expect(cache.everHeldPaths().size).toBe(1)
  })

  test('#245 prefetchGitStatusForCompaction warms git status asynchronously for the first post-compact turn', async () => {
    let calls = 0
    prefetchGitStatusForCompaction(async () => {
      calls++
      return 'Current branch: main\nStatus: (clean)'
    })
    const status = await getGitStatus()
    expect(calls).toBe(1)
    expect(status).toContain('Current branch: main')
  })

  test('#342 buildStrictGitEnv strips relative PATH entries unless keepUserPath is true', () => {
    expect(
      sanitizeStrictGitPath('.:./bin:/usr/bin::../tools:/bin', 'darwin'),
    ).toBe('/usr/bin:/bin')
    expect(sanitizeStrictGitPath('.:relative', 'linux')).toBe('/dev/null')
    expect(
      sanitizeStrictGitPath(
        '.;.\\bin;C:\\Program Files\\Git\\cmd;..\\evil;D:/bin',
        'win32',
      ),
    ).toBe('C:\\Program Files\\Git\\cmd;D:/bin')

    const strictEnv = buildStrictGitEnv(undefined, {
      base: {
        PATH: '.:/usr/bin:/bin',
        GIT_LFS_SKIP_SMUDGE: '1',
        GIT_NO_LAZY_FETCH: '1',
      },
      platform: 'darwin',
    })
    expect(strictEnv.PATH).toBe('/usr/bin:/bin')
    expect(strictEnv.GIT_NO_REPLACE_OBJECTS).toBe('1')
    expect(strictEnv.GIT_LFS_SKIP_SMUDGE).toBeUndefined()
    expect(strictEnv.GIT_NO_LAZY_FETCH).toBeUndefined()

    const keepPathEnv = buildStrictGitEnv(undefined, {
      base: { PATH: '.:/usr/bin' },
      keepUserPath: true,
      platform: 'darwin',
    })
    expect(keepPathEnv.PATH).toBe('.:/usr/bin')
  })
})
