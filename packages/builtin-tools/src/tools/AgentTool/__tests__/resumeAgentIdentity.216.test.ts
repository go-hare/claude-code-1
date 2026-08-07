import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

mock.module('bun:bundle', () => ({
  feature: (_name: string) => true,
}))

/**
 * densable 2.1.216 changelog #7 — resumed bg agents must not revert to
 * general-purpose (prompt + tool restrictions). Gold:
 *   - spawn writes isFork/agentType/model/spawnMode/worktree/cwd fields
 *   - H4d preserves observer pairing keys on full rewrite
 *   - Aye selection: isFork true forces FORK; type lookup; else GP
 */
describe('resume agent identity (densable 2.1.216 #7)', () => {
  const origClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  let tmpRoot: string

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'agent-meta-216-'))
    process.env.CLAUDE_CONFIG_DIR = tmpRoot
  })

  afterAll(() => {
    if (origClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = origClaudeConfigDir
    }
    try {
      rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  test('AgentMetadata type + H4d preserve keys match densable $Ns', async () => {
    const { AGENT_METADATA_PRESERVE_KEYS } = await import(
      'src/utils/sessionStorage.js'
    )
    expect([...AGENT_METADATA_PRESERVE_KEYS]).toEqual([
      'isObserver',
      'observerStopped',
      'observerTaskId',
      'armingPermissionMode',
    ])
  })

  test('writeAgentMetadata H4d merges $Ns when omitted on rewrite', async () => {
    const { asAgentId } = await import('src/types/ids.js')
    const { writeAgentMetadata, readAgentMetadata, getAgentTranscriptPath } =
      await import('src/utils/sessionStorage.js')

    const agentId = asAgentId('a-identity-h4d-216')
    // Ensure parent dir exists the same way production does
    const metaPath = getAgentTranscriptPath(agentId).replace(
      /\.jsonl$/,
      '.meta.json',
    )
    mkdirSync(join(metaPath, '..'), { recursive: true })

    await writeAgentMetadata(agentId, {
      agentType: 'Explore',
      isObserver: true,
      observerTaskId: 'obs-1',
      armingPermissionMode: 'acceptEdits',
      description: 'first',
    })
    const mid = await readAgentMetadata(agentId)
    expect(mid?.isObserver).toBe(true)
    expect(mid?.observerTaskId).toBe('obs-1')

    // Spawn-style rewrite omits $Ns — densable H4d must preserve them
    await writeAgentMetadata(agentId, {
      agentType: 'Explore',
      description: 'second',
      model: 'sonnet',
      spawnMode: 'acceptEdits',
    })
    const after = await readAgentMetadata(agentId)
    expect(after?.agentType).toBe('Explore')
    expect(after?.description).toBe('second')
    expect(after?.model).toBe('sonnet')
    expect(after?.spawnMode).toBe('acceptEdits')
    expect(after?.isObserver).toBe(true)
    expect(after?.observerTaskId).toBe('obs-1')
    expect(after?.armingPermissionMode).toBe('acceptEdits')
  })

  test('writeAgentMetadata persists densable identity fields', async () => {
    const { asAgentId } = await import('src/types/ids.js')
    const { writeAgentMetadata, readAgentMetadata } = await import(
      'src/utils/sessionStorage.js'
    )
    const agentId = asAgentId('a-identity-fields-216')
    await writeAgentMetadata(agentId, {
      agentType: 'fork',
      isFork: true,
      worktreePath: '/tmp/wt',
      worktreeBranch: 'agent-wt',
      cwd: '/tmp/wt',
      spawnMode: 'bubble',
      permissionMode: 'bubble',
      model: 'inherit',
      spawnDepth: 1,
      parentAgentId: 'parent-1',
      toolUseId: 'tu-1',
      description: 'forked',
      name: 'researcher',
    })
    const got = await readAgentMetadata(agentId)
    expect(got).toMatchObject({
      agentType: 'fork',
      isFork: true,
      worktreePath: '/tmp/wt',
      worktreeBranch: 'agent-wt',
      cwd: '/tmp/wt',
      spawnMode: 'bubble',
      permissionMode: 'bubble',
      model: 'inherit',
      spawnDepth: 1,
      parentAgentId: 'parent-1',
      toolUseId: 'tu-1',
      description: 'forked',
      name: 'researcher',
    })
  })

  test('runAgent writeAgentMetadata includes isFork for FORK_AGENT', () => {
    const src = readFileSync(join(import.meta.dir, '../runAgent.ts'), 'utf8')
    expect(src).toContain('FORK_SUBAGENT_TYPE')
    expect(src).toContain('isFork: true')
    expect(src).toContain('worktreeBranch')
    expect(src).toContain('spawnMode')
    expect(src).toContain('parentAgentId')
    expect(src).toContain('toolUseId')
  })

  test('resumeAgent Aye selection uses isFork before agentType lookup', () => {
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    // densable: j = isFork===true ? void 0 : lookup
    expect(src).toContain('meta?.isFork === true')
    expect(src).toContain('isResumedFork')
    expect(src).toContain('FORK_AGENT')
    expect(src).toContain('GENERAL_PURPOSE_AGENT')
    // model pin for non-observer
    expect(src).toContain('resumeModelAlias')
    expect(src).toContain('meta?.model')
    // spawnMode typed on meta
    expect(src).toContain('meta?.spawnMode')
    // re-persist identity fields on resume runAgent
    expect(src).toContain('worktreeBranch: meta?.worktreeBranch')
    expect(src).toContain('cwd: meta?.cwd ?? resumedWorktreePath')
  })

  test('AgentTool spawn passes identity into runAgentParams', () => {
    const src = readFileSync(join(import.meta.dir, '../AgentTool.tsx'), 'utf8')
    expect(src).toContain('worktreeBranch: worktreeInfo?.worktreeBranch')
    expect(src).toContain('cwd: cwd ?? worktreeInfo?.worktreePath')
    expect(src).toContain('spawnMode: appState.toolPermissionContext.mode')
    expect(src).toContain('toolUseId: toolUseContext.toolUseId')
    expect(src).toContain('parentAgentId: toolUseContext.agentId')
  })

  test('resolveWorkerPermissionMode still caps observer arming (MJe)', async () => {
    const { resolveWorkerPermissionMode } = await import('../resumeAgent.js')
    expect(
      resolveWorkerPermissionMode('bypassPermissions', 'acceptEdits'),
    ).toBeUndefined()
    expect(resolveWorkerPermissionMode('plan', 'bypassPermissions')).toBe(
      'plan',
    )
  })

  test('resumeAgent disk-missing falls back to in-memory task.messages (densable getTranscript)', () => {
    const src = readFileSync(join(import.meta.dir, '../resumeAgent.ts'), 'utf8')
    // densable: if (!P) { Ie = g.getTranscript(e)?.messages; if (Ie?.length) mirror }
    expect(src).toContain('disk transcript missing; using')
    expect(src).toContain('in-memory messages mirrored during the run')
    expect(src).toContain('contentReplacements: []')
    // live re-read of tasks (not only entry snapshot)
    expect(src).toContain('toolUseContext.getAppState().tasks')
    // still throws densable copy when both empty
    expect(src).toContain('No transcript found for agent ID:')
    // fallback sits before the hard throw
    const mirrorIdx = src.indexOf('disk transcript missing; using')
    const throwIdx = src.indexOf('No transcript found for agent ID:')
    expect(mirrorIdx).toBeGreaterThan(0)
    expect(throwIdx).toBeGreaterThan(mirrorIdx)
  })
})
