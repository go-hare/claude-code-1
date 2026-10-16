import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import { asAgentId } from '../../types/ids.js'
import { createLocalFsBackend } from '../storageV5/createLocalFsBackend.js'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../storageV5/hoverRestPin.js'

const transcriptByAgent = new Map<string, string>()
let projectsDir = join(tmpdir(), 'forked-skill-projects')
let sessionProjectDir: string | null = null
let sessionId = 'sess-1'

const sessionPathsSnap = snapshotModuleExports(
  await import('../sessionPaths.js'),
)
const stateSnap = snapshotModuleExports(
  await import('../../bootstrap/state.js'),
)

mock.module('../sessionPaths.js', () => ({
  ...sessionPathsSnap,
  getAgentTranscriptPath: (agentId: string) => {
    const hit = transcriptByAgent.get(String(agentId))
    if (!hit) throw new Error(`missing transcript path for ${agentId}`)
    return hit
  },
  getProjectsDir: () => projectsDir,
  getProjectDir: () => sessionProjectDir ?? join(projectsDir, 'proj'),
}))

mock.module('../../bootstrap/state.js', () => ({
  ...stateSnap,
  getSessionId: () => sessionId,
  getSessionProjectDir: () => sessionProjectDir,
  getOriginalCwd: () => '/tmp/cwd',
}))

afterAll(() => {
  mock.module('../sessionPaths.js', () => ({ ...sessionPathsSnap }))
  mock.module('../../bootstrap/state.js', () => ({ ...stateSnap }))
})

const {
  FORKED_SKILL_SCOPING_MAX_BYTES,
  forkedSkillScopingPaths,
  readForkedSkillProvenanceSkillName,
  readForkedSkillScoping,
  writeForkedSkillScoping,
} = await import('../forkedSkillScoping.js')

afterEach(() => {
  transcriptByAgent.clear()
  sessionProjectDir = null
  sessionId = 'sess-1'
  resetHoverRestPinForTests()
})

