import { describe, expect, test } from 'bun:test'

describe('isLocalIpcPath (densable TSe)', () => {
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
    expect(err).toBeInstanceOf(UdsUnvouchedPipeError)
    expect(err?.message).toMatch(/No running session has registered an inbox/)
    expect(err?.message).toMatch(/ENOINBOX: no-key/)
    expect((err as InstanceType<typeof UdsUnvouchedPipeError>).code).toBe(
      'no live inbox registered for the target pipe',
    )
  })
})
