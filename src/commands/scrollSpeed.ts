/**
 * /scroll-speed — Tune mouse wheel scroll speed with an interactive slider
 * showing every value (1–10), supporting Home/End, mouse clicks, and narrow
 * terminals (Official 2.1.326 #285 & #289).
 */

import * as React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Box,
  Byline,
  Dialog,
  type KeyboardEvent,
  KeyboardShortcutHint,
  Text,
} from '@anthropic/ink'
import { findNearestSliderStopIndex } from '../components/EffortPanel/EffortPanel.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import type { Command, LocalJSXCommandOnDone } from '../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import {
  computeValueSliderLayout,
  type ValueSliderStop,
} from './autocompact/autocompact.js'

export const SCROLL_SPEED_MIN = 1
export const SCROLL_SPEED_MAX = 10
export const SCROLL_SPEED_DEFAULT = 3

export function buildScrollSpeedSliderStops(): ValueSliderStop[] {
  const stops: ValueSliderStop[] = []
  for (let s = SCROLL_SPEED_MIN; s <= SCROLL_SPEED_MAX; s++) {
    stops.push({ value: s, label: String(s) })
  }
  return stops
}

function getCurrentScrollSpeed(): number {
  const raw = (getGlobalConfig() as Record<string, unknown>).scrollSpeed
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= SCROLL_SPEED_MIN &&
    raw <= SCROLL_SPEED_MAX
  ) {
    return raw
  }
  return SCROLL_SPEED_DEFAULT
}

