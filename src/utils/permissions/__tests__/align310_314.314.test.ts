import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { getOriginalCwd } from '../../../bootstrap/state.js'
import { SandboxSettingsSchema } from '../../../entrypoints/sandboxTypes.js'
import {
  checkBlockWritesOutsideWorkingDirectories,
  denyBlockedOutsideWritesForFileTool,
  getRemoteSettingsCachePaths,
  isClaudeSettingsPath,
  type ToolPermissionContextWithWriteBlock,
} from '../filesystem.js'
import { outsideReadsExplainer } from '../outsideReads.js'
import { isCoworkCloudAutoHookAllowBlocked } from '../permissions.js'

function makeContext(
  overrides: Partial<ToolPermissionContextWithWriteBlock> = {},
): ToolPermissionContextWithWriteBlock {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

describe('v2.1.310-314 permissions & sandboxTypes alignment', () => {
  test('#1204 outsideReadsExplainer(!sandboxFenced) mentions auto mode asking before shell commands', () => {
    const msg = outsideReadsExplainer(false)
    expect(msg).toContain(
      "The sandbox doesn't enforce it on this machine (off, filesystem rules relaxed, managed read-path lock on, or working directory name has glob characters). Auto mode asks before each shell command it can't check.",
    )
    expect(outsideReadsExplainer(true)).toContain(
      'Sandboxed commands lose your home directory',
    )
  })

  test('#1383 excludedCommands schema description states every command in a call must match', () => {
    const desc =
      SandboxSettingsSchema().shape.excludedCommands.description ?? ''
    expect(desc).toContain(
      'An entry takes a call out of the sandbox only when every command in the call matches an entry',
    )
    expect(desc).toContain('`a && b`')
    expect(desc).toContain('`2>&1`')
  })

  test('#1442 isCoworkCloudAutoHookAllowBlocked blocks mcp__ tools in remote_cowork auto mode', () => {
    const prev = process.env.CLAUDE_CODE_ENTRYPOINT
    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_cowork'
    try {
      expect(
        isCoworkCloudAutoHookAllowBlocked('mcp__slack__post_message', 'auto'),
      ).toBe(true)
      expect(
        isCoworkCloudAutoHookAllowBlocked(
          'mcp__slack__post_message',
          'default',
        ),
      ).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
      else process.env.CLAUDE_CODE_ENTRYPOINT = prev
    }
  })

  test('#1438 getRemoteSettingsCachePaths & isClaudeSettingsPath protect remote-settings.json and vouchers', () => {
    const cachePaths = getRemoteSettingsCachePaths()
    const homeRemote = join(getClaudeConfigHomeDir(), 'remote-settings.json')
    const projRemote = join(getOriginalCwd(), '.claude', 'remote-settings.json')
    expect(cachePaths).toContain(homeRemote)
    expect(cachePaths).toContain(`${homeRemote}.signature.json`)
    expect(cachePaths).toContain(`${homeRemote}.signature-iat.json`)
    expect(cachePaths).toContain(`${homeRemote}.synced-at`)
    expect(cachePaths).toContain(
      join(getClaudeConfigHomeDir(), 'remote-settings-helper-consent'),
    )
    expect(cachePaths).toContain(
      join(getClaudeConfigHomeDir(), 'remote-settings-consent.json'),
    )
    expect(cachePaths).toContain(projRemote)
    expect(isClaudeSettingsPath(homeRemote)).toBe(true)
    expect(isClaudeSettingsPath(`${homeRemote}.signature.json`)).toBe(true)
    expect(isClaudeSettingsPath(projRemote)).toBe(true)
  })

  test('#1354 blockWritesOutsideWorkingDirectories blocks outside paths and .json/settings files', () => {
    const cwd = getOriginalCwd()
    const ctx = makeContext({ blockWritesOutsideWorkingDirectories: true })
    const outsidePath = '/tmp/outside-314-test/file.txt'
    const insideJson = join(cwd, 'package.json')
    const insideTxt = join(cwd, 'notes.txt')

    expect(
      checkBlockWritesOutsideWorkingDirectories(outsidePath, ctx),
    ).toContain('permissions.blockWritesOutsideWorkingDirectories')
    expect(
      checkBlockWritesOutsideWorkingDirectories(insideJson, ctx),
    ).toContain('Writes to Claude Code settings files are blocked')
    expect(
      checkBlockWritesOutsideWorkingDirectories(insideTxt, ctx),
    ).toBeUndefined()

    const denyOutside = denyBlockedOutsideWritesForFileTool(outsidePath, ctx)
    expect(denyOutside?.behavior).toBe('deny')
    const denyJson = denyBlockedOutsideWritesForFileTool(insideJson, ctx)
    expect(denyJson?.behavior).toBe('deny')
    expect(denyBlockedOutsideWritesForFileTool(insideTxt, ctx)).toBeNull()
  })
})
