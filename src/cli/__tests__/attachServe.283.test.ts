/**
 * densable 2.1.283 leftover `--attach-serve <session_id>`.
 * Gold SEA /tmp/official-283/package/claude help @81207589 + os() @191780834.
 */
import { describe, expect, test } from 'bun:test'
import {
  Command as CommanderCommand,
  Option,
} from '@commander-js/extra-typings'
import { readFileSync } from 'fs'
import { join } from 'path'

import { parseCloudLaunch as os } from '../cloudSession.js'
import {
  ATTACH_SERVE_COMBINE_CLOUD,
  ATTACH_SERVE_EXPECTS_PREFIX,
  ATTACH_SERVE_REQUIRES_HEADLESS,
} from '../leftoverCliFlags.js'

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

function ctx(over: Partial<Parameters<typeof os>[1]> = {}) {
  return {
    hasSdkUrl: false,
    nonInteractive: true,
    isViolinWoodEnabled: async () => false,
    cloudPrintEnabled: false,
    hasConnect: false,
    hasSSH: false,
    cloudSessionsByDefault: false,
    inputFormat: 'stream-json',
    outputFormat: 'stream-json',
    ...over,
  }
}

describe('densable 2.1.283 leftover --attach-serve', () => {
  test('MAIN registers --attach-serve via registerCloudCliOptions (gold hideHelp)', () => {
    const main = src('src/main.tsx')
    const cloud = src('src/cli/cloudSession.ts')
    expect(main).toContain('registerCloudCliOptions(program)')
    const flags = cloud.indexOf("'--cloud [description|session_id|url]'")
    const remote = cloud.indexOf("'--remote [description|session_id|url]'")
    const attach = cloud.indexOf("'--attach-serve <session_id>'")
    const env = cloud.indexOf("'--environment <environment_id>'")
    expect(flags).toBeGreaterThan(0)
    expect(remote).toBeGreaterThan(flags)
    expect(attach).toBeGreaterThan(remote)
    expect(env).toBeGreaterThan(attach)
    expect(cloud).toContain(
      'Attach a serve-only helper to a bound cloud session (spawned by the desktop app; not for interactive use).',
    )
    const afterAttach = cloud.slice(attach, env)
    expect(afterAttach).toContain('hideHelp()')
  })

  test('commander help lists --attach-serve', () => {
    const program = new CommanderCommand()
      .exitOverride()
      .option(
        '--attach-serve <session_id>',
        'Attach a serve-only helper to a bound cloud session (spawned by the desktop app; not for interactive use).',
      )
    program.parse(['--attach-serve', 'cse_abc'], { from: 'user' })
    expect(program.opts().attachServe).toBe('cse_abc')
    expect(program.helpInformation()).toContain('--attach-serve')
  })

  test('Error: --attach-serve cannot be combined with --cloud/--remote', async () => {
    expect(ATTACH_SERVE_COMBINE_CLOUD).toBe(
      'Error: --attach-serve cannot be combined with --cloud/--remote',
    )
    const withCloud = await os(
      { attachServe: 'cse_abc', cloud: 'cse_abc' },
      ctx(),
    )
    expect(withCloud).toEqual({
      ok: false,
      error: ATTACH_SERVE_COMBINE_CLOUD,
    })
    const withRemote = await os(
      { attachServe: 'cse_abc', remote: 'cse_abc' },
      ctx(),
    )
    expect(withRemote).toEqual({
      ok: false,
      error: ATTACH_SERVE_COMBINE_CLOUD,
    })
  })

  test('Error: --attach-serve expects a session id (cse_...), got', async () => {
    expect(ATTACH_SERVE_EXPECTS_PREFIX).toBe(
      'Error: --attach-serve expects a session id (cse_...), got ',
    )
    const got = await os({ attachServe: 'not-a-session' }, ctx())
    expect(got).toEqual({
      ok: false,
      error: `${ATTACH_SERVE_EXPECTS_PREFIX}not-a-session`,
    })
  })

  test('Error: --attach-serve requires serve-only headless when violin-wood is off', async () => {
    expect(ATTACH_SERVE_REQUIRES_HEADLESS).toContain(
      'never falls back to a plain attach',
    )
    const got = await os({ attachServe: 'cse_abc' }, ctx())
    expect(got).toEqual({
      ok: false,
      error: ATTACH_SERVE_REQUIRES_HEADLESS,
    })
  })

  test('serve-only + violin-wood applies attach without combining --cloud', async () => {
    const got = await os(
      { attachServe: 'cse_bound_1' },
      ctx({ isViolinWoodEnabled: async () => true }),
    )
    expect(got.ok).toBe(true)
    if (got.ok) {
      expect(got.value.serveOnly).toBe(true)
      expect(got.value.remote).toBe('cse_bound_1')
      expect(got.value.cloudAttachId).toBe('cse_bound_1')
      expect(got.value.headlessCloud).toBe(true)
    }
  })

  test('--cloud itself is not hideHelp (gold help @81206980)', () => {
    const program = new CommanderCommand()
      .exitOverride()
      .option(
        '--cloud [description|session_id|url]',
        'Create a cloud session with the given description, or attach to an existing one by session ID or claude.ai/code URL',
      )
      .addOption(
        new Option(
          '--remote [description|session_id|url]',
          'Deprecated alias for --cloud',
        ).hideHelp(),
      )
    const help = program.helpInformation()
    expect(help).toContain('--cloud')
    expect(help).not.toContain('--remote')
  })

  test('default inject is off — attach-serve never falls back to plain attach', async () => {
    const got = await os({ attachServe: 'cse_abc' }, ctx())
    expect(got).toEqual({
      ok: false,
      error: ATTACH_SERVE_REQUIRES_HEADLESS,
    })
  })

  test('GB on without stream-json still refuses (m8r missing)', async () => {
    const got = await os(
      { attachServe: 'cse_abc' },
      ctx({
        inputFormat: 'text',
        outputFormat: 'text',
        isViolinWoodEnabled: async () => true,
      }),
    )
    expect(got).toEqual({
      ok: false,
      error: ATTACH_SERVE_REQUIRES_HEADLESS,
    })
  })

  test('throwing GB inject is catch→false then refuse (gold os())', async () => {
    const got = await os(
      { attachServe: 'cse_abc' },
      ctx({
        isViolinWoodEnabled: async () => {
          throw new Error('gb')
        },
      }),
    )
    expect(got).toEqual({
      ok: false,
      error: ATTACH_SERVE_REQUIRES_HEADLESS,
    })
  })

  test('MAIN wires gold Wd, not a hard false stub', () => {
    const main = src('src/main.tsx')
    expect(main).toContain("from './cli/violinWood.js'")
    expect(main).toContain('isViolinWoodEnabled,')
    expect(main).not.toContain('isViolinWoodEnabled: async () => false')
  })
})
