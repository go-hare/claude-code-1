import { describe, expect, test } from 'bun:test'
import {
  cursorPosition as cursorPositionQuery,
  type TerminalQuery,
} from '../terminal-querier.js'
import type { TerminalResponse } from '../parse-keypress.js'

/**
 * densable probeExternalClear gates (pure logic mirror of Ink.probeExternalClear):
 *   !altScreen || paused || unmounted → false
 *   !displayCursor || y < 1 → false
 *   querier row !== 1 → false
 *   else forceRedraw + true
 *
 * Avoids constructing full Ink (TTY/yoga); exercises the decision table.
 */
type ProbeState = {
  altScreenActive: boolean
  isPaused: boolean
  isUnmounted: boolean
  displayCursor: { x: number; y: number } | null
}

async function probeExternalClearLogic(
  state: ProbeState,
  querier: {
    send: (
      query: TerminalQuery<
        Extract<TerminalResponse, { type: 'cursorPosition' }>
      >,
    ) => Promise<
      Extract<TerminalResponse, { type: 'cursorPosition' }> | undefined
    >
  },
  forceRedraw: () => void,
): Promise<boolean> {
  if (!state.altScreenActive || state.isPaused || state.isUnmounted) {
    return false
  }
  const parked = state.displayCursor
  if (!parked || parked.y < 1) return false
  const reported = await querier.send(cursorPositionQuery())
  if (reported?.row !== 1) return false
  forceRedraw()
  return true
}

describe('probeExternalClear (densable)', () => {
  test('false when not alt-screen', async () => {
    let redraws = 0
    const ok = await probeExternalClearLogic(
      {
        altScreenActive: false,
        isPaused: false,
        isUnmounted: false,
        displayCursor: { x: 0, y: 5 },
      },
      { send: async () => ({ type: 'cursorPosition', row: 1, col: 1 }) },
      () => {
        redraws++
      },
    )
    expect(ok).toBe(false)
    expect(redraws).toBe(0)
  })

  test('false when paused or unmounted', async () => {
    const send = async () => ({
      type: 'cursorPosition' as const,
      row: 1,
      col: 1,
    })
    expect(
      await probeExternalClearLogic(
        {
          altScreenActive: true,
          isPaused: true,
          isUnmounted: false,
          displayCursor: { x: 0, y: 5 },
        },
        { send },
        () => {},
      ),
    ).toBe(false)
    expect(
      await probeExternalClearLogic(
        {
          altScreenActive: true,
          isPaused: false,
          isUnmounted: true,
          displayCursor: { x: 0, y: 5 },
        },
        { send },
        () => {},
      ),
    ).toBe(false)
  })

  test('false when displayCursor missing or y < 1', async () => {
    const send = async () => ({
      type: 'cursorPosition' as const,
      row: 1,
      col: 1,
    })
    expect(
      await probeExternalClearLogic(
        {
          altScreenActive: true,
          isPaused: false,
          isUnmounted: false,
          displayCursor: null,
        },
        { send },
        () => {},
      ),
    ).toBe(false)
    expect(
      await probeExternalClearLogic(
        {
          altScreenActive: true,
          isPaused: false,
          isUnmounted: false,
          displayCursor: { x: 0, y: 0 },
        },
        { send },
        () => {},
      ),
    ).toBe(false)
  })

  test('false when terminal reports row !== 1', async () => {
    let redraws = 0
    const ok = await probeExternalClearLogic(
      {
        altScreenActive: true,
        isPaused: false,
        isUnmounted: false,
        displayCursor: { x: 0, y: 10 },
      },
      { send: async () => ({ type: 'cursorPosition', row: 10, col: 1 }) },
      () => {
        redraws++
      },
    )
    expect(ok).toBe(false)
    expect(redraws).toBe(0)
  })

  test('true + forceRedraw when wiped (row===1, parked y>=1)', async () => {
    let redraws = 0
    let seenQuery: string | undefined
    const ok = await probeExternalClearLogic(
      {
        altScreenActive: true,
        isPaused: false,
        isUnmounted: false,
        displayCursor: { x: 3, y: 12 },
      },
      {
        send: async query => {
          seenQuery = query.request
          return { type: 'cursorPosition', row: 1, col: 4 }
        },
      },
      () => {
        redraws++
      },
    )
    expect(ok).toBe(true)
    expect(redraws).toBe(1)
    // DECXCPR CSI ? 6 n
    expect(seenQuery).toContain('6n')
  })

  test('false when querier returns undefined (unsupported)', async () => {
    const ok = await probeExternalClearLogic(
      {
        altScreenActive: true,
        isPaused: false,
        isUnmounted: false,
        displayCursor: { x: 0, y: 5 },
      },
      { send: async () => undefined },
      () => {},
    )
    expect(ok).toBe(false)
  })
})
