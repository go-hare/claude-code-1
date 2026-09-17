/**
 * `file.ts` 的 feature-gate 反向注册槽。
 *
 * 背景：`file.ts` 原先直接 import `getFeatureValue_CACHED_MAY_BE_STALE`，
 * 这一条边把 analytics/auth 整棵树拖进来，使 `file.ts`（进而 `settings.ts`）
 * 落在 770 模块的导入环里。改成反向注册后 `file.ts` 6141ms → 81ms、
 * `settings.ts` 7055ms → 374ms。
 *
 * 这里锁两件事：回退语义，以及那条 import 不许加回来。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import {
  COMPACT_LINE_PREFIX_KILLSWITCH,
  type FileGateReader,
  isCompactLinePrefixEnabled,
  registerFileGateReader,
} from '../file.js'

// 槽是模块级的，不能假设进入测试时为空：同进程里只要有测试加载过
// `growthbook.ts`，它就会在模块体里注册一个 reader。每个用例前摘下、
// 用完原样放回，既拿到确定的起点，也不污染后续测试。
let saved: FileGateReader | null = null

beforeEach(() => {
  saved = registerFileGateReader(null)
})

afterEach(() => {
  registerFileGateReader(saved)
})

describe('registerFileGateReader', () => {
  test('返回上一个 reader，便于调用方还原', () => {
    const first: FileGateReader = () => false
    const second: FileGateReader = () => true
    expect(registerFileGateReader(first)).toBeNull()
    expect(registerFileGateReader(second)).toBe(first)
    expect(registerFileGateReader(null)).toBe(second)
  })
})

describe('isCompactLinePrefixEnabled', () => {
  test('无 reader 时回退到默认：killswitch 读不到 = 关 = 紧凑格式启用', () => {
    registerFileGateReader(null)
    expect(isCompactLinePrefixEnabled()).toBe(true)
  })

  test('killswitch 打开时禁用紧凑格式', () => {
    registerFileGateReader(gate =>
      gate === COMPACT_LINE_PREFIX_KILLSWITCH ? true : false,
    )
    expect(isCompactLinePrefixEnabled()).toBe(false)
  })

  test('killswitch 关闭时启用紧凑格式', () => {
    registerFileGateReader(() => false)
    expect(isCompactLinePrefixEnabled()).toBe(true)
  })

  test('reader 抛异常时按默认走，不把异常漏给调用方', () => {
    registerFileGateReader(() => {
      throw new Error('GrowthBook 炸了')
    })
    expect(isCompactLinePrefixEnabled()).toBe(true)
  })

  test('传给 reader 的 fallback 是 false，与原先的直接调用一致', () => {
    const seen: [string, boolean][] = []
    registerFileGateReader((gate, fallback) => {
      seen.push([gate, fallback])
      return false
    })
    isCompactLinePrefixEnabled()
    expect(seen).toEqual([[COMPACT_LINE_PREFIX_KILLSWITCH, false]])
  })
})

describe('file.ts 的依赖面', () => {
  test('不得 import growthbook —— 那条边会把 770 个模块拖回来', () => {
    const src = readFileSync('src/utils/file.ts', 'utf8')
    expect(src).not.toMatch(/from\s+['"][^'"]*analytics\/growthbook\.js['"]/)
  })
})
