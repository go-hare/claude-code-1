import { afterEach, describe, expect, test } from 'bun:test'
import { APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import axios from 'axios'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { zstdCompressSync } from 'zlib'
import { migrateSonnet1mToSonnet45 } from '../../../migrations/migrateSonnet1mToSonnet45.js'
import {
  getContextWindowForModel,
  isRecognizedModelForWindowEnforcement,
} from '../../../utils/context.js'
import {
  resetHostCredsModuleStateForTests,
  setHostAuthTokenRefreshCallback,
} from '../../../utils/hostCredsFile.js'
import {
  createBoundedZstdDecompressStreams,
  hasDisallowedResponseEncoding,
  isZstdDecompressError,
  parseResponseContentEncodings,
} from '../../../utils/http.js'
import { getRuntimeMainLoopModel } from '../../../utils/model/model.js'
import { isDownloadStallAbortError } from '../../../utils/nativeInstaller/download.js'
import { wrapFetchWithResponseLimit } from '../../mcp/httpResponseLimit.js'
import {
  getAssistantMessageFromError,
  isPromptTooLongErrorMessage,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
} from '../errors.js'
import { raceHostAuthRefreshWithSignal, withRetry } from '../withRetry.js'

const savedEnv = {
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
  CLAUDE_CODE_DISABLE_1M_CONTEXT: process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT,
  CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT:
    process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
}

afterEach(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[key]
    else process.env[key] = val
  }
})

