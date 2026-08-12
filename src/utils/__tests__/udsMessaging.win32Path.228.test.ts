import { describe, expect, test } from 'bun:test'

describe('UDS default path shapes (228 surface)', () => {
  test('getDefaultUdsSocketPath is local IPC on this platform', async () => {
    const { getDefaultUdsSocketPath, isLocalIpcPath } = await import(
      '../udsMessaging.js'
    )
    const path = getDefaultUdsSocketPath()
    expect(isLocalIpcPath(path)).toBe(true)
    if (process.platform === 'win32') {
      expect(path.toLowerCase()).toMatch(/^\\\\\.\\pipe\\claude-code-/)
    } else {
      expect(path).toContain('cc-socks')
      expect(path).toMatch(/messaging\.sock$/)
    }
  })

  test('getPipePath windows shape documented for node compat', async () => {
    const { getPipePath } = await import('../pipeTransport.js')
    const p = getPipePath('demo-pipe')
    if (process.platform === 'win32') {
      expect(p).toBe('\\\\.\\pipe\\claude-code-demo-pipe')
    } else {
      // unix: under pipes dir
      expect(p).toContain('demo-pipe')
    }
  })
})
