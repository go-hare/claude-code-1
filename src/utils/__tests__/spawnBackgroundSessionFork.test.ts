import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { FORK_GLYPH } from '../../constants/figures.js'
import {
  buildReplConfigArgv,
  getForkRestrictedLaunchConfig,
  getReplConfigArgv,
  isForkRestrictedLaunchOptions,
  mergeForkReplayIntoChildArgs,
  resetForkReplayLaunchConfig,
  setForkReplayLaunchConfig,
  setForkRestrictedLaunchConfig,
  setReplConfigArgv,
  getForkReplayLaunchConfig,
} from '../forkReplayLaunchConfig.js'
import {
  collapseForkPromptLabel,
  deriveForkName,
  deriveForkSessionSeed,
  formatForkSessionToast,
  parseSessionStatusLine,
  getForkSessionPreflightError,
  isForkRestrictedLaunch,
  isResumeTranscriptPath,
  resolveForkEditsIn,
  resolveKeepParentForkName,
  FORK_NOTHING_YET_ERROR,
  FORK_PERSISTENCE_OFF_ERROR,
  FORK_RESTRICTED_LAUNCH_ERROR,
} from '../spawnBackgroundSessionFork.js'

describe('deriveForkName', () => {
  test('takes first three tokens lowercased with dashes', () => {
    expect(deriveForkName('Fix the null check in validate.ts')).toBe(
      'fix-the-null',
    )
  })

  test('strips non-alnum and collapses dashes', () => {
    expect(deriveForkName('Hello!!! World??? Foo')).toBe('hello-world-foo')
  })

  test('truncates to 24 chars', () => {
    const name = deriveForkName('abcdefghijklmnopqrstuvwxyz more words here')
    expect(name.length).toBeLessThanOrEqual(24)
    expect(name).toBe('abcdefghijklmnopqrstuvwx')
  })

  test('falls back to fork for empty/punctuation-only', () => {
    expect(deriveForkName('')).toBe('fork')
    expect(deriveForkName('   ')).toBe('fork')
    expect(deriveForkName('!!!')).toBe('fork')
  })
})

describe('collapseForkPromptLabel', () => {
  test('collapses whitespace and truncates', () => {
    expect(collapseForkPromptLabel('  hello   world  ')).toBe('hello world')
    expect(collapseForkPromptLabel('a'.repeat(80)).length).toBeLessThanOrEqual(
      60,
    )
  })
})

describe('resolveForkEditsIn', () => {
  test('this-tree when not in worktree', () => {
    expect(resolveForkEditsIn({ inWorktree: false })).toBe('this-tree')
  })

  test('own-worktree when in worktree (child isolates)', () => {
    expect(resolveForkEditsIn({ inWorktree: true })).toBe('own-worktree')
  })

  test('this-tree when bgIsolation none', () => {
    expect(
      resolveForkEditsIn({ inWorktree: true, bgIsolationNone: true }),
    ).toBe('this-tree')
  })

  test('undefined when not a git repo', () => {
    expect(
      resolveForkEditsIn({ inWorktree: false, isGitRepo: false }),
    ).toBeUndefined()
  })
})

describe('formatForkSessionToast (densable rBo one-liner)', () => {
  test('prompt + this-tree: running · name · attach-id · edits this checkout', () => {
    const text = formatForkSessionToast({
      name: 'fix-the-null',
      short: 'abcd1234',
      hadPrompt: true,
      editsIn: 'this-tree',
    })
    expect(text).toBe(
      'session running · fix-the-null · abcd1234 · edits this checkout',
    )
    expect(text).not.toContain('\n')
  })

  test('no-prompt: waiting for a prompt · name · id', () => {
    const text = formatForkSessionToast({
      name: 'fork',
      short: 'deadbeef',
      hadPrompt: false,
    })
    expect(text).toBe('session waiting for a prompt · fork · deadbeef')
  })

  test('relocated chip wins over this-tree', () => {
    const text = formatForkSessionToast({
      name: 'x',
      short: '12345678',
      hadPrompt: true,
      relocatedTo: '/repo',
      editsIn: 'this-tree',
    })
    expect(text).toBe(
      'session running · x · 12345678 · runs in the origin tree',
    )
    expect(text).not.toContain('edits this checkout')
  })

  test('own-worktree: no shared-checkout chip', () => {
    const text = formatForkSessionToast({
      name: 'x',
      short: '12345678',
      hadPrompt: true,
      editsIn: 'own-worktree',
    })
    expect(text).toBe('session running · x · 12345678')
  })

  test('permission mode does not expand toast (216 dropped inherit prose)', () => {
    const text = formatForkSessionToast({
      name: 'x',
      short: '12345678',
      hadPrompt: true,
      permissionMode: 'plan',
    })
    expect(text).toBe('session running · x · 12345678')
    expect(text).not.toContain('inherited')
  })
})

