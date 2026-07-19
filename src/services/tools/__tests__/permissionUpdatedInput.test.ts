/**
 * densable residual — PERMISSION_UPDATED_INPUT when canUseTool/hook returns
 * non-empty updatedInput that fails schema (ignoring unrecognized_keys).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('toolExecution densable PERMISSION_UPDATED_INPUT residual', () => {
  const src = readFileSync(join(import.meta.dir, '../toolExecution.ts'), 'utf8')

  test('errorCode PERMISSION_UPDATED_INPUT + feature_sad tool_permission_updated_input_invalid', () => {
    expect(src).toContain("'PERMISSION_UPDATED_INPUT'")
    expect(src).toContain("'tool_permission_updated_input_invalid'")
    const idx = src.indexOf("'PERMISSION_UPDATED_INPUT'")
    const window = src.slice(Math.max(0, idx - 500), idx + 200)
    expect(window).toContain("logEvent('tengu_feature_sad'")
    expect(window).toContain("logEvent('tengu_tool_use_error'")
    expect(window).toContain("'InputValidationError'")
  })

  test('skips empty updatedInput via isEmptyPlainObject densable h1i', () => {
    expect(src).toContain(
      'isEmptyPlainObject(permissionDecision.updatedInput)',
    )
    // densable: only apply/re-validate when !h1i(updatedInput)
    expect(src).toContain(
      '!isEmptyPlainObject(permissionDecision.updatedInput)',
    )
    // empty {} must not overwrite processedInput
    const emptyGate = src.indexOf(
      '!isEmptyPlainObject(permissionDecision.updatedInput)',
    )
    const assign = src.indexOf(
      'processedInput = permissionDecision.updatedInput',
    )
    expect(emptyGate).toBeGreaterThan(-1)
    expect(assign).toBeGreaterThan(emptyGate)
  })

  test('CKu: filters unrecognized_keys before treating as invalid', () => {
    expect(src).toContain("issue.code !== 'unrecognized_keys'")
    expect(src).toContain('materialIssues')
    // CKu gate sits on the updatedInput path near PERMISSION_UPDATED_INPUT
    const empty = src.indexOf(
      '!isEmptyPlainObject(permissionDecision.updatedInput)',
    )
    const perm = src.indexOf("'PERMISSION_UPDATED_INPUT'")
    expect(empty).toBeGreaterThan(-1)
    expect(empty).toBeLessThan(perm)
  })

  test('errorDetailsHash + zodIssueCodes on updatedInput path', () => {
    const idx = src.indexOf("'PERMISSION_UPDATED_INPUT'")
    const window = src.slice(idx, idx + 500)
    expect(window).toContain('errorDetailsHash')
    expect(window).toContain('shortSha256Hex12')
    expect(window).toContain('zodIssueCodes')
  })

  test('user-facing densable configuration issue message', () => {
    expect(src).toContain(
      'permission handler returned updatedInput for ${tool.name} that failed schema validation',
    )
    expect(src).toContain(
      'configuration issue in your canUseTool callback, PermissionRequest hook',
    )
    expect(src).toContain(
      'permission handler updatedInput failed schema for ${tool.name}',
    )
  })

  test('reject span source permission_updated_input_invalid densable JFr', () => {
    expect(src).toContain("'permission_updated_input_invalid'")
    expect(src).toContain('endToolBlockedOnUserSpan')
  })

  test('path is after can_use_tool_allowed and before tool call', () => {
    const allowed = src.indexOf("logEvent('tengu_tool_use_can_use_tool_allowed'")
    const perm = src.indexOf("'PERMISSION_UPDATED_INPUT'")
    const ok = src.indexOf("logEvent('tengu_feature_ok'")
    expect(allowed).toBeGreaterThan(-1)
    expect(perm).toBeGreaterThan(allowed)
    expect(ok).toBeGreaterThan(perm)
  })
})
