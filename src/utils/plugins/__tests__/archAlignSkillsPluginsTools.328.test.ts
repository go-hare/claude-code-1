import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ArtifactTool } from '@claude-code/builtin-tools/tools/ArtifactTool/ArtifactTool.js'
import { AskUserQuestionTool } from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { ClaudeDesignTool } from '@claude-code/builtin-tools/tools/ClaudeDesignTool/ClaudeDesignTool.js'
import { PushNotificationTool } from '@claude-code/builtin-tools/tools/PushNotificationTool/PushNotificationTool.js'
import { isDeferredTool } from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import {
  evaluateSkillAllowRule,
  formatSkillAllowRuleHeldBackReason,
  isForkedSkillRecursiveInvocation,
  isSha256PinnedSkillRule,
  runWithActiveForkedSkill,
  SkillTool,
} from '@claude-code/builtin-tools/tools/SkillTool/SkillTool.js'
import {
  clearDynamicSkills,
  createSkillCommand,
  discoverSkillDirsForPaths,
  isConnectorDownloadsPath,
  isConnectorDownloadsSegment,
  parseSkillFrontmatterFields,
} from '../../../skills/loadSkillsDir.js'
import {
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import { getAllBaseTools } from '../../../tools.js'
import type { Command } from '../../../types/command.js'
import {
  mergeDisallowedToolsFromFrontmatter,
  parseFrontmatter,
} from '../../frontmatterParser.js'
import { parseSlashCommandToolsFromFrontmatter } from '../../markdownConfigLoader.js'
import {
  checkUppercaseCommitShaRefError,
  cloneMarketplaceAtCommit,
  gitPull,
  isCommitShaRef,
  isFullLowercaseCommitSha,
} from '../marketplaceManager.js'
import {
  loadSkillsAsPlugins,
  mergePluginSources,
  SKILLS_DIR_MARKETPLACE_NAME,
} from '../pluginLoader.js'
import {
  BLOCKED_OFFICIAL_NAME_PATTERN,
  isBlockedOfficialName,
  isMarketplaceAutoUpdate,
  MarketplaceSourceSchema,
  PluginManifestSchema,
} from '../schemas.js'

const tempDirs: string[] = []
async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

afterEach(async () => {
  clearDynamicSkills()
  if (originalEntrypoint === undefined) {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
  } else {
    process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

function makePromptCommand(
  overrides: Partial<Command & { type: 'prompt' }> & { name: string },
): Command & { type: 'prompt' } {
  return {
    type: 'prompt',
    description: 'test skill',
    progressMessage: 'running',
    contentLength: 10,
    source: 'userSettings',
    loadedFrom: 'skills',
    userFacingName: () => overrides.name,
    getPromptForCommand: async () => [{ type: 'text', text: 'body' }],
    ...overrides,
  } as Command & { type: 'prompt' }
}

function makeToolUseContext(overrides?: {
  mcpCommands?: Command[]
  allowRules?: string[]
  askRules?: string[]
  denyRules?: string[]
  spawnedBySkill?: string
  spawnedByForkedSkill?: boolean
}): ToolUseContext {
  const basePerm = getEmptyToolPermissionContext()
  const permContext = {
    ...basePerm,
    alwaysAllowRules: {
      ...basePerm.alwaysAllowRules,
      localSettings: overrides?.allowRules ?? [],
    },
    alwaysAskRules: {
      ...basePerm.alwaysAskRules,
      localSettings: overrides?.askRules ?? [],
    },
    alwaysDenyRules: {
      ...basePerm.alwaysDenyRules,
      localSettings: overrides?.denyRules ?? [],
    },
  }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      verbose: false,
      isNonInteractiveSession: false,
      ...(overrides?.spawnedBySkill !== undefined
        ? { spawnedBySkill: overrides.spawnedBySkill }
        : {}),
      ...(overrides?.spawnedByForkedSkill !== undefined
        ? { spawnedByForkedSkill: overrides.spawnedByForkedSkill }
        : {}),
    },
    ...(overrides?.spawnedBySkill !== undefined
      ? { spawnedBySkill: overrides.spawnedBySkill }
      : {}),
    ...(overrides?.spawnedByForkedSkill !== undefined
      ? { spawnedByForkedSkill: overrides.spawnedByForkedSkill }
      : {}),
    getAppState: () => ({
      toolPermissionContext: permContext,
      mcp: {
        commands: overrides?.mcpCommands ?? [],
        tools: [],
        clients: [],
        resources: {},
      },
    }),
  } as unknown as ToolUseContext
}

// ─── Group 1: SkillTool fork-recursion guard & permission boundaries ─────

describe('2.1.328 [P0-8] SkillTool fork-recursion guard & permission boundaries', () => {
  test('detects self-recursive and ancestor-recursive forked skill invocation', () => {
    const forkSkillA = makePromptCommand({
      name: 'deep-review',
      context: 'fork',
    })
    const forkSkillB = makePromptCommand({
      name: 'other-fork',
      context: 'fork',
    })
    const inlineSkillA = makePromptCommand({ name: 'deep-review' })
    const ctx = makeToolUseContext()

    expect(isForkedSkillRecursiveInvocation(forkSkillA, ctx)).toBe(false)

    runWithActiveForkedSkill('deep-review', () => {
      expect(isForkedSkillRecursiveInvocation(forkSkillA, ctx)).toBe(true)
      expect(isForkedSkillRecursiveInvocation(forkSkillB, ctx)).toBe(false)
      expect(isForkedSkillRecursiveInvocation(inlineSkillA, ctx)).toBe(false)

      // Nested ancestor stack: deep-review -> other-fork -> deep-review is still blocked
      runWithActiveForkedSkill('other-fork', () => {
        expect(isForkedSkillRecursiveInvocation(forkSkillA, ctx)).toBe(true)
        expect(isForkedSkillRecursiveInvocation(forkSkillB, ctx)).toBe(true)
      })
    })
  })

  test('validateInput blocks recursive forked skill with errorCode: 9', async () => {
    const mcpForkSkill = makePromptCommand({
      name: 'recursive-fork-skill',
      context: 'fork',
      loadedFrom: 'mcp',
    })
    const ctx = makeToolUseContext({
      mcpCommands: [mcpForkSkill],
      spawnedBySkill: 'recursive-fork-skill',
      spawnedByForkedSkill: true,
    })

    const res = await SkillTool.validateInput!(
      { skill: 'recursive-fork-skill' },
      ctx,
    )
    expect(res.result).toBe(false)
    if (!res.result) {
      expect(res.errorCode).toBe(9)
      expect(res.message).toContain('already executing in this forked context')
      expect(res.message).toContain('Skill')
    }
  })

  test('evaluateSkillAllowRule enforces held-back-nonholder & held-back-boundary', () => {
    const pluginNonholder = makePromptCommand({
      name: 'anthropic-skills:pdf',
      source: 'plugin',
      loadedFrom: 'plugin',
      allowedTools: ['Bash'],
      pluginInfo: {
        pluginManifest: { name: 'rogue-plugin' },
        repository: 'rogue-plugin@third-party',
      },
    })
    const syncedHolder = makePromptCommand({
      name: 'anthropic-skills:pdf',
      source: 'userSettings',
      loadedFrom: 'syncedSkills',
      allowedTools: ['Bash'],
    })
    const boundarySpoof = makePromptCommand({
      name: 'anthropic-skills-evil',
      source: 'userSettings',
      loadedFrom: 'skills',
      allowedTools: ['Bash'],
    })

    // Wildcard rule on reserved namespace covers synced holder only
    expect(
      evaluateSkillAllowRule(
        'anthropic-skills:*',
        'anthropic-skills:pdf',
        syncedHolder,
      ),
    ).toBe('allow')
    expect(
      evaluateSkillAllowRule(
        'anthropic-skills:*',
        'anthropic-skills:pdf',
        pluginNonholder,
      ),
    ).toBe('held-back-nonholder')

    // Missing colon crosses namespace boundary -> held-back-boundary
    expect(
      evaluateSkillAllowRule(
        'anthropic-skills:*',
        'anthropic-skills-evil',
        boundarySpoof,
      ),
    ).toBe('held-back-boundary')

    // Broad non-reserved prefix cannot cross into reserved anthropic-skills:*
    expect(
      evaluateSkillAllowRule(
        'anthropic:*',
        'anthropic-skills:pdf',
        syncedHolder,
      ),
    ).toBe('held-back-boundary')

    // Formatted reason explains nonholder plugin provenance
    const reason = formatSkillAllowRuleHeldBackReason(
      'anthropic-skills:*',
      'anthropic-skills:pdf',
      { kind: 'nonholder', pluginName: 'rogue-plugin' },
    )
    expect(reason).toContain(
      'only covers skills synced from your claude.ai account',
    )
    expect(reason).toContain('rogue-plugin')
  })

  test('SkillTool.checkPermissions sets suppressAlwaysAllowRule for nonholder reserved-namespace and sha256 rules', async () => {
    const sha64 = 'a'.repeat(64)
    expect(isSha256PinnedSkillRule(`my-skill@sha256:${sha64}`)).toBe(true)
    expect(isSha256PinnedSkillRule('my-skill')).toBe(false)

    const ctx = makeToolUseContext({
      allowRules: [`Skill(anthropic-skills:*)`],
    })
    const nonholderDecision = await SkillTool.checkPermissions!(
      { skill: 'anthropic-skills:spoof' },
      ctx,
    )
    expect(nonholderDecision.behavior).toBe('ask')
    if (nonholderDecision.behavior === 'ask') {
      expect(nonholderDecision.suppressAlwaysAllowRule).toBe(true)
      expect(nonholderDecision.suggestions).toBeUndefined()
      expect(nonholderDecision.message).toContain(
        'synced from your claude.ai account',
      )
    }

    const shaCtx = makeToolUseContext({
      allowRules: [`Skill(pinned-skill@sha256:${sha64})`],
    })
    const shaDecision = await SkillTool.checkPermissions!(
      { skill: `pinned-skill@sha256:${sha64}` },
      shaCtx,
    )
    expect(shaDecision.behavior).toBe('ask')
    if (shaDecision.behavior === 'ask') {
      expect(shaDecision.suppressAlwaysAllowRule).toBe(true)
      expect(shaDecision.suggestions).toBeUndefined()
    }
  })
})

// ─── Group 2: Plugin & Marketplace Schemas ───────────────────────────────

describe('2.1.328 [P0-9/P0-10/P1-9/P2] Plugin & Marketplace Schemas', () => {
  test('[P0-9] MarketplaceSourceSchema accepts { source: "skills-dir" } with optional path', () => {
    const bare = MarketplaceSourceSchema().safeParse({ source: 'skills-dir' })
    expect(bare.success).toBe(true)
    if (bare.success) {
      expect(bare.data.source).toBe('skills-dir')
    }

    const withPath = MarketplaceSourceSchema().safeParse({
      source: 'skills-dir',
      path: '/custom/skills',
    })
    expect(withPath.success).toBe(true)
    if (withPath.success && withPath.data.source === 'skills-dir') {
      expect(withPath.data.path).toBe('/custom/skills')
    }
  })

  test('[P0-10] PluginManifestSchema preserves $schema, displayName, metadata, network, themes, workflows, types, binaries, experimental', () => {
    const sha256 = '0123456789abcdef'.repeat(4)
    const parsed = PluginManifestSchema().parse({
      $schema: 'https://claude.ai/schemas/plugin.json',
      name: 'full-featured-plugin',
      displayName: 'Full Featured Plugin',
      metadata: { entitlement: 'enterprise', catalogId: 42 },
      network: { hosts: ['api.example.com', '*.internal.corp:8443'] },
      themes: './themes/dark.json',
      workflows: ['./workflows/deploy.js'],
      types: './types/contract.d.ts',
      binaries: {
        'my-tool-aarch64-apple-darwin': { sha256 },
        '../bad-traversal': { sha256 },
      },
      experimental: {
        themes: './exp-themes',
        outputStyles: './exp-styles',
        workflows: './exp-workflows',
        evals: './evals',
        futureExperimentalFlag: true,
      },
    })

    expect(parsed.$schema).toBe('https://claude.ai/schemas/plugin.json')
    expect(parsed.displayName).toBe('Full Featured Plugin')
    expect(parsed.metadata).toEqual({
      entitlement: 'enterprise',
      catalogId: 42,
    })
    expect(parsed.network).toEqual({
      hosts: ['api.example.com', '*.internal.corp:8443'],
    })
    expect(parsed.themes).toBe('./themes/dark.json')
    expect(parsed.workflows).toEqual(['./workflows/deploy.js'])
    expect(parsed.types).toBe('./types/contract.d.ts')
    expect(parsed.binaries).toEqual({
      'my-tool-aarch64-apple-darwin': { sha256 },
    })
    expect(parsed.experimental).toMatchObject({
      themes: './exp-themes',
      outputStyles: './exp-styles',
      workflows: './exp-workflows',
      evals: './evals',
      futureExperimentalFlag: true,
    })

    // types rejects non-.d.ts or path traversal
    expect(
      PluginManifestSchema().safeParse({
        name: 'bad-types',
        types: './types/index.ts',
      }).success,
    ).toBe(false)
    expect(
      PluginManifestSchema().safeParse({
        name: 'bad-types-trav',
        types: './../escape.d.ts',
      }).success,
    ).toBe(false)
  })

  test('[P1-9] npm marketplace source accepts version & http(s) registry; autoUpdate defaults match 2.1.328', () => {
    const npmValid = MarketplaceSourceSchema().safeParse({
      source: 'npm',
      package: '@acme/claude-marketplace',
      version: '^1.4.0',
      registry: 'https://npm.acme.internal',
    })
    expect(npmValid.success).toBe(true)
    if (npmValid.success && npmValid.data.source === 'npm') {
      expect(npmValid.data.version).toBe('^1.4.0')
      expect(npmValid.data.registry).toBe('https://npm.acme.internal')
    }

    const npmWildcard = MarketplaceSourceSchema().safeParse({
      source: 'npm',
      package: '@acme/*',
    })
    expect(npmWildcard.success).toBe(true)

    const npmBadRegistry = MarketplaceSourceSchema().safeParse({
      source: 'npm',
      package: '@acme/claude-marketplace',
      registry: 'ftp://npm.acme.internal',
    })
    expect(npmBadRegistry.success).toBe(false)

    // first-party-plugins opted out of default auto-update
    expect(isMarketplaceAutoUpdate('first-party-plugins', {})).toBe(false)
    expect(isMarketplaceAutoUpdate('knowledge-work-plugins', {})).toBe(false)
    expect(isMarketplaceAutoUpdate('claude-plugins-official', {})).toBe(true)

    // claudeai and pluginDirectory default to autoUpdate: true
    expect(
      isMarketplaceAutoUpdate('custom-synced', {
        source: { source: 'claudeai' },
      }),
    ).toBe(true)
    expect(
      isMarketplaceAutoUpdate('custom-dir', {
        source: { source: 'pluginDirectory' },
      }),
    ).toBe(true)
    expect(
      isMarketplaceAutoUpdate('custom-dir', {
        autoUpdate: false,
        source: { source: 'pluginDirectory' },
      }),
    ).toBe(false)
  })

  test('[P2] BLOCKED_OFFICIAL_NAME_PATTERN blocks directory/directories impersonations', () => {
    expect(BLOCKED_OFFICIAL_NAME_PATTERN.test('claude-directory')).toBe(true)
    expect(BLOCKED_OFFICIAL_NAME_PATTERN.test('anthropic-directories')).toBe(
      true,
    )
    expect(isBlockedOfficialName('claude-directory')).toBe(true)
    expect(isBlockedOfficialName('anthropic-directories-v2')).toBe(true)
    expect(isBlockedOfficialName('my-team-directory')).toBe(false)
  })
})

// ─── Group 3: Marketplace commit-SHA pinning & @skills-dir plugin loader ─

describe('2.1.328 [P1-9] Marketplace SHA pinning & @skills-dir plugin loader', () => {
  test('SHA detection handles 40-char and 64-char SHAs and rejects uppercase SHAs', () => {
    const sha40 = 'a'.repeat(40)
    const sha64 = 'b'.repeat(64)
    const upperSha40 = 'A'.repeat(40)

    expect(isCommitShaRef(sha40)).toBe(true)
    expect(isCommitShaRef(sha64)).toBe(true)
    expect(isCommitShaRef(upperSha40)).toBe(true)
    expect(isCommitShaRef('main')).toBe(false)
    expect(isCommitShaRef('a'.repeat(39))).toBe(false)

    expect(isFullLowercaseCommitSha(sha40)).toBe(true)
    expect(isFullLowercaseCommitSha(sha64)).toBe(true)
    expect(isFullLowercaseCommitSha(upperSha40)).toBe(false)

    expect(checkUppercaseCommitShaRefError(upperSha40)).toContain(
      'looks like a commit id with capital letters',
    )
    expect(checkUppercaseCommitShaRefError(sha40)).toBeUndefined()
  })

  test('cloneMarketplaceAtCommit checks out exact commit and gitPull preserves SHA pin', async () => {
    const originRepo = await makeTempDir('mkt-origin-')
    const cloneDest = join(await makeTempDir('mkt-clone-'), 'checkout')

    const runGit = (args: string[], cwd: string) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf-8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
      }).trim()

    runGit(['init', '-b', 'main'], originRepo)
    await mkdir(join(originRepo, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(originRepo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'pinned-mkt',
        owner: { name: 'Test' },
        plugins: [],
        metadata: { version: '1.0.0' },
      }),
    )
    runGit(['add', '.'], originRepo)
    runGit(['commit', '-m', 'first commit'], originRepo)
    const sha1 = runGit(['rev-parse', 'HEAD'], originRepo)

    await writeFile(
      join(originRepo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'pinned-mkt',
        owner: { name: 'Test' },
        plugins: [],
        metadata: { version: '2.0.0' },
      }),
    )
    runGit(['add', '.'], originRepo)
    runGit(['commit', '-m', 'second commit'], originRepo)
    const sha2 = runGit(['rev-parse', 'HEAD'], originRepo)
    expect(sha1).not.toBe(sha2)

    // Clone at sha1 even though origin HEAD is at sha2
    await cloneMarketplaceAtCommit(
      { source: 'git', url: originRepo, ref: 'main' },
      sha1,
      cloneDest,
    )
    expect(runGit(['rev-parse', 'HEAD'], cloneDest)).toBe(sha1)

    // Refresh via gitPull with pinned sha1 preserves sha1 and does not advance to sha2
    const pullRes = await gitPull(cloneDest, sha1)
    expect(pullRes.code).toBe(0)
    expect(runGit(['rev-parse', 'HEAD'], cloneDest)).toBe(sha1)

    // Mismatched source SHA pin is rejected
    await expect(
      cloneMarketplaceAtCommit(
        { source: 'git', url: originRepo, ref: sha2 },
        sha1,
        join(await makeTempDir('mkt-mismatch-'), 'checkout'),
      ),
    ).rejects.toThrow('its source is pinned at another commit')

    // Non-git source is rejected
    await expect(
      cloneMarketplaceAtCommit(
        { source: 'directory', path: originRepo },
        sha1,
        join(await makeTempDir('mkt-nongit-'), 'checkout'),
      ),
    ).rejects.toThrow('its marketplace is no git repository')
  })

  test('loadSkillsAsPlugins loads @skills-dir plugins, skips plain/hidden dirs, strips project monitors, and merges cleanly', async () => {
    const userSkillsDir = await makeTempDir('user-skills-')
    const projectSkillsDir = await makeTempDir('project-skills-')

    // 1. Valid user plugin folder with .claude-plugin/plugin.json
    const userPluginDir = join(userSkillsDir, 'alpha-tool')
    await mkdir(join(userPluginDir, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(userPluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'alpha-tool', description: 'User skill plugin' }),
    )

    // 2. Plain skill folder (SKILL.md only, no .claude-plugin) -> ignored
    const plainSkillDir = join(userSkillsDir, 'plain-skill')
    await mkdir(plainSkillDir, { recursive: true })
    await writeFile(join(plainSkillDir, 'SKILL.md'), '# Plain skill')

    // 3. Hidden dot-prefixed dir -> ignored even if it has .claude-plugin
    const hiddenDir = join(userSkillsDir, '.hidden-plugin')
    await mkdir(join(hiddenDir, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(hiddenDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'hidden-plugin' }),
    )

    // 4. Duplicate plugin name in project scope -> shadowed by user scope
    const dupProjectDir = join(projectSkillsDir, 'alpha-tool')
    await mkdir(join(dupProjectDir, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(dupProjectDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'alpha-tool' }),
    )

    // 5. Unique project plugin with a monitor -> monitor stripped with warning
    const projPluginDir = join(projectSkillsDir, 'beta-tool')
    await mkdir(join(projPluginDir, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(projPluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'beta-tool',
        monitors: [
          {
            name: 'watch-bg',
            command: 'echo hi',
            description: 'Watch background',
          },
        ],
      }),
    )

    const result = await loadSkillsAsPlugins({
      skillsDirs: [
        { dir: userSkillsDir, scope: 'user' },
        { dir: projectSkillsDir, scope: 'project' },
      ],
      enabledPlugins: { 'beta-tool@skills-dir': false },
      skipPolicyCheck: true,
    })

    expect(result.plugins.map(p => p.source).sort()).toEqual([
      `alpha-tool@${SKILLS_DIR_MARKETPLACE_NAME}`,
      `beta-tool@${SKILLS_DIR_MARKETPLACE_NAME}`,
    ])
    const alpha = result.plugins.find(p => p.name === 'alpha-tool')!
    const beta = result.plugins.find(p => p.name === 'beta-tool')!
    expect(alpha.enabled).toBe(true)
    expect(alpha.scope).toBe('user')
    expect(beta.enabled).toBe(false)
    expect(beta.scope).toBe('project')
    expect(beta.monitors).toEqual([])
    expect(
      result.warnings.some(w => w.type === 'project-scope-server-stripped'),
    ).toBe(true)
    expect(
      result.errors.some(
        e => e.type === 'generic-error' && e.error.includes('shadowed'),
      ),
    ).toBe(true)

    // mergePluginSources honors managedNames lock for skillsDir plugins
    const merged = mergePluginSources({
      session: [],
      marketplace: [],
      skillsDir: [alpha, beta],
      builtin: [],
      managedNames: new Set(['alpha-tool']),
    })
    expect(merged.plugins.map(p => p.name)).toEqual(['beta-tool'])
    expect(
      merged.errors.some(
        e =>
          e.type === 'generic-error' &&
          e.error.includes('locked by managed settings'),
      ),
    ).toBe(true)
  })
})