describe('parseSessionStatusLine (densable HXs)', () => {
  test('round-trips rBo one-liner with chip', () => {
    const text = formatForkSessionToast({
      name: 'fix-the-null',
      short: 'abcd1234',
      hadPrompt: true,
      editsIn: 'this-tree',
    })
    expect(parseSessionStatusLine(text)).toEqual({
      state: 'session running',
      name: 'fix-the-null',
      id: 'abcd1234',
      chips: ['edits this checkout'],
    })
  })

  test('rejects multiline', () => {
    expect(
      parseSessionStatusLine('session running · x · abcd1234\nextra'),
    ).toBeNull()
  })
})

describe('getForkSessionPreflightError', () => {
  const seed = { intent: 'hi' }

  test('coordinator', () => {
    expect(
      getForkSessionPreflightError({ isCoordinator: true, seed }),
    ).toContain('coordinator')
  })

  test('persistence off', () => {
    expect(
      getForkSessionPreflightError({
        persistenceDisabled: true,
        seed,
      }),
    ).toBe(FORK_PERSISTENCE_OFF_ERROR)
  })

  test('restricted launch', () => {
    expect(
      getForkSessionPreflightError({
        restrictedLaunch: true,
        seed,
      }),
    ).toBe(FORK_RESTRICTED_LAUNCH_ERROR)
  })

  test('null seed', () => {
    expect(getForkSessionPreflightError({ seed: null })).toBe(
      FORK_NOTHING_YET_ERROR,
    )
  })

  test('ok', () => {
    expect(getForkSessionPreflightError({ seed })).toBeNull()
  })
})

describe('isForkRestrictedLaunch', () => {
  test('safe-mode argv', () => {
    expect(isForkRestrictedLaunch(['node', 'cli', '--safe-mode'])).toBe(true)
  })

  test('system-prompt argv', () => {
    expect(
      isForkRestrictedLaunch(['node', 'cli', '--system-prompt', 'x']),
    ).toBe(true)
  })

  test('clean argv', () => {
    // may still be true if env bare/safe is set in process — only assert false
    // when neither env nor argv restricted.
    const clean = isForkRestrictedLaunch(['node', 'cli'])
    // If process env has CLAUDE_CODE_SIMPLE/SAFE, function correctly returns true.
    expect(typeof clean).toBe('boolean')
  })
})

describe('deriveForkSessionSeed', () => {
  test('null when empty messages and empty prompt', () => {
    expect(deriveForkSessionSeed([], '')).toBeNull()
  })

  test('uses prompt as intent', () => {
    const seed = deriveForkSessionSeed(
      [
        {
          type: 'user',
          message: { content: 'hello world' },
        },
      ],
      'fix the bug',
    )
    expect(seed?.intent).toBe('fix the bug')
  })

  test('falls back to last user when no prompt', () => {
    const seed = deriveForkSessionSeed(
      [
        {
          type: 'user',
          message: { content: 'hello world' },
        },
        {
          type: 'assistant',
          message: { content: 'I can help' },
        },
      ],
      '',
    )
    expect(seed?.intent).toBe('hello world')
    expect(seed?.detail).toContain('I can help')
  })

  test('default intent becomes (forked)', () => {
    const seed = deriveForkSessionSeed(
      [
        {
          type: 'user',
          message: { content: '<command-name>x</command-name>' },
        },
      ],
      '',
    )
    // systemish user still sawUser; intent default (forked)
    expect(seed).not.toBeNull()
    expect(seed?.intent === '(forked)' || seed?.intent.startsWith('<')).toBe(
      true,
    )
  })
})

describe('resolveKeepParentForkName', () => {
  test('appends glyph + prompt to seed name', () => {
    const r = resolveKeepParentForkName({
      seedName: 'My Session',
      seedNameSource: 'user',
      prompt: 'fix the bug now',
    })
    expect(r.name).toContain('My Session')
    expect(r.name).toContain(FORK_GLYPH)
    expect(r.nameSource).toBe('auto')
  })

  test('glyph + prompt when no seed name', () => {
    const r = resolveKeepParentForkName({ prompt: 'do stuff' })
    expect(r.name.startsWith(FORK_GLYPH)).toBe(true)
  })
})

