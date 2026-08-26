import { describe, expect, test } from 'bun:test'

describe('isLocalIpcPath (double-slash gate)', () => {
  test('unix absolute paths are local', async () => {
    const { isLocalIpcPath } = await import('../udsMessaging.js')
    expect(isLocalIpcPath('/tmp/cc-socks/1/messaging.sock')).toBe(true)
    expect(isLocalIpcPath('/var/folders/x/y.sock')).toBe(true)
  })

  test('windows named pipes are local', async () => {
    const { isLocalIpcPath, parseWindowsNamedPipeName } = await import(
      '../udsMessaging.js'
    )
    expect(isLocalIpcPath('\\\\.\\pipe\\claude-code-1')).toBe(true)
    expect(isLocalIpcPath('//./pipe/claude-code-1')).toBe(true)
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\claude-code-1')).toBe(
      'claude-code-1',
    )
  })

  test('jWe LOCAL prefix, trailing junk, mixed \\\\?\\ (densable 2.1.239)', async () => {
    const { parseWindowsNamedPipeName } = await import('../udsMessaging.js')
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\LOCAL\\claude-code-1')).toBe(
      'LOCAL\\claude-code-1',
    )
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\foo.')).toBeUndefined()
    expect(parseWindowsNamedPipeName('\\\\.\\pipe\\foo ')).toBeUndefined()
    expect(parseWindowsNamedPipeName('\\\\?\\pipe\\ok')).toBe('ok')
  })

  test('UNC shares are non-local', async () => {
    const { isLocalIpcPath } = await import('../udsMessaging.js')
    expect(isLocalIpcPath('\\\\server\\share\\sock')).toBe(false)
    expect(isLocalIpcPath('//server/share/sock')).toBe(false)
  })
})

describe('sendToUdsSocket fail-closed strings', () => {
  test('non-local path refuses with densable message', async () => {
    const { sendToUdsSocket } = await import('../udsClient.js')
    await expect(
      sendToUdsSocket('\\\\server\\share\\x.sock', 'hi'),
    ).rejects.toThrow('Refusing to connect to non-local IPC path:')
  })

  test('ELe refuses NT object paths that isLocalIpcPath would pass', async () => {
    const { isLocalIpcPath, isLocalSocketAddress } = await import(
      '../udsMessaging.js'
    )
    const nt = '\\??\\C:\\Windows\\messaging.sock'
    expect(isLocalIpcPath(nt)).toBe(true)
    expect(isLocalSocketAddress(nt)).toBe(false)
    const { sendToUdsSocket } = await import('../udsClient.js')
    await expect(sendToUdsSocket(nt, 'hi')).rejects.toThrow(
      'Refusing to connect to non-local IPC path:',
    )
  })

  test('missing capability uses unvouched / ENOINBOX surface', async () => {
    const { sendToUdsSocket, UdsUnvouchedPipeError } = await import(
      '../udsClient.js'
    )
    const err = await sendToUdsSocket(
      `/tmp/cc-socks/no-such-${process.pid}/messaging.sock`,
      'hi',
    ).then(
      () => null,
      e => e as Error,
    )
    // densable cmp: Sli only when mti() && !(no-key && rvv). Unix does not throw.
    if (process.platform === 'win32') {
      expect(err).toBeInstanceOf(UdsUnvouchedPipeError)
      expect(err?.message).toMatch(/No running session has registered an inbox/)
      expect(err?.message).toMatch(/ENOINBOX: no-key/)
      expect((err as InstanceType<typeof UdsUnvouchedPipeError>).code).toBe(
        'no live inbox registered for the target pipe',
      )
    } else {
      expect(err).not.toBeInstanceOf(UdsUnvouchedPipeError)
    }
  })
})
