/**
 * densable 2.1.283 hideHelp CLI flags: --await-claim, --await-initialize,
 * --thinking-display.
 *
 * GOLD SEA /tmp/official-283/package/claude commander @192098232
 * gates @191846271; g$e @177609369.
 */
import { describe, expect, test } from 'bun:test'
import {
  Command as CommanderCommand,
  Option,
} from '@commander-js/extra-typings'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  concatPluginDirs,
  parseAwaitInitializeLine,
} from '../awaitInitialize.js'
import {
  getRecordedStartupPhase,
  recordStartupPhase,
  resetRecordedStartupPhasesForTesting,
} from '../../utils/startupProfiler.js'
import {
  bindMinimalClaimSession,
  isSubprocessEnvScrubEnabled,
  markSpareParked,
} from '../spareClaim.js'
import {
  isThinkingDisplay,
  THINKING_DISPLAY_CHOICES,
} from '../../utils/thinking.js'
import { getBootstrapSessionHost } from '../../utils/sessionHost.js'

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('densable 2.1.283 await-claim / await-initialize / thinking-display', () => {
  test('commander hideHelp order: session-mirror, await-claim, input-format, await-initialize', () => {
    const main = src('src/main.tsx')
    const mirror = main.indexOf("'--session-mirror'")
    const awaitClaim = main.indexOf("'--await-claim'")
    const inputFormat = main.indexOf("'--input-format <format>'")
    const awaitInit = main.indexOf("'--await-initialize'")
    expect(mirror).toBeGreaterThan(0)
    expect(awaitClaim).toBeGreaterThan(mirror)
    expect(inputFormat).toBeGreaterThan(awaitClaim)
    expect(awaitInit).toBeGreaterThan(inputFormat)
    const claimSlice = main.slice(awaitClaim, inputFormat)
    expect(claimSlice).toContain('hideHelp()')
    expect(claimSlice).toContain('claim_session')
    const initSlice = main.slice(awaitInit, awaitInit + 900)
    expect(initSlice).toContain('hideHelp()')
    expect(initSlice).toContain('launch-scoped fields (plugins)')
  })

  test('commander hideHelp --thinking-display after --thinking before --max-thinking-tokens', () => {
    const main = src('src/main.tsx')
    const thinking = main.indexOf("'--thinking <mode>'")
    const display = main.indexOf("'--thinking-display <display>'")
    const maxTokens = main.indexOf("'--max-thinking-tokens <tokens>'")
    expect(thinking).toBeGreaterThan(0)
    expect(display).toBeGreaterThan(thinking)
    expect(maxTokens).toBeGreaterThan(display)
    const slice = main.slice(display, maxTokens)
    expect(slice).toContain('hideHelp()')
    expect(slice).toContain('THINKING_DISPLAY_CHOICES')
  })

  test('thinking-display choices are summarized, omitted, highlights', () => {
    expect([...THINKING_DISPLAY_CHOICES]).toEqual([
      'summarized',
      'omitted',
      'highlights',
    ])
    expect(isThinkingDisplay('summarized')).toBe(true)
    expect(isThinkingDisplay('omitted')).toBe(true)
    expect(isThinkingDisplay('highlights')).toBe(true)
    expect(isThinkingDisplay('verbose')).toBe(false)
  })

  test('cli flags parse and stay hidden from help', () => {
    const program = new CommanderCommand()
      .exitOverride()
      .option('--forward-subagent-text', 'Forward', () => true)
      .addOption(
        new Option('--session-mirror', 'Emit transcript_mirror').hideHelp(),
      )
      .addOption(
        new Option(
          '--await-claim',
          'Start as a pre-warmed spare for an SDK host',
        ).hideHelp(),
      )
      .addOption(
        new Option('--input-format <format>', 'Input format').choices([
          'text',
          'stream-json',
        ]),
      )
      .addOption(new Option('--await-initialize', 'Read initialize').hideHelp())
      .addOption(
        new Option('--thinking <mode>', 'Thinking')
          .choices(['enabled', 'adaptive', 'disabled'])
          .hideHelp(),
      )
      .addOption(
        new Option('--thinking-display <display>', 'How thinking appears')
          .choices(['summarized', 'omitted', 'highlights'])
          .hideHelp(),
      )
      .option('-p, --print', 'Print', () => true)
      .addOption(
        new Option('--output-format <format>', 'Output').choices([
          'text',
          'json',
          'stream-json',
        ]),
      )

    program.parse(
      [
        '--await-claim',
        '--await-initialize',
        '--thinking-display',
        'omitted',
        '-p',
        '--input-format=stream-json',
        '--output-format=stream-json',
      ],
      { from: 'user' },
    )
    const opts = program.opts()
    expect(opts.awaitClaim).toBe(true)
    expect(opts.awaitInitialize).toBe(true)
    expect(opts.thinkingDisplay).toBe('omitted')
    const help = program.helpInformation()
    expect(help).not.toContain('--await-claim')
    expect(help).not.toContain('--await-initialize')
    expect(help).not.toContain('--thinking-display')
  })

  test('gate error strings 1:1 gold nn', () => {
    const main = src('src/main.tsx')
    expect(main).toContain(
      'Error: --await-initialize requires --input-format=stream-json.',
    )
    expect(main).toContain(
      'Error: --await-initialize cannot be used with --sdk-url.',
    )
    expect(main).toContain(
      'Error: --await-claim requires --print with --input-format=stream-json and --output-format=stream-json.',
    )
    expect(main).toContain(
      'Error: --await-claim cannot be combined with --continue, --resume or --fork-session.',
    )
    expect(main).toContain(
      'Error: --await-claim cannot be used with CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: the subprocess sandbox pins its protected paths to the launch directory at start-up.',
    )
  })

  test('await-initialize parse: stdin ended / not JSON / not initialize / plugins malformed / applied', () => {
    expect(parseAwaitInitializeLine('not-json').kind).toBe('violation')
    expect(
      (parseAwaitInitializeLine('not-json') as { message: string }).message,
    ).toBe(
      'Error: --await-initialize requires the initialize control request as the first stdin line, and the first line is not valid JSON.',
    )
    expect(
      (
        parseAwaitInitializeLine(
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'hi' },
          }),
        ) as { message: string }
      ).message,
    ).toBe(
      'Error: --await-initialize requires the initialize control request as the first stdin line, and the first line is a different message.',
    )
    expect(
      (
        parseAwaitInitializeLine(
          JSON.stringify({
            type: 'control_request',
            request: { subtype: 'initialize', plugins: 'nope' },
          }),
        ) as { message: string }
      ).message,
    ).toBe(
      "Error: initialize.plugins must be an array of { type: 'local', path: string, skipMcpDiscovery?: boolean } entries.",
    )
    const applied = parseAwaitInitializeLine(
      JSON.stringify({
        type: 'control_request',
        request: {
          subtype: 'initialize',
          plugins: [
            { type: 'local', path: '/p/a' },
            { type: 'local', path: '/p/b', skipMcpDiscovery: true },
          ],
        },
      }),
    )
    expect(applied).toEqual({
      kind: 'applied',
      pluginDirs: ['/p/a'],
      pluginDirsNoMcp: ['/p/b'],
    })
    expect(concatPluginDirs(['/cli'], ['/init'])).toEqual(['/cli', '/init'])
  })

  test('await-claim park then minimal claim_session bind', () => {
    const host = getBootstrapSessionHost().launchOptions
    host.reset()
    markSpareParked()
    expect(host.spareClaimState()).toBe('parked')
    const dirs: string[] = []
    const ok = bindMinimalClaimSession(
      { subtype: 'claim_session', cwd: '/tmp/claimed' },
      p => {
        dirs.push(p)
      },
    )
    expect(ok.kind).toBe('ok')
    expect(dirs).toEqual(['/tmp/claimed'])
    expect(host.spareClaimState()).toBe('claimed')
    const again = bindMinimalClaimSession(
      { subtype: 'claim_session', cwd: '/tmp/other' },
      () => {},
    )
    expect(again.kind).toBe('error')
    if (again.kind === 'error') {
      expect(again.message).toContain('not_a_spare')
    }
  })

  test('await-initialize fl telemetry reasons 1:1 gold _/m/p', () => {
    const awaitInit = src('src/cli/awaitInitialize.ts')
    expect(awaitInit).toContain("logEvent('tengu_feature_ok'")
    expect(awaitInit).toContain("logSdkLaunchInitializeSad('stdin_ended')")
    expect(awaitInit).toContain(
      "logSdkLaunchInitializeBad('first_line_too_long')",
    )
    expect(awaitInit).toContain(
      "logSdkLaunchInitializeBad('first_line_not_json')",
    )
    expect(awaitInit).toContain(
      "logSdkLaunchInitializeBad('first_line_not_initialize')",
    )
    expect(awaitInit).toContain(
      "logSdkLaunchInitializeBad('plugins_malformed')",
    )
    expect(awaitInit).toContain("logSdkLaunchInitializeSad('stdin_error')")
    expect(awaitInit).toContain("logSdkLaunchInitializeBad('parse_threw')")
    expect(awaitInit).toContain('logSdkLaunchInitializeOk()')
    const main = src('src/main.tsx')
    expect(main).toContain('recordStartupPhase(')
    expect(main).toContain("'await_initialize_ms'")
  })

  test('Zo recordStartupPhase stores await_initialize_ms', () => {
    resetRecordedStartupPhasesForTesting()
    recordStartupPhase('await_initialize_ms', 12.7, 100.2)
    expect(getRecordedStartupPhase('await_initialize_ms')).toBe(13)
  })

  test('isSubprocessEnvScrubEnabled reads CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', () => {
    const prev = process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
    process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1'
    expect(isSubprocessEnvScrubEnabled()).toBe(true)
    process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '0'
    expect(isSubprocessEnvScrubEnabled()).toBe(false)
    if (prev === undefined) delete process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
    else process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = prev
  })
})
