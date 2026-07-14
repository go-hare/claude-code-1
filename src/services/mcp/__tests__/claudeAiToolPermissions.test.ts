/**
 * Official 2.1.x: Kdg — claude.ai connector tools → toolPermissions.
 */
import { describe, expect, test } from 'bun:test'
import { toolPermissionsFromClaudeAiTools } from '../claudeai.js'

describe('toolPermissionsFromClaudeAiTools (Kdg)', () => {
  test('empty/undefined yields undefined', () => {
    expect(toolPermissionsFromClaudeAiTools(undefined)).toBeUndefined()
    expect(toolPermissionsFromClaudeAiTools([])).toBeUndefined()
  })

  test('maps allow/ask/blocked and fails closed on invalid', () => {
    expect(
      toolPermissionsFromClaudeAiTools([
        { name: 'read', effective_max_permission: 'allow' },
        { name: 'send', effective_max_permission: 'ask' },
        { name: 'delete', effective_max_permission: 'blocked' },
        { name: 'weird', effective_max_permission: 'nope' },
        { name: 'unset' },
      ]),
    ).toEqual({
      read: 'allow',
      send: 'ask',
      delete: 'blocked',
      weird: 'blocked',
    })
  })

  test('all unset yields undefined', () => {
    expect(
      toolPermissionsFromClaudeAiTools([{ name: 'a' }, { name: 'b' }]),
    ).toBeUndefined()
  })
})
