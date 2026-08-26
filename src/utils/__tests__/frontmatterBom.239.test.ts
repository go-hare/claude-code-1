// densable 2.1.239 #23 — agents/skills/commands .md UTF-8 BOM via HG/bf.
import { describe, expect, test } from 'bun:test'
import { parseFrontmatter, stripUtf8Bom } from '../frontmatterParser.js'

const BOM = '\uFEFF'

describe('densable 2.1.239 #23 frontmatter UTF-8 BOM', () => {
  test('HG strips a leading BOM and leaves other text', () => {
    expect(stripUtf8Bom(`${BOM}---\n`)).toBe('---\n')
    expect(stripUtf8Bom('no bom')).toBe('no bom')
    expect(stripUtf8Bom('')).toBe('')
  })

  test('BOM + frontmatter parses instead of being ignored', () => {
    const md = `${BOM}---
description: A test
---
body`
    const result = parseFrontmatter(md)
    expect(result.frontmatter.description).toBe('A test')
    expect(result.content).toBe('body')
  })

  test('no frontmatter keeps the original string including BOM', () => {
    const md = `${BOM}Just prose`
    const result = parseFrontmatter(md)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe(md)
  })
})
