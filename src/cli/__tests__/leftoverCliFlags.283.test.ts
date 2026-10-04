/**
 * densable 2.1.283 leftover hideHelp CLI flags:
 * --system-prompt-snapshot, --inherit-permission-mode, --watch-artifact,
 * --client-data-url, --forward-home-settings.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  Command as CommanderCommand,
  Option,
} from '@commander-js/extra-typings'
import { readFileSync } from 'fs'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('../../utils/debug.js', () => debugMock())
mock.module('../../utils/debug.ts', () => debugMock())
mock.module('src/utils/debug.js', () => debugMock())
mock.module('src/utils/debug.ts', () => debugMock())
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())
mock.module('src/services/analytics/index.js', () => analyticsMock())
mock.module('src/services/analytics/index.ts', () => analyticsMock())

const { parseWatchArtifactArg, WATCH_ARTIFACT_EXPECTS } = await import(
  '../watchArtifactCli.js'
)
const {
  applyHomeSettingsHostConsent,
  applyMayForwardHomeSettings,
  parseCloudLaunch,
} = await import('../cloudSession.js')
const { FORWARD_HOME_BOOL_PREFIX, FORWARD_HOME_CLOUD_GATE } = await import(
  '../leftoverCliFlags.js'
)
const { getBootstrapSessionHost, resetSessionHostForTests } = await import(
  '../../utils/sessionHost.js'
)

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('densable 2.1.283 leftover CLI flags', () => {
  test('commander hideHelp order for snapshot / inherit / watch / client-data', () => {
    const main = src('src/main.tsx')
    const snap = main.indexOf("'--system-prompt-snapshot <on|off>'")
    const inherit = main.indexOf("'--inherit-permission-mode <mode>'")
    const watch = main.indexOf("'--watch-artifact <artifact>'")
    const watchNo = main.indexOf("'--watch-artifact-no-autoreact <artifact>'")
    const client = main.indexOf("'--client-data-url <url>'")
    expect(snap).toBeGreaterThan(0)
    expect(inherit).toBeGreaterThan(snap)
    expect(watch).toBeGreaterThan(inherit)
    expect(watchNo).toBeGreaterThan(watch)
    expect(client).toBeGreaterThan(watchNo)
    expect(main.slice(snap, inherit)).toContain('hideHelp()')
    expect(main.slice(inherit, watch)).toContain('hideHelp()')
    expect(main.slice(watch, watchNo)).toContain('hideHelp()')
    const cloud = src('src/cli/cloudSession.ts')
    expect(cloud).toContain("'--forward-home-settings <true|false>'")
    expect(cloud).toContain('.hideHelp()')
  })

  test('flags parse and stay hidden from help', () => {
    const program = new CommanderCommand()
      .exitOverride()
      .addOption(
        new Option('--system-prompt-snapshot <on|off>', 'snap')
          .choices(['on', 'off'])
          .argParser((w: string) => w === 'on')
          .hideHelp(),
      )
      .addOption(
        new Option('--inherit-permission-mode <mode>', 'inherit')
          .choices(['default', 'plan', 'acceptEdits'])
          .hideHelp(),
      )
      .addOption(new Option('--watch-artifact <artifact>', 'watch').hideHelp())
      .option('--client-data-url <url>', 'doc')
      .addOption(
        new Option('--forward-home-settings <true|false>', 'fwd')
          .choices(['true', 'false', '1', '0'])
          .hideHelp(),
      )
    program.parse(
      [
        '--system-prompt-snapshot',
        'off',
        '--inherit-permission-mode',
        'plan',
        '--watch-artifact',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '--client-data-url',
        'https://example.test/doc',
        '--forward-home-settings',
        'false',
      ],
      { from: 'user' },
    )
    const opts = program.opts()
    expect(opts.systemPromptSnapshot).toBe(false)
    expect(opts.inheritPermissionMode).toBe('plan')
    expect(opts.watchArtifact).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(opts.clientDataUrl).toBe('https://example.test/doc')
    expect(opts.forwardHomeSettings).toBe('false')
    const help = program.helpInformation()
    expect(help).not.toContain('--system-prompt-snapshot')
    expect(help).not.toContain('--inherit-permission-mode')
    expect(help).not.toContain('--watch-artifact')
    expect(help).not.toContain('--forward-home-settings')
  })

  test('watch-artifact parse uuid / refuse junk', () => {
    const ok = parseWatchArtifactArg('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect('slug' in ok).toBe(true)
    if ('slug' in ok) {
      expect(ok.slug).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    }
    expect(parseWatchArtifactArg('not-an-artifact')).toEqual({
      error: WATCH_ARTIFACT_EXPECTS,
    })
  })

  test('forward-home gold nn strings', () => {
    expect(FORWARD_HOME_BOOL_PREFIX).toBe(
      'Error: --forward-home-settings takes true or false, not ',
    )
    expect(FORWARD_HOME_CLOUD_GATE).toContain('pass --cloud')
  })
})

describe('densable 2.1.283 leftover --forward-home-settings APPLY', () => {
  beforeEach(() => {
    resetSessionHostForTests()
  })
  afterEach(() => {
    resetSessionHostForTests()
  })

  function ctx() {
    return {
      hasSdkUrl: false,
      nonInteractive: false,
      hasConnect: false,
      hasSSH: false,
    }
  }

  test('refuse when neither --cloud nor --environment is set', async () => {
    const got = await parseCloudLaunch({ forwardHomeSettings: 'true' }, ctx())
    expect(got).toEqual({ ok: false, error: FORWARD_HOME_CLOUD_GATE })
    const invalid = await parseCloudLaunch(
      { forwardHomeSettings: 'maybe' },
      ctx(),
    )
    expect(invalid).toEqual({
      ok: false,
      error: `${FORWARD_HOME_BOOL_PREFIX}maybe.`,
    })
  })

  test('with --cloud applies boolean to LaunchOptions.mayForwardHomeSettings', async () => {
    const host = getBootstrapSessionHost().launchOptions
    expect(host.mayForwardHomeSettings()).toBe(true)
    const off = await parseCloudLaunch(
      { forwardHomeSettings: 'false', cloud: 'cse_abc' },
      ctx(),
    )
    expect(off.ok).toBe(true)
    if (off.ok) {
      applyMayForwardHomeSettings(off.value.forwardHomeSettings)
      applyHomeSettingsHostConsent(off.value.homeSettingsConsent)
      expect(host.mayForwardHomeSettings()).toBe(false)
      expect(host.homeSettingsHostConsent()).toBe(null)
    }
    const on = await parseCloudLaunch(
      { forwardHomeSettings: 'true', cloud: 'new task' },
      ctx(),
    )
    expect(on.ok).toBe(true)
    if (on.ok) {
      applyMayForwardHomeSettings(on.value.forwardHomeSettings)
      applyHomeSettingsHostConsent(on.value.homeSettingsConsent)
      expect(host.mayForwardHomeSettings()).toBe(true)
      expect(host.homeSettingsHostConsent()).toBe('forward')
    }
  })

  test('main wires parseCloudLaunch then replaceMayForwardHomeSettings', () => {
    const main = src('src/main.tsx')
    expect(main).toContain('parseCloudLaunch')
    expect(main).toContain(
      'applyMayForwardHomeSettings(cloudLaunch.forwardHomeSettings)',
    )
    expect(main).toContain(
      'applyHomeSettingsHostConsent(cloudLaunch.homeSettingsConsent)',
    )
    expect(main).not.toContain(
      'Local CLI parses the flag; gold refuses unless --cloud/--environment (not landed).',
    )
  })
})
