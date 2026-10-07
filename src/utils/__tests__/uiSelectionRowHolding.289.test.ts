import { describe, expect, test } from 'bun:test'
import type { SelectionState } from '@anthropic/ink/src/core/selection.js'
import {
  messageHasUuid,
  messageSelectionRequestId,
  requestIdContainingSpan,
  requestIdHoldingSelection,
  selectionAnswer,
  selectionFullyInViewport,
  selectionRowBounds,
} from '../plugins/uiSelectionRowHolding.js'

function sel(
  partial: Partial<SelectionState> &
    Pick<SelectionState, 'anchor' | 'focus'> & {
      scope?: { x1: number; x2: number; node?: unknown }
    },
): SelectionState {
  return {
    isDragging: false,
    anchorSpan: null,
    scrolledOffAbove: [],
    scrolledOffBelow: [],
    scrolledOffAboveSW: [],
    scrolledOffBelowSW: [],
    lastPressHadAlt: false,
    ...partial,
  } as SelectionState
}

describe('densable 2.1.289 ui.selection rowHolding helpers', () => {
  test('selectionAnswer maps gold requestId to instance_id', () => {
    expect(selectionAnswer('hi', undefined)).toEqual({ text: 'hi' })
    expect(selectionAnswer('hi', 'toolu_1')).toEqual({
      text: 'hi',
      instance_id: 'toolu_1',
    })
  })

  test('messageSelectionRequestId prefers tool_use / tool_result ids', () => {
    expect(
      messageSelectionRequestId({
        type: 'assistant',
        uuid: 'msg-uuid',
        message: { content: [{ type: 'tool_use', id: 'toolu_abc' }] },
      }),
    ).toBe('toolu_abc')
    expect(
      messageSelectionRequestId({
        type: 'user',
        uuid: 'msg-uuid',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_abc' }],
        },
      }),
    ).toBe('toolu_abc')
    expect(
      messageSelectionRequestId({
        type: 'assistant',
        uuid: 'msg-uuid',
        message: { content: [{ type: 'text', text: 'hi' }] },
      }),
    ).toBe('msg-uuid')
  })

  test('messageHasUuid matches densable dN', () => {
    expect(messageHasUuid({ uuid: 'a' })).toBe(true)
    expect(messageHasUuid({ uuid: '' })).toBe(false)
    expect(messageHasUuid({})).toBe(false)
  })

  test('selectionRowBounds uses virtual rows when present', () => {
    expect(
      selectionRowBounds(
        sel({
          anchor: { row: 10, col: 0 },
          focus: { row: 12, col: 3 },
          virtualAnchorRow: 2,
          virtualFocusRow: 4,
        }),
      ),
    ).toEqual({ first: 2, last: 4 })
  })

  test('requestIdContainingSpan requires full containment', () => {
    const rows = [
      { requestId: 'a', first: 0, last: 2 },
      { requestId: 'b', first: 3, last: 5 },
    ]
    expect(requestIdContainingSpan({ first: 3, last: 4 }, rows)).toBe('b')
    expect(
      requestIdContainingSpan({ first: 2, last: 4 }, rows),
    ).toBeUndefined()
  })

  test('requestIdHoldingSelection needs viewport containment', () => {
    const node = { tag: 'scroll' }
    const selection = sel({
      anchor: { row: 3, col: 0 },
      focus: { row: 4, col: 1 },
      scope: { x1: 0, x2: 80, node },
    })
    const rows = [{ requestId: 'row-b', first: 3, last: 5 }]
    expect(
      requestIdHoldingSelection(
        selection,
        { node: node as never, first: 0, last: 10 },
        rows,
      ),
    ).toBe('row-b')
    expect(
      requestIdHoldingSelection(
        selection,
        { node: { other: true } as never, first: 0, last: 10 },
        rows,
      ),
    ).toBeUndefined()
    expect(
      selectionFullyInViewport(selection, {
        node: node as never,
        first: 0,
        last: 10,
      }),
    ).toBe(true)
  })
})
