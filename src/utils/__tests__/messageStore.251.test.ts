/**
 * densable 2.1.251 #15 + #46 — iCe (Mn=200) + eBt append-or-move-by-uuid.
 */
import { describe, expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import {
  appendOrMoveByUuid,
  applyMessageStoreAction,
  EPHEMERAL_PROGRESS_SCAN_WINDOW,
} from '../messageStore.js'

function uuid(n: number): Message['uuid'] {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function progress(
  n: number,
  parentToolUseID: string,
  dataType: string,
  extra?: Record<string, unknown>,
): Message {
  return {
    type: 'progress',
    uuid: uuid(n),
    parentToolUseID,
    data: { type: dataType, ...extra },
  } as Message
}

function user(n: number): Message {
  return { type: 'user', uuid: uuid(n) } as Message
}

describe('densable 2.1.251 iCe applyMessageStoreAction', () => {
  test('append empty returns the same array; non-empty concatenates', () => {
    const a = [user(1)]
    expect(applyMessageStoreAction(a, { type: 'append', messages: [] })).toBe(a)
    expect(
      applyMessageStoreAction(a, { type: 'append', messages: [user(2)] }),
    ).toEqual([a[0], user(2)])
  })

  test('replace-all / remove-by-uuid / replace-by-uuid / insert-after-uuid', () => {
    const a = user(1)
    const b = user(2)
    const c = user(3)
    expect(
      applyMessageStoreAction([a], {
        type: 'replace-all',
        messages: [b, c],
      }),
    ).toEqual([b, c])

    expect(
      applyMessageStoreAction([a, b], {
        type: 'remove-by-uuid',
        uuid: a.uuid,
      }),
    ).toEqual([b])
    const missing = [a]
    expect(
      applyMessageStoreAction(missing, {
        type: 'remove-by-uuid',
        uuid: b.uuid,
      }),
    ).toBe(missing)

    expect(
      applyMessageStoreAction([a, b], {
        type: 'replace-by-uuid',
        uuid: b.uuid,
        message: c,
      }),
    ).toEqual([a, c])
    expect(
      applyMessageStoreAction([a], {
        type: 'replace-by-uuid',
        uuid: b.uuid,
        message: c,
      }),
    ).toEqual([a, c])

    expect(
      applyMessageStoreAction([a, c], {
        type: 'insert-after-uuid',
        uuid: a.uuid,
        messages: [b],
      }),
    ).toEqual([a, b, c])
    expect(
      applyMessageStoreAction([a], {
        type: 'insert-after-uuid',
        uuid: b.uuid,
        messages: [c],
      }),
    ).toEqual([a])
    expect(
      applyMessageStoreAction([a], {
        type: 'insert-after-uuid',
        uuid: a.uuid,
        messages: [],
      }),
    ).toEqual([a])
  })

  test('same parentToolUseID+data.type progress replaces the last match', () => {
    const tick1 = progress(1, 'tu-a', 'tool_heartbeat', {
      elapsedTimeSeconds: 1,
    })
    const tick2 = progress(2, 'tu-a', 'tool_heartbeat', {
      elapsedTimeSeconds: 2,
    })
    const next = applyMessageStoreAction([user(9), tick1], {
      type: 'replace-last-ephemeral-progress',
      message: tick2,
    })
    expect(next).toEqual([user(9), tick2])
    expect(next).toHaveLength(2)
  })

  test('parallel subagent ticks replace only the matching parent', () => {
    const a1 = progress(1, 'tu-a', 'tool_heartbeat', {
      elapsedTimeSeconds: 1,
    })
    const b1 = progress(2, 'tu-b', 'bash_progress', { elapsedTimeSeconds: 1 })
    const a2 = progress(3, 'tu-a', 'tool_heartbeat', {
      elapsedTimeSeconds: 2,
    })
    expect(
      applyMessageStoreAction([a1, b1], {
        type: 'replace-last-ephemeral-progress',
        message: a2,
      }),
    ).toEqual([a2, b1])
  })

  test('mismatching data.type or a non-progress wall appends', () => {
    const hb = progress(1, 'tu-a', 'tool_heartbeat')
    const bash = progress(2, 'tu-a', 'bash_progress')
    expect(
      applyMessageStoreAction([hb], {
        type: 'replace-last-ephemeral-progress',
        message: bash,
      }),
    ).toEqual([hb, bash])

    const later = progress(3, 'tu-a', 'tool_heartbeat', {
      elapsedTimeSeconds: 9,
    })
    expect(
      applyMessageStoreAction([hb, user(8)], {
        type: 'replace-last-ephemeral-progress',
        message: later,
      }),
    ).toEqual([hb, user(8), later])
  })

  test('Mn=200 window (SEA var Mn=200): match outside suffix is not replaced', () => {
    expect(EPHEMERAL_PROGRESS_SCAN_WINDOW).toBe(200)
    const match = progress(1, 'tu-a', 'tool_heartbeat')
    const others = Array.from({ length: 200 }, (_, i) =>
      progress(i + 2, 'tu-other', 'tool_heartbeat'),
    )
    const incoming = progress(999, 'tu-a', 'tool_heartbeat', {
      elapsedTimeSeconds: 30,
    })
    const next = applyMessageStoreAction([match, ...others], {
      type: 'replace-last-ephemeral-progress',
      message: incoming,
    })
    expect(next).toHaveLength(202)
    expect(next[0]).toBe(match)
    expect(next.at(-1)).toBe(incoming)
  })

  test('Mn=200: match inside window is replaced', () => {
    const match = progress(1, 'tu-a', 'tool_heartbeat')
    const others = Array.from({ length: 50 }, (_, i) =>
      progress(i + 2, 'tu-other', 'tool_heartbeat'),
    )
    const incoming = progress(999, 'tu-a', 'tool_heartbeat', {
      elapsedTimeSeconds: 30,
    })
    // wall of 50 then match at end-ish — put match after 50 others so it's in window
    const next = applyMessageStoreAction([...others, match], {
      type: 'replace-last-ephemeral-progress',
      message: incoming,
    })
    expect(next).toHaveLength(51)
    expect(next.at(-1)).toBe(incoming)
  })

  test('eBt append-or-move-by-uuid: absent uuid appends; present moves to end', () => {
    const a = user(1)
    const b = user(2)
    const a2 = { ...a, content: 'updated' } as Message
    expect(appendOrMoveByUuid([a, b], user(3))).toEqual([a, b, user(3)])
    expect(appendOrMoveByUuid([a, b], a2)).toEqual([b, a2])
    expect(
      applyMessageStoreAction([a, b], {
        type: 'append-or-move-by-uuid',
        message: a2,
      }),
    ).toEqual([b, a2])
  })

  test('remove-uuids-and-append and update', () => {
    const a = user(1)
    const b = user(2)
    const c = user(3)
    expect(
      applyMessageStoreAction([a, b], {
        type: 'remove-uuids-and-append',
        excludeUuids: new Set([a.uuid]),
        message: c,
      }),
    ).toEqual([b, c])
    expect(
      applyMessageStoreAction([a, b], {
        type: 'update',
        updater: msgs => msgs.slice(0, 1),
      }),
    ).toEqual([a])
  })

  test('REPL wires fullscreen append-or-move (Nt/eBt product arm)', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const src = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(src).toContain("type: 'append-or-move-by-uuid'")
    expect(src).toContain('isFullscreenEnvEnabled()')
    expect(src).toContain('replace-last-ephemeral-progress')
    // gold: salvage/remove-by-uuid BEFORE Nt()?eBt:append (single copy)
    const land = src.slice(src.indexOf('replace-last-ephemeral-progress'))
    const salvageAt = land.indexOf('st.salvage !== null')
    const ebtAt = land.indexOf("type: 'append-or-move-by-uuid'")
    expect(salvageAt).toBeGreaterThan(-1)
    expect(ebtAt).toBeGreaterThan(salvageAt)
    expect(land.split('st.salvage !== null').length - 1).toBe(1)
  })
})
