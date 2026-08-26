/**
 * densable 2.1.239 eWd / eti / nft / VEt.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compareMessagingSocketPaths,
  isOwnMessagingSocketTarget,
  messagingSocketsMayBeSame,
  startUdsMessaging,
  stopUdsMessaging,
  stripSystemVolumesDataPrefix,
} from '../udsMessaging.js'

function pipe(name: string): string {
  return `\\\\.\\pipe\\${name}`
}

describe('densable 2.1.239 nft stripSystemVolumesDataPrefix', () => {
  test('strips Data volume when remainder is a Pm_ root', () => {
    expect(
      stripSystemVolumesDataPrefix('/System/Volumes/Data/private/tmp/x'),
    ).toBe('/private/tmp/x')
    expect(stripSystemVolumesDataPrefix('/System/Volumes/Data/Users/a')).toBe(
      '/Users/a',
    )
    expect(stripSystemVolumesDataPrefix('/system/volumes/data/Library/x')).toBe(
      '/Library/x',
    )
  })

  test('leaves non-Pm_ Data paths and ordinary paths alone', () => {
    expect(
      stripSystemVolumesDataPrefix('/System/Volumes/Data/not-a-root/x'),
    ).toBe('/System/Volumes/Data/not-a-root/x')
    expect(stripSystemVolumesDataPrefix('/tmp/x')).toBe('/tmp/x')
  })
})

describe('densable 2.1.239 eWd compareMessagingSocketPaths', () => {
  test('identical strings are same', () => {
    expect(compareMessagingSocketPaths('/tmp/a.sock', '/tmp/a.sock')).toBe(
      'same',
    )
    expect(compareMessagingSocketPaths(pipe('Claude'), pipe('Claude'))).toBe(
      'same',
    )
  })

  test('named-pipe leaf h_a-fold is same; pipe vs unix is different', () => {
    expect(compareMessagingSocketPaths(pipe('Foo'), pipe('foo'))).toBe('same')
    expect(
      compareMessagingSocketPaths(pipe('claude-1'), '/tmp/claude-1.sock'),
    ).toBe('different')
  })

  test('IMr paths are not same unless the raw strings match', () => {
    expect(
      compareMessagingSocketPaths('/tmp/a/../x.sock', '/tmp/b/../x.sock'),
    ).not.toBe('same')
    expect(
      compareMessagingSocketPaths('/tmp/a/../x.sock', '/tmp/a/../x.sock'),
    ).toBe('same')
  })

  test('eti is not-different', () => {
    expect(messagingSocketsMayBeSame(pipe('Foo'), pipe('foo'))).toBe(true)
    expect(
      messagingSocketsMayBeSame(pipe('claude-1'), '/tmp/claude-1.sock'),
    ).toBe(false)
  })
})

describe('densable 2.1.239 VEt isOwnMessagingSocketTarget', () => {
  let previousConfigDir: string | undefined
  let tempConfigDir = ''

  function socket(label: string): string {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\claude-vet-${process.pid}-${label}`
    }
    return join(tempConfigDir, `${label}.sock`)
  }

  beforeEach(async () => {
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempConfigDir = await mkdtemp(join(tmpdir(), 'uds-vet-239-'))
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
  })

  afterEach(async () => {
    await stopUdsMessaging()
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir
    }
    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true })
      tempConfigDir = ''
    }
  })

  test('false when this process has no inbox', () => {
    expect(isOwnMessagingSocketTarget(pipe('missing'))).toBe(false)
  })

  test('true for own socket and eti-equivalent pipe spelling', async () => {
    const path = socket('own')
    await startUdsMessaging(path, { isExplicit: true })
    expect(isOwnMessagingSocketTarget(path)).toBe(true)
    if (process.platform === 'win32') {
      expect(
        isOwnMessagingSocketTarget(
          path.replace('\\\\.\\pipe\\', '\\\\.\\PIPE\\'),
        ),
      ).toBe(true)
    }
    expect(isOwnMessagingSocketTarget(socket('other'))).toBe(false)
  })
})
