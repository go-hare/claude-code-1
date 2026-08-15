/**
 * densable 2.1.233 #3 — tool memory cgroup pure helpers (y4b / g4b / h4b).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  defaultToolMemoryLimitBytes,
  parseMemoryCgroupTarget,
  parseToolMemoryLimitBytes,
  resetToolMemoryCgroupMemoForTests,
  resolveToolMemoryCgroupForSpawn,
} from '../toolMemoryCgroup.js'

afterEach(() => {
  resetToolMemoryCgroupMemoForTests()
  delete process.env.CLAUDE_CODE_TOOL_MEMORY_LIMIT
})

describe('parseToolMemoryLimitBytes densable y4b', () => {
  test('plain bytes / k / m / g', () => {
    expect(parseToolMemoryLimitBytes('1024')).toBe(1024)
    expect(parseToolMemoryLimitBytes('2k')).toBe(2 * 1024)
    expect(parseToolMemoryLimitBytes('512m')).toBe(512 * 1024 ** 2)
    expect(parseToolMemoryLimitBytes('2G')).toBe(2 * 1024 ** 3)
    expect(parseToolMemoryLimitBytes('1.5g')).toBe(Math.floor(1.5 * 1024 ** 3))
  })

  test('optional iB suffix', () => {
    expect(parseToolMemoryLimitBytes('64MiB')).toBe(64 * 1024 ** 2)
    expect(parseToolMemoryLimitBytes('1GiB')).toBe(1024 ** 3)
  })

  test('invalid / empty', () => {
    expect(parseToolMemoryLimitBytes(undefined)).toBeUndefined()
    expect(parseToolMemoryLimitBytes('')).toBeUndefined()
    expect(parseToolMemoryLimitBytes('none')).toBeUndefined()
    expect(parseToolMemoryLimitBytes('abc')).toBeUndefined()
  })
})

describe('defaultToolMemoryLimitBytes densable g4b', () => {
  test('reserves max(2GiB, 15% total)', () => {
    const total = 16 * 1024 ** 3
    const expected = Math.floor(total - Math.max(2 * 1024 ** 3, total * 0.15))
    expect(defaultToolMemoryLimitBytes(total)).toBe(expected)
  })

  test('small host uses 2GiB reserve floor', () => {
    const total = 8 * 1024 ** 3
    // 15% of 8GiB = 1.2GiB < 2GiB → reserve 2GiB
    expect(defaultToolMemoryLimitBytes(total)).toBe(total - 2 * 1024 ** 3)
  })
})

describe('parseMemoryCgroupTarget densable h4b', () => {
  test('v1 memory hierarchy', () => {
    const text = [
      '11:name=systemd:/user.slice',
      '5:memory:/user.slice/user-1000.slice',
      '1:name=systemd:/',
    ].join('\n')
    const t = parseMemoryCgroupTarget(text)
    expect(t).toEqual({
      dir: '/sys/fs/cgroup/memory/user.slice/user-1000.slice/claude-code-bash',
      v2: false,
    })
  })

  test('v2 unified hierarchy', () => {
    const text = '0::/user.slice/user-1000.slice/session-1.scope\n'
    const t = parseMemoryCgroupTarget(text)
    expect(t).toEqual({
      dir: '/sys/fs/cgroup/user.slice/user-1000.slice/claude-code-bash',
      v2: true,
    })
  })

  test('already inside claude-code-bash → undefined', () => {
    const text = '0::/user.slice/claude-code-bash\n'
    expect(parseMemoryCgroupTarget(text)).toBeUndefined()
  })

  test('no memory controller → undefined', () => {
    expect(parseMemoryCgroupTarget('1:name=systemd:/\n')).toBeUndefined()
  })
})

describe('resolveToolMemoryCgroupForSpawn densable y?Qfp()', () => {
  test('false / undefined → no cgroup option', () => {
    expect(resolveToolMemoryCgroupForSpawn(undefined)).toBeUndefined()
    expect(resolveToolMemoryCgroupForSpawn(false)).toBeUndefined()
  })

  test('true on non-linux memoizes disabled without throwing', () => {
    // win32/darwin: ensureToolMemoryCgroupDir → null; spawn gets undefined
    const dir = resolveToolMemoryCgroupForSpawn(true)
    if (process.platform !== 'linux') {
      expect(dir).toBeUndefined()
    }
  })
})
