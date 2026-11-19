import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getEmptyToolPermissionContext,
  type ToolPermissionContext,
} from '../../../Tool.js'
import { planModelSupportsAutoMode } from '../../betas.js'
import { validatePermissionRule } from '../../settings/permissionValidation.js'
import {
  getClaudeTempDir,
  isCurrentSessionTaskOutputPath,
} from '../filesystem.js'
import {
  _setAllowRuleSecretScannerForTesting,
  applyPermissionUpdate,
  classifyAllowRuleSessionOnlyReason,
  downgradePermissionUpdateForPersistence,
  SESSION_ONLY_ALLOW_REASON_MESSAGES,
} from '../PermissionUpdate.js'
import { stripToolCheckHookResult } from '../permissions.js'
import {
  getReadDenyRuleForPath,
  isPathCoveredByReadDenyRule,
} from '../../../../packages/builtin-tools/src/tools/shared/fileEditReadGate.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  _setAllowRuleSecretScannerForTesting(undefined)
  for (const d of tempDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe('Wave 323 Permissions & Modes (#1973, #2015, #2019, #2023, #2026, #2176)', () => {
  test('#1973: warns on Bash allow rule with wildcard in env var value', () => {
    const res = validatePermissionRule('Bash(PORT=* npm run dev)', 'allow')
    expect(res.valid).toBe(true)
    expect(res.securityNotice).toBeDefined()
    expect(res.securityNotice).toContain('PORT=*')

    const denyRes = validatePermissionRule('Bash(PORT=* npm run dev)', 'deny')
    expect(denyRes.securityNotice).toBeUndefined()
  })

  test('#2015: allows reading current session task output across worktree cwd change', () => {
    const tempRoot = getClaudeTempDir()
    const ownTaskOutput = join(
      tempRoot,
      '-old-project-cwd',
      'session-abc',
      'tasks',
      'task-1.output',
    )
    const otherSessionOutput = join(
      tempRoot,
      '-old-project-cwd',
      'session-other',
      'tasks',
      'task-1.output',
    )
    const nonTaskFile = join(
      tempRoot,
      '-old-project-cwd',
      'session-abc',
      'scratchpad',
      'notes.txt',
    )

    expect(isCurrentSessionTaskOutputPath(ownTaskOutput, 'session-abc')).toBe(
      true,
    )
    expect(
      isCurrentSessionTaskOutputPath(otherSessionOutput, 'session-abc'),
    ).toBe(false)
    expect(isCurrentSessionTaskOutputPath(nonTaskFile, 'session-abc')).toBe(
      false,
    )

    // #2015 P0-4 regression: symlink inside current session's `tasks/` pointing
    // outside (or to another session's tasks) MUST be rejected (AND semantics).
    const testSession = `session-symlink-test-${Date.now()}`
    const projSlug = `-w323-task-test-${Date.now()}`
    const tasksDir = join(tempRoot, projSlug, testSession, 'tasks')
    const otherTasksDir = join(tempRoot, projSlug, 'other-session', 'tasks')
    mkdirSync(tasksDir, { recursive: true })
    mkdirSync(otherTasksDir, { recursive: true })
    tempDirs.push(join(tempRoot, projSlug))

    const realTaskFile = join(tasksDir, 'legit.output')
    writeFileSync(realTaskFile, 'ok\n')
    expect(isCurrentSessionTaskOutputPath(realTaskFile, testSession)).toBe(true)
    expect(
      isCurrentSessionTaskOutputPath(realpathSync(realTaskFile), testSession),
    ).toBe(true)

    const outsideDir = makeTempDir('w323-task-outside-')
    const outsideSecret = join(outsideDir, 'secret.txt')
    writeFileSync(outsideSecret, 'TOP_SECRET\n')
    const escapingLink = join(tasksDir, 'escape.output')
    symlinkSync(outsideSecret, escapingLink)
    expect(isCurrentSessionTaskOutputPath(escapingLink, testSession)).toBe(
      false,
    )

    const otherSessionFile = join(otherTasksDir, 'other.output')
    writeFileSync(otherSessionFile, 'OTHER\n')
    const crossSessionLink = join(tasksDir, 'cross.output')
    symlinkSync(otherSessionFile, crossSessionLink)
    expect(isCurrentSessionTaskOutputPath(crossSessionLink, testSession)).toBe(
      false,
    )

    const danglingOutsideLink = join(tasksDir, 'dangling.output')
    symlinkSync(join(outsideDir, 'missing.txt'), danglingOutsideLink)
    expect(
      isCurrentSessionTaskOutputPath(danglingOutsideLink, testSession),
    ).toBe(false)
  })

  test('#2019: refuses Haiku models behind ANTHROPIC_BASE_URL gateway except claude-haiku-5-5', () => {
    const prevBase = process.env.ANTHROPIC_BASE_URL
    try {
      process.env.ANTHROPIC_BASE_URL = 'https://gateway.internal.example.com'
      expect(
        planModelSupportsAutoMode('gateway-claude-haiku-4-5', 'firstParty'),
      ).toBe(false)
      expect(planModelSupportsAutoMode('my-custom-haiku', 'firstParty')).toBe(
        false,
      )
      expect(planModelSupportsAutoMode('claude-haiku-5-5', 'firstParty')).toBe(
        true,
      )
      expect(planModelSupportsAutoMode('claude-sonnet-4-6', 'firstParty')).toBe(
        true,
      )
    } finally {
      if (prevBase === undefined) {
        delete process.env.ANTHROPIC_BASE_URL
      } else {
        process.env.ANTHROPIC_BASE_URL = prevBase
      }
    }
  })

  test('#2023: Read deny rule covers symlinked path spellings', () => {
    const dir = makeTempDir('w323-readdeny-')
    const secretFile = join(dir, 'secret.env')
    const linkFile = join(dir, 'alias.txt')
    writeFileSync(secretFile, 'TOP_SECRET=1\n')
    symlinkSync(secretFile, linkFile)

    const ctx: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        userSettings: [`Read(//${secretFile.replace(/^\//, '')})`],
      },
    }

    expect(getReadDenyRuleForPath(secretFile, ctx)).not.toBeNull()
    expect(getReadDenyRuleForPath(linkFile, ctx)).not.toBeNull()
    expect(isPathCoveredByReadDenyRule(linkFile, ctx)).toBe(true)
  })

  test('#2026: stripToolCheckHookResult stamps only the asking plugin', () => {
    const prior = [{ decision: 'allow' }]
    const stripped = stripToolCheckHookResult(
      { decision: 'ask', reason: 'needs review' },
      prior,
      { name: 'plugin-b' },
    )
    expect(stripped).toEqual({
      decision: 'ask',
      reason: 'needs review',
      plugin: 'plugin-b',
    })

    // Non-ask decisions do not get a plugin stamp
    const allowStripped = stripToolCheckHookResult(
      { decision: 'allow', plugin: 'spoofed' },
      prior,
      { name: 'plugin-a' },
    )
    expect(allowStripped).toEqual({ decision: 'allow' })
  })

  test('#2176: secret-bearing allow rule downgrades to session-only', () => {
    _setAllowRuleSecretScannerForTesting(text => text.includes('sk-ant-secret'))
    const rule = {
      toolName: 'Bash',
      ruleContent: 'curl -H "x-api-key: sk-ant-secret" https://example.com',
    }
    const update = {
      type: 'addRules' as const,
      behavior: 'allow' as const,
      destination: 'localSettings' as const,
      rules: [rule],
    }
    expect(classifyAllowRuleSessionOnlyReason(rule, 'localSettings')).toBe(
      'holds_secret',
    )
    const downgraded = downgradePermissionUpdateForPersistence(update)
    expect(downgraded.reason).toBe('holds_secret')
    expect(downgraded.updates[0]?.destination).toBe('session')
    expect(SESSION_ONLY_ALLOW_REASON_MESSAGES.holds_secret).toContain(
      'session only',
    )

    const nextCtx = applyPermissionUpdate(
      getEmptyToolPermissionContext(),
      update,
    )
    expect(nextCtx.alwaysAllowRules.session?.length).toBe(1)
    expect(nextCtx.alwaysAllowRules.localSettings).toBeUndefined()
  })
})
