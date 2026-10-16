import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  canStampSharesCwdNote,
  hasSameCwdWriteCapableSibling,
  isWriteCapableAgentDefinition,
  resolveSharesCwdStamp,
} from '../agentSharesCwd.js'

const writeAgent = { tools: undefined as string[] | undefined }
const readAgent = {
  tools: ['Read', 'Grep'],
  disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const agentToolSrc = readFileSync(
  join(
    __dirname,
    '../../../packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
  ),
  'utf-8',
)

describe('sharesCwd stamp (densable ALo/Stn/TRe)', () => {
  test('Stn: undefined/null/* tools are write-capable; read-only is not', () => {
    expect(isWriteCapableAgentDefinition(writeAgent)).toBe(true)
    expect(isWriteCapableAgentDefinition({ tools: null })).toBe(true)
    expect(isWriteCapableAgentDefinition({ tools: '*' })).toBe(true)
    expect(isWriteCapableAgentDefinition({ tools: ['*'] })).toBe(true)
    expect(isWriteCapableAgentDefinition(readAgent)).toBe(false)
    expect(
      isWriteCapableAgentDefinition({
        tools: ['*'],
        disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
      }),
    ).toBe(false)
    expect(
      isWriteCapableAgentDefinition({
        tools: ['Edit', 'Read'],
        disallowedTools: ['Edit'],
      }),
    ).toBe(false)
  })

  test('ALo is false when GB twinkling boole is off', () => {
    expect(
      hasSameCwdWriteCapableSibling({
        tasks: {
          a: {
            type: 'local_agent',
            status: 'running',
            agentId: 'a1',
            selectedAgent: writeAgent,
          } as never,
        },
        selectedAgent: writeAgent,
        effectiveIsolation: undefined,
        cwd: undefined,
        parentCwd: '/repo',
        parentAgentId: 'parent',
        siblingGateOn: false,
      }),
    ).toBe(false)
  })

  test('ALo is true with a sibling write-capable running agent', () => {
    expect(
      hasSameCwdWriteCapableSibling({
        tasks: {
          a: {
            type: 'local_agent',
            status: 'running',
            agentId: 'a1',
            selectedAgent: writeAgent,
          } as never,
        },
        selectedAgent: writeAgent,
        effectiveIsolation: undefined,
        cwd: undefined,
        parentCwd: '/repo',
        parentAgentId: 'parent',
        siblingGateOn: true,
      }),
    ).toBe(true)
  })

  test('ALo skips observers, parent self, isolation, and off-cwd spawn', () => {
    const sibling = {
      type: 'local_agent',
      status: 'running',
      agentId: 'a1',
      selectedAgent: writeAgent,
    } as never
    expect(
      hasSameCwdWriteCapableSibling({
        tasks: { a: { ...(sibling as object), isObserver: true } } as never,
        selectedAgent: writeAgent,
        effectiveIsolation: undefined,
        cwd: undefined,
        parentCwd: '/repo',
        parentAgentId: 'parent',
        siblingGateOn: true,
      }),
    ).toBe(false)
    expect(
      hasSameCwdWriteCapableSibling({
        tasks: { a: { ...(sibling as object), agentId: 'parent' } } as never,
        selectedAgent: writeAgent,
        effectiveIsolation: undefined,
        cwd: undefined,
        parentCwd: '/repo',
        parentAgentId: 'parent',
        siblingGateOn: true,
      }),
    ).toBe(false)
    expect(
      hasSameCwdWriteCapableSibling({
        tasks: { a: sibling },
        selectedAgent: writeAgent,
        effectiveIsolation: 'worktree',
        cwd: undefined,
        parentCwd: '/repo',
        parentAgentId: 'parent',
        siblingGateOn: true,
      }),
    ).toBe(false)
    expect(
      hasSameCwdWriteCapableSibling({
        tasks: { a: sibling },
        selectedAgent: writeAgent,
        effectiveIsolation: undefined,
        cwd: '/other',
        parentCwd: '/repo',
        parentAgentId: 'parent',
        siblingGateOn: true,
      }),
    ).toBe(false)
    expect(
      hasSameCwdWriteCapableSibling({
        tasks: { a: sibling },
        selectedAgent: writeAgent,
        effectiveIsolation: undefined,
        cwd: undefined,
        parentCwd: null,
        parentAgentId: 'parent',
        siblingGateOn: true,
      }),
    ).toBe(false)
  })

  test('rn is ALo && TRe — this repo has a git root so TRe is true', () => {
    expect(canStampSharesCwdNote(process.cwd())).toBe(true)
    expect(
      resolveSharesCwdStamp({
        tasks: {
          a: {
            type: 'local_agent',
            status: 'running',
            agentId: 'a1',
            selectedAgent: writeAgent,
          } as never,
        },
        selectedAgent: writeAgent,
        effectiveIsolation: undefined,
        cwd: undefined,
        parentCwd: process.cwd(),
        parentAgentId: 'parent',
        siblingGateOn: true,
      }),
    ).toBe(true)
  })

  test('AgentTool async_launched returns stamp sharesCwd when resolve true', () => {
    expect(agentToolSrc).toContain('resolveSharesCwdStamp')
    expect(agentToolSrc).toContain(
      '...(sharesCwd ? { sharesCwd: true as const } : {})',
    )
    expect(agentToolSrc).toContain('SHARES_CWD_LAUNCH_NOTE')
    // both async_launched return sites
    expect(
      agentToolSrc.split('...(sharesCwd ? { sharesCwd: true as const } : {})')
        .length - 1,
    ).toBe(2)
  })

  test('kLo K lands in Agent prompt behind Pqe&&TRe, GB default off', () => {
    const promptSrc = readFileSync(
      join(
        __dirname,
        '../../../packages/builtin-tools/src/tools/AgentTool/prompt.ts',
      ),
      'utf-8',
    )
    expect(promptSrc).toContain(
      'isSharesCwdSiblingGateOn() && canStampSharesCwdNote()',
    )
    expect(promptSrc).toContain(
      'When dispatching two or more agents that will write or edit files in the same repository, give EACH `isolation: "worktree"`',
    )
    expect(promptSrc).toContain(
      'parallel agents sharing a working directory overwrite each other',
    )
    const cwdSrc = readFileSync(
      join(__dirname, '../agentSharesCwd.ts'),
      'utf-8',
    )
    expect(cwdSrc).toContain(
      'getFeatureValue_CACHED_MAY_BE_STALE(TWINKLING_BOOLE_GATE, false)',
    )
  })
})
