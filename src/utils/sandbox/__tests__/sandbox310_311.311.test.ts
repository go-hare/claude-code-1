import { describe, expect, test } from 'bun:test'
import { detectLinuxAppArmorUsernsRestriction } from '../sandbox-adapter.js'

describe('v2.1.310-311 sandbox alignment', () => {
  test('#1207 detectLinuxAppArmorUsernsRestriction detects AppArmor userns denial and returns remediation', () => {
    const msg = detectLinuxAppArmorUsernsRestriction({
      readRestrictionSwitch: () => '1\n',
      resolveBubblewrap: () => '/usr/bin/bwrap',
      tryBubblewrap: () => ({
        ran: true,
        exitCode: 1,
        stderr: 'bwrap: setting up uid map: Permission denied\n',
      }),
    })
    expect(msg).toBe(
      `Ubuntu's AppArmor restriction on user namespaces stops bubblewrap here ("setting up uid map: Permission denied"). Add bubblewrap's AppArmor profile from https://code.claude.com/docs/en/sandboxing, or run \`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0\` (holds until reboot), then restart Claude Code`,
    )
  })

  test('#1207 detectLinuxAppArmorUsernsRestriction returns undefined when sysctl != 1 or bwrap succeeds', () => {
    expect(
      detectLinuxAppArmorUsernsRestriction({
        readRestrictionSwitch: () => '0\n',
        resolveBubblewrap: () => '/usr/bin/bwrap',
        tryBubblewrap: () => ({
          ran: true,
          exitCode: 1,
          stderr: 'bwrap: setting up uid map: Permission denied',
        }),
      }),
    ).toBeUndefined()

    expect(
      detectLinuxAppArmorUsernsRestriction({
        readRestrictionSwitch: () => '1',
        resolveBubblewrap: () => '/usr/bin/bwrap',
        tryBubblewrap: () => ({ ran: true, exitCode: 0, stderr: '' }),
      }),
    ).toBeUndefined()
  })
})
