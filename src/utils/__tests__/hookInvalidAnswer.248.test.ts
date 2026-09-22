/**
 * densable 2.1.248 #21 wwt / Swt / rA.noteHookFailure
 *
 * Gold (SEA official-248/package/claude.exe):
 * - wwt @186237955 sha=fba5d4f0b9ee6440
 * - Swt @186235528 sha=7cd25b6ba6d5958a
 * - caller rA.noteHookFailure @186308528
 * - leftover host: bgNeedsInputBridge (rA) + hooks.ts execute loop
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  _resetBgNeedsInputBridgeForTests,
  emitBgNeedsInput,
  getBgNeedsInputSnapshot,
  noteHookFailure,
} from '../bgNeedsInputBridge.js'
import { Eve, parseHookOutput, Uct, wwt } from '../hooks.js'

const hooksSrc = readFileSync(join(import.meta.dir, '../hooks.ts'), 'utf8')
const hostSrc = readFileSync(
  join(import.meta.dir, '../../dialog/DialogHost.tsx'),
  'utf8',
)

describe('densable 2.1.248 #21 hook invalid answer', () => {
  afterEach(() => {
    _resetBgNeedsInputBridgeForTests()
  })

  test('gold wwt / Eve / caller strings are in leftover hosts', () => {
    expect(hooksSrc).toContain('export const Eve =')
    expect(hooksSrc).toContain('export function wwt(')
    expect(hooksSrc).toContain(
      'noteHookFailure(toolUseID, wwt(hookEvent, stderr))',
    )
    expect(hooksSrc).toContain(
      'PermissionRequest decision must be {"behavior": "allow"}',
    )
    expect(hooksSrc).toContain(
      'top-level decision is the legacy approve|block field',
    )
    expect(hostSrc).toContain("emitBgNeedsInput(label, 'permission'")
    expect(hostSrc).toContain('toolUseID: permissionToolUseID')
  })

  test('wwt strips Eve to hook output invalid', () => {
    expect(wwt('PreToolUse', `${Eve}decision: invalid`)).toBe(
      'PreToolUse hook output invalid: decision: invalid',
    )
    expect(wwt('PermissionRequest', 'boom\n\nmore')).toBe(
      'PermissionRequest hook failed: boom',
    )
    expect(wwt('PreToolUse', '  \n')).toBe('PreToolUse hook failed to run')
  })

  test('Swt names PermissionRequest schema on first line', () => {
    const result = parseHookOutput(
      '{"hookSpecificOutput":{"hookEventName":"PermissionRequest"}}',
    )
    expect(result.validationError).toContain(Eve)
    expect(result.validationError).toContain(
      'PermissionRequest decision must be {"behavior": "allow"}',
    )
    const first = result.validationError?.split('\n')[0] ?? ''
    expect(wwt('PermissionRequest', first)).toContain(
      'PermissionRequest hook output invalid:',
    )
    expect(wwt('PermissionRequest', first)).toContain(
      'PermissionRequest decision must be',
    )
  })

  test('Swt names legacy top-level decision', () => {
    const result = parseHookOutput('{"decision":"allow"}')
    expect(result.validationError).toContain(
      'top-level decision is the legacy approve|block field; for "allow"',
    )
    expect(result.validationError).toContain(
      'hookSpecificOutput.decision: {"behavior": "allow"}',
    )
  })

  test('Uct keeps Eve on line 1', () => {
    const body = `${Eve}path: msg`
    expect(Uct(body, 0, 'ignored')).toBe(body)
    expect(Uct(body, 1, '  boom  ')).toBe(
      `${body}\n\nHook exited 1 with stderr:\nboom`,
    )
  })

  test('noteHookFailure prefixes leftover agents needs with hook+schema', () => {
    emitBgNeedsInput('approve Bash: ls', 'permission', { toolUseID: 'tu-1' })
    noteHookFailure('tu-1', wwt('PreToolUse', `${Eve}decision: invalid`))
    expect(getBgNeedsInputSnapshot()?.text).toBe(
      'PreToolUse hook output invalid: decision: invalid \u00b7 approve Bash: ls',
    )
  })
})
