/**
 * densable 2.1.219 #14 — Vim NORMAL idle empty ← → agent view.
 *
 * densable:
 *   if (j.command.type==="idle" && !F.shift &&
 *       (F.name==="up" || F.name==="down" || (F.name==="left" && z.text===""))) {
 *     W.handleKeyDown(F); return
 *   }
 *
 * Static source shape + pure-gate e2e matrix (no React mount).
 * densable z.text ≈ controlled props.value.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldDelegateVimIdleArrowToTextInput } from '../useVimInput.js'

const ROOT = join(import.meta.dir, '../..')

describe('densable 2.1.219 #14 vim empty left — source shape', () => {
  test('VimTextInput forwards onLeftArrowOnEmpty props', () => {
    const src = readFileSync(join(ROOT, 'components/VimTextInput.tsx'), 'utf8')
    expect(src).toContain('onLeftArrowOnEmpty: props.onLeftArrowOnEmpty')
    expect(src).toContain(
      'onLeftArrowOnEmptyMessage: props.onLeftArrowOnEmptyMessage',
    )
  })

  test('useVimInput uses pure densable idle-arrow gate helper', () => {
    const src = readFileSync(join(ROOT, 'hooks/useVimInput.ts'), 'utf8')
    expect(src).toContain('shouldDelegateVimIdleArrowToTextInput')
    expect(src).toContain('commandType: state.command.type')
    expect(src).toContain('text: props.value')
    // right is NOT in densable early delegate (maps to l instead)
    expect(src).not.toMatch(
      /key\.upArrow\s*\|\|\s*key\.downArrow\s*\|\|\s*key\.leftArrow\s*\|\|\s*key\.rightArrow/,
    )
  })

  test('useTextInput left-empty path invokes onLeftArrowOnEmpty', () => {
    const src = readFileSync(join(ROOT, 'hooks/useTextInput.ts'), 'utf8')
    expect(src).toContain('onLeftArrowOnEmpty')
    expect(src).toContain("originalValue === ''")
    expect(src).toContain('cursor.offset === 0')
  })
})

describe('densable 2.1.219 #14 pure gate e2e matrix', () => {
  const idle = {
    commandType: 'idle' as const,
    shift: false,
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    text: '',
  }

  test('empty left → delegate (agent view path)', () => {
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        leftArrow: true,
        text: '',
      }),
    ).toBe(true)
  })

  test('non-empty left → stay vim (maps to h)', () => {
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        leftArrow: true,
        text: 'hello',
      }),
    ).toBe(false)
  })

  test('up / down early-delegate regardless of text', () => {
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        upArrow: true,
        text: 'x',
      }),
    ).toBe(true)
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        downArrow: true,
        text: 'x',
      }),
    ).toBe(true)
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        upArrow: true,
        text: '',
      }),
    ).toBe(true)
  })

  test('shift blocks early-delegate (densable !F.shift)', () => {
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        shift: true,
        leftArrow: true,
        text: '',
      }),
    ).toBe(false)
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        shift: true,
        upArrow: true,
        text: '',
      }),
    ).toBe(false)
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        shift: true,
        downArrow: true,
        text: '',
      }),
    ).toBe(false)
  })

  test('non-idle command does not early-delegate', () => {
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        commandType: 'count',
        leftArrow: true,
        text: '',
      }),
    ).toBe(false)
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        commandType: 'operator',
        upArrow: true,
        text: '',
      }),
    ).toBe(false)
  })

  test('right alone never early-delegates', () => {
    // densable only names up|down|left — right maps to l after gate
    expect(
      shouldDelegateVimIdleArrowToTextInput({
        ...idle,
        leftArrow: false,
        text: '',
      }),
    ).toBe(false)
  })
})
