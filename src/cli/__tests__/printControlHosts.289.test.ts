/**
 * densable 2.1.289 print control unique English (rewind / mcp_call / dialogs /
 * update_settings / reload_skills).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  findRewindCut,
  isStagedMcpCall,
  listHooksForControl,
  mcpCallNotFullyQualified,
  mcpCallServerNotConnected,
  mcpCallStagedDisabled,
  mcpCallToolMustBeString,
  parseMcpCallTool,
  rewindTargetUuidError,
  unavailableOnThisConnection,
  updateSettingsEffortError,
  validateUpdateSettingsRequest,
} from '../printControlHosts.js'

const PRINT = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')

describe('densable 2.1.289 print control hosts', () => {
  test('print.ts hosts unique English subtypes', () => {
    expect(PRINT).toContain("req.subtype === 'rewind_conversation'")
    expect(PRINT).toContain('rewindTargetUuidError()')
    expect(PRINT).toContain("req.subtype === 'mcp_call'")
    expect(PRINT).toContain('mcpCallToolMustBeString()')
    expect(PRINT).toContain('mcpCallStagedDisabled()')
    expect(PRINT).toContain('mcpCallServerNotConnected(')
    expect(PRINT).toContain("req.subtype === 'get_memory_dialog'")
    expect(PRINT).toContain(
      'get_memory_dialog is not available on this connection',
    )
    expect(PRINT).toContain(
      'get_skills_dialog is not available on this connection',
    )
    expect(PRINT).toContain("req.subtype === 'get_hooks_listing'")
    expect(PRINT).toContain("req.subtype === 'update_settings'")
    expect(PRINT).toContain('update_settings: effortLevel must be one of')
    expect(PRINT).toContain("req.subtype === 'reload_skills'")
  })

  test('JA unique English', () => {
    expect(
      validateUpdateSettingsRequest(true, true, 'userSettings', {
        effortLevel: 'high',
      }),
    ).toBe('update_settings is not available over a remote transport')
    expect(
      validateUpdateSettingsRequest(false, true, 'userSettings', null),
    ).toBe('update_settings requires `settings` to be an object, got null')
    expect(
      validateUpdateSettingsRequest(false, true, 'flagSettings', {
        effortLevel: 'high',
      }),
    ).toBe('update_settings: unsupported source flagSettings')
    expect(
      validateUpdateSettingsRequest(false, false, 'userSettings', {
        effortLevel: 'high',
      }),
    ).toBe(
      'update_settings: the userSettings source is disabled for this session (--setting-sources)',
    )
    expect(validateUpdateSettingsRequest(false, true, 'userSettings', {})).toBe(
      'update_settings requires at least one key',
    )
    expect(
      validateUpdateSettingsRequest(false, true, 'userSettings', {
        model: 'opus',
      }),
    ).toBe('update_settings keys not allowed: model')
    expect(
      validateUpdateSettingsRequest(false, true, 'userSettings', {
        effortLevel: 1,
      }),
    ).toBe(
      'update_settings values must be strings (deletion is not supported): effortLevel',
    )
    expect(
      validateUpdateSettingsRequest(false, true, 'userSettings', {
        effortLevel: 'nope',
      }),
    ).toBe(updateSettingsEffortError())
    expect(
      validateUpdateSettingsRequest(false, true, 'userSettings', {
        effortLevel: '50',
      }),
    ).toBe(updateSettingsEffortError())
    expect(
      validateUpdateSettingsRequest(false, true, 'userSettings', {
        effortLevel: 'high',
      }),
    ).toBeNull()
    expect(
      validateUpdateSettingsRequest(false, true, 'localSettings', {
        outputStyle: 'Explanatory',
      }),
    ).toBeNull()
  })

  test('rewind cut + unique English', () => {
    expect(rewindTargetUuidError()).toBe(
      'rewind_conversation: target_message_uuid must be a string',
    )
    expect(
      findRewindCut([{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'a' }], 'a'),
    ).toEqual({ index: 2, echoUuid: 'a' })
    expect(findRewindCut([{ uuid: 'a' }], 'missing')).toEqual({
      refuse: 'target_not_found',
    })
  })

  test('mcp_call unique English + FQ parse', () => {
    expect(mcpCallToolMustBeString()).toBe('mcp_call: tool must be a string')
    expect(mcpCallNotFullyQualified('Bash')).toBe(
      'Not a fully-qualified MCP tool name: Bash',
    )
    expect(mcpCallServerNotConnected('git')).toBe(
      'MCP server not connected: git',
    )
    expect(mcpCallStagedDisabled()).toBe('staged mcp_call is disabled')
    expect(parseMcpCallTool('mcp__git__status')).toEqual({
      serverName: 'git',
      toolName: 'status',
    })
    expect(parseMcpCallTool('Bash')).toBeNull()
    expect(isStagedMcpCall({ input_files: [] })).toBe(true)
    expect(isStagedMcpCall({ tool: 'mcp__git__status' })).toBe(false)
  })

  test('dialog unique English + hooks listing', () => {
    expect(unavailableOnThisConnection('get_memory_dialog')).toBe(
      'get_memory_dialog is not available on this connection',
    )
    expect(listHooksForControl({ PreToolUse: [{}, {}] })).toEqual({
      events: { PreToolUse: 2 },
    })
  })
})
