import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ArtifactTool,
  _resetStoredDbAccessRulesForTesting,
  recordStoredDbAccessRules,
} from '@claude-code/builtin-tools/tools/ArtifactTool/ArtifactTool.js'
import { resolveRunAgentEffort } from '@claude-code/builtin-tools/tools/AgentTool/runAgent.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { builtInCommandNames, getBuiltinCommands } from '../commands.js'
import { ShareOnboardingGuideTool } from '../commands/team-onboarding/shareOnboardingGuide.js'
import { findToolByName, getEmptyToolPermissionContext } from '../Tool.js'
import { getAllBaseTools } from '../tools.js'
import {
  holdWorkingDirPathAsNamed,
  isWorkingDirPathHeldAsNamed,
  pathInAllowedWorkingPath,
  pathInOutsideReadFenceWorkingPath,
  pathInWorkingPath,
  resolvedWorkingDirPaths,
  workingDirPathsForPermission,
  workingDirPathsHeldAsNamed,
} from '../utils/permissions/filesystem.js'
import { shouldSkipWhereCandidateAsCwdShadow } from '../utils/windowsPaths.js'

describe('Deep wiring Group 1 (Commands / Agent / Artifact / Filesystem)', () => {
  const prevEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, val: string | undefined) {
    if (!(key in prevEnv)) prevEnv[key] = process.env[key]
    if (val === undefined) delete process.env[key]
    else process.env[key] = val
  }

  afterEach(() => {
    for (const [key, val] of Object.entries(prevEnv)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
    for (const key of Object.keys(prevEnv)) delete prevEnv[key]
    _resetStoredDbAccessRulesForTesting()
  })

  test('#1558 & #1559: /team-onboarding is registered in COMMANDS and ShareOnboardingGuide in getAllBaseTools', async () => {
    expect(builtInCommandNames().has('team-onboarding')).toBe(true)
    const cmd = getBuiltinCommands().find(c => c.name === 'team-onboarding')
    expect(cmd).toBeDefined()
    expect(cmd?.type).toBe('prompt')

    const registeredTool = findToolByName(
      getAllBaseTools(),
      'ShareOnboardingGuide',
    )
    expect(registeredTool).toBe(ShareOnboardingGuideTool)
    expect(ShareOnboardingGuideTool.isDestructive({ mode: 'delete' })).toBe(
      true,
    )
    expect(ShareOnboardingGuideTool.isDestructive({ mode: 'check' })).toBe(
      false,
    )

    // #1558: delete without short_code through ShareOnboardingGuideTool.call lists guides and deletes nothing
    const getSpy = spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: {
        guides: [
          {
            short_code: 'guide-1',
            share_url: 'https://claude.ai/onboarding/guide-1',
            updated_at: '2026-10-01',
          },
        ],
      },
    } as never)
    try {
      const result = await ShareOnboardingGuideTool.call({ mode: 'delete' })
      expect(result.data.status).toBe('unavailable')
      expect(result.data.message).toContain('Nothing was deleted')
      expect(result.data.message).toContain('guide-1')
      const block =
        ShareOnboardingGuideTool.mapToolResultToToolResultBlockParam(
          result.data,
          'tu-1',
        )
      expect(block.content).toContain('[unavailable]')
      expect(block.content).toContain('guide-1')
    } finally {
      getSpy.mockRestore()
    }

    // #1559: delete with short_code reports server refusal status 403
    const delSpy = spyOn(axios, 'delete').mockResolvedValueOnce({
      status: 403,
      data: {},
    } as never)
    try {
      const result = await ShareOnboardingGuideTool.call({
        mode: 'delete',
        short_code: 'guide-1',
      })
      expect(result.data.status).toBe('unavailable')
      expect(result.data.message).toContain('status 403')
    } finally {
      delSpy.mockRestore()
    }
  })

  test('#1476: resolveRunAgentEffort applies agent > CLAUDE_CODE_SUBAGENT_EFFORT > inherit precedence', () => {
    const baseAgent = {
      agentType: 'Explore',
      whenToUse: 'explore',
      getSystemPrompt: () => '',
      source: 'built-in',
    } as unknown as AgentDefinition

    setEnv('CLAUDE_CODE_SUBAGENT_EFFORT', 'medium')
    expect(resolveRunAgentEffort(baseAgent)).toBe('medium')

    // Explicit agent definition effort wins over CLAUDE_CODE_SUBAGENT_EFFORT
    expect(resolveRunAgentEffort({ ...baseAgent, effort: 'high' })).toBe('high')

    // Inherited effort permission layer yields to parent layer (returns undefined)
    expect(
      resolveRunAgentEffort(baseAgent, [{ kind: 'effort', effort: 'high' }]),
    ).toBeUndefined()

    // Fork and ineligible built-in web-fetch skip CLAUDE_CODE_SUBAGENT_EFFORT
    expect(
      resolveRunAgentEffort({ ...baseAgent, agentType: 'fork' }),
    ).toBeUndefined()
    expect(
      resolveRunAgentEffort({ ...baseAgent, agentType: 'web-fetch' }),
    ).toBeUndefined()

    // 'inherit' falls back to inheriting parent session effort
    setEnv('CLAUDE_CODE_SUBAGENT_EFFORT', 'inherit')
    expect(resolveRunAgentEffort(baseAgent)).toBeUndefined()
  })

  test('#1497: ArtifactTool validates self DB rules, refuses silent republish drop, and renders summary in tool results', async () => {
    // 1. validateInput accepts {self} path and self tier, rejects invalid tier/path
    const validRes = await ArtifactTool.validateInput?.({
      file_path: '/tmp/app.html',
      capabilities: {
        db: {
          rules: [
            { path: 'users/{self}/profile', read: 'self', write: 'self' },
          ],
        },
      },
    } as never)
    expect(validRes?.result).toBe(true)

    const invalidTierRes = await ArtifactTool.validateInput?.({
      file_path: '/tmp/app.html',
      capabilities: {
        db: {
          rules: [{ path: 'users/{self}', read: 'superuser' }],
        },
      },
    } as never)
    expect(invalidTierRes?.result).toBe(false)

    // 2. mapToolResultToToolResultBlockParam formats db_access_rules and dropped_db_access_rules
    const uploadBlock = ArtifactTool.mapToolResultToToolResultBlockParam(
      {
        id: 'art-1',
        url: 'https://claude.ai/artifacts/art-1',
        expiresAt: '2026-12-01',
        db_access_rules: [
          { path: 'users/{self}/notes', read: 'self', write: 'self' },
        ],
        dropped_db_access_rules: [{ path: 'legacy/items', read: 'view' }],
      },
      'tu-art-1',
    )
    expect(String(uploadBlock.content)).toContain(
      'users/{self}/notes: read=self, write=self',
    )
    expect(String(uploadBlock.content)).toContain(
      '1 database access rule was dropped on republish',
    )

    const readBlock = ArtifactTool.mapToolResultToToolResultBlockParam(
      {
        id: '',
        url: '',
        expiresAt: '',
        read: {
          url: 'https://claude.ai/artifacts/art-1',
          bytes: 12,
          code: 200,
          codeText: 'OK',
          result: '<html></html>',
          durationMs: 1,
        },
        db_access_rules: [{ path: '', read: 'view', write: 'interact' }],
      },
      'tu-art-2',
    )
    expect(String(readBlock.content)).toContain(
      '(root): read=view, write=interact',
    )

    // 3. Republish guard refuses capabilities.db without rules when stored rules exist
    const dir = mkdtempSync(join(tmpdir(), 'artifact-db-rules-'))
    const htmlFile = join(dir, 'page.html')
    writeFileSync(htmlFile, '<html><body>hi</body></html>', 'utf8')
    try {
      recordStoredDbAccessRules('my-artifact-hash', [
        { path: 'users/{self}/prefs', read: 'self', write: 'self' },
      ])
      const res = await ArtifactTool.call(
        {
          file_path: htmlFile,
          hash: 'my-artifact-hash',
          capabilities: { db: true },
        } as never,
        {} as never,
      )
      expect(res.data.error).toBeDefined()
      expect(res.data.error).toContain('re-sends db without its rules')
      expect(res.data.error).toContain('users/{self}/prefs')
      expect(res.data.error).toContain('db: {"rules": []}')
      expect(res.data.error).toContain(
        '1 database access rule was dropped on republish',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1596 & #1496: folder dev:ino identity and held-as-named paths integrate into filesystem & windowsPaths checks', () => {
    const base = mkdtempSync(join(tmpdir(), 'folder-id-wire-'))
    const realDir = join(base, 'real-repo')
    const subDir = join(realDir, 'src')
    const outsideDir = join(base, 'outside')
    const aliasDir = join(base, 'alias-repo')
    const escapeLink = join(realDir, 'escape-link')
    mkdirSync(subDir, { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(subDir, 'index.ts'), 'export {}\n', 'utf8')
    writeFileSync(join(outsideDir, 'secret.txt'), 'nope\n', 'utf8')
    symlinkSync(realDir, aliasDir)
    symlinkSync(outsideDir, escapeLink)

    try {
      // #1596 in filesystem.ts: alias pointing to same dev:ino directory matches workingPath
      expect(
        pathInWorkingPath(aliasDir, realDir, {
          caseFold: false,
          uncShapeParity: true,
        }),
      ).toBe(true)
      expect(
        pathInWorkingPath(join(aliasDir, 'src', 'index.ts'), realDir, {
          caseFold: false,
          uncShapeParity: true,
        }),
      ).toBe(true)

      // Through pathInAllowedWorkingPath & pathInOutsideReadFenceWorkingPath
      const ctx = {
        ...getEmptyToolPermissionContext(),
        additionalWorkingDirectories: new Map([
          [realDir, { path: realDir, source: 'session' as const }],
        ]),
      }
      expect(
        pathInAllowedWorkingPath(join(aliasDir, 'src', 'index.ts'), ctx),
      ).toBe(true)
      expect(
        pathInOutsideReadFenceWorkingPath(
          join(aliasDir, 'src', 'index.ts'),
          ctx,
        ),
      ).toBe(true)

      // Symlink escaping outside realDir is still rejected
      expect(
        pathInAllowedWorkingPath(join(escapeLink, 'secret.txt'), ctx),
      ).toBe(false)

      // #1496: when realDir is held as named, aliasDir MUST NOT match via inode/symlink expansion
      holdWorkingDirPathAsNamed(realDir)
      expect(isWorkingDirPathHeldAsNamed(realDir)).toBe(true)
      expect(workingDirPathsForPermission(realDir)).toEqual([realDir])
      expect(
        pathInWorkingPath(aliasDir, realDir, {
          caseFold: false,
          uncShapeParity: true,
        }),
      ).toBe(false)
      expect(
        pathInWorkingPath(join(aliasDir, 'src', 'index.ts'), realDir, {
          caseFold: false,
          uncShapeParity: true,
        }),
      ).toBe(false)
      expect(
        pathInAllowedWorkingPath(join(aliasDir, 'src', 'index.ts'), ctx, [
          join(aliasDir, 'src', 'index.ts'),
        ]),
      ).toBe(false)

      // #1596 in windowsPaths.ts: shouldSkipWhereCandidateAsCwdShadow catches aliased cwd via dev:ino
      expect(
        shouldSkipWhereCandidateAsCwdShadow(join(aliasDir, 'git.exe'), realDir),
      ).toBe(true)
      expect(
        shouldSkipWhereCandidateAsCwdShadow(
          join(outsideDir, 'git.exe'),
          realDir,
        ),
      ).toBe(false)
    } finally {
      workingDirPathsHeldAsNamed.delete(realDir)
      resolvedWorkingDirPaths.delete(realDir)
      rmSync(base, { recursive: true, force: true })
    }
  })
})
