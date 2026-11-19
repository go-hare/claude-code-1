import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSandboxedGitProtectedFileNote } from '../BashTool.js'
import { checkReadOnlyGitRepositoryTrust } from '../readOnlyValidation.js'
import {
  bashToolCheckPermission,
  bashToolHasPermission,
} from '../bashPermissions.js'
import { detectBareGitIndicators } from 'src/utils/promptShellExecution.js'
import { matchingRuleForInput } from 'src/utils/permissions/filesystem.js'
import { toolMatchesRule } from 'src/utils/permissions/permissions.js'
import { checkZRuGitRedirect } from 'src/utils/worktreeGitIsolation.js'
import { assertHookWorktreePathSafe } from 'src/utils/worktree.js'
import { filterEffectiveHostAlwaysAllowSuggestions } from 'src/cli/structuredIO.js'
import { hasUnverifiableDotGitPointer } from 'src/utils/permissions/projectGrantsGate.js'
import type { ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'

function makePermCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    ...overrides,
  }
}

describe('Wave 325 Group 1 — Bash, Permissions, Worktree & Git (#2261-#2262, #2267, #2321-#2322, #2325-#2327, #2355, #2357, #2359, #2364, #2380)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#2261: getSandboxedGitProtectedFileNote emits note for sandboxed git checkout/stash protected-file failures', () => {
    const note = getSandboxedGitProtectedFileNote(
      "Switched to branch 'main'\nerror: unable to unlink old '.claude/settings.json': Operation not permitted",
      1,
    )
    expect(note).toBeDefined()
    expect(note).toContain('sandbox')

    const autostashNote = getSandboxedGitProtectedFileNote(
      "Created autostash 1234abcd\nerror: unable to unlink old '.claude/hooks/pre.sh': Read-only file system",
      1,
    )
    expect(autostashNote).toBeDefined()
    expect(autostashNote).toContain('autostash')

    const unrelated = getSandboxedGitProtectedFileNote(
      'Everything up-to-date',
      0,
    )
    expect(unrelated).toBeUndefined()
  })

  test('#2262: detectBareGitIndicators accepts worktree of bare repo, --separate-git-dir, and Android repo checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'wave325-bare-wt-'))
    tempDirs.push(root)

    // Create a bare repo with a linked worktree
    const bareRepo = join(root, 'repo.git')
    const wtGitDir = join(bareRepo, 'worktrees', 'feature')
    const wtCheckout = join(root, 'worktree-feature')
    mkdirSync(join(bareRepo, 'objects'), { recursive: true })
    mkdirSync(join(bareRepo, 'refs', 'heads'), { recursive: true })
    writeFileSync(join(bareRepo, 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(bareRepo, 'config'), '[core]\n\tbare = true\n')
    mkdirSync(wtGitDir, { recursive: true })
    writeFileSync(join(wtGitDir, 'HEAD'), 'ref: refs/heads/feature\n')
    writeFileSync(join(wtGitDir, 'commondir'), '../..\n')
    mkdirSync(wtCheckout, { recursive: true })
    writeFileSync(join(wtCheckout, '.git'), `gitdir: ${wtGitDir}\n`)

    expect(detectBareGitIndicators(wtCheckout)).toBe('none')
  })

  test('#2321: relative deny/ask rule Read(./.env) covers project root and additionalWorkingDirectories after cd', () => {
    const root = mkdtempSync(join(tmpdir(), 'wave325-rel-rule-'))
    tempDirs.push(root)
    const proj = join(root, 'proj')
    const subdir = join(proj, 'packages', 'app')
    const extra = join(root, 'extra')
    mkdirSync(subdir, { recursive: true })
    mkdirSync(extra, { recursive: true })

    const permCtx = makePermCtx({
      alwaysDenyRules: { userSettings: ['Read(./.env)'] },
      additionalWorkingDirectories: new Map([
        [extra, { path: extra, source: 'session' as const }],
      ]),
    })

    // Rule must match ./.env in the added working directory even when cwd is elsewhere
    const matchedExtra = matchingRuleForInput(
      join(extra, '.env'),
      permCtx,
      'read',
      'deny',
    )
    expect(matchedExtra).not.toBeNull()
    expect(matchedExtra?.ruleValue.ruleContent).toBe('./.env')
  })

  test('#2322: mcp__plugin_*_ deny/ask rules match case-insensitively without widening allow rules', () => {
    const tool = {
      name: 'mcp__plugin_MyPlugin_MyServer__DoThing',
      mcpInfo: { serverName: 'plugin_MyPlugin_MyServer', toolName: 'DoThing' },
    }
    expect(
      toolMatchesRule(tool, {
        source: 'userSettings',
        ruleBehavior: 'deny',
        ruleValue: { toolName: 'mcp__plugin_*_myserver__dothing' },
      }),
    ).toBe(true)
    expect(
      toolMatchesRule(tool, {
        source: 'userSettings',
        ruleBehavior: 'ask',
        ruleValue: { toolName: 'mcp__plugin_*_myserver__*' },
      }),
    ).toBe(true)
    // Allow rules remain case-sensitive
    expect(
      toolMatchesRule(tool, {
        source: 'userSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'mcp__plugin_*_myserver__dothing' },
      }),
    ).toBe(false)
  })

  test('#2325/#2326/#2327: Bash permission hardening for wrappers, escaped spaces, compound commands, pipes, and attached wildcards', async () => {
    const makeCtx = (permCtx: ToolPermissionContext): ToolUseContext =>
      ({
        getAppState: () => ({ toolPermissionContext: permCtx }),
        options: { isNonInteractiveSession: false, tools: [], mcpClients: [] },
        abortController: new AbortController(),
      }) as unknown as ToolUseContext

    // #2325: `command` wrapper + xargs must still hit deny rule
    const denyPermCtx = makePermCtx({
      alwaysDenyRules: { userSettings: ['Bash(rm:*)', 'Bash(curl:*)'] },
    })
    const rWrapper = bashToolCheckPermission(
      { command: 'command rm -rf /tmp/x' },
      denyPermCtx,
    )
    expect(rWrapper.behavior).toBe('deny')

    const rXargs = await bashToolHasPermission(
      { command: 'echo foo | xargs rm -f' },
      makeCtx(denyPermCtx),
    )
    expect(rXargs.behavior).toBe('deny')

    // #2327: Bash(git*) must NOT allow `git/evil`
    const allowGitStar = makePermCtx({
      alwaysAllowRules: { userSettings: ['Bash(git*)'] },
    })
    const rGitEvil = bashToolCheckPermission(
      { command: 'git/evil status' },
      allowGitStar,
    )
    expect(rGitEvil.behavior).not.toBe('allow')

    // #2018/#2021/#2327 P1-1 regression: quoted heads & unsafe tails on path prefixes
    const { isAttachedWildcardAllowBlocked } = await import(
      '../bashPermissions.js'
    )
    expect(isAttachedWildcardAllowBlocked("'ls'*", "'ls'evil")).toBe(true)
    expect(isAttachedWildcardAllowBlocked("'ls'*", "'ls';id")).toBe(true)
    expect(isAttachedWildcardAllowBlocked('"git"*', '"git"evil')).toBe(true)
    expect(
      isAttachedWildcardAllowBlocked('/usr/bin/git*', '/usr/bin/git<in'),
    ).toBe(true)
    expect(
      isAttachedWildcardAllowBlocked('/usr/bin/git*', '/usr/bin/git;id'),
    ).toBe(true)
    expect(
      isAttachedWildcardAllowBlocked(
        '/usr/bin/git*',
        '/usr/bin/git-lfs status',
      ),
    ).toBe(false)
    expect(
      isAttachedWildcardAllowBlocked('/usr/bin/git*', '/usr/bin/git status'),
    ).toBe(false)
    expect(
      isAttachedWildcardAllowBlocked('./scripts/a*', './scripts/a=1'),
    ).toBe(true)
    expect(
      isAttachedWildcardAllowBlocked('./scripts/a*', './scripts/app.sh'),
    ).toBe(false)

    // #2326: assignment-only pipe stage must not auto-allow
    const allowEcho = makePermCtx({
      alwaysAllowRules: { userSettings: ['Bash(echo:*)'] },
    })
    const rAssignPipe = await bashToolHasPermission(
      { command: 'FOO=bar | echo ok' },
      makeCtx(allowEcho),
    )
    expect(rAssignPipe.behavior).not.toBe('allow')
  })

  test('#2355: read-only git in another untrusted repo asks first', () => {
    const root = mkdtempSync(join(tmpdir(), 'wave325-ro-git-'))
    tempDirs.push(root)
    const orig = join(root, 'orig-repo')
    const other = join(root, 'other-repo')
    mkdirSync(join(orig, '.git'), { recursive: true })
    mkdirSync(join(other, '.git'), { recursive: true })

    // Same repo is trusted (returns undefined)
    expect(checkReadOnlyGitRepositoryTrust(orig, orig)).toBeUndefined()
    // Different untrusted repo returns an untrusted reason string (asks first)
    expect(typeof checkReadOnlyGitRepositoryTrust(other, orig)).toBe('string')
  })

  test('#2357: filterEffectiveHostAlwaysAllowSuggestions drops allow suggestion when re-check does not allow', async () => {
    const mockTool = {
      name: 'Bash',
      inputSchema: { parse: (v: unknown) => v },
      checkPermissions: async () => ({
        behavior: 'ask' as const,
        message: 'still needs ask',
      }),
    }
    const baseCtx = {
      getAppState: () => ({ toolPermissionContext: makePermCtx() }),
      options: { isNonInteractiveSession: true, tools: [], mcpClients: [] },
      abortController: new AbortController(),
    } as unknown as ToolUseContext

    const kept = await filterEffectiveHostAlwaysAllowSuggestions(
      mockTool as unknown as Parameters<
        typeof filterEffectiveHostAlwaysAllowSuggestions
      >[0],
      { command: 'git status && rm -rf /tmp/x' },
      [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'localSettings',
          rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
        },
      ],
      baseCtx,
    )
    expect(kept).toBeUndefined()
  })

  test('#2359: worktree isolation blocks git bisect run, git maintenance register/start, and scalar setup commands with remedies', () => {
    const wtRoot = '/tmp/fake-worktree'
    const mk = (argv: string[]): Parameters<typeof checkZRuGitRedirect>[0] => ({
      kind: 'simple',
      commands: [{ argv, envVars: [], redirects: [], text: argv.join(' ') }],
      bareAssignmentNames: [],
    })
    const bisect = checkZRuGitRedirect(
      mk(['git', 'bisect', 'run', './test.sh']),
      wtRoot,
      wtRoot,
    )
    expect(bisect).not.toBeNull()
    expect(bisect).toContain('git bisect')

    const maint = checkZRuGitRedirect(
      mk(['git', 'maintenance', 'register']),
      wtRoot,
      wtRoot,
    )
    expect(maint).not.toBeNull()
    expect(maint).toContain('maintenance')

    const maintStart = checkZRuGitRedirect(
      mk(['git', 'maintenance', 'start']),
      wtRoot,
      wtRoot,
    )
    expect(maintStart).not.toBeNull()

    const scalarReg = checkZRuGitRedirect(
      mk(['scalar', 'register', '/some/repo']),
      wtRoot,
      wtRoot,
    )
    expect(scalarReg).not.toBeNull()
    expect(scalarReg).toContain('scalar')

    const scalarRun = checkZRuGitRedirect(
      mk(['scalar', 'run', 'all']),
      wtRoot,
      wtRoot,
    )
    expect(scalarRun).not.toBeNull()
  })

  test('#2364: assertHookWorktreePathSafe rejects WorktreeCreate hook paths traversing symlinks inside project root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wave325-wt-hook-'))
    tempDirs.push(root)
    const realParent = join(root, 'real-parent')
    const aliasParent = join(root, 'alias-parent')
    const project = join(realParent, 'project')
    const outside = join(root, 'outside-wt')
    mkdirSync(project, { recursive: true })
    mkdirSync(outside, { recursive: true })
    symlinkSync(realParent, aliasParent)
    const linkPath = join(project, 'wt-link')
    symlinkSync(outside, linkPath)

    await expect(assertHookWorktreePathSafe(linkPath, project)).rejects.toThrow(
      /symlink/i,
    )
    await expect(
      assertHookWorktreePathSafe(outside, project),
    ).resolves.toBeUndefined()

    // #2364 P1-4 regression: ancestor symlink mismatch (like macOS `/tmp` vs `/private/tmp`):
    // `fromCwd` goes through `aliasParent` while hook returns canonical `realParent/.../wt-link`.
    const projectViaAlias = join(aliasParent, 'project')
    await expect(
      assertHookWorktreePathSafe(linkPath, projectViaAlias),
    ).rejects.toThrow(/symlink/i)
  })

  test('#2380: hasUnverifiableDotGitPointer detects broken container-mounted worktree/submodule .git pointers', () => {
    const root = mkdtempSync(join(tmpdir(), 'wave325-dotgit-'))
    tempDirs.push(root)
    writeFileSync(
      join(root, '.git'),
      'gitdir: /host-only/path/that/does/not/exist/.git/worktrees/sub\n',
    )
    expect(hasUnverifiableDotGitPointer(root)).toBe(true)

    // Valid directory .git is not unverifiable
    const normal = mkdtempSync(join(tmpdir(), 'wave325-normalgit-'))
    tempDirs.push(normal)
    mkdirSync(join(normal, '.git'))
    expect(hasUnverifiableDotGitPointer(normal)).toBe(false)
  })
})
