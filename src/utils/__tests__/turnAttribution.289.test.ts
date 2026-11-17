import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  clearTurnAttributionKey,
  getTurnAttributionKey,
  resolveCommandTurnAttributionKey,
  resolveSinglePromptAttributionKey,
  runWithTurnAttribution,
  updateTurnAttributionFromCommands,
  withTurnAttributionGenerator,
} from '../turnAttribution.js'

describe('densable yk / rAn.run withTurnAttributionGenerator', () => {
  test('does not fabricate a UUID when no outer turn attribution exists', async () => {
    let keyInside: string | undefined = 'sentinel'
    async function* inner() {
      keyInside = getTurnAttributionKey()
      yield 1
    }
    const wrapped = withTurnAttributionGenerator(inner())
    expect((await wrapped.next()).value).toBe(1)
    expect(keyInside).toBeUndefined()
    await wrapped.return(undefined as never)
  })

  test('next(), throw(), and return() run inside ALS and reach the inner generator', async () => {
    const validUuid = '11111111-2222-3333-4444-555555555555'
    const updatedUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    let innerReturned = false
    let caughtInside: unknown
    const observedKeys: Array<string | undefined> = []

    async function* inner() {
      try {
        observedKeys.push(getTurnAttributionKey())
        try {
          yield 1
        } catch (err) {
          caughtInside = err
          observedKeys.push(getTurnAttributionKey())
        }
        updateTurnAttributionFromCommands([{ turnAttributionKey: updatedUuid }])
        observedKeys.push(getTurnAttributionKey())
        clearTurnAttributionKey()
        observedKeys.push(getTurnAttributionKey())
        yield 2
      } finally {
        innerReturned = true
      }
    }

    const wrapped = runWithTurnAttribution(validUuid, () =>
      withTurnAttributionGenerator(inner()),
    )
    expect((await wrapped.next()).value).toBe(1)
    expect((await wrapped.throw(new Error('boom'))).value).toBe(2)
    expect(caughtInside).toBeInstanceOf(Error)
    expect(observedKeys).toEqual([validUuid, validUuid, updatedUuid, undefined])
    await wrapped.return(undefined as never)
    expect(innerReturned).toBe(true)
  })

  test('nested generator gets an isolated store and never mutates parent turn attribution', async () => {
    const parentUuid = '11111111-2222-3333-4444-555555555555'
    const childUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

    await runWithTurnAttribution(parentUuid, async () => {
      async function* child() {
        expect(getTurnAttributionKey()).toBe(parentUuid)
        updateTurnAttributionFromCommands([{ turnAttributionKey: childUuid }])
        expect(getTurnAttributionKey()).toBe(childUuid)
        clearTurnAttributionKey()
        expect(getTurnAttributionKey()).toBeUndefined()
        yield 'done'
      }

      const wrapped = withTurnAttributionGenerator(child())
      expect((await wrapped.next()).value).toBe('done')
      // Parent ALS store must remain untouched after child mutations.
      expect(getTurnAttributionKey()).toBe(parentUuid)
      await wrapped.return(undefined as never)
      expect(getTurnAttributionKey()).toBe(parentUuid)
    })
  })

  test('resolveCommandTurnAttributionKey and resolveSinglePromptAttributionKey validate UUID shape', () => {
    const valid = '11111111-2222-3333-4444-555555555555'
    const other = '22222222-3333-4444-5555-666666666666'
    expect(
      resolveCommandTurnAttributionKey({ turnAttributionKey: 'not-a-uuid' }),
    ).toBeUndefined()
    expect(
      resolveCommandTurnAttributionKey({ turnAttributionKey: valid }),
    ).toBe(valid)
    expect(
      resolveCommandTurnAttributionKey({
        mode: 'task-notification',
        inheritedTurnAttributionKey: valid,
      }),
    ).toBe(valid)

    expect(
      resolveSinglePromptAttributionKey([{ uuid: valid, isMeta: false }]),
    ).toBe(valid)
    expect(
      resolveSinglePromptAttributionKey([
        { turnAttributionKey: valid, isMeta: false },
        { turnAttributionKey: other, isMeta: false },
      ]),
    ).toBeUndefined()
    expect(
      resolveSinglePromptAttributionKey([
        {
          mode: 'task-notification',
          inheritedTurnAttributionKey: valid,
          isMeta: true,
        },
      ]),
    ).toBe(valid)
  })

  test('handlePromptSubmit wires runWithTurnAttribution and QueryEngine clears deferredToolUse', () => {
    const handleSrc = readFileSync(
      join(import.meta.dir, '../handlePromptSubmit.ts'),
      'utf8',
    )
    expect(handleSrc).toContain('resolveSinglePromptAttributionKey(commands)')
    expect(handleSrc).toContain('runWithTurnAttribution(turnAttributionKey')

    const qeSrc = readFileSync(
      join(import.meta.dir, '../../QueryEngine.ts'),
      'utf8',
    )
    const deferredIdx = qeSrc.indexOf('if (deferredToolUse)')
    expect(deferredIdx).toBeGreaterThan(-1)
    expect(qeSrc.slice(deferredIdx, deferredIdx + 260)).toContain(
      'clearTurnAttributionKey()',
    )
  })
})
