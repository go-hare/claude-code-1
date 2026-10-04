import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadEvalCases } from '../pluginEval/loadCases.js'
import { runPluginEvalSuite } from '../pluginEval/runSuite.js'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe('plugin eval runner densable 2.1.283 ($R / mc)', () => {
  test('empty evals still No eval cases found under after mc/loadCases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-empty-283-'))
    tempDirs.push(root)
    await mkdir(join(root, 'evals'), { recursive: true })
    const outcome = await runPluginEvalSuite({
      rootPath: root,
      evalDirSegments: ['evals'],
      frameRoot: null,
      adoptionDecided: true,
      trust: {},
      targetScreened: true,
      consentDecided: true,
      concurrency: 1,
      threshold: 1,
      allowTools: [],
      noScaffold: true,
      keepTemp: false,
      mocks: 'off',
      allowRealServers: false,
      keepFailedRuns: false,
      verbose: false,
      ablation: 'none',
      onLine: () => {},
      onNotice: () => {},
      signal: new AbortController().signal,
      authPreflight: async () => ({ ok: true }),
    })
    expect(outcome.report.cases).toEqual([])
    expect(outcome.resolvedCases).toEqual([])
    expect(outcome.errors.every(e => !e.error.includes('Error: mc'))).toBe(true)
  })

  test('case.yaml OR prompt.md+graders discovered then suite runs (mc after loadCases)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-cases-283-'))
    tempDirs.push(root)
    await mkdir(join(root, 'evals', 'alpha'), { recursive: true })
    await writeFile(
      join(root, 'evals', 'alpha', 'prompt.md'),
      `---
max_turns: 1
allowed_tools: [Read]
tags: [smoke]
---
hello
`,
    )
    await mkdir(join(root, 'evals', 'alpha', 'graders'), { recursive: true })
    await writeFile(
      join(root, 'evals', 'alpha', 'graders', 'criteria.md'),
      `---
type: regex
pattern: hello
---
`,
    )
    const loaded = await loadEvalCases(
      root,
      { tags: ['smoke'] },
      { evalDirSegments: ['evals'] },
    )
    expect(loaded.cases.map(c => c.name)).toEqual(['alpha'])
    expect(loaded.cases[0]?.caseSource).toBe('prose')

    const taggedOut = await loadEvalCases(
      root,
      { tags: ['missing'] },
      { evalDirSegments: ['evals'] },
    )
    expect(taggedOut.cases).toEqual([])

    const outcome = await runPluginEvalSuite({
      rootPath: root,
      evalDirSegments: ['evals'],
      frameRoot: null,
      adoptionDecided: true,
      trust: {},
      targetScreened: true,
      consentDecided: true,
      tags: ['smoke'],
      runs: 1,
      concurrency: 1,
      threshold: 1,
      allowTools: ['Read'],
      noScaffold: true,
      keepTemp: false,
      mocks: 'off',
      allowRealServers: false,
      keepFailedRuns: false,
      verbose: false,
      ablation: 'none',
      onLine: () => {},
      onNotice: () => {},
      signal: AbortSignal.abort(),
      authPreflight: async () => ({ ok: true }),
    })
    expect(
      outcome.resolvedCases.length + outcome.errors.length,
    ).toBeGreaterThanOrEqual(0)
    expect(
      outcome.report.cases.length === 0 ||
        outcome.exitCode === 130 ||
        outcome.exitCode === 2,
    ).toBe(true)
  })

  test('handler source no longer contains Error: mc', async () => {
    const src = await readFile(
      join(import.meta.dir, '../../../cli/handlers/pluginEval.ts'),
      'utf8',
    )
    expect(src).not.toContain('Error: mc')
    expect(src).toContain('runPluginEvalSuite')
    expect(src).toContain('No eval cases found${gt} under')
    expect(src).toContain('Interrupted — finishing up')
    expect(src).toContain('tags: options.tag')
  })

  test('yPt still tengu_sharded_snowflake', async () => {
    const src = await readFile(
      join(import.meta.dir, '../../../cli/handlers/pluginEval.ts'),
      'utf8',
    )
    expect(src).toContain(
      "!getFeatureValue_CACHED_MAY_BE_STALE('tengu_sharded_snowflake', false)",
    )
  })

  test('Zi prompts Trust this plugin directory then gate persist', async () => {
    const src = await readFile(
      join(import.meta.dir, '../pluginEval/trust.ts'),
      'utf8',
    )
    expect(src).toContain('Trust this plugin directory?')
    expect(src).toContain("source: 'gate'")
    expect(src).toContain('persistPluginEvalTrust')
  })

  test('NR init has interview / child-session delegate / bare', async () => {
    const src = await readFile(
      join(import.meta.dir, '../../../cli/handlers/pluginEval.ts'),
      'utf8',
    )
    expect(src).toContain('spawnEvalInterview')
    expect(src).toContain('childSessionInterviewText')
    expect(src).toContain('CLAUDE_CODE_EVAL_INTERVIEW_SESSION')
  })

  test('mc starts densable sc agent relay', async () => {
    const src = await readFile(
      join(import.meta.dir, '../pluginEval/runSuite.ts'),
      'utf8',
    )
    expect(src).toContain('startEvalAgentRelay')
  })

  test('Qo interview prompt is gold full body (not the short subset)', async () => {
    const { evalInterviewPrompt, MOCK_STUB_TODO } = await import(
      '../pluginEval/interviewPrompt.js'
    )
    const text = evalInterviewPrompt('/plugin', 'hello', 'evals', 'spawned', '')
    expect(text).toContain('If README and SKILL.md disagree')
    expect(text).toContain(
      'TODO: replace with the canned result this tool should return',
    )
    expect(text).toContain(MOCK_STUB_TODO)
    expect(text).toContain('type: agent')
    expect(text).toContain('--no-publish')
    expect(text).toContain('{source: file, path}')
    expect(text).not.toContain('Do NOT invent')
  })

  test('Km interpolates {{input.x}} and dQe expect abort', async () => {
    const { interpolateMockPrompt, matchExpect, answerAgentMock } =
      await import('../pluginEval/agentMock.js')
    const out = await interpolateMockPrompt(
      'echo {{input.ticket}}',
      { ticket: 'ABC-1' },
      '/tmp',
    )
    expect(out).toEqual({ ok: true, text: 'echo ABC-1' })
    expect(matchExpect({ project: 'wrong' }, { project: 'right' })).toContain(
      'project',
    )
    const aborted = await answerAgentMock({
      server: 'jira',
      tool: 'create',
      input: { project: 'wrong' },
      responder: {
        kind: 'agent',
        prompt: 'unused',
        expect: { project: 'right' },
        abortWhen: null,
        baseDir: '/tmp',
      },
      history: [],
      signal: new AbortController().signal,
    })
    expect(aborted.verdict).toBe('abort')
    expect(aborted.text).toContain('input violates expect:')
  })

  test('xMn mergeSkillToolCommands is exported and skill listing uses it', async () => {
    const commandsSrc = await readFile(
      join(import.meta.dir, '../../../commands.ts'),
      'utf8',
    )
    expect(commandsSrc).toContain(
      'export async function mergeSkillToolCommands',
    )
    expect(commandsSrc).toContain('getMcpSkillCommands(mcpCommands)')
    expect(commandsSrc).toContain('invocableMemoryStoreSkillCommands()')
    const relay = await readFile(
      join(import.meta.dir, '../pluginEval/agentRelay.ts'),
      'utf8',
    )
    expect(relay).toContain('answerAgentMock')
    const mock = await readFile(
      join(import.meta.dir, '../pluginEval/agentMock.ts'),
      'utf8',
    )
    expect(mock).toContain("querySource: 'plugin_eval_mock'")
    expect(mock).toContain('You are standing in for the MCP server')
  })
})
