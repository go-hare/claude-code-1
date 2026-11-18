import { describe, expect, test } from 'bun:test'
import {
  WORKFLOW_ARRAY_LENGTH_CAP,
  WORKFLOW_DEPTH_CAP_ENTERING,
  WORKFLOW_DEPTH_CAP_LEAVING,
  parseScript,
  primitivizeDeep,
} from '../engine/script.js'

function makeDeepObject(depth: number): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  let cur = root
  for (let i = 1; i < depth; i++) {
    const next: Record<string, unknown> = {}
    cur.next = next
    cur = next
  }
  cur.leaf = 'ok'
  return root
}

describe('v2.1.296 #508 — workflow primitivizeDeep depth & boundary protection', () => {
  test('copies objects deeper than 20,000 levels (up to 28,000) without stack overflow or truncation', () => {
    const deep = makeDeepObject(22000)
    const copied = primitivizeDeep(deep, { isLeaving: true }) as Record<
      string,
      unknown
    >
    let cur: Record<string, unknown> | undefined = copied
    for (let i = 1; i < 22000; i++) {
      cur = cur?.next as Record<string, unknown> | undefined
    }
    expect(cur?.leaf).toBe('ok')
  })

  test('throws explicit cap error when leaving depth exceeds 28,000', () => {
    const tooDeep = makeDeepObject(WORKFLOW_DEPTH_CAP_LEAVING + 1)
    expect(() => primitivizeDeep(tooDeep, { isLeaving: true })).toThrow(
      'nesting deeper than 28000 levels is not supported',
    )
  })

  test('throws explicit cap error when entering depth exceeds 100,000', () => {
    const tooDeep = makeDeepObject(WORKFLOW_DEPTH_CAP_ENTERING + 1)
    expect(() => primitivizeDeep(tooDeep, { isLeaving: false })).toThrow(
      'nesting deeper than 100000 levels is not supported',
    )
  })

  test('throws explicit cap error when array length exceeds 4096', () => {
    const bigArr = new Array(WORKFLOW_ARRAY_LENGTH_CAP + 1).fill(1)
    expect(() => primitivizeDeep(bigArr)).toThrow(
      `array length ${WORKFLOW_ARRAY_LENGTH_CAP + 1} exceeds the maximum of ${WORKFLOW_ARRAY_LENGTH_CAP} supported across the workflow VM boundary`,
    )
  })

  test('preserves cycles and strips functions and __proto__', () => {
    const obj: Record<string, unknown> = { a: 1, fn: () => 2 }
    obj.self = obj
    const copied = primitivizeDeep(obj) as Record<string, unknown>
    expect(copied.a).toBe(1)
    expect('fn' in copied).toBe(false)
    expect(copied.self).toBe(copied)
  })

  test('parseScript().execute enforces depth cap on script return value and agent opts', async () => {
    const script = parseScript(`
      let cur = {};
      const root = cur;
      for (let i = 1; i < 28005; i++) {
        cur.next = {};
        cur = cur.next;
      }
      return root;
    `)
    await expect(
      script.execute(
        {
          agent: async () => null,
          parallel: async () => [],
          pipeline: async () => [],
          phase: () => {},
          log: () => {},
          workflow: async () => null,
        },
        {},
        {},
      ),
    ).rejects.toThrow('nesting deeper than 28000 levels is not supported')
  })
})
