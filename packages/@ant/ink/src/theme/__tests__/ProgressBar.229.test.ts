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
    const children = (node.props as { children?: string }).children
    expect(typeof children === 'string' ? children.length : 0).toBeGreaterThan(
      0,
    )
  })
})
