/**
 * densable 2.1.229 #8 — ProgressBar must not RangeError on non-positive width.
 */
import { describe, expect, test } from 'bun:test'
import React from 'react'
import { ProgressBar } from '../ProgressBar.js'

describe('densable 2.1.229 #8 ProgressBar narrow width', () => {
  test('width 0 does not throw', () => {
    expect(() => ProgressBar({ ratio: 0.5, width: 0 })).not.toThrow()
  })

  test('width negative does not throw', () => {
    expect(() => ProgressBar({ ratio: 0.5, width: -3 })).not.toThrow()
  })

  test('normal width still renders filled segment', () => {
    const node = ProgressBar({ ratio: 1, width: 4 }) as React.ReactElement
    expect(node).toBeTruthy()
    // children is the joined block string
    const props = node.props as { children?: string; 'aria-label'?: string }
    expect(
      typeof props.children === 'string' ? props.children.length : 0,
    ).toBeGreaterThan(0)
    expect(props['aria-label']).toBe('100%')
  })

  test('pill variant renders geometric shapes or fallback on ghostty', () => {
    const savedTerm = process.env.TERM
    const savedProg = process.env.TERM_PROGRAM
    try {
      delete process.env.TERM
      delete process.env.TERM_PROGRAM
      const pill = ProgressBar({
        ratio: 0.5,
        width: 4,
        variant: 'pill',
      }) as React.ReactElement
      const children = (pill.props as { children: React.ReactElement[] })
        .children
      expect((children[0]!.props as { children: string }).children).toBe('▰▰')
      expect((children[1]!.props as { children: string }).children).toBe('▱▱')

      process.env.TERM_PROGRAM = 'ghostty'
      const fallback = ProgressBar({
        ratio: 0.5,
        width: 4,
        variant: 'pill',
      }) as React.ReactElement
      const fbChildren = (fallback.props as { children: React.ReactElement[] })
        .children
      expect((fbChildren[0]!.props as { children: string }).children).toBe('██')
      expect((fbChildren[1]!.props as { children: string }).children).toBe('░░')
    } finally {
      if (savedTerm === undefined) delete process.env.TERM
      else process.env.TERM = savedTerm
      if (savedProg === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = savedProg
    }
  })
})
