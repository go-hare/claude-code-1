import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clampTimeoutForAutoBackground,
  resolveSubagentAutoBackgroundCapMs,
  SUBAGENT_AUTO_BACKGROUND_CAP_MS,
} from '../autoBackgroundTimeout.js'
import { buildShellSpawnEnv } from '../Shell.js'
import {
  boundProjectTempSegmentForWindows,
  getFolderIdentityKey,
  holdWorkingDirPathAsNamed,
  isSameFolderIdentity,
  isWorkingDirPathHeldAsNamed,
  workingDirPathsForPermission,
  workingDirPathsHeldAsNamed,
  resolvedWorkingDirPaths,
} from '../permissions/filesystem.js'
import { isSameWindowsFolderIdentity } from '../windowsPaths.js'
import {
  hasReplacingManagedAutoModeAllow,
  mergeRuleArray,
} from '../../services/autoModeSetup/write.js'
import { resolveSwarmPickedEffortModel } from '../swarm/spawnInProcess.js'
import { checkMcpToolNotLoaded } from '../../services/tools/toolExecution.js'

describe('Wave 316-318 Group C (src/utils & services)', () => {
  test('#1480 & #1581 ShellCommand registers cleanupRegistry and uses SIGTERM -> SIGKILL escalation', () => {
    const src = readFileSync(join(__dirname, '../ShellCommand.ts'), 'utf8')
    expect(src).toContain('registerCleanup')
    expect(src).toContain('KILL_GRACE_MS = 1500')
    expect(src).toContain("process.kill(-pid, 'SIGTERM')")
    expect(src).toContain("process.kill(-pid, 'SIGKILL')")
  })

  test('#1481 & #1506 ShellSnapshot uses declare -F | while read func, eval -- %q, \\alias -p, and sed winpty filter', () => {
    const src = readFileSync(
      join(__dirname, '../bash/ShellSnapshot.ts'),
      'utf8',
    )
    expect(src).toContain('declare -F | while read func; do')
    expect(src).toContain("printf 'eval -- %q > /dev/null 2>&1\\\\n'")
    expect(src).toContain('\\alias -p | sed')
    expect(src).toContain('alias | sed -e "/=\'winpty /d"')
    expect(src).not.toContain('alias | grep -v "=\'winpty "')
  })

  test('#1482 & #1621 Shell.ts strips SHELLOPTS and avoids blocking exec on outputHandle.close()', () => {
    const prev = process.env.SHELLOPTS
    process.env.SHELLOPTS = 'errexit:pipefail'
    try {
      const env = buildShellSpawnEnv({
        shellType: 'bash',
        binShell: '/bin/bash',
        envOverrides: {},
      })
      expect(env.SHELLOPTS).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.SHELLOPTS
      else process.env.SHELLOPTS = prev
    }
    const src = readFileSync(join(__dirname, '../Shell.ts'), 'utf8')
    expect(src).toContain('void outputHandle.close().catch')
    expect(src).toContain('shellCommand.result = shellCommand.result.then')
  })

  test('#1672 autoBackgroundTimeout supports 180s subagentCapMs across all providers', () => {
    expect(SUBAGENT_AUTO_BACKGROUND_CAP_MS).toBe(180_000)
    expect(
      clampTimeoutForAutoBackground({
        requestedTimeoutMs: 600_000,
        isMainAgent: false,
        canAutoBackground: true,
        subagentCapMs: SUBAGENT_AUTO_BACKGROUND_CAP_MS,
      }),
    ).toBe(180_000)
    expect(
      resolveSubagentAutoBackgroundCapMs({
        agentId: 'a1',
        agentContext: { isAsync: true, isMainSession: false, agentId: 'a1' },
      }),
    ).toBe(180_000)
    expect(
      resolveSubagentAutoBackgroundCapMs({
        agentId: 'a1',
        agentContext: { isAsync: false, isMainSession: false, agentId: 'a1' },
      }),
    ).toBe(0)
  })

  test('#1500 & #1570 ripgrep.ts has forceEndTimer + stream destroy and rejectOnPartial option', () => {
    const src = readFileSync(join(__dirname, '../ripgrep.ts'), 'utf8')
    expect(src).toContain('forceEndTimer')
    expect(src).toContain('child.stdout?.destroy()')
    expect(src).toContain('child.stderr?.destroy()')
    expect(src).toContain('rejectOnPartial?: boolean')
    expect(src).toContain('RipgrepTimeoutError')
  })

  test('#1491 autoModeSetup keeps replace semantics when managed allow omits $defaults', () => {
    expect(hasReplacingManagedAutoModeAllow({ allow: ['Read', 'Grep'] })).toBe(
      true,
    )
    expect(
      hasReplacingManagedAutoModeAllow({ allow: ['$defaults', 'Read'] }),
    ).toBe(false)
    expect(mergeRuleArray('allow', [], ['CustomRule'], true)).toEqual([
      'CustomRule',
    ])
    expect(mergeRuleArray('allow', [], ['CustomRule'], false)).toEqual([
      '$defaults',
      'CustomRule',
    ])
  })

  test('#1496 registerRepoRoot + filesystem holdWorkingDirPathAsNamed', () => {
    const p = '/tmp/test-held-repo-root-318'
    try {
      holdWorkingDirPathAsNamed(p)
      expect(isWorkingDirPathHeldAsNamed(p)).toBe(true)
      expect(workingDirPathsForPermission(p)).toEqual([p])
    } finally {
      workingDirPathsHeldAsNamed.delete(p)
      resolvedWorkingDirPaths.delete(p)
    }
    const regSrc = readFileSync(
      join(__dirname, '../../commands/add-dir/registerRepoRoot.ts'),
      'utf8',
    )
    expect(regSrc).toContain('holdWorkingDirPathAsNamed(requestedRealpath)')
  })

  test('#1511 permissions_external.txt moves Scheduled-Task Fires outside <user_allow_rules_to_replace>', () => {
    const txt = readFileSync(
      join(
        __dirname,
        '../permissions/yolo-classifier-prompts/permissions_external.txt',
      ),
      'utf8',
    )
    const stripped = txt.replace(
      /<user_allow_rules_to_replace>[\s\S]*?<\/user_allow_rules_to_replace>/,
      '',
    )
    expect(stripped).toContain('- Scheduled-Task Fires:')
  })

  test('#1596 folder identity compares dev:ino via statSync bigint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folder-id-318-'))
    const sub = join(dir, 'sub')
    mkdirSync(sub)
    try {
      const id = getFolderIdentityKey(dir)
      expect(id).toMatch(/^\d+:\d+$/)
      expect(isSameFolderIdentity(dir, dir)).toBe(true)
      expect(isSameFolderIdentity(dir, sub)).toBe(false)
      expect(isSameWindowsFolderIdentity(dir, dir)).toBe(true)
      expect(isSameWindowsFolderIdentity(dir, sub)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1597 boundProjectTempSegmentForWindows bounds long Windows paths under 260 chars', () => {
    const longSeg = 'C--Users-very-long-username-' + 'a'.repeat(250)
    const base = 'C:\\Users\\alice\\AppData\\Local\\Temp\\claude-0'
    const bounded = boundProjectTempSegmentForWindows(longSeg, base, 'win32')
    expect(bounded.length).toBeLessThanOrEqual(32)
    expect(join(base, bounded).length).toBeLessThan(260)
    expect(boundProjectTempSegmentForWindows(longSeg, base, 'darwin')).toBe(
      longSeg,
    )
  })

  test('#1569 listFrames.ts requests /api/frame/frames?rel=shared&limit=...', () => {
    const src = readFileSync(
      join(__dirname, '../../services/artifactAutoReact/listFrames.ts'),
      'utf8',
    )
    expect(src).toContain('/api/frame/frames?rel=shared&limit=${limit}')
  })

  test('#1663 toolExecution checkMcpToolNotLoaded returns inputSchema when deferred MCP tool not loaded', () => {
    const fakeTool = {
      name: 'mcp__srv__do_thing',
      isMcp: true,
      shouldDefer: true,
      inputJSONSchema: {
        type: 'object',
        properties: { count: { type: 'number' } },
      },
    } as any
    const res = checkMcpToolNotLoaded(fakeTool, [], [{ name: 'ToolSearch' }])
    if (res !== null) {
      expect(res.enforced).toBe(true)
      expect(res.message).toContain('has not been loaded yet')
      expect(res.message).toContain('"count"')
    }
  })

  test('#1592 resolveSwarmPickedEffortModel returns pickedEffortModel or model', () => {
    expect(
      resolveSwarmPickedEffortModel({
        pickedEffortModel: 'claude-opus-4-6',
        model: 'sonnet',
      }),
    ).toBe('claude-opus-4-6')
    expect(resolveSwarmPickedEffortModel({ model: 'sonnet' })).toBe('sonnet')
  })
})
