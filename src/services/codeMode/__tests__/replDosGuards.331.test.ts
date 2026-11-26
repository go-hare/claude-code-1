import { afterEach, describe, expect, test } from 'bun:test'
import { REPLTool } from '@claude-code/builtin-tools/tools/REPLTool/REPLTool.js'
import { z } from 'zod/v4'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import {
  formatReplCallTooDeepError,
  formatReplCallTooManyBigIntDigitsError,
  REPL_CALL_TOO_DEEP_PLAIN_ERROR,
  REPL_CALL_TOO_LARGE_ERROR,
  REPL_CALL_TOO_LARGE_PLAIN_ERROR,
  REPL_CALL_TOO_LONG_NUMBERS_PLAIN_ERROR,
  REPL_CIRCULAR_TRANSFORM_ERROR,
  REPL_MOST_DEPTH,
  REPL_MOST_DIGITS,
  REPL_MOST_ITEMS,
  REPL_MOST_JSON_CHARS,
  REPL_MOST_TEXT_CHARS,
  REPL_PRIMITIVE_ONLY_ARGS_ERROR,
  REPL_TURN_BUDGET_EXCEEDED_ERROR,
  REPL_TURN_MAX_QUEUED_CALLS,
  REPL_TURN_MAX_QUEUED_CHARS,
  REPL_TURN_MAX_QUEUED_NOTIFY_CALLS,
  REPL_UNAWAITED_PROMISE_ERROR,
  REPL_UNAWAITED_PROMISE_PLAIN_ERROR,
  REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
  REPL_WIRE_MAX_DEPTH,
} from '../constants.js'
import {
  clearCodeModeVmSession,
  executeCodeModeScript,
  resetCodeModeRuntimeStateForTests,
  wrapReplToolForCodeMode,
} from '../executor.js'
import {
  pinCodeMode,
  resetCodeModeOptInStateForTests,
  setEngineCheckResultForTests,
  unpinCodeMode,
} from '../optIn.js'
import {
  assertNoCircularValueInSchemaTransforms,
  assertNotCircularForTransform,
  createDefaultReplHostOpSpecs,
  createReplCodec,
  decodeReplWireValue,
  guardCircularTransform,
  hasCircularReference,
  isHostCallPrimitive,
  isJsonNestingWithinLimit,
  mapReplPlainErrorLine,
  parseReplHostOpArgs,
  ReplHostCallValidationError,
  ReplHostDispatcher,
  ReplHostLink,
  ReplTurnCallBudget,
  safeParseWithCircularTransformGuard,
  summarizeReplErrorLine,
  tagReplPlainError,
} from '../replDosGuards.js'

afterEach(() => {
  resetCodeModeRuntimeStateForTests()
  resetCodeModeOptInStateForTests()
  clearCodeModeVmSession()
  unpinCodeMode()
})

function makeNestedObject(depth: number): Record<string, unknown> {
  let current: Record<string, unknown> = { leaf: 1 }
  for (let i = 0; i < depth; i++) {
    current = { child: current }
  }
  return current
}

