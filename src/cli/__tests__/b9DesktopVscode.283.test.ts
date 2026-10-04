/**
 * densable 2.1.283 Desktop / VS Code / Cowork CLI commander + handler gates.
 * Gold SEA /tmp/official-283/package/claude.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getCliCommandGraphNode } from '../cliCommandGraph.js'
import { runChromeSettingsEdit } from '../handlers/chromeSettingsEdit.js'
import { designLoginStatus } from '../handlers/designLogin.js'
import { runMemorySettingsEdit } from '../handlers/memorySettingsEdit.js'
import { runPermissionRuleEdit } from '../handlers/permissionRuleEdit.js'
import { runSkillOverrideEdit } from '../handlers/skillOverrideEdit.js'

const ROOT = join(import.meta.dir, '../../..')

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('densable 2.1.283 B9 desktop/vscode/cowork commander', () => {
  test('hidden VS Code stdin commands are registered on both commander hosts', () => {
    const names = [
      'edit-permission-rules',
      'edit-memory-settings',
      'edit-skill-overrides',
      'edit-sandbox-settings',
      'design-login',
      'edit-chrome-settings',
    ]
    const host = src('src/cli/registerCliHostCommands.ts')
    const vscodeHost = src('src/cli/handlers/vscodeExtensionHost.ts')
    const main = src('src/main.tsx')
    expect(host).toContain('registerVscodeExtensionHostCommands(program)')
    expect(main).toContain('registerVscodeExtensionHostCommands(program)')
    for (const name of names) {
      expect(vscodeHost).toContain(`.command('${name}'`)
      expect(vscodeHost).toContain('{ hidden: true }')
      expect(vscodeHost).toContain('.allowExcessArguments(false)')
      expect(vscodeHost).toContain('used by the VS Code extension')
      expect(getCliCommandGraphNode([name]).hidden).toBe(true)
    }
  })

  test('chrome MCP fast path and --chrome/--no-chrome flags already HAVE gold BODY', () => {
    const cli = src('src/entrypoints/cli.tsx')
    expect(cli).toContain('--claude-in-chrome-mcp')
    expect(cli).toContain('--chrome-native-host')
    expect(cli).toContain('runChromeNativeHost')
    const main = src('src/main.tsx')
    expect(main).toContain(
      ".option('--chrome', 'Enable Claude in Chrome integration')",
    )
    expect(main).toContain(
      ".option('--no-chrome', 'Disable Claude in Chrome integration')",
    )
    expect(main).toContain(
      ".option('--ide', 'Automatically connect to IDE on startup if exactly one valid IDE is available'",
    )
  })

  test('cowork is a hidden plugin flag, not a top-level claude desktop/cowork subcommand', () => {
    const host = src('src/cli/registerCliHostCommands.ts')
    expect(host).toContain(
      "new Option('--cowork', 'Use cowork_plugins directory').hideHelp()",
    )
    expect(host).not.toContain(".command('desktop'")
    expect(host).not.toContain(".command('cowork'")
    expect(host).toContain(".command('add-from-claude-desktop')")
    expect(
      getCliCommandGraphNode(['mcp', 'add-from-claude-desktop']).description,
    ).toBe('Import MCP servers from Claude Desktop (Mac and WSL only)')
  })

  test('edit-permission-rules TTY and schema gates match gold strings', async () => {
    const vscodeHost = src('src/cli/handlers/vscodeExtensionHost.ts')
    expect(vscodeHost).toContain(
      'claude edit-permission-rules reads one JSON edit from stdin; it is run by the VS Code extension, not by hand',
    )
    const bad = await runPermissionRuleEdit({ op: 'nope' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toBe('op must be one of: add, remove')
    }
    const dest = await runPermissionRuleEdit({
      op: 'add',
      rules: ['Bash'],
      behavior: 'allow',
      destination: 'session',
    })
    expect(dest.ok).toBe(false)
    if (!dest.ok) {
      expect(dest.error).toContain('destination must be one of:')
    }
  })

  test('memory / chrome / skill / design-login handler gates match gold strings', async () => {
    const mem = await runMemorySettingsEdit({})
    expect(mem.ok).toBe(false)
    if (!mem.ok) {
      expect(mem.error).toContain(
        'Nothing to change: neither autoMemoryEnabled nor autoDreamEnabled was given.',
      )
    }
    const chrome = await runChromeSettingsEdit({})
    expect(chrome.ok).toBe(false)
    if (!chrome.ok) {
      expect(chrome.error).toContain('Not a Claude in Chrome settings edit')
    }
    const skill = await runSkillOverrideEdit(
      { name: '__proto__', state: 'off' },
      process.cwd(),
    )
    expect(skill.ok).toBe(false)
    if (!skill.ok) {
      expect(skill.error).toContain(
        "Settings can't store an entry with this skill's name",
      )
    }
    const status = await designLoginStatus()
    // gold `_()`: available=BO() (firstParty); can_sign_in_here=Nbe(); reason=!Nbe
    expect(status.can_sign_in_here).toBe(false)
    expect(status.reason).toBe(
      'The Claude Design sign-in is not configured in this build.',
    )
    const oauth = src('src/cli/handlers/designOauth.ts')
    expect(oauth).toContain('CLAUDE_CODE_DESIGN_OAUTH_CLIENT_ID')
    expect(oauth).toContain("startsWith('00000000-')")
    expect(oauth).toContain('allow_design_sync')
    expect(oauth).toContain("getAPIProvider() === 'firstParty'")
    expect(oauth).toContain('env.isSSH()')
    expect(oauth).toContain('The Claude Design OAuth client is not configured')
    expect(oauth).toContain('user:design:read')
    expect(oauth).toContain('user:design:write')
    expect(oauth).toContain('grantDesignOauthSlot')
    expect(oauth).toContain('skipProfileFetch: true')
    expect(oauth).toContain('revokeOAuthRefreshToken')
    expect(oauth).toContain("'oauth_token_revoke'")
    expect(oauth).toContain('tengu_feature_ok')
    expect(oauth).toContain('tengu_feature_sad')
    expect(oauth).toContain("http_${status ?? 'network'}")
  })

  test('gkn refuses tokens missing H_e scopes', async () => {
    const { grantDesignOauthSlot } = await import('../handlers/designOauth.js')
    const missing = grantDesignOauthSlot(
      {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Date.now() + 1000,
        scopes: ['user:inference'],
      },
      'cid',
    )
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.message).toContain('user:design:read')
    }
    const ok = grantDesignOauthSlot(
      {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Date.now() + 1000,
        scopes: ['user:design:read', 'user:design:write', 'extra'],
      },
      'cid',
    )
    expect(ok.ok).toBe(true)
  })

  test('Otn / yOt source-lock', () => {
    const ide = src('src/utils/ide.ts')
    expect(ide).toContain('isDiffBuiltinPluginAvailable')
    expect(ide).toContain("getBuiltinPluginDefinition('diff')")
    const sandbox = src('src/utils/sandbox/sandbox-adapter.ts')
    expect(sandbox).toContain('isStrictSandboxModeConfigured')
    expect(sandbox).toContain("source: 'localSettings' | 'userSettings'")
    const edit = src('src/cli/handlers/sandboxSettingsEdit.ts')
    expect(edit).toContain('user_settings_disabled')
    expect(edit).toContain("'userSettings'")
  })
})
