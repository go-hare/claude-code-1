/**
 * densable 2.1.283 --session-mirror + transcript_mirror frames.
 *
 * GOLD SEA /tmp/official-283/package/claude:
 *   commander hideHelp --session-mirror @192098232 after --forward-subagent-text
 *   Bbr addMirror @186835893; drainQueuesOnce fireMirror @186842029
 *   print Bbr enqueue {type:"transcript_mirror",filePath,entries} @199053588
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  Command as CommanderCommand,
  Option,
} from '@commander-js/extra-typings'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/services/analytics/index.js', analyticsMock)

const {
  addTranscriptMirror,
  getProject,
  resetProjectForTesting,
  setSessionFileForTesting,
} = await import('../../utils/sessionStorage.js')
const { getSessionId } = await import('../../bootstrap/state.js')
const { StdoutMessageSchema } = await import(
  '../../entrypoints/sdk/controlSchemas.js'
)

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('densable 2.1.283 session-mirror', () => {
  const temps: string[] = []
  const envKeys = [
    'CLAUDE_CONFIG_DIR',
    'TEST_ENABLE_SESSION_PERSISTENCE',
    'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE',
  ] as const
  const envSnap: Partial<Record<(typeof envKeys)[number], string | undefined>> =
    {}

  beforeEach(() => {
    for (const k of envKeys) {
      if (!(k in envSnap)) envSnap[k] = process.env[k]
    }
    const cfg = mkdtempSync(join(tmpdir(), 'session-mirror-'))
    temps.push(cfg)
    process.env.CLAUDE_CONFIG_DIR = cfg
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    process.env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = '1'
    resetProjectForTesting()
  })

  afterEach(() => {
    resetProjectForTesting()
    for (const k of envKeys) {
      const v = envSnap[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const t of temps.splice(0)) {
      try {
        rmSync(t, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  test('commander registers hideHelp --session-mirror after --forward-subagent-text', () => {
    const main = src('src/main.tsx')
    const forward = main.indexOf("'--forward-subagent-text'")
    const mirror = main.indexOf("'--session-mirror'")
    const inputFormat = main.indexOf("'--input-format <format>'")
    expect(forward).toBeGreaterThan(0)
    expect(mirror).toBeGreaterThan(forward)
    expect(inputFormat).toBeGreaterThan(mirror)
    expect(main).toContain('.hideHelp()')
    const slice = main.slice(mirror, inputFormat)
    expect(slice).toContain('hideHelp()')
    expect(slice).toContain('transcript_mirror')
  })

  test('cli --session-mirror parses as a hidden boolean flag', () => {
    const program = new CommanderCommand()
      .exitOverride()
      .option('--forward-subagent-text', 'Forward subagent text', () => true)
      .addOption(
        new Option(
          '--session-mirror',
          'Emit transcript_mirror frames on stdout (SDK-internal; set by ProcessTransport when sessionStore is configured)',
        ).hideHelp(),
      )
      .option('-p, --print', 'Print', () => true)
      .addOption(
        new Option('--output-format <format>', 'Output format').choices([
          'text',
          'json',
          'stream-json',
        ]),
      )
      .option('--verbose', 'Verbose', () => true)

    program.parse(
      ['--session-mirror', '-p', '--output-format=stream-json', '--verbose'],
      { from: 'user' },
    )
    expect(program.opts().sessionMirror).toBe(true)
    expect(program.helpInformation()).not.toContain('--session-mirror')
  })

  test('addMirror fires after appendToFile with enqueue shape {type,filePath,entries}', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-mirror-jsonl-'))
    temps.push(dir)
    const filePath = join(dir, 'session.jsonl')
    mkdirSync(dirname(filePath), { recursive: true })
    setSessionFileForTesting(filePath)

    const frames: Array<{
      type: string
      filePath: string
      entries: unknown[]
    }> = []
    addTranscriptMirror((path, entries) => {
      frames.push({ type: 'transcript_mirror', filePath: path, entries })
    })

    const entry = {
      type: 'custom-title' as const,
      sessionId: getSessionId(),
      customTitle: 'mirror-test',
    }
    await getProject().appendEntry(entry)
    await getProject().flush()

    expect(frames).toHaveLength(1)
    expect(frames[0]).toEqual({
      type: 'transcript_mirror',
      filePath,
      entries: [entry],
    })
    const parsed = StdoutMessageSchema().parse(frames[0])
    expect(parsed.type).toBe('transcript_mirror')
  })

  test('print Bbr site enqueues transcript_mirror and excludes it from lastMessage', () => {
    const print = src('src/cli/print.ts')
    expect(print).toContain(
      "options.outputFormat === 'stream-json' && options.sessionMirror",
    )
    expect(print).toContain('addTranscriptMirror')
    expect(print).toContain("type: 'transcript_mirror'")
    expect(print).toContain('filePath,')
    expect(print).toContain('entries,')
    const lastPin = print.indexOf("message.type !== 'keep_alive'")
    const mirrorPin = print.indexOf("message.type !== 'transcript_mirror'")
    expect(lastPin).toBeGreaterThan(0)
    expect(mirrorPin).toBeGreaterThan(lastPin)
  })
})
