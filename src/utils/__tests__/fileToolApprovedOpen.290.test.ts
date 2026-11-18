import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  approvedPathSetFor,
  openReadBoundToApproval,
  snapshotApprovedReadIdentity,
  SymlinkResolutionChangedError,
} from '../fileToolApprovedOpen.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('2.1.290 #96 openReadBoundToApproval + snapshotApprovedReadIdentity', () => {
  test('opens an approved regular file and snapshots its dev/ino identity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-bound-'))
    tempDirs.push(dir)
    const file = join(dir, 'hello.txt')
    writeFileSync(file, 'world')
    const approved = approvedPathSetFor(file)
    const identity = await snapshotApprovedReadIdentity(approved)
    expect(identity).not.toBeNull()
    expect(typeof identity?.dev).toBe('bigint')
    expect(typeof identity?.ino).toBe('bigint')

    const opened = await openReadBoundToApproval(
      file,
      approved,
      undefined,
      identity,
      'refused',
    )
    try {
      const content = await opened.handle.readFile('utf8')
      expect(content).toBe('world')
      expect(opened.canonicalPath).toBe(realpathSync(file))
    } finally {
      await opened.close()
    }
  })

  test('refuses unapproved symlink target when no pinned identity matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-bound-sym-'))
    tempDirs.push(dir)
    const outside = join(dir, 'outside.txt')
    const link = join(dir, 'link.txt')
    writeFileSync(outside, 'secret')
    symlinkSync(outside, link)

    await expect(
      openReadBoundToApproval(link, new Set([link])),
    ).rejects.toBeInstanceOf(SymlinkResolutionChangedError)
  })
})
