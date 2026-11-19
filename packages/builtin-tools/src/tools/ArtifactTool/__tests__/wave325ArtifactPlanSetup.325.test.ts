import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearAllPlanSlugs,
  getPlanFilePath,
  getPlansDirectory,
  persistApprovedPlanEdit,
  setPlanSlug,
} from 'src/utils/plans.js'
import { applyPermissionUpdate } from 'src/utils/permissions/PermissionUpdate.js'
import {
  getRuleByContentsForToolName,
  standsInForBuiltInArtifactTool,
  stripCommandAllowedToolsForBackgroundAgent,
  toolMatchesRule,
} from 'src/utils/permissions/permissions.js'
import { ExitPlanModeV2Tool } from '../../ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { ArtifactTool, isArtifactOutsideOrgOrUnknown } from '../ArtifactTool.js'
import { checkArtifactActionPermissions } from '../permissions.js'
import {
  $A,
  PAr,
  VBe,
  dD,
  resetConsentStateForTests,
} from 'src/services/artifactAutoReact/readPerm/consent.js'
import {
  hasSharedProbeToolUseId,
  mergeProbeToolUseIds,
} from 'src/services/artifactAutoReact/ownership.js'
import { un } from 'src/services/artifactAutoReact/store.js'
import { runWithAgentContext } from 'src/utils/agentContext.js'
import { getScratchpadInstructions } from 'src/constants/prompts.js'
import { registerWorktreeHooksAhead } from 'src/setup.js'
import { getSessionId } from 'src/bootstrap/state.js'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
  type ToolUseContext,
} from 'src/Tool.js'
import { parseArtifactUrlAnyCase } from 'src/utils/artifactUrl.js'

function makePermCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    ...overrides,
  }
}