describe('forkedSkillScoping densable W3e/Ywo/fIt (2.1.289)', () => {
  test('forkedSkillScopingPaths replaces .jsonl with scoping + marker', () => {
    expect(forkedSkillScopingPaths('/tmp/agent-abc.jsonl')).toEqual({
      scoping: '/tmp/agent-abc.forked-skill.json',
      provenanceMarker: '/tmp/agent-abc.forked-skill.marker.json',
    })
  })

  test('write + read valid scoping round-trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forked-skill-scoping-'))
    const agentId = asAgentId('a-valid-1')
    transcriptByAgent.set(String(agentId), join(dir, 'agent-a-valid-1.jsonl'))

    await writeForkedSkillScoping(agentId, {
      skillName: 'explore',
      attributionName: 'explore',
      frozenCommandDenies: ['rm -rf /'],
    })

    const read = await readForkedSkillScoping(agentId)
    expect(read).toEqual({
      status: 'valid',
      scoping: {
        skillName: 'explore',
        attributionName: 'explore',
        frozenCommandDenies: ['rm -rf /'],
      },
    })
    expect(await readForkedSkillProvenanceSkillName(agentId)).toBe('explore')

    const marker = await readFile(
      join(dir, 'agent-a-valid-1.forked-skill.marker.json'),
      'utf-8',
    )
    expect(JSON.parse(marker)).toEqual({
      forkedSkill: true,
      skillName: 'explore',
    })
  })

  test('absent when neither scoping nor marker exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forked-skill-scoping-'))
    const agentId = asAgentId('a-absent-1')
    transcriptByAgent.set(String(agentId), join(dir, 'agent-a-absent-1.jsonl'))
    expect(await readForkedSkillScoping(agentId)).toEqual({ status: 'absent' })
  })

  test('absent-but-marked when only provenance marker exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forked-skill-scoping-'))
    const agentId = asAgentId('a-marked-1')
    const jsonl = join(dir, 'agent-a-marked-1.jsonl')
    transcriptByAgent.set(String(agentId), jsonl)
    const paths = forkedSkillScopingPaths(jsonl)
    await mkdir(dir, { recursive: true })
    await writeFile(
      paths.provenanceMarker,
      JSON.stringify({ forkedSkill: true, skillName: 'explore' }),
      'utf-8',
    )
    expect(await readForkedSkillScoping(agentId)).toEqual({
      status: 'absent-but-marked',
    })
  })

  test('malformed when scoping is not valid JSON / zod', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forked-skill-scoping-'))
    const agentId = asAgentId('a-bad-1')
    const jsonl = join(dir, 'agent-a-bad-1.jsonl')
    transcriptByAgent.set(String(agentId), jsonl)
    const paths = forkedSkillScopingPaths(jsonl)
    await writeFile(paths.scoping, '{not-json', 'utf-8')
    expect(await readForkedSkillScoping(agentId)).toEqual({
      status: 'malformed',
    })
  })

  test('malformed when scoping exceeds 524288 bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forked-skill-scoping-'))
    const agentId = asAgentId('a-big-1')
    const jsonl = join(dir, 'agent-a-big-1.jsonl')
    transcriptByAgent.set(String(agentId), jsonl)
    const paths = forkedSkillScopingPaths(jsonl)
    await writeFile(
      paths.scoping,
      'x'.repeat(FORKED_SKILL_SCOPING_MAX_BYTES + 1),
      'utf-8',
    )
    expect(await readForkedSkillScoping(agentId)).toEqual({
      status: 'malformed',
    })
  })

  test('Ywo storageV5 arm: F() + backend + keys reads via x()', async () => {
    const configHome = await mkdtemp(join(tmpdir(), 'forked-skill-v5-'))
    projectsDir = join(configHome, 'projects')
    sessionProjectDir = join(projectsDir, 'proj')
    sessionId = 'sess-v5'
    const agentId = asAgentId('a-v5-1')
    const jsonl = join(
      sessionProjectDir,
      sessionId,
      'subagents',
      `agent-${agentId}.jsonl`,
    )
    transcriptByAgent.set(String(agentId), jsonl)

    const backend = createLocalFsBackend({
      configHome,
      globalConfigFile: join(configHome, '.claude.json'),
    })
    const scopingKey = {
      namespace: 'sidecar' as const,
      projectKey: 'proj',
      sessionId,
      relPath: ['subagents', `agent-${agentId}.forked-skill.json`],
    }
    const markerKey = {
      namespace: 'sidecar' as const,
      projectKey: 'proj',
      sessionId,
      relPath: ['subagents', `agent-${agentId}.forked-skill.marker.json`],
    }
    const record = {
      skillName: 'explore',
      attributionName: 'explore',
    }
    const written = await backend.write(scopingKey, JSON.stringify(record))
    expect(written.ok).toBe(true)
    const markerWritten = await backend.write(
      markerKey,
      JSON.stringify({ forkedSkill: true, skillName: 'explore' }),
    )
    expect(markerWritten.ok).toBe(true)

    pinHoverRest(true)
    const read = await readForkedSkillScoping(agentId, backend)
    expect(read).toEqual({ status: 'valid', scoping: record })
    expect(await readForkedSkillProvenanceSkillName(agentId, backend)).toBe(
      'explore',
    )
  })

  test('Ywo falls back to disk when hover-rest gate is off', async () => {
    const configHome = await mkdtemp(join(tmpdir(), 'forked-skill-v5-off-'))
    projectsDir = join(configHome, 'projects')
    sessionProjectDir = join(projectsDir, 'proj')
    sessionId = 'sess-off'
    const agentId = asAgentId('a-v5-off')
    const jsonl = join(
      sessionProjectDir,
      sessionId,
      'subagents',
      `agent-${agentId}.jsonl`,
    )
    transcriptByAgent.set(String(agentId), jsonl)

    await writeForkedSkillScoping(agentId, {
      skillName: 'disk-skill',
      attributionName: 'disk-skill',
    })

    const backend = createLocalFsBackend({
      configHome,
      globalConfigFile: join(configHome, '.claude.json'),
    })
    // Gate off (default) — ignore storage even if handed.
    const read = await readForkedSkillScoping(agentId, backend)
    expect(read).toEqual({
      status: 'valid',
      scoping: { skillName: 'disk-skill', attributionName: 'disk-skill' },
    })
  })

  test('storageV5 absent-but-marked + Unavailable sets transientRead', async () => {
    pinHoverRest(true)
    const agentId = asAgentId('a-v5-transient')
    projectsDir = join(tmpdir(), 'forked-skill-projects-transient')
    sessionProjectDir = join(projectsDir, 'proj')
    sessionId = 'sess-tr'
    transcriptByAgent.set(
      String(agentId),
      join(sessionProjectDir, sessionId, 'subagents', `agent-${agentId}.jsonl`),
    )

    const fakeStorage = {
      async statMeta(key: { relPath?: string[] }) {
        const leaf = key.relPath?.at(-1) ?? ''
        if (leaf.endsWith('.forked-skill.json')) {
          return {
            ok: false as const,
            error: { code: 'Unavailable' },
          }
        }
        return {
          ok: false as const,
          error: { code: 'Unavailable' },
        }
      },
      async read() {
        return {
          ok: false as const,
          error: { code: 'Unavailable' },
        }
      },
    }

    const read = await readForkedSkillScoping(agentId, fakeStorage)
    expect(read).toEqual({
      status: 'malformed',
      transientRead: true,
    })
  })
})
