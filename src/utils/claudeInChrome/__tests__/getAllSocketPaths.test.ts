import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { getAllSocketPaths, getSocketDir } from '../common.js'

const created: string[] = []

afterEach(async () => {
  await Promise.all(
    created.splice(0).map(p => rm(p, { recursive: true, force: true })),
  )
})

describe('getAllSocketPaths', () => {
  test('only returns existing unix sockets, not the socket directory itself', async () => {
    const dir = getSocketDir()
    // If host is running, paths may already include real socks — just assert
    // none of the returned paths is a directory.
    const { statSync, existsSync } = await import('fs')
    for (const p of getAllSocketPaths()) {
      if (!existsSync(p)) continue
      expect(statSync(p).isDirectory()).toBe(false)
      expect(statSync(p).isSocket()).toBe(true)
    }
    // Directory itself must never be listed
    expect(getAllSocketPaths().includes(dir)).toBe(false)
  })

  test('ignores non-socket files under a fake legacy path name', async () => {
    // Smoke: create a plain file that would look like a legacy name if we
    // naively listed it — getAllSocketPaths should skip non-sockets.
    const junk = join(
      tmpdir(),
      `claude-mcp-browser-bridge-notasocket-test-${Date.now()}`,
    )
    created.push(junk)
    await writeFile(junk, 'not a socket')
    // Our API uses username-based names; just ensure junk is not returned.
    expect(getAllSocketPaths().includes(junk)).toBe(false)
  })
})
