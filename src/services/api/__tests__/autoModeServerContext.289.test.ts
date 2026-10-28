/**
 * densable 2.1.289 M1t / JUo / x1t / Ha / Ya.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { ToolUseContext } from '../../../Tool.js'
import { resetRequestLatches } from '../../../bootstrap/state.js'
import { resetAutoModeClassifierTransportForTests } from '../autoModeClassifierTransport.js'
import {
  clampClassifierGitState,
  composeAutoModeClassifierContext,
  kickoffAutoModeServerContext,
  probeClassifierGitState,
  slimClassifierContextForHistory,
  type ClassifierContextJson,
  type ClassifierGitState,
} from '../autoModeServerContext.js'

const PROVIDER_ENV = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'ANTHROPIC_UNIX_SOCKET',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_AUTO_MODE_SERVER',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
] as const

const savedEnv: Partial<Record<(typeof PROVIDER_ENV)[number], string>> = {}

function emptyGit(cwd: string): ClassifierGitState {
  return {
    cwd,
    root: null,
    branch: null,
    default_branch: null,
    status: null,
    visibility: null,
  }
}

function fixtureContext(
  overrides: Partial<ClassifierContextJson> = {},
): ClassifierContextJson {
  return {
    permission_mode: 'auto',
    platform: 'macos',
    live_cwd: '/tmp',
    home_dir: '/home',
    rule_roots: {},
    trusted_directories: {
      primary: { path: '/tmp', resolved: ['/tmp'] },
      additional: [],
      network: [],
      block_reads_outside_working_directories: false,
    },
    rules: { allow: [], deny: [], ask: [] },
    case_insensitive_paths: false,
    auto_mode: {
      allow: [],
      soft_deny: [],
      hard_deny: [],
      environment: [],
    },
    artifact_consent_holdback: false,
    restricted: false,
    is_remote_mode: false,
    classify_all_shell: false,
    user_identity: null,
    ...overrides,
  }
}

beforeEach(() => {
  for (const key of PROVIDER_ENV) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  resetRequestLatches()
  resetAutoModeClassifierTransportForTests()
})

afterEach(() => {
  resetRequestLatches()
  resetAutoModeClassifierTransportForTests()
  for (const key of PROVIDER_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('composeAutoModeClassifierContext (M1t / JUo)', () => {
  test('composes v:1 git_state and x1t fingerprint', () => {
    const git = emptyGit('/work')
    const composed = composeAutoModeClassifierContext({
      autoModeServerContext: {
        context: fixtureContext({ live_cwd: '/work', platform: 'linux' }),
        git,
      },
    })
    expect(composed).toBeDefined()
    expect(composed?.v).toBe(1)
    expect(composed?.git_state).toEqual(git)
    expect(composed?.live_cwd).toBe('/work')
    const slim = slimClassifierContextForHistory(composed!)
    expect(slim).toEqual({
      git_state: git,
      live_cwd: '/work',
      platform: 'linux',
    })
  })

  test('binary-shrinks prior_turn_context from the suffix', () => {
    const prior = Array.from({ length: 8 }, (_, i) => ({
      i,
      pad: 'n'.repeat(80_000),
    }))
    const composed = composeAutoModeClassifierContext({
      autoModeServerContext: {
        context: fixtureContext(),
        git: emptyGit('/tmp'),
      },
      priorTurnContext: prior,
    })
    expect(composed).toBeDefined()
    const kept = composed?.prior_turn_context as
      | Array<{ i: number }>
      | undefined
    if (kept !== undefined && kept.length > 0) {
      expect(kept[0]?.i).toBe(prior.length - kept.length)
    } else {
      expect(composed?.shed).toContain('prior_turn_context')
    }
  })

  test('static over-budget warn copy is gold 289', async () => {
    const src = await readFile(
      join(import.meta.dir, '../autoModeServerContext.ts'),
      'utf8',
    )
    expect(src).toContain(
      "[server-classifier] the permission rule lists alone exceed the auto-mode context budget (${COMPOSE_SHED_BUDGET_BYTES} bytes): every variable part (git state, repository visibility, Chrome tabs, prior-turn history, system-reminder ids, artifact state) was left out of this request's classifier context — trim the deny/ask rules or settings.autoMode entries",
    )
    expect(src).toContain('tengu_auto_mode_context_static_over_budget')
  })
})

describe('clampClassifierGitState (APo)', () => {
  test('clamps host and caps remotes', () => {
    const clamped = clampClassifierGitState({
      cwd: 'c'.repeat(2000),
      root: null,
      branch: null,
      default_branch: null,
      status: null,
      visibility: {
        origin: {
          host: 'h'.repeat(400),
          remote: 'o/r',
          visibility: 'unknown',
        },
        push_remote: 'origin',
        remotes: Array.from({ length: 40 }, (_, i) => ({
          name: `r${i}`,
          host: 'example.com',
          remote: `o/r${i}`,
          visibility: 'unknown',
        })),
        visibility_cache: [],
      },
    })
    expect(clamped.cwd.length).toBe(1024)
    expect(clamped.visibility?.origin?.host.length).toBe(260)
    expect(clamped.visibility?.remotes.length).toBe(32)
    expect(clamped.truncated).toBe(true)
  })
})

describe('probeClassifierGitState (Ha)', () => {
  test('non-repo is not_a_repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'am-git-'))
    try {
      const git = await probeClassifierGitState(
        dir,
        new AbortController().signal,
      )
      expect(git.error).toBe('not_a_repo')
      expect(git.root).toBeNull()
      expect(git.status).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('kickoffAutoModeServerContext (Ya)', () => {
  function stub(mode: 'auto' | 'default'): ToolUseContext {
    return {
      getAppState: () => ({
        toolPermissionContext: {
          ...getEmptyToolPermissionContext(),
          mode,
        },
      }),
      options: { tools: [] },
      abortController: new AbortController(),
    } as unknown as ToolUseContext
  }

  test('user switch false returns undefined', () => {
    process.env.CLAUDE_CODE_AUTO_MODE_SERVER = '0'
    resetAutoModeClassifierTransportForTests()
    expect(kickoffAutoModeServerContext(stub('auto'))).toBeUndefined()
  })

  test('default mode is off', () => {
    expect(kickoffAutoModeServerContext(stub('default'))).toBeUndefined()
  })
})
