/**
 * densable 2.1.251 leftover — gold S keys fail closed on eligible cache miss.
 * QD/Ot: allow_remote_control / allow_remote_sessions are not isPolicyAllowed
 * fail-open.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')

describe('densable QD/Ot remote policy fail-closed', () => {
  test('isRemotePolicyAllowed is QD null', () => {
    expect(src).toContain('export function isRemotePolicyAllowed')
    expect(src).toContain('return getPolicyDenyKind(policy) === null')
    expect(src).toContain("'allow_remote_control'")
    expect(src).toContain("'allow_remote_sessions'")
    expect(src).toContain("return 'cache_miss'")
  })

  test('RC/teleport entries use Ot not fail-open isPolicyAllowed', () => {
    const files = [
      '../../../commands/bridge/bridge.tsx',
      '../../../entrypoints/remoteControlFlags.ts',
      '../../../main.tsx',
      '../../../cli/print.ts',
      '../../../utils/teleport.tsx',
      '../../../utils/background/remote/remoteSession.ts',
      '../../../utils/teleport/cloudPeerAccess.ts',
      '../../../skills/bundled/scheduleRemoteAgents.ts',
      '../../../commands/remote-env/index.ts',
      '../../../commands/remote-setup/index.ts',
      '../../../commands/review/githubAccessPrecheck.ts',
      '../../../../packages/builtin-tools/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts',
    ]
    for (const rel of files) {
      const body = readFileSync(join(import.meta.dir, rel), 'utf8')
      expect(body).toContain('isRemotePolicyAllowed')
      expect(body).not.toContain("isPolicyAllowed('allow_remote")
    }
  })
})
