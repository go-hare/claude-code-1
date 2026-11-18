import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import {
  extraEvalToolDenies,
  grantEvalAllowedTools,
  parseDisallowedEvalTools,
} from '../pluginEval/evalFence.js'
import { adviseFileCreateGraders } from '../pluginEval/evalScaffold.js'
import {
  mergeProseOntoYaml,
  parseCaseDefinition,
} from '../pluginEval/schema.js'
import { parseEvalChildTrace } from '../pluginEval/spawnEval.js'
import type { ResolvedCase } from '../pluginEval/types.js'

function makeCase(
  overrides: Partial<ResolvedCase['execution']> = {},
): ResolvedCase {
  return {
    schema_version: '1.0',
    name: 'test-case',
    context: { add_dirs: [] },
    execution: {
      prompt: 'Do the task',
      max_turns: 5,
      timeout_seconds: 60,
      allowed_tools: ['Read', 'Write'],
      env: {},
      ...overrides,
    },
    runs: 1,
    graders: [
      {
        name: 'check-file',
        type: 'file_exists',
        path: 'out.txt',
        exists: true,
        weight: 1,
      },
    ],
    caseFile: '/tmp/case.yaml',
    caseDir: '/tmp',
    caseSource: 'case_yaml',
    pluginDirs: [],
    pluginDirsUnderTest: [],
    evalDirSegments: ['evals'],
  } as unknown as ResolvedCase
}

describe('pluginEval v2.1.299 alignment (#576, #659)', () => {
  test('#576 schema accepts disallowed_tools and merges prose onto yaml', () => {
    const parsed = parseCaseDefinition({
      schema_version: '1.0',
      name: 'c1',
      execution: {
        prompt: 'hello',
        disallowed_tools: ['Agent', 'TaskStop'],
      },
      graders: [
        {
          name: 'g1',
          type: 'regex',
          pattern: 'ok',
          target: 'last_message',
          weight: 1,
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.case.execution.disallowed_tools).toEqual([
        'Agent',
        'TaskStop',
      ])
    }

    const merged = mergeProseOntoYaml(
      { execution: { disallowed_tools: ['Agent'] } },
      { top: {}, execution: { disallowed_tools: ['TaskStop'] }, graders: [] },
      '/tmp/c1',
    )
    expect(
      (merged.execution as { disallowed_tools?: string[] }).disallowed_tools,
    ).toEqual(['Agent', 'TaskStop'])
  })

  test('#576 parseDisallowedEvalTools accepts bare built-in names and rejects patterns/MCP tools', () => {
    const res = parseDisallowedEvalTools([
      'Agent,TaskStop',
      'Bash(rm:*)',
      'mcp__foo__bar',
    ])
    expect(res.tools).toEqual(['Agent', 'TaskStop'])
    expect(res.rejected).toEqual(['Bash(rm:*)', 'mcp__foo__bar'])
  })

  test('#576 grantEvalAllowedTools and extraEvalToolDenies remove disallowedTools', () => {
    const granted = grantEvalAllowedTools(
      ['Read', 'Agent', 'Write'],
      ['Write'],
      {
        disallowedTools: ['Agent', 'Write'],
      },
    )
    expect(granted.allowed).toEqual(['Read'])

    const denies = extraEvalToolDenies(['Read'], ['Agent'])
    expect(denies).toContain('Agent')
  })

  test('#576 adviseFileCreateGraders reports disallowed_tools / --disallow-tools when file creation or trace tool is blocked', () => {
    const cse = makeCase({ disallowed_tools: ['Write'] })
    const advice = adviseFileCreateGraders(cse, ['Write'], {
      scaffolded: false,
      artifactPublishGranted: false,
      mockedTools: [],
      disallowedTools: ['Write'],
    })
    expect(advice[0]?.text).toContain(
      'disallowed_tools or --disallow-tools lists Write',
    )

    const toolUsedCase: ResolvedCase = {
      ...makeCase({ disallowed_tools: ['Agent'] }),
      graders: [
        { name: 'u1', type: 'tool_used', tool: 'Agent', min: 1, weight: 1 },
      ],
    }
    const advice2 = adviseFileCreateGraders(toolUsedCase, [], {
      scaffolded: false,
      artifactPublishGranted: false,
      mockedTools: [],
      disallowedTools: ['Agent'],
    })
    expect(advice2[0]?.text).toContain(
      "Agent is in the case's disallowed_tools or --disallow-tools",
    )
  })

  test('#659 parseEvalChildTrace sets endedOnApiError when result has is_error=true and numeric api_error_status', () => {
    const events = [
      {
        type: 'result',
        is_error: true,
        api_error_status: 400,
        result: 'invalid_request_error',
        num_turns: 1,
        total_cost_usd: 0,
      },
    ]
    const parsed = parseEvalChildTrace(
      events,
      false,
      { kind: 'exit', code: '1', stderrTail: '' },
      join('/tmp', 'trace.jsonl'),
    )
    expect(parsed.endedOnApiError).toBe(true)

    const okEvents = [
      {
        type: 'result',
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0.01,
      },
    ]
    const okParsed = parseEvalChildTrace(
      okEvents,
      false,
      { kind: 'ok' },
      join('/tmp', 'trace2.jsonl'),
    )
    expect(okParsed.endedOnApiError).toBe(false)
  })
})
