import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { wrapAnsi } from '../wrapAnsi.js'

describe('2.1.290 #55/#59 wrapAnsi NON_FAST_PATH regex fast-path', () => {
  test('source uses official NON_FAST_PATH regex excluding dashes, arrows, box-drawing, CJK', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'wrapAnsi.ts'), 'utf8')
    expect(src).toContain('NON_FAST_PATH')
    expect(src).not.toContain('HAS_NON_ASCII')
  })

  test('wraps dashes, arrows, box-drawing, and CJK cleanly via fast-path', () => {
    const text = 'hello — world → next │ box 中文测试'
    const wrapped = wrapAnsi(text, 20, { hard: true })
    expect(wrapped.split('\n').length).toBeGreaterThan(1)
    expect(wrapped).toContain('—')
    expect(wrapped).toContain('→')
    expect(wrapped).toContain('│')
    expect(wrapped).toContain('中文测试')
  })

  test('protects ZWJ / combining emoji clusters without splitting', () => {
    const zwj = '👨‍👩‍👧‍👦'.repeat(5)
    const wrapped = wrapAnsi(zwj, 4, { hard: true })
    for (const line of wrapped.split('\n')) {
      expect(line).toContain('👨‍👩‍👧‍👦')
    }
  })
})
