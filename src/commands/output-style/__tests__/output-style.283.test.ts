import { describe, expect, test } from 'bun:test'
import outputStyle, { outputStyleMapleAlias } from '../index.js'

describe('densable 2.1.283 /output-style', () => {
  test('live command lists or switches; maple alias stays hidden', () => {
    expect(outputStyle.type).toBe('local')
    expect(outputStyle.name).toBe('output-style')
    expect(outputStyle.supportsNonInteractive).toBe(true)
    expect(outputStyle.description).toBe('List output styles or switch to one')
    expect(outputStyle.argumentHint).toBe('[style]')
    expect(outputStyleMapleAlias.isHidden).toBe(true)
    expect(outputStyleMapleAlias.description).toContain('/config')
  })
})
