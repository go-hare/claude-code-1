import { describe, expect, test } from 'bun:test'
import { delimiter } from 'path'
import {
  buildShellSpawnEnv,
  formatPreSpawnDiskFullError,
  resolveCapturedShellExportsForSpawn,
} from '../Shell.js'
import { createBashShellProvider } from '../shell/bashProvider.js'

describe('Shell alignment (#904, #981, #1039, #1118)', () => {
  test('#904 buildShellSpawnEnv injects spawnEnvPluginBinPaths into PATH', () => {
    const env = buildShellSpawnEnv({
      shellType: 'powershell',
      binShell: 'pwsh',
      envOverrides: { PATH: '/usr/bin' },
      spawnEnvPluginBinPaths: ['/plugins/foo/bin'],
      shouldUseSandbox: false,
    })
    expect(env.PATH).toBe(['/usr/bin', '/plugins/foo/bin'].join(delimiter))
  })

  test('#981 resolveCapturedShellExportsForSpawn only returns exports for unsandboxed bash', () => {
    expect(
      resolveCapturedShellExportsForSpawn('powershell', false),
    ).toBeUndefined()
    expect(resolveCapturedShellExportsForSpawn('bash', true)).toBeUndefined()
  })

  test('#981 buildShellSpawnEnv merges envDefaults below subprocessEnv and envOverrides', () => {
    const env = buildShellSpawnEnv({
      shellType: 'bash',
      binShell: '/bin/bash',
      envDefaults: { ZSHRC_ONLY_VAR: 'from-zshrc', PATH: '/ignored' },
      envOverrides: { OVERRIDE_VAR: '1' },
      shouldUseSandbox: false,
    })
    expect(env.ZSHRC_ONLY_VAR).toBe('from-zshrc')
    expect(env.OVERRIDE_VAR).toBe('1')
  })

  test('#1039 formatPreSpawnDiskFullError formats ENOSPC and EDQUOT when childProcess is undefined', () => {
    const enospc = Object.assign(new Error('no space'), { code: 'ENOSPC' })
    const msg = formatPreSpawnDiskFullError(enospc, undefined)
    expect(msg).toContain(
      "The command was not started: this computer's disk is full (ENOSPC)",
    )
    expect(msg).toContain("(Claude Code's temporary directory)")

    const edquot = Object.assign(new Error('quota'), { code: 'EDQUOT' })
    const qmsg = formatPreSpawnDiskFullError(edquot, undefined)
    expect(qmsg).toContain("the user's disk quota is used up (EDQUOT)")

    const other = Object.assign(new Error('other'), { code: 'EACCES' })
    expect(formatPreSpawnDiskFullError(other, undefined)).toBeUndefined()
  })

  test('#1118 bashProvider getSpawnArgs passes --noprofile --norc and omits -l when sandboxed', async () => {
    const provider = await createBashShellProvider('/bin/bash', {
      skipSnapshot: true,
    })
    await provider.buildExecCommand('echo hi', {
      id: '1',
      useSandbox: false,
    })
    expect(provider.getSpawnArgs('echo hi')).toEqual(['-c', '-l', 'echo hi'])

    await provider.buildExecCommand('echo hi', {
      id: '2',
      sandboxTmpDir: '/tmp/claude-test',
      useSandbox: true,
    })
    expect(provider.getSpawnArgs('echo hi')).toEqual([
      '--noprofile',
      '--norc',
      '-c',
      'echo hi',
    ])
  })
})
