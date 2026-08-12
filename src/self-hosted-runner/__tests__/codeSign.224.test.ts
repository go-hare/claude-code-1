/**
 * densable 2.1.224 #1 — self-hosted-runner code-sign (Wqv/S2h/T2h).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseCodeSignArgs,
  signCommitFile,
  truncateForError,
} from '../codeSign.js'

const mainSrc = readFileSync(join(import.meta.dir, '../main.ts'), 'utf8')
const codeSignSrc = readFileSync(
  join(import.meta.dir, '../codeSign.ts'),
  'utf8',
)

describe('densable 2.1.224 #1 code-sign pure helpers', () => {
  test('truncateForError (zqv)', () => {
    expect(truncateForError('abc', 10)).toBe('abc')
    expect(truncateForError('abcdefghij', 5)).toBe('abcde…')
  })

  test('parseCodeSignArgs requires -Y sign + file (S2h)', () => {
    expect(() => parseCodeSignArgs(['file.buf'])).toThrow(
      'only SSH-style signing',
    )
    expect(() => parseCodeSignArgs(['-Y', 'sign'])).toThrow(
      'no file specified to sign',
    )
    const parsed = parseCodeSignArgs([
      '-Y',
      'sign',
      '-n',
      'git',
      '-f',
      '/tmp/key',
      'commit.buf',
    ])
    expect(parsed.namespace).toBe('git')
    expect(parsed.keyFile).toBe('/tmp/key')
    expect(parsed.bufferFile.endsWith('commit.buf')).toBe(true)
  })
})

describe('densable 2.1.224 #1 code-sign signCommitFile (T2h)', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  test('env validation errors', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-'))
    const buf = join(dir, 'buf')
    writeFileSync(buf, 'payload')
    const args = parseCodeSignArgs(['-Y', 'sign', buf])

    await expect(
      signCommitFile(args, {
        env: {},
        fetchFn: (async () => new Response()) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('CLAUDE_CODE_REMOTE_SESSION_ID')

    await expect(
      signCommitFile(args, {
        env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'sess_1' },
        fetchFn: (async () => new Response()) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('CLAUDE_CODE_SESSION_ACCESS_TOKEN')

    await expect(
      signCommitFile(args, {
        env: {
          CLAUDE_CODE_REMOTE_SESSION_ID: 'sess_1',
          CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'tok',
        },
        fetchFn: (async () => new Response()) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('ANTHROPIC_BASE_URL')
  })

  test('POST sign-commit success writes .sig', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-'))
    const buf = join(dir, 'buf')
    writeFileSync(buf, 'payload-body')
    const args = parseCodeSignArgs(['-Y', 'sign', buf])

    let seenUrl = ''
    let seenAuth = ''
    let seenBody = ''
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(url)
      const headers = init?.headers as Record<string, string>
      seenAuth = headers.authorization ?? ''
      seenBody = String(init?.body ?? '')
      return new Response(JSON.stringify({ signature: 'SIGDATA' }), {
        status: 200,
      })
    }) as unknown as typeof fetch

    const sigPath = await signCommitFile(args, {
      env: {
        CLAUDE_CODE_REMOTE_SESSION_ID: 'session_abc',
        CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'tok-xyz',
        ANTHROPIC_BASE_URL: 'https://api.example.test/',
      },
      fetchFn,
      version: '2.1.224',
    })
    expect(sigPath).toBe(`${buf}.sig`)
    expect(readFileSync(sigPath, 'utf8')).toBe('SIGDATA')
    expect(seenUrl).toBe(
      'https://api.example.test/v1/code/sessions/session_abc/sign-commit',
    )
    expect(seenAuth).toBe('Bearer tok-xyz')
    expect(seenBody).toContain('payload-body')
    expect(seenBody).toContain('git_repository')
  })
})

describe('densable 2.1.224 #1 code-sign source gold', () => {
  test('exports + main routes code-sign', () => {
    expect(codeSignSrc).toContain('export function parseCodeSignArgs')
    expect(codeSignSrc).toContain('export async function signCommitFile')
    expect(codeSignSrc).toContain(
      'export async function selfHostedRunnerCodeSignMain',
    )
    expect(codeSignSrc).toContain('/sign-commit')
    expect(codeSignSrc).toContain('x-environment-runner-version')
    expect(mainSrc).toContain("sub === 'code-sign'")
    expect(mainSrc).toContain('selfHostedRunnerCodeSignMain')
  })
})