// ─── Group 4: Frontmatter disallowedTools, metadata & connector-downloads ─

describe('2.1.328 [P1-8] Frontmatter camelCase disallowedTools, metadata & connector-downloads skip', () => {
  test('parses and merges camelCase disallowedTools + kebab-case disallowed-tools, preserving fallback, displayName & metadata', () => {
    const md = `---
displayName: Code Review Helper
description: Helps review pull requests
disallowed-tools: Bash, Write
disallowedTools:
  - Edit
  - Bash
fallback: true
metadata:
  owner: platform-team
  tier: 2
---
Review the diff carefully.
`
    const { frontmatter, content } = parseFrontmatter(md)
    expect(frontmatter.disallowedTools).toEqual(['Edit', 'Bash'])
    expect(frontmatter.displayName).toBe('Code Review Helper')
    expect(frontmatter.fallback).toBe(true)
    expect(frontmatter.metadata).toEqual({ owner: 'platform-team', tier: 2 })

    const mergedRaw = mergeDisallowedToolsFromFrontmatter(
      frontmatter,
      parseSlashCommandToolsFromFrontmatter,
    )
    expect(mergedRaw).toEqual(['Bash', 'Write', 'Edit'])

    const fields = parseSkillFrontmatterFields(frontmatter, content, 'review')
    expect(fields.disallowedTools).toEqual(['Bash', 'Write', 'Edit'])
    expect(fields.displayName).toBe('Code Review Helper')
    expect(fields.fallback).toBe(true)
    expect(fields.metadata).toEqual({ owner: 'platform-team', tier: 2 })

    const cmd = createSkillCommand({
      ...fields,
      skillName: 'review',
      markdownContent: content,
      source: 'userSettings',
      baseDir: '/tmp/skills/review',
      loadedFrom: 'skills',
      paths: undefined,
    })
    expect(cmd.type).toBe('prompt')
    if (cmd.type === 'prompt') {
      expect(cmd.disallowedTools).toEqual(['Bash', 'Write', 'Edit'])
      expect(cmd.userFacingName?.()).toBe('Code Review Helper')
      expect((cmd as Command & { fallback?: boolean }).fallback).toBe(true)
      expect(
        (cmd as Command & { metadata?: Record<string, unknown> }).metadata,
      ).toEqual({ owner: 'platform-team', tier: 2 })
    }
  })

  test('supports camelCase disallowedTools alone without kebab-case', () => {
    const md = `---
description: Read-only helper
disallowedTools: Bash, Edit
---
Only read files.
`
    const { frontmatter, content } = parseFrontmatter(md)
    const fields = parseSkillFrontmatterFields(frontmatter, content, 'ro')
    expect(fields.disallowedTools).toEqual(['Bash', 'Edit'])
  })

  test('isConnectorDownloadsPath skips connector-downloads directories and symlinks pointing into them', async () => {
    expect(isConnectorDownloadsSegment('connector-downloads')).toBe(true)
    expect(isConnectorDownloadsSegment('Connector-Downloads')).toBe(true)
    expect(isConnectorDownloadsSegment('connector-download\u017F')).toBe(true)
    expect(isConnectorDownloadsSegment('downloads')).toBe(false)

    const root = await makeTempDir('conn-dl-root-')
    const connectorDir = join(root, 'connector-downloads')
    const nestedSkillDir = join(connectorDir, 'sub', '.claude', 'skills', 'bad')
    await mkdir(nestedSkillDir, { recursive: true })
    await writeFile(join(nestedSkillDir, 'SKILL.md'), '# Untrusted')

    expect(await isConnectorDownloadsPath(connectorDir)).toBe(true)
    expect(await isConnectorDownloadsPath(nestedSkillDir)).toBe(true)

    // Symlink pointing into connector-downloads is also caught via realpath
    const linkDir = join(root, 'innocent-link')
    await symlink(connectorDir, linkDir)
    expect(await isConnectorDownloadsPath(linkDir)).toBe(true)

    // discoverSkillDirsForPaths skips files under connector-downloads
    const discovered = await discoverSkillDirsForPaths(
      [join(connectorDir, 'sub', 'file.txt')],
      root,
    )
    expect(discovered).toEqual([])
  })
})

