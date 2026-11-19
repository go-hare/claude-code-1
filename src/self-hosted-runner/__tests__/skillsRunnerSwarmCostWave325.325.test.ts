import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hasBriefRepliedInTurn,
  markBriefRepliedInTurn,
  shouldSuppressDuplicateBriefReply,
} from '../../../packages/builtin-tools/src/tools/BriefTool/BriefTool.js'
import {
  isScheduledOrLoopSkillExecution,
  skillDeclaresAllowedToolsOrHooks,
} from '../../../packages/builtin-tools/src/tools/SkillTool/SkillTool.js'
import {
  getInlinePlugins,
  getOriginalCwd,
  setCwdState,
  setInlinePlugins,
} from '../../bootstrap/state.js'
import { getTotalCost, recordModModelUsage } from '../../cost-tracker.js'
import { getPluginOwnedPrefixes } from '../../skills/loadSkillsDir.js'
import {
  assertRunnerPathNotSymlink,
  expandSessionSubpaths,
  isRunnerPathSymlinkOrNonDir,
  resolveChildCwdAndAddDirs,
} from '../sessionSeed.js'

describe('Wave 325 Group 3 — Skills / Brief / Runner / Swarm / Cost', () => {
  const tempDirs: string[] = []
  const prevInlinePlugins = getInlinePlugins()

  afterEach(() => {
    setInlinePlugins(prevInlinePlugins)
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#2300 suppresses duplicate same-turn brief replies per AbortSignal', () => {
    const ac1 = new AbortController()
    const ac2 = new AbortController()

    expect(hasBriefRepliedInTurn(ac1.signal)).toBe(false)
    expect(shouldSuppressDuplicateBriefReply('normal', ac1.signal)).toBe(false)

    markBriefRepliedInTurn(ac1.signal)
    expect(hasBriefRepliedInTurn(ac1.signal)).toBe(true)
    expect(shouldSuppressDuplicateBriefReply('normal', ac1.signal)).toBe(true)
    // Proactive status is never suppressed
    expect(shouldSuppressDuplicateBriefReply('proactive', ac1.signal)).toBe(
      false,
    )

    // New turn (distinct signal) is not suppressed
    expect(shouldSuppressDuplicateBriefReply('normal', ac2.signal)).toBe(false)
  })

  test('#2311 multi-repo runner includes sessionRoot in addDirs for dynamically added repos', () => {
    const sessionRoot = '/tmp/runner-session-root'
    const repoA = '/var/repos/repo-a'
    const repoB = '/var/repos/repo-b'
    const resolved = resolveChildCwdAndAddDirs(sessionRoot, [repoA, repoB])
    expect(resolved.childCwd).toBe(repoA)
    expect(resolved.addDirs).toEqual([repoA, repoB, sessionRoot])

    // When all repos are already under sessionRoot, childCwd is sessionRoot
    const underRoot = resolveChildCwdAndAddDirs(sessionRoot, [
      `${sessionRoot}/repo-a`,
      `${sessionRoot}/repo-b`,
    ])
    expect(underRoot.childCwd).toBe(sessionRoot)
    expect(underRoot.addDirs).toEqual([
      `${sessionRoot}/repo-a`,
      `${sessionRoot}/repo-b`,
    ])
  })

  test('#2352 dataviz choosing-a-form.md includes static-image part-to-whole guidance', () => {
    const md = readFileSync(
      join(
        process.cwd(),
        'src/skills/bundled/datavizContent/references/choosing-a-form.md',
      ),
      'utf8',
    )
    expect(md).toContain('static image')
    expect(md).toContain('no hover')
    expect(md).toContain('age bands')
  })

  test('#2356 detects skills declaring allowed-tools/hooks and scheduled/loop executions', () => {
    expect(
      skillDeclaresAllowedToolsOrHooks({
        allowedTools: ['Bash(ls:*)'],
      }),
    ).toBe(true)
    expect(
      skillDeclaresAllowedToolsOrHooks({
        hooks: { PreToolUse: [{ hooks: [] }] },
      }),
    ).toBe(true)
    expect(
      skillDeclaresAllowedToolsOrHooks({
        allowedTools: [],
      }),
    ).toBe(false)

    expect(
      isScheduledOrLoopSkillExecution({
        options: { isScheduledTask: true },
      } as never),
    ).toBe(true)
    expect(
      isScheduledOrLoopSkillExecution({
        options: { querySource: 'cron_loop' },
      } as never),
    ).toBe(true)
    expect(
      isScheduledOrLoopSkillExecution({
        options: {},
      } as never),
    ).toBe(false)
  })

  test('#2363 nested skill discovery excludes --plugin-dir owned paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-dir-325-'))
    tempDirs.push(dir)
    setInlinePlugins([dir])

    const prefixes = await getPluginOwnedPrefixes()
    const folded = dir.toLowerCase()
    expect(prefixes.some(p => p.toLowerCase().startsWith(folded))).toBe(true)
  })

  test('#2365 sessionTeam and PaneBackendExecutor use getOriginalCwd() instead of drifted shell cwd', () => {
    const orig = getOriginalCwd()
    setCwdState('/tmp')
    const sessionTeamSrc = readFileSync(
      join(process.cwd(), 'src/utils/swarm/sessionTeam.ts'),
      'utf8',
    )
    const paneSrc = readFileSync(
      join(process.cwd(), 'src/utils/swarm/backends/PaneBackendExecutor.ts'),
      'utf8',
    )
    const leftArrowSrc = readFileSync(
      join(process.cwd(), 'src/cli/bg/leftArrowAgents.ts'),
      'utf8',
    )
    expect(sessionTeamSrc).toContain('getOriginalCwd()')
    expect(paneSrc).toContain('getOriginalCwd()')
    expect(leftArrowSrc).toContain('getOriginalCwd()')
    setCwdState(orig)
  })

  test('#2370 recordModModelUsage counts mod $.model.complete/classify usage in total cost', () => {
    const before = getTotalCost()
    const cost = recordModModelUsage('claude-haiku-4-5-20251001', {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })
    expect(cost).toBeGreaterThan(0)
    expect(getTotalCost()).toBeCloseTo(before + cost, 10)
  })

  test('#2381 runner rejects symlinked sessionDir or repo paths', async () => {
    const base = mkdtempSync(join(tmpdir(), 'runner-symlink-325-'))
    tempDirs.push(base)
    const realDir = join(base, 'real-dir')
    mkdirSync(realDir, { recursive: true })
    const linkDir = join(base, 'link-dir')
    symlinkSync(realDir, linkDir)

    expect(expandSessionSubpaths(base, join(base, 'a/b'))).toEqual([
      join(base, 'a'),
      join(base, 'a/b'),
    ])
    expect(await isRunnerPathSymlinkOrNonDir(realDir)).toBe(false)
    expect(await isRunnerPathSymlinkOrNonDir(linkDir)).toBe(true)

    await expect(
      assertRunnerPathNotSymlink(realDir, 'session folder'),
    ).resolves.toBeUndefined()
    await expect(
      assertRunnerPathNotSymlink(linkDir, 'session folder'),
    ).rejects.toThrow(/symbolic link/)
  })
})
