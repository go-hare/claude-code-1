/**
 * densable Nke residual #165 — system informational / permission_denied /
 * local_command_output. Behavior only (no analytics).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { convertSDKMessage } from '../sdkMessageAdapter.js'
import type { SDKMessage } from '../../entrypoints/agentSdkTypes.js'

const srcPath = join(import.meta.dir, '../sdkMessageAdapter.ts')

describe('convertSDKMessage densable Nke #165 system extras', () => {
  test('informational converts with content/level/toolUseID/preventContinuation', () => {
    const out = convertSDKMessage({
      type: 'system',
      subtype: 'informational',
      content: 'hello info',
      level: 'warning',
      tool_use_id: 'tu_1',
      prevent_continuation: true,
      uuid: 'i1',
      session_id: 's1',
    } as SDKMessage)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    const m = out.message as any
    expect(m.type).toBe('system')
    expect(m.subtype).toBe('informational')
    expect(m.content).toBe('hello info')
    expect(m.level).toBe('warning')
    expect(m.toolUseID).toBe('tu_1')
    expect(m.preventContinuation).toBe(true)
    expect(m.isMeta).toBe(false)
  })

  test('permission_denied without convertToolResults renders warning', () => {
    const out = convertSDKMessage({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      decision_reason: 'user rejected',
      tool_use_id: 'tu_2',
      uuid: 'p1',
      session_id: 's1',
    } as SDKMessage)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    const m = out.message as any
    expect(m.subtype).toBe('informational')
    expect(m.level).toBe('warning')
    expect(m.content).toBe('Permission denied: Bash — user rejected')
    expect(m.toolUseID).toBe('tu_2')
  })

  test('permission_denied decision_reason_type only uses parens form', () => {
    const out = convertSDKMessage({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Edit',
      decision_reason_type: 'rule',
      uuid: 'p2',
      session_id: 's1',
    } as SDKMessage)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    expect((out.message as any).content).toBe('Permission denied: Edit (rule)')
  })

  test('permission_denied ignored under convertToolResults', () => {
    expect(
      convertSDKMessage(
        {
          type: 'system',
          subtype: 'permission_denied',
          tool_name: 'Bash',
          uuid: 'p3',
          session_id: 's1',
        } as SDKMessage,
        { convertToolResults: true },
      ).type,
    ).toBe('ignored')
  })

  test('local_command_output becomes synthetic assistant with uuid', () => {
    const out = convertSDKMessage({
      type: 'system',
      subtype: 'local_command_output',
      content: 'cost: $0.01',
      uuid: '11111111-1111-1111-1111-1111111111c1',
      session_id: 's1',
    } as SDKMessage)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    expect(out.message.type).toBe('assistant')
    expect(out.message.uuid).toBe('11111111-1111-1111-1111-1111111111c1')
    const content = (out.message as any).message?.content
    const text =
      Array.isArray(content) && content[0]?.type === 'text'
        ? content[0].text
        : null
    expect(text).toBe('cost: $0.01')
  })

  test('densable zi strips ANSI on informational/local_command_output', () => {
    const red = '\u001b[31mx\u001b[0m'
    const info = convertSDKMessage({
      type: 'system',
      subtype: 'informational',
      content: red,
      uuid: 'z1',
      session_id: 's1',
    } as SDKMessage)
    expect(info.type).toBe('message')
    if (info.type === 'message') {
      expect((info.message as any).content).toBe('x')
    }
    const loc = convertSDKMessage({
      type: 'system',
      subtype: 'local_command_output',
      content: red,
      uuid: '11111111-1111-1111-1111-1111111111z2',
      session_id: 's1',
    } as SDKMessage)
    expect(loc.type).toBe('message')
    if (loc.type === 'message') {
      const content = (loc.message as any).message?.content
      const text =
        Array.isArray(content) && content[0]?.type === 'text'
          ? content[0].text
          : null
      expect(text).toBe('x')
    }
  })

  test('source anchors densable Nke #165 system extras', () => {
    const src = readFileSync(srcPath, 'utf8')
    expect(src).toContain("subtype === 'informational'")
    expect(src).toContain("subtype === 'permission_denied'")
    expect(src).toContain('convertToolResults')
    expect(src).toContain("subtype === 'local_command_output'")
    expect(src).toContain('createAssistantMessage')
    expect(src).toContain('Permission denied:')
    expect(src).toContain('densableZi')
    expect(src).toContain('strip-ansi')
  })
})
