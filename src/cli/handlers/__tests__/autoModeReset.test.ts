/**
 * densable PbS — auto-mode reset safety paths.
 * Do not mock analytics (process-global mock.module pollution); logEvent queues without sink.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { debugMock } from '../../../../tests/mocks/debug.js'

mock.module('src/utils/debug.ts', debugMock)

const TEST_ROOT = join(
  tmpdir(),
  `claude-auto-mode-reset-${process.pid}-${Date.now()}`,
)

describe('autoModeResetHandler densable PbS', () => {
  let prevConfigDir: string | undefined
  let prevExitCode: string | number | undefined

  beforeEach(() => {
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    // process.exitCode may be null; store only string|number for restore.
    prevExitCode = process.exitCode ?? undefined
    // Bun keeps exitCode sticky across tests; force-clear each case.
    process.exitCode = 0
    rmSync(TEST_ROOT, { recursive: true, force: true })
    mkdirSync(TEST_ROOT, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = TEST_ROOT
  })

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    process.exitCode = prevExitCode
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  test('already at defaults when no autoMode section', async () => {
    writeFileSync(join(TEST_ROOT, 'settings.json'), '{}\n', 'utf-8')
    const { autoModeResetHandler } = await import('../autoMode.js')
    const chunks: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((c: string | Uint8Array) => {
      chunks.push(String(c))
      return true
    }) as typeof process.stdout.write
    try {
      await autoModeResetHandler({ yes: true })
    } finally {
      process.stdout.write = orig
    }
    const out = chunks.join('')
    expect(out).toContain('already at defaults')
    expect(out).toContain('has no autoMode section')
    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true)
  })

  test('invalid JSON refuses with settings_file_invalid message', async () => {
    writeFileSync(join(TEST_ROOT, 'settings.json'), '{not-json', 'utf-8')
    const { autoModeResetHandler } = await import('../autoMode.js')
    const errChunks: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((c: string | Uint8Array) => {
      errChunks.push(String(c))
      return true
    }) as typeof process.stderr.write
    try {
      await autoModeResetHandler({ yes: true })
    } finally {
      process.stderr.write = orig
    }
    const err = errChunks.join('')
    expect(err).toContain('contains invalid JSON')
    expect(err).toContain('re-run reset')
    expect(process.exitCode).toBe(1)
  })

  test('--yes removes autoMode section', async () => {
    const path = join(TEST_ROOT, 'settings.json')
    writeFileSync(
      path,
      JSON.stringify(
        {
          autoMode: {
            allow: ['Bash(git status:*)'],
          },
          theme: 'dark',
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )
    const { autoModeResetHandler } = await import('../autoMode.js')
    const chunks: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((c: string | Uint8Array) => {
      chunks.push(String(c))
      return true
    }) as typeof process.stdout.write
    try {
      await autoModeResetHandler({ yes: true })
    } finally {
      process.stdout.write = orig
    }
    const out = chunks.join('')
    expect(out).toContain('autoMode section removed')
    expect(process.exitCode === 1).toBe(false)
    expect(existsSync(path)).toBe(true)
    const written = JSON.parse(readFileSync(path, 'utf-8')) as Record<
      string,
      unknown
    >
    expect(written.autoMode).toBeUndefined()
    expect(written.theme).toBe('dark')
  })

  test('--yes + non-string permission rule: densable lossy or write', async () => {
    const path = join(TEST_ROOT, 'settings.json')
    writeFileSync(
      path,
      JSON.stringify(
        {
          autoMode: { allow: ['x'] },
          permissions: {
            allow: [123],
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )
    const before = readFileSync(path, 'utf-8')
    const { autoModeResetHandler } = await import('../autoMode.js')
    const errChunks: string[] = []
    const outChunks: string[] = []
    const origErr = process.stderr.write.bind(process.stderr)
    const origOut = process.stdout.write.bind(process.stdout)
    process.stderr.write = ((c: string | Uint8Array) => {
      errChunks.push(String(c))
      return true
    }) as typeof process.stderr.write
    process.stdout.write = ((c: string | Uint8Array) => {
      outChunks.push(String(c))
      return true
    }) as typeof process.stdout.write
    try {
      await autoModeResetHandler({ yes: true })
    } finally {
      process.stderr.write = origErr
      process.stdout.write = origOut
    }
    const err = errChunks.join('')
    const out = outChunks.join('')
    if (err.includes('Not resetting')) {
      expect(err).toContain('cannot parse')
      expect(process.exitCode).toBe(1)
      expect(readFileSync(path, 'utf-8')).toBe(before)
    } else {
      expect(out).toContain('autoMode section removed')
    }
  })
})