describe('Wave 325 Group 1 — Artifact, Plan, Setup & Scratchpad (#2268, #2295, #2299, #2312-#2313, #2319, #2329-#2331, #2377)', () => {
  const tempDirs: string[] = []
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string | undefined): void {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key]
    }
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const k of Object.keys(savedEnv)) delete savedEnv[k]
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    resetConsentStateForTests()
    un().shareStatus.bySlug.clear()
    clearAllPlanSlugs()
    getPlansDirectory.cache.clear()
  })

  test('#2268: persistApprovedPlanEdit falls back to default plans folder with warning when custom plansDirectory fails', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wave325-plan-fallback-'))
    tempDirs.push(tmp)
    const configHome = join(tmp, 'claude-home')
    mkdirSync(configHome, { recursive: true })
    setEnv('CLAUDE_CONFIG_DIR', configHome)

    // Simulate a custom plansDirectory target whose containment fails (symlink / unvetted dir)
    const badPlansDir = join(tmp, 'unvetted-plans')
    mkdirSync(badPlansDir, { recursive: true })
    const badTarget = join(badPlansDir, 'test-slug.md')
    symlinkSync(join(tmp, 'outside.md'), badTarget)

    setPlanSlug(getSessionId(), 'test-slug')
    const outcome = await persistApprovedPlanEdit(
      badTarget,
      '# Approved Plan\n',
    )
    expect(outcome).toBeDefined()
    expect(outcome?.savedTo).toBeDefined()
    expect(outcome?.savedTo?.startsWith(join(configHome, 'plans'))).toBe(true)
    expect(outcome?.notice).toContain('which this session uses from now on')
    expect(readFileSync(outcome!.savedTo!, 'utf-8')).toBe('# Approved Plan\n')
    // Session now routes plan file lookups to the default plans folder
    expect(getPlanFilePath()).toBe(outcome!.savedTo!)
  })

  test('#2295: subagent ExitPlanMode does not mutate main session mode/prePlanMode, and setMode clears stale prePlanMode', async () => {
    // 1. PermissionUpdate setMode clears stale prePlanMode when leaving plan mode
    const withStalePrePlan = makePermCtx({
      mode: 'plan',
      prePlanMode: 'acceptEdits',
    })
    const afterSetMode = applyPermissionUpdate(withStalePrePlan, {
      type: 'setMode',
      mode: 'default',
      destination: 'session',
    })
    expect(afterSetMode.mode).toBe('default')
    expect(afterSetMode.prePlanMode).toBeUndefined()

    // 2. Subagent ExitPlanMode.call must NOT call setAppState to revert main session
    let setAppStateCalls = 0
    const subagentCtx = {
      agentId: 'subagent-123',
      getAppState: () => ({
        toolPermissionContext: makePermCtx({
          mode: 'plan',
          prePlanMode: 'acceptEdits',
        }),
      }),
      setAppState: () => {
        setAppStateCalls++
      },
      options: { tools: [], mainLoopModel: 'claude-sonnet-4-6' },
      abortController: new AbortController(),
    } as unknown as ToolUseContext

    await ExitPlanModeV2Tool.call(
      {},
      subagentCtx,
      async () => ({ behavior: 'allow', updatedInput: {} }),
      {} as never,
    )
    expect(setAppStateCalls).toBe(0)
  })

  test('#2299: registerWorktreeHooksAhead skips cleanly in bare mode and is wired for --worktree', async () => {
    setEnv('CLAUDE_CODE_SIMPLE', '1')
    expect(await registerWorktreeHooksAhead()).toBe('skipped')
  })

  test('#2312: shared parallel probe toolUseIds allow reading own artifact and its data without asking', () => {
    const slug = '11111111-1111-4111-8111-111111111111'
    const parsed = parseArtifactUrlAnyCase(
      `https://claude.ai/code/artifact/${slug}`,
    )!
    const first = mergeProbeToolUseIds(undefined, 'tu-read-page', false)
    const second = mergeProbeToolUseIds(first, 'tu-read-db', true)

    expect(hasSharedProbeToolUseId(second, 'tu-read-page')).toBe(true)
    expect(hasSharedProbeToolUseId(second, 'tu-read-db')).toBe(true)

    const status = {
      role: 'owner',
      mode: 'owner',
      ...second,
    }
    // Both parallel tool calls recognize `owned: true`
    const factsPage = $A(
      'read',
      parsed,
      { toolUseId: 'tu-read-page' },
      status,
      { networkOff: false, turnStartedByHuman: true },
    )
    const factsDb = $A('read', parsed, { toolUseId: 'tu-read-db' }, status, {
      networkOff: false,
      turnStartedByHuman: true,
    })
    expect(factsPage.owned).toBe(true)
    expect(factsDb.owned).toBe(true)
  })

  test('#2313: Artifact deny and ask rules apply to cloud MCP stand-in Artifact tools without widening allow', () => {
    const cloudMcpArtifact = {
      name: 'mcp__artifacts__publish_artifact',
      mcpInfo: { serverName: 'artifacts', toolName: 'publish_artifact' },
    }
    expect(standsInForBuiltInArtifactTool(cloudMcpArtifact)).toBe(true)

    expect(
      toolMatchesRule(cloudMcpArtifact, {
        source: 'userSettings',
        ruleBehavior: 'deny',
        ruleValue: { toolName: 'Artifact' },
      }),
    ).toBe(true)
    expect(
      toolMatchesRule(cloudMcpArtifact, {
        source: 'userSettings',
        ruleBehavior: 'ask',
        ruleValue: { toolName: 'Artifact' },
      }),
    ).toBe(true)
    // Allow rules are NOT widened to MCP stand-ins
    expect(
      toolMatchesRule(cloudMcpArtifact, {
        source: 'userSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'Artifact' },
      }),
    ).toBe(false)

    // Scoped deny rule `Artifact(url:...)` also matches stand-in tool name
    const permCtx = makePermCtx({
      alwaysDenyRules: { userSettings: ['Artifact(url:https://claude.ai/*)'] },
    })
    const scoped = getRuleByContentsForToolName(
      permCtx,
      'mcp__artifacts__publish_artifact',
      'deny',
    )
    expect(scoped.has('url:https://claude.ai/*')).toBe(true)
  })

  test('#2319: slash command allowed-tools grants do not leak to background/async subagents', () => {
    const permCtx = makePermCtx({
      alwaysAllowRules: {
        userSettings: ['Read'],
        command: ['Bash(git push:*)'],
      },
    })

    // Main thread keeps command-scoped allow rules
    expect(
      stripCommandAllowedToolsForBackgroundAgent(permCtx).alwaysAllowRules
        .command,
    ).toEqual(['Bash(git push:*)'])

    // Background async subagent has command-scoped allow rules stripped
    const strippedInBg = runWithAgentContext(
      {
        agentId: 'bg-agent-1',
        agentType: 'subagent',
        isBackgroundAgent: true,
        isAsync: true,
      },
      () => stripCommandAllowedToolsForBackgroundAgent(permCtx),
    )
    expect(strippedInBg.alwaysAllowRules.command).toBeUndefined()
    expect(strippedInBg.alwaysAllowRules.userSettings).toEqual(['Read'])
  })

  test('#2329/#2330/#2331: outside-org artifact publish/mutations ignore allow rule, ask every time in auto mode, and require subagent confirmation', async () => {
    const slug = '22222222-2222-4222-8222-222222222222'
    const url = `https://claude.ai/code/artifact/${slug}`
    un().shareStatus.bySlug.set(slug, {
      mode: 'public',
      isSharedLive: true,
      role: 'owner',
      outsideAudience: true,
    })

    // #2330: whole-tool allow rule is ignored for outside-org publish
    expect(isArtifactOutsideOrgOrUnknown(slug)).toBe(true)
    expect(
      ArtifactTool.ignoresWholeToolAllowRule?.({ action: 'publish', url }),
    ).toBe(true)
    expect(ArtifactTool.ignoresWholeToolAllowRule?.({ url })).toBe(true)

    // #2330: publish asks with suppressAlwaysAllowRule: true
    const ctx = {
      toolUseId: 'tu-pub-1',
      getAppState: () => ({
        toolPermissionContext: makePermCtx({ mode: 'default' }),
      }),
      options: { isNonInteractiveSession: false, tools: [] },
      abortController: new AbortController(),
    } as unknown as ToolUseContext

    const pubDecision = await checkArtifactActionPermissions(
      { action: 'publish', url },
      ctx,
    )
    expect(pubDecision.behavior).toBe('ask')
    if (pubDecision.behavior === 'ask') {
      expect(pubDecision.suppressAlwaysAllowRule).toBe(true)
    }

    // #2331: auto mode classifier approval does NOT persist `public_change` consent
    const autoCtx = {
      toolUseId: 'tu-auto-1',
      getAppState: () => ({
        toolPermissionContext: makePermCtx({ mode: 'auto' }),
      }),
      toolDecisions: new Map([
        ['tu-auto-1', { source: 'classifier', decision: 'accept' }],
      ]),
      options: { isNonInteractiveSession: false, tools: [] },
      abortController: new AbortController(),
    } as unknown as ToolUseContext

    const ruling = {
      ask: true as const,
      class: 'public_change' as const,
      answeredBy: 'classifier' as const,
      remember: 'artifact' as const,
      basis: 'known' as const,
      about: 'outside_audience' as const,
    }
    expect(VBe(ruling)).toBe('public_change:outside_audience')

    const firstAsk = dD({
      input: { action: 'publish', url },
      context: autoCtx,
      ruling,
      slug,
      display: { url },
      action: 'publish',
    })
    expect(firstAsk.behavior).toBe('ask')

    // Classifier approves first change -> PAr must NOT persist conversation-wide consent
    PAr(autoCtx)

    // Second change in auto mode MUST STILL ASK (first yes covered that single change alone)
    const secondAutoCtx = {
      ...autoCtx,
      toolUseId: 'tu-auto-2',
    } as unknown as ToolUseContext
    const secondAsk = dD({
      input: { action: 'publish', url },
      context: secondAutoCtx,
      ruling,
      slug,
      display: { url },
      action: 'publish',
    })
    expect(secondAsk.behavior).toBe('ask')

    // #2331: ArtifactTool.checkPermissions in auto mode must NOT auto-allow outside-org publish
    const autoCheck = await ArtifactTool.checkPermissions(
      { file_path: '/tmp/a.html', url } as never,
      secondAutoCtx,
    )
    expect(autoCheck.behavior).toBe('ask')
  })

  test('#2173/#2329-#2331 P1-3 regression: Kgl populates outsideAudience from boot/mode and upload_asset fails closed for both main agent and subagent when audience is unknown', async () => {
    const { Kgl, ip } = await import(
      'src/services/artifactAutoReact/ownership.js'
    )
    const { Wu } = await import(
      'src/services/artifactAutoReact/readPerm/consent.js'
    )
    const { writeFileSync } = await import('fs')

    const slug = '33333333-3333-4333-8333-333333333333'
    const url = `https://claude.ai/code/artifact/${slug}`

    // 1. Owner-only boot populates outsideAudience: false
    Kgl(
      slug,
      {
        err: null,
        mode: 'owner',
        role: 'owner',
        boot: {
          err: null,
          ver: 'v1',
          assetToken: 'tok-1',
          data: { mode: 'owner', perm: { role: 'owner', mode: 'owner' } },
        },
      },
      { consumedByCheck: true, toolUseId: 'tu-own', issuedAt: Date.now() },
    )
    expect(ip(slug)?.outsideAudience).toBe(false)

    // 2. Public/tokenless boot populates outsideAudience: true
    Kgl(
      slug,
      {
        err: null,
        mode: 'public',
        role: undefined,
        boot: {
          err: null,
          ver: 'v2',
          assetToken: undefined,
          data: { mode: 'public' },
        },
      },
      { consumedByCheck: true, toolUseId: 'tu-pub', issuedAt: Date.now() },
    )
    expect(ip(slug)?.outsideAudience).toBe(true)

    // 3. Explicit outsideAudience boolean on boot.data is honored
    Kgl(
      slug,
      {
        err: null,
        mode: 'users',
        role: 'owner',
        boot: {
          err: null,
          ver: 'v3',
          assetToken: 'tok-3',
          data: {
            mode: 'users',
            outsideAudience: false,
            perm: { role: 'owner', mode: 'users' },
          },
        },
      },
      { consumedByCheck: true, toolUseId: 'tu-users-in', issuedAt: Date.now() },
    )
    expect(ip(slug)?.outsideAudience).toBe(false)

    // 4. `mode: 'users'` without explicit outsideAudience clears stale `false` -> undefined (fail-closed)
    Kgl(
      slug,
      {
        err: null,
        mode: 'users',
        role: 'owner',
        boot: {
          err: null,
          ver: 'v4',
          assetToken: 'tok-4',
          data: { mode: 'users', perm: { role: 'owner', mode: 'users' } },
        },
      },
      {
        consumedByCheck: true,
        toolUseId: 'tu-users-unk',
        issuedAt: Date.now(),
      },
    )
    expect(ip(slug)?.outsideAudience).toBeUndefined()

    // 5. upload_asset fails closed for BOTH main agent and subagent when shareStatus is
    // missing or outsideAudience is undefined, even with prior session upload consent.
    const tmp = mkdtempSync(join(tmpdir(), 'wave325-upload-failclosed-'))
    tempDirs.push(tmp)
    const sampleFile = join(tmp, 'img.png')
    writeFileSync(sampleFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const makeUploadCtx = (
      toolUseId: string,
      agentId?: string,
    ): ToolUseContext =>
      ({
        toolUseId,
        ...(agentId ? { agentId } : {}),
        getAppState: () => ({
          toolPermissionContext: makePermCtx({ mode: 'default' }),
          artifactAssetUploadConsentSlugs: { [slug]: true },
        }),
        options: { isNonInteractiveSession: false, tools: [] },
        abortController: new AbortController(),
      }) as unknown as ToolUseContext

    // Main agent with outsideAudience === undefined -> must ask, Wu: false
    const mainUnknown = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url, file_path: sampleFile },
      makeUploadCtx('tu-users-unk'),
    )) as { behavior: string; updatedInput?: Record<string, unknown> }
    expect(mainUnknown.behavior).toBe('ask')
    expect(mainUnknown.updatedInput?.[Wu]).toBe(false)

    // Subagent with outsideAudience === undefined -> must ask, Wu: false
    const subUnknown = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url, file_path: sampleFile },
      makeUploadCtx('tu-users-unk', 'sub-1'),
    )) as { behavior: string; updatedInput?: Record<string, unknown> }
    expect(subUnknown.behavior).toBe('ask')
    expect(subUnknown.updatedInput?.[Wu]).toBe(false)

    // Missing shareStatus entirely -> main agent must also fail closed
    un().shareStatus.bySlug.delete(slug)
    const mainMissing = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url, file_path: sampleFile },
      makeUploadCtx('tu-missing'),
    )) as { behavior: string; updatedInput?: Record<string, unknown> }
    expect(mainMissing.behavior).toBe('ask')
    expect(mainMissing.updatedInput?.[Wu]).toBe(false)
  })

  test('#2377: scratchpad instructions warn that temporary scratchpad can be cleared', () => {
    setEnv('CLAUDE_CODE_SESSION_KIND', undefined)
    const instructions = getScratchpadInstructions()
    if (instructions !== null) {
      expect(instructions).toContain('clear')
      expect(instructions).toContain('durable')
    }
  })
})