function ScrollSpeedSliderDialog({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const { columns } = useTerminalSize()
  const stops = useMemo(() => buildScrollSpeedSliderStops(), [])
  const initialSpeed = useMemo(() => getCurrentScrollSpeed(), [])
  const [speed, setSpeed] = useState(initialSpeed)
  const doneRef = useRef(false)

  const selectedIndex = Math.max(0, speed - SCROLL_SPEED_MIN)

  const selectIndex = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(stops.length - 1, idx))
      setSpeed(stops[clamped]!.value)
    },
    [stops],
  )

  const finish = useCallback(
    (message: string) => {
      if (doneRef.current) return
      doneRef.current = true
      onDone(message)
    },
    [onDone],
  )

  const accept = useCallback(() => {
    saveGlobalConfig(prev => ({ ...prev, scrollSpeed: speed }))
    finish(
      `Scroll speed set to ${speed}. Scroll to test — adjust with /scroll-speed <1-10>.`,
    )
  }, [finish, speed])

  const cancel = useCallback(() => {
    finish(`Scroll speed unchanged: ${initialSpeed}`)
  }, [finish, initialSpeed])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.name === 'home') {
        e.preventDefault()
        selectIndex(0)
      } else if (e.name === 'end') {
        e.preventDefault()
        selectIndex(stops.length - 1)
      }
    },
    [selectIndex, stops.length],
  )

  useKeybindings(
    {
      'select:previous': () => selectIndex(selectedIndex - 1),
      'select:next': () => selectIndex(selectedIndex + 1),
      'select:accept': accept,
    },
    { context: 'Select' },
  )
  useKeybindings(
    {
      'tabs:previous': () => selectIndex(selectedIndex - 1),
      'tabs:next': () => selectIndex(selectedIndex + 1),
    },
    { context: 'Tabs' },
  )

  const availableWidth = Math.max(20, columns - 6)
  const layout = useMemo(
    () => computeValueSliderLayout(stops, availableWidth),
    [stops, availableWidth],
  )
  const markerCol = layout.stopCols[selectedIndex] ?? 0
  const trackBefore = layout.trackChars.slice(0, markerCol)
  const trackAfter = layout.trackChars.slice(markerCol + 1)

  const sliderNode = layout.compact
    ? React.createElement(
        Box,
        { flexWrap: 'wrap', columnGap: 1 },
        stops.map((stop, idx) =>
          React.createElement(
            Box,
            {
              key: stop.value,
              onClick: e => {
                e.stopImmediatePropagation()
                selectIndex(idx)
              },
            },
            React.createElement(
              Text,
              {
                bold: idx === selectedIndex,
                color: idx === selectedIndex ? 'suggestion' : undefined,
                dimColor: idx !== selectedIndex,
              },
              idx === selectedIndex ? `[${stop.label}]` : stop.label,
            ),
          ),
        ),
      )
    : React.createElement(
        Box,
        { flexDirection: 'column', width: layout.width },
        React.createElement(
          Box,
          {
            onClick: e => {
              e.stopImmediatePropagation()
              selectIndex(
                findNearestSliderStopIndex(e.localCol, layout.stopCols),
              )
            },
          },
          React.createElement(Text, { dimColor: true }, trackBefore),
          React.createElement(Text, { bold: true, color: 'suggestion' }, '▲'),
          React.createElement(Text, { dimColor: true }, trackAfter),
        ),
        React.createElement(
          Box,
          null,
          stops.map((stop, idx) =>
            React.createElement(
              React.Fragment,
              { key: stop.value },
              idx > 0
                ? React.createElement(Text, null, ' '.repeat(layout.gap))
                : null,
              React.createElement(
                Box,
                {
                  onClick: e => {
                    e.stopImmediatePropagation()
                    selectIndex(idx)
                  },
                },
                React.createElement(
                  Text,
                  {
                    bold: idx === selectedIndex,
                    color: idx === selectedIndex ? 'suggestion' : undefined,
                    dimColor: idx !== selectedIndex,
                  },
                  stop.label,
                ),
              ),
            ),
          ),
        ),
      )

  const dialogBody = React.createElement(
    Box,
    {
      flexDirection: 'column',
      gap: 1,
      tabIndex: 0,
      autoFocus: true,
      onKeyDown: handleKeyDown,
    },
    React.createElement(
      Box,
      null,
      React.createElement(Text, null, 'Selected speed: '),
      React.createElement(
        Text,
        { bold: true, color: 'suggestion' },
        `${speed} ${speed === 1 ? 'line' : 'lines'}`,
      ),
    ),
    sliderNode,
  )

  return React.createElement(
    Dialog as React.ComponentType<
      Omit<React.ComponentProps<typeof Dialog>, 'children'>
    >,
    {
      title: 'Scroll speed',
      subtitle: `Lines per mouse wheel tick (current: ${initialSpeed})`,
      onCancel: cancel,
      inputGuide: () =>
        React.createElement(
          Byline,
          null,
          React.createElement(KeyboardShortcutHint, {
            shortcut: '←/→',
            action: 'adjust',
          }),
          React.createElement(KeyboardShortcutHint, {
            shortcut: 'Home/End',
            action: 'min/max',
          }),
          React.createElement(KeyboardShortcutHint, {
            shortcut: 'Enter',
            action: 'apply',
          }),
          React.createElement(KeyboardShortcutHint, {
            shortcut: 'Esc',
            action: 'cancel',
          }),
        ),
    },
    dialogBody,
  )
}

const scrollSpeed = {
  type: 'local-jsx',
  name: 'scroll-speed',
  description: 'Tune mouse wheel scroll speed (1-10)',
  argumentHint: '[<speed>]',
  immediate: true,
  load: () =>
    Promise.resolve({
      async call(
        onDone: LocalJSXCommandOnDone,
        _context: unknown,
        args?: string,
      ): Promise<React.ReactNode> {
        const input = (args ?? '').trim()

        if (!input) {
          return React.createElement(ScrollSpeedSliderDialog, { onDone })
        }

        const speed = Number.parseInt(input, 10)
        if (
          Number.isNaN(speed) ||
          !/^\d+$/.test(input) ||
          speed < SCROLL_SPEED_MIN ||
          speed > SCROLL_SPEED_MAX
        ) {
          onDone('Scroll speed must be a number between 1 and 10.')
          return null
        }

        saveGlobalConfig(prev => ({ ...prev, scrollSpeed: speed }))
        onDone(
          `Scroll speed set to ${speed}. Scroll to test — adjust with /scroll-speed <1-10>.`,
        )
        return null
      },
    }),
} satisfies Command

export default scrollSpeed
