import { describe, expect, test } from 'bun:test'
import type { EffortValue } from '../../../utils/effort.js'
import {
  CANCEL_MESSAGE,
  type ApplyFn,
  ULTRACODE_HINT,
  END_POSITION,
  HOME_POSITION,
  PANEL_POSITIONS,
  type PanelPosition,
  computeConfirmOutcome,
  getInitialCursor,
  isUltracode,
  moveLeft,
  moveRight,
} from '../effortPanelState.js'

describe('effortPanelState', () => {
  test('PANEL_POSITIONS 顺序为 low → ultracode', () => {
    expect(PANEL_POSITIONS).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultracode',
    ])
  })

  test('moveLeft 在 low 处保持 low', () => {
    expect(moveLeft('low')).toBe('low')
  })

  test('moveLeft 正常左移', () => {
    expect(moveLeft('high')).toBe('medium')
    expect(moveLeft('ultracode')).toBe('max')
  })

  test('moveRight 在 ultracode 处保持 ultracode', () => {
    expect(moveRight('ultracode')).toBe('ultracode')
  })

  test('moveRight 正常右移', () => {
    expect(moveRight('medium')).toBe('high')
    expect(moveRight('max')).toBe('ultracode')
  })

  test('HOME_POSITION 等于 low', () => {
    expect(HOME_POSITION).toBe('low')
  })

  test('END_POSITION 等于 ultracode', () => {
    expect(END_POSITION).toBe('ultracode')
  })

  test('isUltracode 守卫', () => {
    expect(isUltracode('ultracode')).toBe(true)
    expect(isUltracode('max')).toBe(false)
  })

  test('getInitialCursor：env override 为合法档位时返回 env 值', () => {
    expect(
      getInitialCursor({
        envOverride: 'high',
        appStateEffort: 'medium',
        displayed: 'high',
      }),
    ).toBe('high')
  })

  test('getInitialCursor：env 为 null（unset）时用 displayed', () => {
    expect(
      getInitialCursor({
        envOverride: null,
        appStateEffort: undefined,
        displayed: 'medium',
      }),
    ).toBe('medium')
  })

  test('getInitialCursor：env undefined 时用 displayed', () => {
    expect(
      getInitialCursor({
        envOverride: undefined,
        appStateEffort: 'high',
        displayed: 'high',
      }),
    ).toBe('high')
  })

  test('getInitialCursor：env 是数值（ant-only）时落回 displayed', () => {
    // 数值不是合法 PanelPosition，回退
    expect(
      getInitialCursor({
        envOverride: 75,
        appStateEffort: 'medium',
        displayed: 'medium',
      }),
    ).toBe('medium')
  })

  test('PanelPosition 类型编译期检查（隐式）', () => {
    const p: PanelPosition = 'xhigh'
    expect(p).toBe('xhigh')
  })
})

describe('computeConfirmOutcome (densable sLy panel apply)', () => {
  const mockApply: ApplyFn = cursor => {
    if (cursor === 'ultracode') {
      return {
        message: ULTRACODE_HINT,
        effortUpdate: { value: 'xhigh' as EffortValue, ultracode: true },
      }
    }
    return {
      message: `applied:${cursor}`,
      effortUpdate: {
        value: cursor as unknown as EffortValue,
        ultracode: false,
      },
    }
  }

  test('ultracode → kind=apply with xhigh + ultracode flag', () => {
    const out = computeConfirmOutcome('ultracode', mockApply)
    expect(out.kind).toBe('apply')
    expect(out.message).toBe(ULTRACODE_HINT)
    expect(out.effortUpdate).toEqual({ value: 'xhigh', ultracode: true })
  })

  test('ultracode 调 applyFn（session flag path）', () => {
    let calledWith: string | undefined
    const spy: ApplyFn = c => {
      calledWith = c
      return {
        message: 'ok',
        effortUpdate: { value: 'xhigh', ultracode: true },
      }
    }
    computeConfirmOutcome('ultracode', spy)
    expect(calledWith).toBe('ultracode')
  })

  test('low → kind=apply，message 来自 applyFn，effortUpdate 透传', () => {
    const out = computeConfirmOutcome('low', mockApply)
    expect(out.kind).toBe('apply')
    expect(out.message).toBe('applied:low')
    expect(out.effortUpdate?.value).toBe('low')
    expect(out.effortUpdate?.ultracode).toBe(false)
  })

  test('high → apply 路径', () => {
    const out = computeConfirmOutcome('high', mockApply)
    expect(out.kind).toBe('apply')
  })

  test('applyFn 返回无 effortUpdate 时，outcome.effortUpdate 为 undefined', () => {
    const noUpdate: ApplyFn = c => ({ message: `applied:${c}` })
    const out = computeConfirmOutcome('medium', noUpdate)
    expect(out.kind).toBe('apply')
    expect(out.effortUpdate).toBeUndefined()
  })
})

test('常量字符串', () => {
  expect(CANCEL_MESSAGE).toBe('Effort unchanged.')
  expect(ULTRACODE_HINT).toContain('ultracode')
})
