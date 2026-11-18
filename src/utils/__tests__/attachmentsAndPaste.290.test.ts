import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { filterAtMentionDirEntries } from '../attachments.js'
import {
  isPastedImageReadRefused,
  tryReadImageFromPath,
} from '../imagePaste.js'

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
)

describe('attachments & imagePaste Read-deny / symlink checks (#48, #53)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'attach-paste-290-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('#53 isPastedImageReadRefused and tryReadImageFromPath block Read-denied paths', async () => {
    const secretImg = join(dir, 'secret.png')
    const okImg = join(dir, 'ok.png')
    writeFileSync(secretImg, TINY_PNG)
    writeFileSync(okImg, TINY_PNG)

    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        userSettings: [`Read(/${secretImg})`],
      },
    }

    expect(isPastedImageReadRefused(secretImg, ctx)).toBe(true)
    expect(isPastedImageReadRefused(okImg, ctx)).toBe(false)
    expect(await tryReadImageFromPath(secretImg, ctx)).toBeNull()
  })

  if (process.platform !== 'win32') {
    test('#53 isPastedImageReadRefused blocks symlink to Read-denied target', async () => {
      const secretImg = join(dir, 'secret.png')
      const linkImg = join(dir, 'link.png')
      writeFileSync(secretImg, TINY_PNG)
      symlinkSync(secretImg, linkImg)

      const ctx = {
        ...getEmptyToolPermissionContext(),
        alwaysDenyRules: {
          userSettings: [`Read(/${secretImg})`],
        },
      }
      expect(isPastedImageReadRefused(linkImg, ctx)).toBe(true)
      expect(await tryReadImageFromPath(linkImg, ctx)).toBeNull()
    })
  }

  test('#53 filterAtMentionDirEntries omits Read-denied entries and symlinks to denied targets', () => {
    const subDir = join(dir, 'sub')
    const outsideDir = join(dir, 'outside')
    mkdirSync(subDir, { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
    const allowed = join(subDir, 'visible.txt')
    const denied = join(subDir, '.env')
    const secretTarget = join(outsideDir, 'secret.txt')
    writeFileSync(allowed, 'ok')
    writeFileSync(denied, 'SECRET=1')
    writeFileSync(secretTarget, 'OUTSIDE=1')
    if (process.platform !== 'win32') {
      symlinkSync(secretTarget, join(subDir, 'link-to-secret.txt'))
    }

    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        userSettings: [`Read(/${denied})`, `Read(/${secretTarget})`],
      },
    }

    const entries = readdirSync(subDir, { withFileTypes: true })
    const filtered = filterAtMentionDirEntries(entries, subDir, ctx)
    expect(filtered).toEqual(['visible.txt'])
  })
})