// ─── Group 5: Tool shouldDefer policy & retired tools ────────────────────

describe('2.1.328 [P1-6] Tool shouldDefer parity & retired base tools', () => {
  test('AskUserQuestion, Artifact, and ClaudeDesign are not deferred; PushNotification is deferred except on remote_trigger', () => {
    expect(AskUserQuestionTool.shouldDefer).toBe(false)
    expect(isDeferredTool(AskUserQuestionTool)).toBe(false)

    expect(ArtifactTool.shouldDefer).toBe(false)
    expect(isDeferredTool(ArtifactTool)).toBe(false)

    expect(ClaudeDesignTool.shouldDefer).toBe(false)
    expect(isDeferredTool(ClaudeDesignTool)).toBe(false)

    expect(PushNotificationTool.shouldDefer).toBe(true)
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    expect(isDeferredTool(PushNotificationTool)).toBe(true)

    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_trigger'
    expect(isDeferredTool(PushNotificationTool)).toBe(false)
  })

  test('SendUserFile hard deferral exemption is removed; StructuredOutput never defers', () => {
    const fakeSendUserFile = {
      name: 'SendUserFile',
      shouldDefer: true,
    } as never
    expect(isDeferredTool(fakeSendUserFile)).toBe(true)

    const fakeStructuredOutput = {
      name: 'StructuredOutput',
      shouldDefer: true,
    } as never
    expect(isDeferredTool(fakeStructuredOutput)).toBe(false)
  })

  test('getAllBaseTools retires ConfigTool, TeamCreateTool, and TeamDeleteTool', () => {
    const names = new Set(getAllBaseTools().map(t => t.name))
    expect(names.has('Config')).toBe(false)
    expect(names.has('TeamCreate')).toBe(false)
    expect(names.has('TeamDelete')).toBe(false)
  })
})
