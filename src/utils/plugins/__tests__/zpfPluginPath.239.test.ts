/**
 * densable 2.1.239 Zpf path-kind: /mnt/ retry + errno.
 */
import { describe, expect, test } from 'bun:test'
import {
  probeZpfPluginPath,
  zpfPathNotFoundError,
  zpfPathNotFoundLog,
  ZPF_MNT_RETRY_MS,
} from '../zpfPluginPath.js'

function err(code: string): Error {
  const e = new Error(code)
  ;(e as NodeJS.ErrnoException).code = code
  return e
}

function missing(
  probe: Awaited<ReturnType<typeof probeZpfPluginPath>>,
): Extract<Awaited<ReturnType<typeof probeZpfPluginPath>>, { exists: false }> {
  expect(probe.exists).toBe(false)
  if (probe.exists) {
    throw new Error('expected missing probe')
  }
  return probe
}

describe('densable Zpf path probe', () => {
  test('/mnt/ ENOENT: no retry, no errno field', async () => {
    let delays = 0
    const probe = await probeZpfPluginPath('/mnt/ghost', {
      stat: async () => {
        throw err('ENOENT')
      },
      delay: async () => {
        delays++
      },
    })
    expect(delays).toBe(0)
    expect(probe).toEqual({ exists: false, code: 'ENOENT' })
    expect(
      zpfPathNotFoundError('synced[0]', '/mnt/ghost', missing(probe)),
    ).toEqual({
      type: 'path-not-found',
      source: 'synced[0]',
      path: '/mnt/ghost',
      component: 'commands',
    })
  })

  test('ENOENT: no retry, no errno field', async () => {
    let delays = 0
    const probe = await probeZpfPluginPath('/tmp/ghost', {
      stat: async () => {
        throw err('ENOENT')
      },
      delay: async () => {
        delays++
      },
    })
    expect(delays).toBe(0)
    expect(probe).toEqual({ exists: false, code: 'ENOENT' })
    expect(zpfPathNotFoundLog('/tmp/ghost', missing(probe))).toBe(
      'Plugin path does not exist: /tmp/ghost (ENOENT), skipping',
    )
    expect(
      zpfPathNotFoundError('synced[0]', '/tmp/ghost', missing(probe)),
    ).toEqual({
      type: 'path-not-found',
      source: 'synced[0]',
      path: '/tmp/ghost',
      component: 'commands',
    })
  })

  test('non-/mnt/ EACCES: no retry, errno is EACCES', async () => {
    let delays = 0
    const probe = await probeZpfPluginPath('/tmp/denied', {
      stat: async () => {
        throw err('EACCES')
      },
      delay: async () => {
        delays++
      },
    })
    expect(delays).toBe(0)
    expect(probe).toEqual({
      exists: false,
      code: 'EACCES',
      errno: 'EACCES',
    })
    expect(
      zpfPathNotFoundError('inline[1]', '/tmp/denied', missing(probe)),
    ).toEqual({
      type: 'path-not-found',
      source: 'inline[1]',
      path: '/tmp/denied',
      component: 'commands',
      errno: 'EACCES',
    })
  })

  test('/mnt/ EACCES then ok: retry 250ms and exists', async () => {
    let calls = 0
    let delayMs = 0
    const probe = await probeZpfPluginPath('/mnt/wsl/plugin', {
      stat: async () => {
        calls++
        if (calls === 1) throw err('EACCES')
      },
      delay: async ms => {
        delayMs = ms
      },
    })
    expect(delayMs).toBe(ZPF_MNT_RETRY_MS)
    expect(calls).toBe(2)
    expect(probe).toEqual({ exists: true })
  })

  test('/mnt/ EACCES persist: errno EACCES, log current only', async () => {
    const probe = await probeZpfPluginPath('/mnt/wsl/denied', {
      stat: async () => {
        throw err('EACCES')
      },
      delay: async () => {},
    })
    expect(probe).toEqual({
      exists: false,
      code: 'EACCES',
      errno: 'EACCES',
    })
    expect(zpfPathNotFoundLog('/mnt/wsl/denied', missing(probe))).toBe(
      'Plugin path does not exist: /mnt/wsl/denied (EACCES), skipping',
    )
  })

  test('/mnt/ EIO then ENOENT: errno is first, log both', async () => {
    let calls = 0
    const probe = await probeZpfPluginPath('/mnt/wsl/gone', {
      stat: async () => {
        calls++
        throw err(calls === 1 ? 'EIO' : 'ENOENT')
      },
      delay: async () => {},
    })
    expect(probe).toEqual({
      exists: false,
      code: 'ENOENT',
      errno: 'EIO',
    })
    expect(zpfPathNotFoundLog('/mnt/wsl/gone', missing(probe))).toBe(
      'Plugin path does not exist: /mnt/wsl/gone (ENOENT, first EIO), skipping',
    )
  })

  test('stat without code → UNKNOWN', async () => {
    const probe = await probeZpfPluginPath('/tmp/x', {
      stat: async () => {
        throw new Error('nope')
      },
      delay: async () => {},
    })
    expect(probe).toEqual({
      exists: false,
      code: 'UNKNOWN',
      errno: 'UNKNOWN',
    })
  })
})
