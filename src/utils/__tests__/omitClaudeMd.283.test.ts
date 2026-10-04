import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  parseAgentFromMarkdown,
  parseAgentsFromJson,
} from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'

import { coerceOmitClaudeMd, omitClaudeMdUserContext } from '../omitClaudeMd.js'

const ROOT = join(import.meta.dir, '../../..')

describe('omitClaudeMd densable 2.1.283 He YAML', () => {
  test('true and "true" coerce to true; other values are undefined', () => {
    expect(coerceOmitClaudeMd(true)).toBe(true)
    expect(coerceOmitClaudeMd('true')).toBe(true)
    expect(coerceOmitClaudeMd(false)).toBeUndefined()
    expect(coerceOmitClaudeMd('false')).toBeUndefined()
    expect(coerceOmitClaudeMd('yes')).toBeUndefined()
    expect(coerceOmitClaudeMd(undefined)).toBeUndefined()
  })

  test('markdown frontmatter true and "true" set omitClaudeMd', () => {
    const fromBool = parseAgentFromMarkdown(
      '/tmp/author.md',
      '/tmp',
      {
        name: 'author',
        description: 'spec author',
        omitClaudeMd: true,
      },
      'You write specs.',
      'userSettings',
    )
    expect(fromBool?.omitClaudeMd).toBe(true)

    const fromString = parseAgentFromMarkdown(
      '/tmp/runner.md',
      '/tmp',
      {
        name: 'runner',
        description: 'spec runner',
        omitClaudeMd: 'true',
      },
      'You run specs.',
      'userSettings',
    )
    expect(fromString?.omitClaudeMd).toBe(true)

    const fromFalse = parseAgentFromMarkdown(
      '/tmp/plain.md',
      '/tmp',
      {
        name: 'plain',
        description: 'plain agent',
        omitClaudeMd: false,
      },
      'You are plain.',
      'userSettings',
    )
    expect(fromFalse?.omitClaudeMd).toBeUndefined()
  })

  test('--agents JSON omitClaudeMd true is kept', () => {
    const agents = parseAgentsFromJson(
      {
        author: {
          description: 'spec author',
          prompt: 'You write specs.',
          omitClaudeMd: true,
        },
      },
      'flagSettings',
    )
    expect(agents[0]?.omitClaudeMd).toBe(true)
  })
})

describe('omitClaudeMd densable 2.1.283 Fl subagent vs main', () => {
  test('built-in subagent drops claudeMd and does not set managedInstructionsOnly', async () => {
    const result = await omitClaudeMdUserContext(
      { source: 'built-in' },
      { claudeMd: 'USER+PROJECT', other: 'keep' },
    )
    expect(result.managedInstructionsOnly).toBe(false)
    expect(result.userContext).toEqual({ other: 'keep' })
    expect(result.userContext.claudeMd).toBeUndefined()
  })

  test('policySettings subagent drops claudeMd without managedInstructionsOnly', async () => {
    const result = await omitClaudeMdUserContext(
      { source: 'policySettings' },
      { claudeMd: 'POLICY+USER' },
    )
    expect(result.managedInstructionsOnly).toBe(false)
    expect(result.userContext.claudeMd).toBeUndefined()
  })

  test('runAgent passes managedInstructionsOnly into query; main session does not', () => {
    const runAgent = readFileSync(
      join(ROOT, 'packages/builtin-tools/src/tools/AgentTool/runAgent.ts'),
      'utf8',
    )
    expect(runAgent).toContain('omitClaudeMdUserContext')
    expect(runAgent).toContain(
      '...(managedInstructionsOnly && { managedInstructionsOnly: true })',
    )
    expect(runAgent).not.toContain('tengu_slim_subagent_claudemd')

    const queryEngine = readFileSync(join(ROOT, 'src/QueryEngine.ts'), 'utf8')
    expect(queryEngine).not.toContain('managedInstructionsOnly')

    const repl = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(repl).not.toContain('managedInstructionsOnly')
  })

  test('plugin YAML parse uses He true/"true"', () => {
    const src = readFileSync(
      join(ROOT, 'src/utils/plugins/loadPluginAgents.ts'),
      'utf8',
    )
    expect(src).toContain(
      "omitClaudeMdRaw === 'true' || omitClaudeMdRaw === true",
    )
  })
})