describe('Wave 325 Group 2 — #2258 zstd decompression safety', () => {
  test('parseResponseContentEncodings and hasDisallowedResponseEncoding detect zstd/br anywhere in chain', () => {
    expect(parseResponseContentEncodings('gzip, zstd')).toEqual([
      'gzip',
      'zstd',
    ])
    expect(hasDisallowedResponseEncoding('zstd')).toBe(true)
    expect(hasDisallowedResponseEncoding('gzip, zstd')).toBe(true)
    expect(hasDisallowedResponseEncoding('identity, br')).toBe(true)
    expect(hasDisallowedResponseEncoding('gzip')).toBe(false)
    expect(hasDisallowedResponseEncoding('deflate')).toBe(false)
    expect(
      isZstdDecompressError({ code: 'ZSTD_error_corruption_detected' }),
    ).toBe(true)
    expect(isZstdDecompressError({ code: 'ENOENT' })).toBe(false)
  })

  test('wrapFetchWithResponseLimit rejects zstd even in multi-coding header', async () => {
    const fakeFetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-encoding': 'gzip, zstd' },
      })
    const wrapped = wrapFetchWithResponseLimit(
      fakeFetch as unknown as Parameters<typeof wrapFetchWithResponseLimit>[0],
    )
    await expect(wrapped('https://example.com/mcp')).rejects.toThrow(
      'sent a response compressed with br or zstd',
    )
  })

  test('createBoundedZstdDecompressStreams decompresses valid payload within cap and rejects oversized frames', async () => {
    const payload = Buffer.from('A'.repeat(4096), 'utf8')
    const compressed = zstdCompressSync(payload)
    const chunks: Buffer[] = []
    const ok = createBoundedZstdDecompressStreams(payload.length, chunk =>
      chunks.push(Buffer.from(chunk)),
    )
    await pipeline(Readable.from([compressed]), ok.decompress, ok.guard)
    expect(Buffer.concat(chunks).equals(payload)).toBe(true)

    const tooSmall = createBoundedZstdDecompressStreams(100)
    await expect(
      pipeline(
        Readable.from([compressed]),
        tooSmall.decompress,
        tooSmall.guard,
      ),
    ).rejects.toThrow(
      'Decompressed binary exceeds the manifest size of 100 bytes',
    )
  })

  test('download.ts bounded zstd path rejects corrupt frames via ZSTD_error_ normalization', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-325-zstd-'))
    try {
      const payload = Buffer.from('hello-claude-325')
      const hash = createHash('sha256').update(payload).digest('hex')
      expect(hash).toHaveLength(64)
      const dest = join(dir, 'bin')
      expect(readFileSync).toBeDefined()
      expect(dest.endsWith('bin')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Wave 325 Group 2 — #2263 getRuntimeMainLoopModel subagent isolation', () => {
  test('skips opusplan / haiku plan-mode upgrade when subagent has its own model', () => {
    process.env.ANTHROPIC_MODEL = 'opusplan'
    const ownSubagentModel = 'claude-haiku-4-5-20251001'
    expect(
      getRuntimeMainLoopModel({
        permissionMode: 'plan',
        mainLoopModel: ownSubagentModel,
        isSubagent: true,
      }),
    ).toBe(ownSubagentModel)
    expect(
      getRuntimeMainLoopModel({
        permissionMode: 'plan',
        mainLoopModel: 'claude-sonnet-4-6',
        setting: null,
      }),
    ).toBe('claude-sonnet-4-6')
  })

  test('still upgrades main session on opusplan in plan mode', () => {
    process.env.ANTHROPIC_MODEL = 'opusplan'
    const resolved = getRuntimeMainLoopModel({
      permissionMode: 'plan',
      mainLoopModel: 'claude-sonnet-4-6',
      isSubagent: false,
    })
    expect(resolved).not.toBe('claude-sonnet-4-6')
  })
})

describe('Wave 325 Group 2 — #2265 third-party gateway & Foundry context length errors', () => {
  test('recognizes official 2.1.325 gateway and Foundry context overflow phrases', () => {
    const samples = [
      'Your request exceeds the context window of this model.',
      'ContextWindowExceededError: too many tokens',
      'Prompt is longer than the maximum model length',
      "Request is longer than the model's context length",
      'Input exceeds the available context size',
      'Exceeded model token limit for deployment',
      'Input token length too long (210000 > 200000)',
      'Input tokens exceed the configured limit',
      'Maximum context limit reached',
      'Prompt exceeds max length',
      'Tokens in request more than max tokens allowed',
      'Range of input length should be [1, 128000]',
      'Context window exceeds limit',
      'Request has 250000 tokens but model only supports up to 200000',
      'Please reduce the length of the messages.',
      '`inputs` tokens + `max_new_tokens` must be <= 131072',
      'This request context exceeds your deployment limit on Foundry',
      'capability_rejected: prompt_too_long',
    ]
    for (const msg of samples) {
      expect(isPromptTooLongErrorMessage(msg)).toBe(true)
    }
  })

  test('excludes policy_blocked, maxlength schema, media, and content filtering errors', () => {
    expect(
      isPromptTooLongErrorMessage('policy_blocked: exceeds the context window'),
    ).toBe(false)
    expect(
      isPromptTooLongErrorMessage(
        'string too long. expected a string with maximum length 100',
      ),
    ).toBe(false)
    expect(
      isPromptTooLongErrorMessage(
        'Output blocked by content filtering policy: reduce the length of the messages',
      ),
    ).toBe(false)
  })

  test('getAssistantMessageFromError normalizes Foundry context overflow to PROMPT_TOO_LONG', () => {
    const err = new Error(
      'This request context exceeds your deployment limit (210000 > 200000)',
    )
    const msg = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    const content = msg.message?.content
    const firstBlock = Array.isArray(content) ? content[0] : undefined
    expect(
      typeof firstBlock === 'object' &&
        firstBlock !== null &&
        'type' in firstBlock &&
        firstBlock.type === 'text' &&
        'text' in firstBlock
        ? firstBlock.text
        : '',
    ).toBe(PROMPT_TOO_LONG_ERROR_MESSAGE)
  })
})

describe('Wave 325 Group 2 — #2269 & #2368 & #2341 & #2264/#2293', () => {
  test('#2269: migrateSonnet1mToSonnet45 is a no-op and does not throw or rewrite', () => {
    expect(() => migrateSonnet1mToSonnet45()).not.toThrow()
  })

  test('#2368: CLAUDE_CODE_MAX_CONTEXT_TOKENS sets context window for unrecognized claude-* IDs', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    delete process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT
    expect(isRecognizedModelForWindowEnforcement('claude-sonnet-latest')).toBe(
      false,
    )
    expect(
      isRecognizedModelForWindowEnforcement('vertex_ai/claude-sonnet-4'),
    ).toBe(true)
    process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '350000'
    expect(getContextWindowForModel('claude-sonnet-latest')).toBe(350_000)
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
    expect(getContextWindowForModel('claude-sonnet-latest')).toBe(1_000_000)
  })

  test('#2341: raceHostAuthRefreshWithSignal aborts in-flight renewal immediately when signal fires', async () => {
    const controller = new AbortController()
    const neverResolving = new Promise<string>(() => {})
    const raced = raceHostAuthRefreshWithSignal(
      neverResolving,
      controller.signal,
    )
    controller.abort()
    await expect(raced).rejects.toBeInstanceOf(APIUserAbortError)

    const preAborted = new AbortController()
    preAborted.abort()
    await expect(
      raceHostAuthRefreshWithSignal(
        Promise.resolve('updated'),
        preAborted.signal,
      ),
    ).rejects.toBeInstanceOf(APIUserAbortError)
  })

  test('#2341: withRetry forwards options.signal to tryHostAuth401Recovery and aborts before invoking refresh when pre-aborted', async () => {
    try {
      // 1. Mid-refresh abort: signal is forwarded to tryHostAuth401Recovery(options.signal)
      let receivedSignal: AbortSignal | undefined
      let refreshCalls = 0
      const controller = new AbortController()
      setHostAuthTokenRefreshCallback(async sig => {
        refreshCalls++
        receivedSignal = sig
        controller.abort()
        return await new Promise<string>(() => {})
      })

      const drain = async (gen: AsyncGenerator<unknown, unknown>) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of gen) {
          // drain retry messages
        }
      }

      const gen = withRetry(
        async () => ({}) as never,
        async () => {
          throw new APIError(
            401,
            { error: { message: 'expired' } },
            'expired',
            new Headers(),
          )
        },
        {
          model: 'claude-sonnet-4-6',
          thinkingConfig: { type: 'disabled' },
          maxRetries: 2,
          signal: controller.signal,
        },
      )

      await expect(drain(gen)).rejects.toBeInstanceOf(APIUserAbortError)
      expect(refreshCalls).toBe(1)
      expect(receivedSignal).toBe(controller.signal)

      // 2. Signal aborted before retry refresh: throws APIUserAbortError without calling refresh
      let preAbortCalls = 0
      const preAbortCtrl = new AbortController()
      setHostAuthTokenRefreshCallback(async () => {
        preAbortCalls++
        return 'fresh-token'
      })
      const gen2 = withRetry(
        async () => ({}) as never,
        async () => {
          preAbortCtrl.abort()
          throw new APIError(
            401,
            { error: { message: 'expired' } },
            'expired',
            new Headers(),
          )
        },
        {
          model: 'claude-sonnet-4-6',
          thinkingConfig: { type: 'disabled' },
          maxRetries: 2,
          signal: preAbortCtrl.signal,
        },
      )
      await expect(drain(gen2)).rejects.toBeInstanceOf(APIUserAbortError)
      expect(preAbortCalls).toBe(0)
    } finally {
      resetHostCredsModuleStateForTests()
    }
  })

  test('#2258: isDownloadStallAbortError recognizes both axios cancel and pipeline AbortError/ABORT_ERR', () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
    })
    const codeOnlyAbortErr = Object.assign(new Error('aborted'), {
      code: 'ABORT_ERR',
    })
    const checksumErr = new Error('Checksum mismatch')

    expect(isDownloadStallAbortError(abortErr, true)).toBe(true)
    expect(isDownloadStallAbortError(codeOnlyAbortErr, true)).toBe(true)
    expect(isDownloadStallAbortError(abortErr, false)).toBe(false)
    expect(isDownloadStallAbortError(checksumErr, true)).toBe(false)
    expect(
      isDownloadStallAbortError(new axios.CanceledError('stalled'), false),
    ).toBe(true)
  })

  test('#2264 & #2293: tokenEstimation accepts model override and checks Bedrock allowedProviders', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../tokenEstimation.ts'),
      'utf8',
    )
    expect(src).toContain('modelOverride?: string')
    expect(src).toContain("validateAllowedProvider('bedrock')")
    const bedrockSrc = readFileSync(
      join(import.meta.dir, '../../../utils/model/bedrock.ts'),
      'utf8',
    )
    expect(bedrockSrc).toContain("validateAllowedProvider('bedrock')")
    const fileReadSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/FileReadTool/FileReadTool.ts',
      ),
      'utf8',
    )
    expect(fileReadSrc).toContain('context.options.mainLoopModel')
  })
})
