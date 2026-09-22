/**
 * densable 2.1.248 #1 `--restricted` / `CLAUDE_CODE_RESTRICTED`.
 *
 * Gold (SEA official-248/package/claude.exe, 226708128):
 * - O2 @178589351 sha=9555f7c727a5a06d
 * - Yk @178565128 sha=004e8eb906e6711a
 * - D2n @185211537 sha=cc7c00c15a722c6a
 * - argv parse @178161324
 * - env fold @178178450
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import { WEB_FETCH_TOOL_NAME } from '@claude-code/builtin-tools/tools/WebFetchTool/prompt.js'
import {
  addToInMemoryErrorLog,
  setRestrictedSession,
} from '../../bootstrap/state.js'
import { getBootstrapSessionHost } from '../sessionHost.js'
import { resetSessionHostForTests } from '../sessionRoot.js'
import { parseSettingSourcesFlag } from '../settings/constants.js'
import {
  foldRestrictedLaunchOptions,
  isRestrictedEnv,
  isRestrictedSession,
  refuseRestrictedBypass,
  RESTRICTED_BYPASS_REFUSE,
  RESTRICTED_CLOUD_CREATE_REFUSE,
  RESTRICTED_DISPATCH_OPTION_HELP,
  RESTRICTED_OPTION_HELP,
  restrictedAttachmentOutsideMessage,
  restrictedDenyToolNames,
  restrictedFileToolOutsideMessage,
  restrictedNamedKeepSet,
  restrictedDispatchExtraArgs,
  restrictedSpawnEnv,
  setRestrictedSessionFlag,
} from '../restricted.js'

const ENV_KEY = 'CLAUDE_CODE_RESTRICTED'
const saved = process.env[ENV_KEY]
const savedSession = isRestrictedSession()

function src(rel: string): string {
  return readFileSync(join(import.meta.dir, rel), 'utf8')
}

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = saved
  setRestrictedSession(savedSession)
})

describe('densable 2.1.248 #1 --restricted / CLAUDE_CODE_RESTRICTED', () => {
  test('O2 Me truthy: 1/true/yes/on', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE', ' Yes ']) {
      expect(isRestrictedEnv({ [ENV_KEY]: v })).toBe(true)
    }
    for (const v of ['0', 'false', 'off', '', undefined]) {
      expect(isRestrictedEnv({ [ENV_KEY]: v })).toBe(false)
    }
  })

  test('Yk / c7e session bit', () => {
    setRestrictedSessionFlag(false)
    expect(isRestrictedSession()).toBe(false)
    setRestrictedSessionFlag(true)
    expect(isRestrictedSession()).toBe(true)
  })

  test('D2n RSe refuse bypass', () => {
    expect(RESTRICTED_BYPASS_REFUSE).toBe(
      'bypassPermissions not supported in restricted mode',
    )
    expect(
      refuseRestrictedBypass({
        restricted: true,
        permissionMode: 'bypassPermissions',
      }),
    ).toBe(RESTRICTED_BYPASS_REFUSE)
    expect(
      refuseRestrictedBypass({
        restricted: true,
        allowDangerouslySkipPermissions: true,
      }),
    ).toBe(RESTRICTED_BYPASS_REFUSE)
    expect(
      refuseRestrictedBypass({
        restricted: true,
        permissionMode: 'default',
      }),
    ).toBeUndefined()
    expect(
      refuseRestrictedBypass({
        restricted: false,
        permissionMode: 'bypassPermissions',
      }),
    ).toBeUndefined()
  })

  test('zin folds Yk into options.restricted', () => {
    expect(foldRestrictedLaunchOptions({}, true).restricted).toBe(true)
    expect(
      foldRestrictedLaunchOptions({ restricted: false }, true).restricted,
    ).toBe(true)
    expect(foldRestrictedLaunchOptions({}, false).restricted).toBe(false)
    expect(
      foldRestrictedLaunchOptions({ restricted: true }, false).restricted,
    ).toBe(true)
  })

  test('Fnt preset keep-set is empty; named Bash is kept', () => {
    expect(restrictedNamedKeepSet(['preset:default']).size).toBe(0)
    expect(restrictedNamedKeepSet(['default']).has('default')).toBe(true)
    expect(restrictedNamedKeepSet([BASH_TOOL_NAME]).has(BASH_TOOL_NAME)).toBe(
      true,
    )
  })

  test('Nnt strips code-running + WebFetch unless --tools names them', () => {
    const all = restrictedDenyToolNames(
      [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME, 'REPL'],
      new Set(),
    )
    expect(all).toContain(BASH_TOOL_NAME)
    expect(all).toContain(POWERSHELL_TOOL_NAME)
    expect(all).toContain('REPL')
    expect(all).toContain(WEB_FETCH_TOOL_NAME)
    expect(all).toContain('mcp__workspace__bash')
    expect(all).toContain('mcp__workspace__web_fetch')
    expect(all).toContain('mcp__remote-devices__device_bash')
    expect(all).toContain('mcp__ide__executeCode')

    const keepBash = restrictedDenyToolNames(
      [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME, 'REPL'],
      new Set([BASH_TOOL_NAME]),
    )
    expect(keepBash).not.toContain(BASH_TOOL_NAME)
    expect(keepBash).not.toContain('mcp__workspace__bash')
    expect(keepBash).toContain(WEB_FETCH_TOOL_NAME)
    expect(keepBash).toContain(POWERSHELL_TOOL_NAME)
  })

  test('child spawn env when Yk()', () => {
    setRestrictedSessionFlag(false)
    expect(restrictedSpawnEnv()).toEqual({})
    setRestrictedSessionFlag(true)
    expect(restrictedSpawnEnv()).toEqual({ CLAUDE_CODE_RESTRICTED: '1' })
  })

  test('leftover sr extraArgs prepends --restricted when Yk()', () => {
    setRestrictedSessionFlag(false)
    expect(restrictedDispatchExtraArgs(['--effort', 'high'])).toEqual([
      '--effort',
      'high',
    ])
    setRestrictedSessionFlag(true)
    expect(restrictedDispatchExtraArgs(['--effort', 'high'])).toEqual([
      '--restricted',
      '--effort',
      'high',
    ])
    expect(restrictedDispatchExtraArgs(['--restricted', '--effort'])).toEqual([
      '--restricted',
      '--effort',
    ])
  })

  test('gold vi / Wdt deny strings', () => {
    expect(restrictedFileToolOutsideMessage('/tmp/out', ['/work'])).toBe(
      '/tmp/out is outside /work; --restricted confines the file tools to the working directory.',
    )
    expect(restrictedAttachmentOutsideMessage('/tmp/out')).toBe(
      'Attachment "/tmp/out" is outside the working directory; --restricted only sends files from inside it.',
    )
  })

  test('k3t empty setting-sources leaves managed + --settings', () => {
    expect(parseSettingSourcesFlag('')).toEqual([])
    const settingsSrc = src('../settings/constants.ts')
    expect(settingsSrc).toContain("result.add('policySettings')")
    expect(settingsSrc).toContain("result.add('flagSettings')")
  })

  test('leftover sources cite gold offsets and land the 1:1 sites', () => {
    const helpers = src('../restricted.ts')
    expect(helpers).toContain('@178589351')
    expect(helpers).toContain('9555f7c727a5a06d')
    expect(helpers).toContain('@178565128')
    expect(helpers).toContain('004e8eb906e6711a')
    expect(helpers).toContain('@185211537')
    expect(helpers).toContain('cc7c00c15a722c6a')
    expect(helpers).toContain('@178161324')
    expect(helpers).toContain('@178178450')

    const main = src('../../main.tsx')
    expect(main).toContain(".option('--restricted', RESTRICTED_OPTION_HELP)")
    expect(main).toContain(
      "if (eagerHasCliFlag('--restricted') || isRestrictedEnv())",
    )
    expect(main).toContain("loadSettingSourcesFromFlag('')")
    expect(main).toContain('refuseRestrictedBypass')
    expect(main).toContain('setForkRestrictedLaunchConfig')

    const setup = src('../permissions/permissionSetup.ts')
    expect(setup).toContain('toolsNarrowing')
    expect(setup).toContain('restrictedDenyToolNames')
    expect(setup).toContain('RESTRICTED_BYPASS_REFUSE')

    const worker = src('../../daemon/bgWorker.ts')
    expect(worker).toContain('restrictedSpawnEnv()')

    const up = src('../../screens/fleetView/helpers.ts')
    expect(up).toContain("isRestrictedSession() ? ['--restricted'] : []")
    expect(up).toContain('@192190421')

    expect(RESTRICTED_OPTION_HELP).toContain(
      'removes the built-in tools that run commands or code',
    )
    expect(RESTRICTED_DISPATCH_OPTION_HELP).toBe(
      'Start dispatched sessions in restricted mode',
    )

    const agents = src('../../screens/AgentView.tsx')
    expect(agents.match(/fleetUpExtraArgs\(dispatchExtraArgs\)/g)?.length).toBe(
      4,
    )

    const teleport = src('../teleport.tsx')
    expect(teleport).toContain('RESTRICTED_CLOUD_CREATE_REFUSE')
    expect(teleport).toContain("'restricted_session'")
    expect(RESTRICTED_CLOUD_CREATE_REFUSE).toBe(
      'Cloud sessions cannot be created from a --restricted session: they would not enforce it.',
    )

    const fork = src('../spawnBackgroundSessionFork.ts')
    expect(fork).toContain("extraArgs.push('--restricted')")
    expect(fork).toContain('reattachEnv: restrictedSpawnEnv()')
    expect(fork).toContain('isRestrictedSession()')

    const exitBg = src('../../components/BackgroundAndExit.tsx')
    expect(exitBg).toContain("isRestrictedSession() ? ['--restricted'] : []")
    expect(exitBg).toContain('reattachEnv: restrictedSpawnEnv()')

    const log = src('../log.ts')
    expect(log).toContain('addToInMemoryErrorLog(errorInfo)')
    expect(log).toContain('diagnostics.errorLog()')
    expect(log).not.toContain('let inMemoryErrorLog')

    const xse = src('../../daemon/xSeSpawn.ts')
    expect(xse).toContain('restrictedDispatchExtraArgs(opts.extraArgs)')
    expect(xse).toContain('...restrictedSpawnEnv()')

    const spare = src('../../daemon/bgSpare.ts')
    expect(spare).toContain('Object.assign(env, restrictedSpawnEnv()')
  })

  test('leftover yEr / getInMemoryErrors share host.diagnostics He.#e', () => {
    // Prefer host bag over log.getInMemoryErrors — full-suite mock.module on
    // log.ts (tests/mocks/log) returns [] / no-op reset and would false-fail.
    resetSessionHostForTests()
    const host = getBootstrapSessionHost()
    host.diagnostics.reset()
    addToInMemoryErrorLog({ error: 'he-bag', timestamp: 't' })
    expect(host.diagnostics.errorLog()).toEqual([
      { error: 'he-bag', timestamp: 't' },
    ])
    const logSrc = src('../log.ts')
    expect(logSrc).toContain('getBootstrapSessionHost().diagnostics.errorLog()')
    expect(logSrc).toContain('diagnostics.reset()')
    host.diagnostics.reset()
    expect(host.diagnostics.errorLog()).toEqual([])
  })
})
