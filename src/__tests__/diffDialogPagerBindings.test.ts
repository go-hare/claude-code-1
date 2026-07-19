import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'

describe('densable DiffDialog pager bindings', () => {
  test('defaultBindings DiffDialog densable map', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'DiffDialog')
    expect(block).toBeDefined()
    const b = block!.bindings
    expect(b.escape).toBe('diff:dismiss')
    expect(b.left).toBe('diff:previousSource')
    expect(b.right).toBe('diff:nextSource')
    expect(b.up).toBe('diff:previousFile')
    expect(b.down).toBe('diff:nextFile')
    expect(b.enter).toBe('diff:viewDetails')
    expect(b.j).toBe('diff:nextFile')
    expect(b.k).toBe('diff:previousFile')
    expect(b.pageup).toBe('scroll:pageUp')
    expect(b.pagedown).toBe('scroll:pageDown')
    expect(b.space).toBe('scroll:fullPageDown')
    expect(b['shift+space']).toBe('scroll:fullPageUp')
    expect(b.b).toBe('scroll:fullPageUp')
    expect(b.g).toBe('scroll:top')
    expect(b['shift+g']).toBe('scroll:bottom')
    expect(b.home).toBe('scroll:top')
    expect(b.end).toBe('scroll:bottom')
  })
})
