/**
 * densable 2.1.239: SendMessage wires H9b/P9b on via remote-control (bridge).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../SendMessageTool.ts'), 'utf8')

describe('densable 2.1.239 SendMessage H9b/P9b host', () => {
  test('permission and execute refuse elevated RC from a cloud session', () => {
    expect(src).toContain('isRemoteControlPeerUnreachableFromHere')
    expect(src).toContain('formatUnreachableElevatedRefusal')
    expect(src).toContain(
      'target is an elevated-security session unreachable from a cloud session',
    )
    expect(src).toContain("cand.kind === 'bridge-session'")
  })
})