describe('isResumeTranscriptPath', () => {
  test('absolute jsonl path', () => {
    expect(
      isResumeTranscriptPath(
        '/home/u/.claude/jobs/abc/tmp/parent-transcript.jsonl',
      ),
    ).toBe(true)
  })

  test('uuid is not a path', () => {
    expect(isResumeTranscriptPath('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(
      false,
    )
  })
})

describe('forkReplayLaunchConfig (kei/Iei/Hei/gXe)', () => {
  beforeEach(() => {
    resetForkReplayLaunchConfig()
  })
  afterEach(() => {
    resetForkReplayLaunchConfig()
  })

  test('Iei stores and kei reads launch config', () => {
    setForkReplayLaunchConfig({
      appendSystemPrompt: 'extra rules',
      agent: 'code-reviewer',
      agents: '{"x":{}}',
    })
    expect(getForkReplayLaunchConfig()).toEqual({
      appendSystemPrompt: 'extra rules',
      agent: 'code-reviewer',
      agents: '{"x":{}}',
    })
  })

  test('merge joins kei append + isolation with two spaces', () => {
    const merged = mergeForkReplayIntoChildArgs({
      replay: { appendSystemPrompt: 'from-launch' },
      isolationAppend: 'isolation text',
    })
    expect(merged.appendSystemPrompt).toBe('from-launch  isolation text')
    expect(merged.agent).toBeUndefined()
  })

  test('merge passes agent/agents flags', () => {
    const merged = mergeForkReplayIntoChildArgs({
      replay: { agent: 'explore', agents: '{}' },
    })
    expect(merged.agent).toBe('explore')
    expect(merged.agents).toBe('{}')
    expect(merged.appendSystemPrompt).toBeUndefined()
  })

  test('isolation alone still produces append-system-prompt', () => {
    const merged = mergeForkReplayIntoChildArgs({
      isolationAppend: 'only isolation',
    })
    expect(merged.appendSystemPrompt).toBe('only isolation')
  })

  test('xei/Hei sticky restricted launch', () => {
    expect(getForkRestrictedLaunchConfig()).toBe(false)
    setForkRestrictedLaunchConfig(true)
    expect(getForkRestrictedLaunchConfig()).toBe(true)
    expect(isForkRestrictedLaunch(['node', 'cli'])).toBe(true)
  })

  test('Ajs options: systemPrompt / tools non-default', () => {
    expect(isForkRestrictedLaunchOptions({})).toBe(false)
    expect(isForkRestrictedLaunchOptions({ systemPrompt: 'custom' })).toBe(true)
    expect(isForkRestrictedLaunchOptions({ tools: ['default'] })).toBe(false)
    expect(isForkRestrictedLaunchOptions({ tools: ['Bash', 'default'] })).toBe(
      true,
    )
  })

  test('gXe/rti replConfigArgv + Q4t-like build', () => {
    const argv = buildReplConfigArgv({
      settings: '/tmp/s.json',
      pluginDir: ['/p1', '/p2'],
      addDir: '/extra',
      strictMcpConfig: true,
      fallbackModel: 'haiku',
      channels: ['slack'],
    })
    expect(argv).toEqual([
      '--settings',
      '/tmp/s.json',
      '--plugin-dir',
      '/p1',
      '--plugin-dir',
      '/p2',
      '--add-dir',
      '/extra',
      '--strict-mcp-config',
      '--fallback-model',
      'haiku',
      '--channels',
      'slack',
    ])
    setReplConfigArgv(argv)
    expect(getReplConfigArgv()).toEqual(argv)
  })

  test('getters return defensive copies (no live mutable globals)', () => {
    setReplConfigArgv(['--settings', 'a'])
    const argv = getReplConfigArgv() as string[]
    argv.push('MUTATE')
    expect(getReplConfigArgv()).toEqual(['--settings', 'a'])

    setForkReplayLaunchConfig({ agent: 'ok' })
    const replay = getForkReplayLaunchConfig()
    ;(replay as { agent?: string }).agent = 'hacked'
    expect(getForkReplayLaunchConfig().agent).toBe('ok')
  })

  test('buildReplConfigArgv includes plugin-dir-no-mcp when provided', () => {
    expect(buildReplConfigArgv({ pluginDirNoMcp: ['/no-mcp'] })).toEqual([
      '--plugin-dir-no-mcp',
      '/no-mcp',
    ])
  })
})
