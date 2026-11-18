import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../../..')

describe('Deep 1:1 call-chain alignment (#193, #243, #428)', () => {
  test('#193: main.tsx and registerCliHostCommands.ts wire --marketplace <source> on plugin install', () => {
    for (const rel of ['src/main.tsx', 'src/cli/registerCliHostCommands.ts']) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      const start = src.indexOf("command('install <plugin>')")
      const end = src.indexOf("command('uninstall <plugin>')", start)
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      const block = src.slice(start, end)
      expect(block).toContain("'--marketplace <source>'")
      expect(block).toContain('marketplace?: string')
      expect(block).toContain('pluginInstallHandler')
    }
  })

  test('#243: Onboarding and launchOnboarding ThemeSubcommand wire saveThemeWithConfigSetHook when config.set hooks are active', () => {
    const onboarding = readFileSync(
      join(ROOT, 'src/components/Onboarding.tsx'),
      'utf8',
    )
    expect(onboarding).toContain("hasMatchingFunctionHook('config.set')")
    expect(onboarding).toContain('saveThemeWithConfigSetHook')
    expect(onboarding).toContain('Couldn&apos;t save Theme')

    const launch = readFileSync(
      join(ROOT, 'src/commands/onboarding/launchOnboarding.tsx'),
      'utf8',
    )
    expect(launch).toContain("hasMatchingFunctionHook('config.set')")
    expect(launch).toContain('saveThemeWithConfigSetHook')
    expect(launch).toContain("Couldn't save Theme")
  })

  test('#428: logOTelAuthEvent is wired into ConsoleOAuthFlow, auth.ts, and logout.tsx', () => {
    const flow = readFileSync(
      join(ROOT, 'src/components/ConsoleOAuthFlow.tsx'),
      'utf8',
    )
    expect(flow).toContain('logOTelAuthEvent')
    expect(flow).toContain(
      "action: 'login', success: false, authMethod: 'oauth'",
    )
    expect(flow).toContain(
      "action: 'login', success: true, authMethod: 'oauth'",
    )

    const auth = readFileSync(join(ROOT, 'src/cli/handlers/auth.ts'), 'utf8')
    expect(auth).toContain('logOTelAuthEvent')
    expect(auth).toContain(
      "action: 'login', success: true, authMethod: 'oauth'",
    )
    expect(auth).toContain("action: 'login',\n        success: false,")
    expect(auth).toContain(
      "action: 'logout', success: true, authMethod: 'oauth'",
    )

    const logout = readFileSync(
      join(ROOT, 'src/commands/logout/logout.tsx'),
      'utf8',
    )
    expect(logout).toContain('logOTelAuthEvent')
    expect(logout).toContain(
      "action: 'logout', success: true, authMethod: 'oauth'",
    )
  })
})
