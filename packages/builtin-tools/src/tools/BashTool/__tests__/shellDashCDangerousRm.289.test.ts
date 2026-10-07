/**
 * densable 2.1.289 — dangerous rm inside bash/sh -c must still ask
 * (bypassPermissions / Bash allow rules cannot auto-allow it).
 */
import { describe, expect, test } from 'bun:test'
import {
  checkDangerousRmInShellDashC,
  detectPossiblyEmptyVariableRm,
  extractShellDashCScripts,
} from '../bashPermissions.js'

describe('densable 2.1.289 shell -c dangerous rm', () => {
  test('extractShellDashCScripts unwraps bash -c / sh -c / bash -lc', () => {
    expect(extractShellDashCScripts('bash -c "rm -rf /"').scripts).toEqual([
      'rm -rf /',
    ])
    expect(extractShellDashCScripts("sh -c 'rm -rf /tmp/x'").scripts).toEqual([
      'rm -rf /tmp/x',
    ])
    expect(
      extractShellDashCScripts('bash -lc "rm -rf $HOME/*"').scripts[0],
    ).toContain('rm')
    expect(extractShellDashCScripts('rm -rf /').hadShellDashC).toBe(false)
  })

  test('detectPossiblyEmptyVariableRm still misses outer bash -c (needs unwrap)', () => {
    expect(detectPossiblyEmptyVariableRm('bash -c "rm -rf $HOME/*"')).toBeNull()
    expect(detectPossiblyEmptyVariableRm('rm -rf $HOME/*')).not.toBeNull()
  })

  test('checkDangerousRmInShellDashC asks for rm -rf / inside bash -c', () => {
    const r = checkDangerousRmInShellDashC('bash -c "rm -rf /"')
    expect(r?.behavior).toBe('ask')
    expect(r?.decisionReason).toMatchObject({
      type: 'safetyCheck',
      circuitBreaker: 'dangerousRemoval',
      classifierApprovable: false,
    })
    expect(String(r?.message ?? '')).toMatch(/shell -c|critical/i)
  })

  test('checkDangerousRmInShellDashC asks for possibly-empty var rm inside sh -c', () => {
    // Prefer an escaped `$` so the script body still carries the variable
    // (shell-quote otherwise expands empty env to `/*` before we see `$VAR`).
    const r = checkDangerousRmInShellDashC('bash -c "rm -rf \\$UNSET/*"')
    expect(r?.behavior).toBe('ask')
    expect(String(r?.message ?? '')).toMatch(
      /variable|known only when it runs|critical|shell -c/i,
    )
  })

  test('checkDangerousRmInShellDashC asks when shell-quote expands empty var to /*', () => {
    const r = checkDangerousRmInShellDashC('sh -c "rm -rf $UNSET/*"')
    expect(r?.behavior).toBe('ask')
  })

  test('checkDangerousRmInShellDashC allows non-rm shell -c', () => {
    expect(checkDangerousRmInShellDashC('bash -c "echo hi"')).toBeNull()
  })

  test('checkDangerousRmInShellDashC unwraps env/timeout wrappers', () => {
    const r = checkDangerousRmInShellDashC('timeout 5 bash -c "rm -rf /"')
    expect(r?.behavior).toBe('ask')
  })

  test('checkDangerousRmInShellDashC walks compound ;/&&/||/|', () => {
    for (const cmd of [
      'echo hi; bash -c "rm -rf /"',
      'echo x && bash -c "rm -rf /"',
      'true || bash -c "rm -rf /"',
      'echo a | bash -c "rm -rf /"',
    ]) {
      const r = checkDangerousRmInShellDashC(cmd)
      expect(r?.behavior).toBe('ask')
      expect(r?.decisionReason).toMatchObject({
        type: 'safetyCheck',
        circuitBreaker: 'dangerousRemoval',
      })
    }
  })

  test('checkDangerousRmInShellDashC peels sudo/command prefixes', () => {
    for (const cmd of [
      'sudo bash -c "rm -rf /"',
      'sudo -u root bash -c "rm -rf /"',
      'command bash -c "rm -rf /"',
      'command -v bash -c "rm -rf /"', // -v peeled; still find -c
      'env FOO=1 bash -c "rm -rf /"',
    ]) {
      // command -v bash may not be a -c invocation after peel; only assert the
      // privilege wrappers that still leave bash -c intact.
      if (cmd.startsWith('command -v')) continue
      const r = checkDangerousRmInShellDashC(cmd)
      expect(r?.behavior).toBe('ask')
    }
  })

  test('extractShellDashCScripts finds bash -c after compound/prefix', () => {
    expect(
      extractShellDashCScripts('echo hi; bash -c "rm -rf /"').scripts,
    ).toEqual(['rm -rf /'])
    expect(extractShellDashCScripts('sudo bash -c "rm -rf /"').scripts).toEqual(
      ['rm -rf /'],
    )
    expect(
      extractShellDashCScripts('echo a | bash -c "rm -rf /"').hadShellDashC,
    ).toBe(true)
  })

  test('checkDangerousRmInShellDashC walks compounds inside -c script body', () => {
    for (const cmd of [
      'bash -c "echo hi; rm -rf /"',
      'bash -c "echo hi && rm -rf /"',
      'bash -c "false || rm -rf /"',
    ]) {
      const r = checkDangerousRmInShellDashC(cmd)
      expect(r?.behavior).toBe('ask')
      expect(r?.decisionReason).toMatchObject({
        type: 'safetyCheck',
        circuitBreaker: 'dangerousRemoval',
      })
    }
  })

  test('checkDangerousRmInShellDashC asks on nested bash -c (fail-closed if quotes collapse)', () => {
    const r = checkDangerousRmInShellDashC('bash -c "bash -c \\"rm -rf /\\""')
    expect(r?.behavior).toBe('ask')
  })

  test('checkDangerousRmInShellDashC asks on L3 nested bash -c (fail-closed)', () => {
    const r = checkDangerousRmInShellDashC(
      'bash -c "bash -c \\"bash -c \\\\\\"rm -rf /\\\\\\"\\""',
    )
    expect(r?.behavior).toBe('ask')
  })

  test('checkDangerousRmInShellDashC peels privilege-before-wrapper stacks', () => {
    for (const cmd of [
      'sudo timeout 5 bash -c "rm -rf /"',
      'sudo nice bash -c "rm -rf /"',
      'env timeout 5 bash -c "rm -rf /"',
      'timeout 5 sudo bash -c "rm -rf /"',
    ]) {
      const r = checkDangerousRmInShellDashC(cmd)
      expect(r?.behavior).toBe('ask')
    }
  })

  test('checkDangerousRmInShellDashC peels leading env assignments', () => {
    for (const cmd of [
      'FOO=1 bash -c "rm -rf /"',
      'HOME=/tmp bash -c "rm -rf /"',
      'echo hi; FOO=1 bash -c "rm -rf /"',
      'FOO=1 sudo bash -c "rm -rf /"',
      'FOO=1 timeout 5 bash -c "rm -rf /"',
    ]) {
      const r = checkDangerousRmInShellDashC(cmd)
      expect(r?.behavior).toBe('ask')
    }
  })

  test('checkDangerousRmInShellDashC peels VAR=val after sudo/doas/pkexec', () => {
    for (const cmd of [
      'sudo FOO=1 bash -c "rm -rf /"',
      'sudo HOME=/tmp bash -c "rm -rf /"',
      'sudo -u root FOO=1 bash -c "rm -rf /"',
      'doas FOO=1 bash -c "rm -rf /"',
      'pkexec FOO=1 bash -c "rm -rf /"',
      'sudo FOO=1 timeout 5 bash -c "rm -rf /"',
      'sudo FOO=1 nice bash -c "rm -rf /"',
      'sudo FOO=1 BAR=2 bash -c "rm -rf /"',
      'Z=1 sudo FOO=1 bash -c "rm -rf /"',
      'env FOO=1 timeout 5 BAR=2 bash -c "rm -rf /"',
    ]) {
      const r = checkDangerousRmInShellDashC(cmd)
      expect(r?.behavior).toBe('ask')
    }
  })

  test('checkDangerousRmInShellDashC peels gold A6o/d5o wrappers (busybox/ionice/…)', () => {
    for (const cmd of [
      'busybox sh -c "rm -rf /"',
      'toybox bash -c "rm -rf /"',
      'sudo busybox sh -c "rm -rf /"',
      'ionice bash -c "rm -rf /"',
      'setsid bash -c "rm -rf /"',
      'strace bash -c "rm -rf /"',
      'unshare bash -c "rm -rf /"',
      'exec bash -c "rm -rf /"',
      'timeout 5 busybox sh -c "rm -rf /"',
    ]) {
      const r = checkDangerousRmInShellDashC(cmd)
      expect(r?.behavior).toBe('ask')
    }
    // non-rm still null; busybox without shell next stays unwrapped
    expect(checkDangerousRmInShellDashC('busybox sh -c "echo hi"')).toBeNull()
    expect(checkDangerousRmInShellDashC('busybox ls')).toBeNull()
  })

  test('checkDangerousRmInShellDashC peels gold A6o P6o/M6o residual wrappers', () => {
    // densable eut residual after A6o/d5o lite land: M6o positionals,
    // P6o flock/script -c/--command rewrite, per-wrapper value flags
    // (nsenter/unshare -m must NOT eat the shell).
    for (const cmd of [
      'flock /tmp/lock bash -c "rm -rf /"',
      'flock -x /tmp/lock bash -c "rm -rf /"',
      'flock -c "bash -c \\"rm -rf /\\""',
      'flock --command="bash -c \\"rm -rf /\\""',
      'script -c "bash -c \\"rm -rf /\\"" /dev/null',
      'nsenter -t 1 -m bash -c "rm -rf /"',
      'unshare -m bash -c "rm -rf /"',
      'taskset 0x1 bash -c "rm -rf /"',
      'chrt 10 bash -c "rm -rf /"',
      'chrt -f 10 bash -c "rm -rf /"',
      'env -S "bash -c \\"rm -rf /\\""',
    ]) {
      const r = checkDangerousRmInShellDashC(cmd)
      expect(r?.behavior).toBe('ask')
    }
    // invent-ban: xargs/su/chroot stay unpeeled
    expect(checkDangerousRmInShellDashC('xargs bash -c "rm -rf /"')).toBeNull()
    expect(checkDangerousRmInShellDashC('su -c "rm -rf /"')).toBeNull()
    expect(
      checkDangerousRmInShellDashC('chroot / bash -c "rm -rf /"'),
    ).toBeNull()
  })
})
