/**
 * densable 2.1.243 #58 — occupancy notice when another local terminal holds RC.
 * Official `w` / `_` in bridgeStatusUtil.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  formatRemoteControlOccupancyNotice,
  REMOTE_CONTROL_NOT_STARTED_HERE,
} from '../bridgeStatusUtil.js'

describe('densable 2.1.243 #58 occupancy notice', () => {
  test('prefix and move hint without cross-session messaging', () => {
    const text = formatRemoteControlOccupancyNotice(
      {},
      { crossSessionMessaging: false },
    )
    expect(text.startsWith(REMOTE_CONTROL_NOT_STARTED_HERE)).toBe(true)
    expect(text).toContain(
      'another Claude Code on this machine already has Remote Control for this conversation',
    )
    expect(text).toContain('run /remote-control to move it to this terminal')
    expect(text).not.toContain("can't see your sessions on other machines")
  })

  test('cross-session messaging adds other-machines clause', () => {
    const text = formatRemoteControlOccupancyNotice(
      {},
      { crossSessionMessaging: true },
    )
    expect(text).toContain(
      "so this terminal can't see your sessions on other machines and they can't reach it",
    )
  })

  test('startedAt in the past is formatted; future/zero omitted', () => {
    const now = new Date('2026-09-04T12:00:00.000Z')
    const withStart = formatRemoteControlOccupancyNotice(
      { startedAt: now.getTime() - 5 * 60 * 1000 },
      { crossSessionMessaging: false },
      now,
    )
    expect(withStart).toContain('(started ')
    expect(
      formatRemoteControlOccupancyNotice(
        { startedAt: 0 },
        { crossSessionMessaging: false },
        now,
      ),
    ).not.toContain('(started ')
    expect(
      formatRemoteControlOccupancyNotice(
        { startedAt: now.getTime() + 60_000 },
        { crossSessionMessaging: false },
        now,
      ),
    ).not.toContain('(started ')
  })

  test('init decline copy + hook wiring 1:1', () => {
    const init = readFileSync(
      join(import.meta.dir, '../initReplBridge.ts'),
      'utf8',
    )
    expect(init).toContain("'restored_pointer_held_locally'")
    expect(init).toContain(
      'from the resumed transcript is still served by local pid',
    )
    expect(init).toContain('Explicit enable is taking over bridge session')
    const hook = readFileSync(
      join(import.meta.dir, '../../hooks/useReplBridge.tsx'),
      'utf8',
    )
    expect(hook).toContain('Init declined: session held by local pid')
    expect(hook).toContain('leaving Remote Control off')
    expect(hook).toContain('formatRemoteControlOccupancyNotice')
  })
})
