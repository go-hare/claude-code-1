import { afterEach, describe, expect, test } from 'bun:test'
import {
  isDarwinHomeAutomounted,
  resetDarwinHomeAutomountedForTesting,
} from '../path.js'

afterEach(() => {
  resetDarwinHomeAutomountedForTesting()
})

describe('#527: macOS /etc/auto_master and homeIsOwnMount check', () => {
  test('returns true when /etc/auto_master has an active /home entry', () => {
    expect(
      isDarwinHomeAutomounted({
        readAutoMaster: () =>
          '# Automounter master map\n/net\t\t-hosts\n/home\t\tauto_home\n',
        homeIsOwnMount: () => false,
      }),
    ).toBe(true)
  })

  test('ignores commented #/home entries in /etc/auto_master', () => {
    expect(
      isDarwinHomeAutomounted({
        readAutoMaster: () => '# /home auto_home\n/net -hosts\n',
        homeIsOwnMount: () => false,
      }),
    ).toBe(false)
  })

  test('returns true when homeIsOwnMount() is true even without /etc/auto_master entry', () => {
    expect(
      isDarwinHomeAutomounted({
        readAutoMaster: () => '/net -hosts\n',
        homeIsOwnMount: () => true,
      }),
    ).toBe(true)
  })

  test('treats ENOENT on /etc/auto_master as no entry and falls back to homeIsOwnMount()', () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    expect(
      isDarwinHomeAutomounted({
        readAutoMaster: () => {
          throw enoent
        },
        homeIsOwnMount: () => false,
      }),
    ).toBe(false)
  })

  test('fails safe to true on unexpected errors', () => {
    expect(
      isDarwinHomeAutomounted({
        readAutoMaster: () => {
          throw new Error('EACCES')
        },
        homeIsOwnMount: () => false,
      }),
    ).toBe(true)
  })
})