describe('Official 2.1.331 REPL / Code Mode host-call DoS & input validation guards', () => {
  test('matches exact 2.1.331 limit constants and error strings', () => {
    expect(REPL_MOST_ITEMS).toBe(4096)
    expect(REPL_MOST_DEPTH).toBe(2000)
    expect(REPL_WIRE_MAX_DEPTH).toBe(6008)
    expect(REPL_MOST_DIGITS).toBe(1_000_000)
    expect(REPL_MOST_JSON_CHARS).toBe(134_217_728)
    expect(REPL_MOST_TEXT_CHARS).toBe(268_435_456)
    expect(REPL_TURN_MAX_QUEUED_CALLS).toBe(65_536)
    expect(REPL_TURN_MAX_QUEUED_NOTIFY_CALLS).toBe(131_072)
    expect(REPL_TURN_MAX_QUEUED_CHARS).toBe(536_870_912)

    expect(REPL_CALL_TOO_DEEP_PLAIN_ERROR).toBe(
      'A call was not made: its input was nested too deeply',
    )
    expect(REPL_CALL_TOO_LONG_NUMBERS_PLAIN_ERROR).toBe(
      'A call was not made: the numbers in its input were too long',
    )
    expect(REPL_CALL_TOO_LARGE_PLAIN_ERROR).toBe(
      'A call was not made: its input was too large',
    )
    expect(REPL_CALL_TOO_LARGE_ERROR).toBe(
      'REPL: the call was not made, because its arguments are too large. Pass less, or write the data to a file.',
    )
    expect(REPL_PRIMITIVE_ONLY_ARGS_ERROR).toBe(
      'REPL: only text, numbers and flags can be sent to the host.',
    )
    expect(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR).toBe(
      'REPL: the host takes no such call, or an argument is too long.',
    )
    expect(REPL_TURN_BUDGET_EXCEEDED_ERROR).toBe(
      'REPL: too many calls, or too much data, in one turn. Await some of the calls before making more.',
    )
    expect(REPL_CIRCULAR_TRANSFORM_ERROR).toBe(
      'A circular value cannot pass through a transform',
    )
  })

  describe('1. Nesting depth limit', () => {
    test('codec accepts exact mostDepth and rejects mostDepth + 1 with exact TypeError and plain error mapping', () => {
      const codec = createReplCodec({ mostDepth: 12 })
      const atLimit = makeNestedObject(12)
      const wireOk = codec.encode(atLimit, undefined, true)
      expect(codec.decode(wireOk)).toEqual(atLimit)

      const tooDeep = makeNestedObject(13)
      let thrown: unknown
      try {
        codec.encode(tooDeep, undefined, true)
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(TypeError)
      expect((thrown as Error).message).toBe(formatReplCallTooDeepError(12))
      expect(
        mapReplPlainErrorLine(
          thrown,
          `TypeError: ${(thrown as Error).message}`,
        ),
      ).toBe('A call was not made: its input was nested too deeply')

      // Non-whole encoding (e.g. script return value) omits beyond mostDepth instead of throwing.
      const nonWholeWire = codec.encode(tooDeep, undefined, false)
      expect(nonWholeWire.startsWith('~')).toBe(true)
    })

    test('default codec enforces 2000-level depth limit and rejects 2001 levels', () => {
      const codec = createReplCodec()
      const atDefaultLimit = makeNestedObject(REPL_MOST_DEPTH)
      expect(() => codec.encode(atDefaultLimit, undefined, true)).not.toThrow()

      const overDefaultLimit = makeNestedObject(REPL_MOST_DEPTH + 1)
      expect(() => codec.encode(overDefaultLimit, undefined, true)).toThrow(
        'REPL: the call was not made, because an argument nests more than 2000 levels deep. Pass a flatter value.',
      )
    })

    test('rejects deeply nested arrays, Maps, Sets, and Error own properties when whole=true', () => {
      const codec = createReplCodec({ mostDepth: 4 })

      let deepArr: unknown = [1]
      for (let i = 0; i < 5; i++) deepArr = [deepArr]
      expect(() => codec.encode(deepArr, undefined, true)).toThrow(
        formatReplCallTooDeepError(4),
      )

      const mapDeep = new Map<string, unknown>([['k', makeNestedObject(4)]])
      expect(() => codec.encode(mapDeep, undefined, true)).toThrow(
        formatReplCallTooDeepError(4),
      )

      const setDeep = new Set<unknown>([makeNestedObject(4)])
      expect(() => codec.encode(setDeep, undefined, true)).toThrow(
        formatReplCallTooDeepError(4),
      )

      const errWithDeepProp = new Error('outer') as Error & {
        detail?: unknown
      }
      errWithDeepProp.detail = makeNestedObject(4)
      expect(() => codec.encode(errWithDeepProp, undefined, true)).toThrow(
        formatReplCallTooDeepError(4),
      )
    })

    test('isJsonNestingWithinLimit (hBe) enforces bracket depth while ignoring brackets inside strings and escaped quotes', () => {
      expect(isJsonNestingWithinLimit('[[[1]]]', 3)).toBe(true)
      expect(isJsonNestingWithinLimit('[[[[1]]]]', 3)).toBe(false)
      expect(isJsonNestingWithinLimit('{"a":{"b":{"c":1}}}', 3)).toBe(true)
      expect(isJsonNestingWithinLimit('{"a":{"b":{"c":{"d":1}}}}', 3)).toBe(
        false,
      )
      // Quoted brackets & escaped quotes must not count toward depth.
      expect(
        isJsonNestingWithinLimit(
          '{"s":"[[[[[[[[[[[[\\"{{{{{{{{{{","ok":"\\\\\\\\"}}',
          2,
        ),
      ).toBe(true)
      // Escaped backslash immediately before closing quote DOES close the string.
      expect(
        isJsonNestingWithinLimit('{"a":"\\\\","b":{"c":{"d":1}}}', 2),
      ).toBe(false)
    })

    test('decodeReplWireValue rejects wire JSON nested deeper than maxWireDepth', () => {
      const codec = createReplCodec({ mostDepth: 5 })
      const deepWire = `${'['.repeat(24)}1${']'.repeat(24)}`
      expect(() =>
        decodeReplWireValue(deepWire, codec, { mostDepth: 5 }),
      ).toThrow('too long, or nested too deep')
      // Raw text (`=`) is not JSON and ignores brackets.
      expect(
        decodeReplWireValue(`=${'['.repeat(50)}`, codec, { mostDepth: 5 }),
      ).toBe('['.repeat(50))
    })

    test('executeCodeModeScript blocks 2001-deep tool input before invokeTool and sets plainErrorLine', async () => {
      let called = false
      const res = await executeCodeModeScript({
        code: `
          let x = { leaf: 1 };
          for (let i = 0; i < 2001; i++) x = { child: x };
          await Read(x);
        `,
        invokeTool: async () => {
          called = true
          return {}
        },
      })
      expect(called).toBe(false)
      expect(res.tool_calls).toBe(0)
      expect(res.result).toContain(
        'REPL: the call was not made, because an argument nests more than 2000 levels deep. Pass a flatter value.',
      )
      expect(res.plainErrorLine?.text).toBe(
        'A call was not made: its input was nested too deeply',
      )
    })
  })

  describe('2. Overly long number (BigInt digit count) rejection', () => {
    test('codec accepts exact mostDigits and rejects single or combined BigInts exceeding mostDigits', () => {
      const codec = createReplCodec({ mostDigits: 20 })

      // Exactly 20 digits passes.
      const exactWire = codec.encode({ n: 10n ** 19n }, undefined, true)
      expect(codec.decode(exactWire)).toEqual({ n: 10n ** 19n })

      // Single 21-digit BigInt fails.
      expect(() => codec.encode({ n: 10n ** 20n }, undefined, true)).toThrow(
        formatReplCallTooManyBigIntDigitsError(20),
      )

      // Multiple smaller BigInts summing to > 20 digits (12 + 12 = 24) fail together.
      let thrown: unknown
      try {
        codec.encode({ a: 10n ** 11n, b: 10n ** 11n }, undefined, true)
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(TypeError)
      expect((thrown as Error).message).toBe(
        formatReplCallTooManyBigIntDigitsError(20),
      )
      expect(
        mapReplPlainErrorLine(
          thrown,
          `TypeError: ${(thrown as Error).message}`,
        ),
      ).toBe('A call was not made: the numbers in its input were too long')

      // Negative sign counts toward String(bigint).length (matching official `toText(value).length`).
      expect(() => codec.encode({ n: -(10n ** 19n) }, undefined, true)).toThrow(
        formatReplCallTooManyBigIntDigitsError(20),
      )
    })

    test('readTree replaces over-budget BigInts with omission marker on non-whole decode', () => {
      const codec = createReplCodec({ mostDigits: 10 })
      const wire = codec.encode({ a: 123456n, b: 123456n }, undefined, false)
      const decoded = codec.decode(wire) as { a: unknown; b: unknown }
      expect(decoded.a).toBe(123456n)
      expect(decoded.b).toBe(
        '[a BigInt left out: the BigInts here have over 10 digits together]',
      )
    })

    test('executeCodeModeScript blocks overly long BigInt tool inputs and sets plainErrorLine', async () => {
      let called = false
      const res = await executeCodeModeScript({
        code: `await Read({ a: 10n ** 600n, b: 10n ** 600n })`,
        dosLimits: { mostDigits: 1000 },
        invokeTool: async () => {
          called = true
          return {}
        },
      })
      expect(called).toBe(false)
      expect(res.tool_calls).toBe(0)
      expect(res.result).toContain(
        'REPL: the call was not made, because its BigInts have over 1000 digits together. Pass them as text.',
      )
      expect(res.plainErrorLine?.text).toBe(
        'A call was not made: the numbers in its input were too long',
      )
    })
  })

  describe('3. Per-call argument size limit', () => {
    test('codec enforces mostChars across strings, keys, arrays, typed arrays, buffers, regexes, and errors', () => {
      const codec = createReplCodec({ mostChars: 100 })

      // Oversized string value.
      expect(() =>
        codec.encode({ content: 'a'.repeat(101) }, undefined, true),
      ).toThrow(REPL_CALL_TOO_LARGE_ERROR)

      // Oversized object key.
      expect(() =>
        codec.encode({ ['k'.repeat(101)]: 1 }, undefined, true),
      ).toThrow(REPL_CALL_TOO_LARGE_ERROR)

      // Oversized non-plain array enters treeOf -> countItems (2 * 51 = 102 > 100).
      expect(() =>
        codec.encode([...new Array(50).fill(0), undefined], undefined, true),
      ).toThrow(REPL_CALL_TOO_LARGE_ERROR)
      // Plain array whose JSON wire length (103) exceeds mostJsonChars (100) is rejected by wire decoder.
      const plainBigArrWire = codec.encode(
        new Array(51).fill(0),
        undefined,
        true,
      )
      expect(plainBigArrWire.length).toBeGreaterThan(100)
      expect(() =>
        decodeReplWireValue(plainBigArrWire, codec, { mostJsonChars: 100 }),
      ).toThrow('too long, or nested too deep')

      // Oversized Uint8Array inside slotNode must propagate refusal (not return placeholder).
      expect(() => codec.encode(new Uint8Array(51), undefined, true)).toThrow(
        REPL_CALL_TOO_LARGE_ERROR,
      )

      // Oversized ArrayBuffer & DataView.
      expect(() => codec.encode(new ArrayBuffer(51), undefined, true)).toThrow(
        REPL_CALL_TOO_LARGE_ERROR,
      )
      expect(() =>
        codec.encode(new DataView(new ArrayBuffer(51)), undefined, true),
      ).toThrow(REPL_CALL_TOO_LARGE_ERROR)

      // Oversized RegExp source inside slotNode must propagate refusal.
      expect(() =>
        codec.encode(new RegExp('a'.repeat(101)), undefined, true),
      ).toThrow(REPL_CALL_TOO_LARGE_ERROR)

      // Oversized Error message inside slotNode must propagate refusal.
      expect(() =>
        codec.encode(new Error('e'.repeat(101)), undefined, true),
      ).toThrow(REPL_CALL_TOO_LARGE_ERROR)

      // Map containing oversized value propagates refusal.
      expect(() =>
        codec.encode(new Map([['k', 'v'.repeat(101)]]), undefined, true),
      ).toThrow(REPL_CALL_TOO_LARGE_ERROR)
    })

    test('mapReplPlainErrorLine maps too-large TypeError, unawaited Promise TypeError, and tagged errors', () => {
      expect(
        mapReplPlainErrorLine(
          new TypeError(REPL_CALL_TOO_LARGE_ERROR),
          `TypeError: ${REPL_CALL_TOO_LARGE_ERROR}`,
        ),
      ).toBe('A call was not made: its input was too large')

      expect(
        mapReplPlainErrorLine(
          new TypeError(REPL_UNAWAITED_PROMISE_ERROR),
          `TypeError: ${REPL_UNAWAITED_PROMISE_ERROR}`,
        ),
      ).toBe(REPL_UNAWAITED_PROMISE_PLAIN_ERROR)

      const customErr = tagReplPlainError(
        new Error('detailed internal error'),
        'Short plain error',
      )
      expect(
        mapReplPlainErrorLine(customErr, 'Error: detailed internal error'),
      ).toBe('Short plain error')
      expect(
        summarizeReplErrorLine(`TypeError: ${REPL_CALL_TOO_LARGE_ERROR}`),
      ).toBe(`TypeError: ${REPL_CALL_TOO_LARGE_ERROR}`)
    })

    test('executeCodeModeScript blocks oversized call input before invokeTool and sets plainErrorLine', async () => {
      let called = false
      const res = await executeCodeModeScript({
        code: `await Write({ file_path: 'big.txt', content: 'x'.repeat(2000) })`,
        dosLimits: { mostJsonChars: 1000 },
        invokeTool: async () => {
          called = true
          return {}
        },
      })
      expect(called).toBe(false)
      expect(res.tool_calls).toBe(0)
      expect(res.result).toContain(REPL_CALL_TOO_LARGE_ERROR)
      expect(res.plainErrorLine?.text).toBe(
        'A call was not made: its input was too large',
      )
    })

    test('coercing an unawaited Promise to string inside the VM throws unawaited TypeError with plainErrorLine', async () => {
      const res = await executeCodeModeScript({
        code: `const p = Read({ file_path: 'a.ts' }); return '' + p;`,
        invokeTool: async () => ({ content: 'hi' }),
      })
      expect(res.result).toContain(REPL_UNAWAITED_PROMISE_ERROR)
      expect(res.plainErrorLine?.text).toBe(REPL_UNAWAITED_PROMISE_PLAIN_ERROR)
    })
  })

  describe('4. Primitive-only host call args & unknown call / oversized arg validation', () => {
    test('isHostCallPrimitive allows only text, numbers, booleans, null, undefined', () => {
      expect(isHostCallPrimitive('hello')).toBe(true)
      expect(isHostCallPrimitive(42)).toBe(true)
      expect(isHostCallPrimitive(true)).toBe(true)
      expect(isHostCallPrimitive(false)).toBe(true)
      expect(isHostCallPrimitive(null)).toBe(true)
      expect(isHostCallPrimitive(undefined)).toBe(true)

      expect(isHostCallPrimitive({})).toBe(false)
      expect(isHostCallPrimitive([])).toBe(false)
      expect(isHostCallPrimitive(() => {})).toBe(false)
      expect(isHostCallPrimitive(Symbol('s'))).toBe(false)
      expect(isHostCallPrimitive(1n)).toBe(false)
      expect(isHostCallPrimitive(new Date())).toBe(false)
    })

    test('ReplHostLink refuses non-primitive args and unknown op names with primitive-only error', () => {
      const received: string[] = []
      const link = new ReplHostLink({
        onCall: call => {
          received.push(call.name)
          call.reply(JSON.stringify({ v: 'ok' }))
        },
      })

      expect(link.send('atob', [{ raw: 'bad' }])).toBe(
        `!${REPL_PRIMITIVE_ONLY_ARGS_ERROR}`,
      )
      expect(() => link.invokeOrThrow('atob', [['array']])).toThrow(
        REPL_PRIMITIVE_ONLY_ARGS_ERROR,
      )
      expect(() => link.invokeOrThrow('atob', [() => {}])).toThrow(
        REPL_PRIMITIVE_ONLY_ARGS_ERROR,
      )
      expect(() => link.invokeOrThrow('atob', [Symbol('x')])).toThrow(
        REPL_PRIMITIVE_ONLY_ARGS_ERROR,
      )
      expect(() => link.invokeOrThrow('atob', [123n])).toThrow(
        REPL_PRIMITIVE_ONLY_ARGS_ERROR,
      )
      expect(() => link.invokeOrThrow('noSuchHostOp', ['hi'])).toThrow(
        REPL_PRIMITIVE_ONLY_ARGS_ERROR,
      )
      expect(received).toEqual([])

      // Valid primitive args succeed.
      expect(link.invokeOrThrow('atob', ['aGk='])).toBe('{"v":"ok"}')
      expect(received).toEqual(['atob'])
    })

    test('ReplHostDispatcher refuses unknown op, mode mismatch, extra args, invalid enum, and oversized args', () => {
      const warnings: string[] = []
      const codec = createReplCodec({ mostChars: 120, mostDepth: 4 })
      const dispatcher = new ReplHostDispatcher({
        codec,
        limits: {
          mostTextChars: 50,
          mostJsonChars: 120,
          mostDepth: 4,
        },
        handlers: new Map([
          [
            'atob',
            ({ text }) =>
              Buffer.from(String(text), 'base64').toString('binary'),
          ],
          ['tool', ({ name, input }) => ({ name, input })],
          ['stopped', ({ by }) => by],
        ]),
        onWarn: msg => warnings.push(msg),
      })

      // Unknown op name.
      expect(() =>
        dispatcher.validateCall({ name: 'unknownOp', args: [] }),
      ).toThrow(ReplHostCallValidationError)
      expect(() =>
        dispatcher.validateCall({ name: 'unknownOp', args: [] }),
      ).toThrow(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)

      // Mode mismatch: sync op called with async id, async op called without id.
      expect(() =>
        dispatcher.validateCall({ name: 'atob', args: ['aGk='], id: 1 }),
      ).toThrow(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)
      expect(() =>
        dispatcher.validateCall({ name: 'tool', args: ['Read', '{}'] }),
      ).toThrow(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)

      // Extra trailing non-null argument rejected.
      expect(() =>
        dispatcher.validateCall({ name: 'atob', args: ['aGk=', 'extra'] }),
      ).toThrow(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)

      // Trailing null/undefined ignored (matches official `n.slice(t.length).some(i => i != null)`).
      expect(
        dispatcher.validateCall({
          name: 'atob',
          args: ['aGk=', null, undefined],
        }),
      ).toEqual({ text: 'aGk=' })

      // Oversized string arg (> mostTextChars = 50).
      expect(() =>
        dispatcher.validateCall({ name: 'atob', args: ['a'.repeat(51)] }),
      ).toThrow(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)

      // Oversized JSON `any` arg (> mostJsonChars = 120).
      expect(() =>
        dispatcher.validateCall({
          name: 'tool',
          args: ['Read', JSON.stringify({ s: 'x'.repeat(130) })],
          id: 2,
        }),
      ).toThrow(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)

      // Wire JSON deeper than maxWireDepth (3 * 4 + 8 = 20).
      expect(() =>
        dispatcher.validateCall({
          name: 'tool',
          args: ['Read', `${'['.repeat(21)}1${']'.repeat(21)}`],
          id: 3,
        }),
      ).toThrow(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)

      // Invalid enum value for `stopped`.
      expect(() =>
        dispatcher.validateCall({ name: 'stopped', args: ['invalid'] }),
      ).toThrow(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)
      expect(
        dispatcher.validateCall({ name: 'stopped', args: ['clock'] }),
      ).toEqual({ by: 'clock' })

      // Sync answer refuses via callback with exact message.
      let refusedMsg = ''
      dispatcher.answer({
        name: 'atob',
        args: ['a'.repeat(51)],
        tag: 1,
        reply: () => {},
        refuse: msg => {
          refusedMsg = msg
        },
      })
      expect(refusedMsg).toBe(REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR)
      expect(warnings.length).toBeGreaterThan(0)
      expect(
        warnings.every(w => w === REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR),
      ).toBe(true)

      // Direct parseReplHostOpArgs returns undefined on invalid types.
      const specs = createDefaultReplHostOpSpecs()
      expect(
        parseReplHostOpArgs(specs.get('reached')!, [-1, 0], codec),
      ).toBeUndefined()
      expect(
        parseReplHostOpArgs(specs.get('reached')!, [1.5, 0], codec),
      ).toBeUndefined()
      expect(parseReplHostOpArgs(specs.get('reached')!, [1, 2], codec)).toEqual(
        { slot: 1, at: 2 },
      )
    })

    test('executeCodeModeScript rejects oversized string host args and wire-expanded JSON exceeding mostJsonChars', async () => {
      const resAtob = await executeCodeModeScript({
        code: `return atob('A'.repeat(200))`,
        dosLimits: { mostTextChars: 100 },
        invokeTool: async () => ({}),
      })
      expect(resAtob.result).toContain(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )

      const resBadName = await executeCodeModeScript({
        code: `await callTool(123, {})`,
        invokeTool: async () => ({}),
      })
      expect(resBadName.result).toContain(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )

      // Raw string length (80) fits inside mostJsonChars (100), but JSON escaping
      // doubles `"` -> `\"` so the wire JSON exceeds 100 chars -> rejected by wire decoder.
      const resWireExpanded = await executeCodeModeScript({
        code: `await Read({ s: '"'.repeat(80) })`,
        dosLimits: { mostJsonChars: 100 },
        invokeTool: async () => ({}),
      })
      expect(resWireExpanded.result).toContain(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    })
  })

  describe('5. Per-turn call count / total data budget', () => {
    test('ReplHostLink enforces maxTurnCalls, maxTurnChars, 2x followsCalls headroom, atOnce bypass, flushTurn reset, and handleTimeout', () => {
      const flushed: Array<{ name: string; id?: number; tag: number }> = []
      const forgotten: number[] = []
      const link = new ReplHostLink({
        limits: { maxTurnCalls: 3, maxTurnChars: 100 },
        onCall: call => {
          flushed.push({ name: call.name, id: call.id, tag: call.tag })
        },
        onForget: id => forgotten.push(id),
      })

      // 3 async calls succeed in turn 1.
      expect(link.invokeOrThrow('tool', ['Read', '{}'], 1)).toBe('1')
      expect(link.invokeOrThrow('tool', ['Read', '{}'], 1)).toBe('2')
      expect(link.invokeOrThrow('tool', ['Read', '{}'], 1)).toBe('3')
      // 4th async call hits maxTurnCalls (3).
      expect(() => link.invokeOrThrow('tool', ['Read', '{}'], 1)).toThrow(
        REPL_TURN_BUDGET_EXCEEDED_ERROR,
      )

      // `followsCalls` notify ops (`threw`/`returned`) still have headroom up to 2 * maxTurnCalls (6).
      expect(link.invokeOrThrow('threw', ['err', '', false], 1)).toBe('')
      expect(link.invokeOrThrow('returned', ['=ok'], 1)).toBe('')
      expect(link.invokeOrThrow('returned', ['=ok2'], 1)).toBe('')
      // 7th queued call (2 * 3 = 6 already queued) refuses even followsCalls notify.
      expect(() => link.invokeOrThrow('returned', ['=overflow'], 1)).toThrow(
        REPL_TURN_BUDGET_EXCEEDED_ERROR,
      )

      // `atOnce: true` async op (`sleep`) dispatches immediately without touching queue
      // (the refused 4th async call consumed id 4, matching official `++this.#p` before `#E(i)`).
      expect(link.invokeOrThrow('sleep', [10], 1)).toBe('5')
      expect(flushed).toEqual([{ name: 'sleep', id: 5, tag: 1 }])

      // flushTurn drains queue and resets counters to 0.
      link.flushTurn()
      expect(link.queuedCallCount).toBe(0)
      expect(link.queuedCharCount).toBe(0)
      expect(flushed.length).toBe(7)

      // Cumulative char budget: 1st call has 100 chars -> accepted (queuedChars becomes 104 >= 100);
      // 2nd call in the same turn is rejected even though queuedCount (1) < maxTurnCalls (3).
      expect(link.invokeOrThrow('tool', ['Read', 'x'.repeat(100)], 2)).toBe('6')
      expect(() => link.invokeOrThrow('tool', ['Read', '{}'], 2)).toThrow(
        REPL_TURN_BUDGET_EXCEEDED_ERROR,
      )

      // handleTimeout drops async calls & forgets their IDs, and drops notify calls for timed-out tags.
      link.invokeOrThrow('returned', ['=tag2'], 2)
      link.invokeOrThrow('returned', ['=tag3'], 3)
      link.handleTimeout()
      expect(forgotten).toEqual([6])
      flushed.length = 0
      link.flushTurn()
      // Only tag 3's notify survived (tag 2 had a timed-out async call).
      expect(flushed).toEqual([{ name: 'returned', id: undefined, tag: 3 }])
    })

    test('ReplTurnCallBudget tracks call count and char count accurately and resets cleanly', () => {
      const budget = new ReplTurnCallBudget({
        maxTurnCalls: 2,
        maxTurnChars: 20,
      })
      budget.chargeOrThrow(['a', '1234567890'], false)
      expect(budget.callCount).toBe(1)
      expect(budget.charCount).toBe(11)
      budget.chargeOrThrow(['b', '1234567890'], false)
      expect(budget.callCount).toBe(2)
      expect(budget.charCount).toBe(22)
      expect(() => budget.chargeOrThrow(['c', 'x'], false)).toThrow(
        REPL_TURN_BUDGET_EXCEEDED_ERROR,
      )
      budget.reset()
      expect(budget.callCount).toBe(0)
      expect(budget.charCount).toBe(0)
      expect(() => budget.chargeOrThrow(['c', 'x'], false)).not.toThrow()
    })

    test('executeCodeModeScript blocks too many unawaited calls or too much data in one turn, but succeeds when awaited', async () => {
      // Unawaited burst exceeding maxTurnCalls (4) in one synchronous turn.
      const resCount = await executeCodeModeScript({
        code: `
          const ps = [];
          for (let i = 0; i < 5; i++) ps.push(Read({ file_path: 'a.ts' }));
          await Promise.all(ps);
        `,
        dosLimits: { maxTurnCalls: 4 },
        invokeTool: async () => ({ content: 'ok' }),
      })
      expect(resCount.result).toContain(REPL_TURN_BUDGET_EXCEEDED_ERROR)

      // Unawaited burst exceeding maxTurnChars (200) in one synchronous turn.
      const resBytes = await executeCodeModeScript({
        code: `
          const p1 = Write({ file_path: 'a.ts', content: 'x'.repeat(210) });
          const p2 = Write({ file_path: 'b.ts', content: 'y' });
          await Promise.all([p1, p2]);
        `,
        dosLimits: { maxTurnCalls: 100, maxTurnChars: 200 },
        invokeTool: async () => ({ ok: true }),
      })
      expect(resBytes.result).toContain(REPL_TURN_BUDGET_EXCEEDED_ERROR)

      // Awaiting between calls resets the turn budget and succeeds past maxTurnCalls & maxTurnChars!
      const resAwaited = await executeCodeModeScript({
        code: `
          for (let i = 0; i < 6; i++) {
            await Write({ file_path: 'a.ts', content: 'x'.repeat(210) });
          }
          return 'all-ok';
        `,
        dosLimits: { maxTurnCalls: 2, maxTurnChars: 200 },
        invokeTool: async () => ({ ok: true }),
      })
      expect(resAwaited.result).toBe('all-ok')
      expect(resAwaited.tool_calls).toBe(6)
    })
  })

  describe('6. Circular value transform guard', () => {
    test('hasCircularReference detects direct, mutual, array, Map, Set, and nested cycles, while allowing shared DAGs', () => {
      // Direct self-cycle.
      const selfObj: Record<string, unknown> = { a: 1 }
      selfObj.self = selfObj
      expect(hasCircularReference(selfObj)).toBe(true)

      // Mutual cycle.
      const a: Record<string, unknown> = {}
      const b: Record<string, unknown> = { a }
      a.b = b
      expect(hasCircularReference(a)).toBe(true)

      // Array cycle.
      const arr: unknown[] = []
      arr.push(arr)
      expect(hasCircularReference(arr)).toBe(true)

      // Map cycle.
      const map = new Map<string, unknown>()
      map.set('self', map)
      expect(hasCircularReference(map)).toBe(true)

      // Set cycle.
      const set = new Set<unknown>()
      set.add(set)
      expect(hasCircularReference(set)).toBe(true)

      // Nested cyclic child.
      expect(hasCircularReference({ wrapper: selfObj })).toBe(true)

      // Shared DAG (diamond) is NOT circular.
      const shared = { x: 1, y: [1, 2] }
      expect(hasCircularReference({ left: shared, right: shared })).toBe(false)

      // Dense binary DAG (depth 25 -> 2^25 paths) must complete fast without exponential blowup.
      let dag: Record<string, unknown> = { leaf: true }
      for (let i = 0; i < 25; i++) {
        dag = { left: dag, right: dag }
      }
      expect(hasCircularReference(dag)).toBe(false)
    })

    test('assertNotCircularForTransform and guardCircularTransform throw exact official error on circular values', () => {
      const cyclic: Record<string, unknown> = {}
      cyclic.loop = cyclic

      expect(() => assertNotCircularForTransform(cyclic)).toThrow(
        REPL_CIRCULAR_TRANSFORM_ERROR,
      )

      const doubleKeys = guardCircularTransform((v: Record<string, unknown>) =>
        Object.keys(v),
      )
      expect(doubleKeys({ a: 1, b: 2 })).toEqual(['a', 'b'])
      expect(() => doubleKeys(cyclic)).toThrow(REPL_CIRCULAR_TRANSFORM_ERROR)
    })

    test('safeParseWithCircularTransformGuard blocks circular values entering .transform(), z.preprocess(), and recursive z.lazy() transforms', () => {
      const cyclic: Record<string, unknown> = { label: 'node' }
      cyclic.next = cyclic

      // Top-level .transform()
      const topTransform = z
        .object({ label: z.string(), next: z.unknown().optional() })
        .transform(v => v)
      expect(() =>
        safeParseWithCircularTransformGuard(topTransform, cyclic),
      ).toThrow(REPL_CIRCULAR_TRANSFORM_ERROR)

      // Nested field .transform()
      const nestedTransform = z.object({
        safe: z.string(),
        payload: z.unknown().transform(v => v),
      })
      expect(() =>
        safeParseWithCircularTransformGuard(nestedTransform, {
          safe: 'ok',
          payload: cyclic,
        }),
      ).toThrow(REPL_CIRCULAR_TRANSFORM_ERROR)

      // Circular value in a non-transformed sibling field does NOT trigger error.
      const siblingSchema = z.object({
        safe: z.string().transform(s => s.toUpperCase()),
        extra: z.unknown(),
      })
      const siblingResult = safeParseWithCircularTransformGuard(siblingSchema, {
        safe: 'ok',
        extra: cyclic,
      })
      expect(siblingResult.success).toBe(true)

      // z.preprocess()
      const preprocessSchema = z.preprocess(v => v, z.any())
      expect(() =>
        safeParseWithCircularTransformGuard(preprocessSchema, cyclic),
      ).toThrow(REPL_CIRCULAR_TRANSFORM_ERROR)

      // Recursive z.lazy() with .transform() must throw cleanly without stack overflow.
      const LazyNode: z.ZodType<unknown> = z.lazy(() =>
        z
          .object({ label: z.string(), next: LazyNode.optional() })
          .transform(v => v),
      )
      expect(() =>
        safeParseWithCircularTransformGuard(LazyNode, cyclic),
      ).toThrow(REPL_CIRCULAR_TRANSFORM_ERROR)

      // Union where primitive branch has .transform() does NOT falsely throw on circular object matching non-transform branch.
      const unionSchema = z.union([
        z.string().transform(s => s.trim()),
        z.object({ label: z.string() }),
      ])
      expect(() =>
        assertNoCircularValueInSchemaTransforms(unionSchema, cyclic),
      ).not.toThrow()

      // Shared non-cyclic DAG passes through .transform() cleanly.
      const shared = { val: 42 }
      const dagResult = safeParseWithCircularTransformGuard(
        z
          .object({ a: z.unknown(), b: z.unknown() })
          .transform(v => ({ seen: Boolean(v.a && v.b) })),
        { a: shared, b: shared },
      )
      expect(dagResult.success).toBe(true)
      expect(dagResult.data).toEqual({ seen: true })
    })

    test('wrapReplToolForCodeMode blocks a Code Mode script passing a circular object to a tool schema with .transform()', async () => {
      setEngineCheckResultForTests('passed')
      pinCodeMode(true)

      let toolInvoked = false
      const transformTool = {
        name: 'TransformTool',
        description: async () =>
          'Tool with a Zod transform on its input schema',
        inputSchema: z
          .object({ payload: z.unknown() })
          .transform(v => ({ wrapped: v.payload })),
        call: async () => {
          toolInvoked = true
          return { data: { ok: true } }
        },
        isEnabled: () => true,
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
        checkPermissions: async (input: unknown) => ({
          behavior: 'allow' as const,
          updatedInput: input as Record<string, unknown>,
        }),
      } as unknown as Tool

      const wrapped = wrapReplToolForCodeMode(REPLTool, () => [
        REPLTool,
        transformTool,
      ])

      const ctx = {
        abortController: new AbortController(),
        options: { tools: [REPLTool, transformTool] },
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'bypassPermissions',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: true,
          },
        }),
      } as unknown as ToolUseContext

      const canUseTool = async (
        _tool: Tool,
        input: Record<string, unknown>,
      ) => ({
        behavior: 'allow' as const,
        updatedInput: input,
      })

      const circularRes = (await wrapped.call(
        {
          code: `
            const obj = { k: 1 };
            obj.self = obj;
            await TransformTool({ payload: obj });
          `,
        } as never,
        ctx,
        canUseTool as never,
        {} as AssistantMessage,
      )) as { data: { result: string } }

      expect(toolInvoked).toBe(false)
      expect(circularRes.data.result).toContain(REPL_CIRCULAR_TRANSFORM_ERROR)

      // Shared non-cyclic DAG object passes through TransformTool cleanly.
      const dagRes = (await wrapped.call(
        {
          code: `
            const shared = { k: 1 };
            return await TransformTool({ payload: { a: shared, b: shared } });
          `,
        } as never,
        ctx,
        canUseTool as never,
        {} as AssistantMessage,
      )) as { data: { result: string } }

      expect(toolInvoked).toBe(true)
      expect(dagRes.data.result).not.toContain('Error:')
    })
  })
})
