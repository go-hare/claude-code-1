import { describe, expect, test } from 'bun:test'
import advisor from '../index.js'

describe('/advisor densable 2.1.234', () => {
  test('is local-jsx with function immediate', () => {
    expect(advisor.type).toBe('local-jsx')
    expect(typeof advisor.immediate).toBe('function')
  })

  test('argumentHint includes off', () => {
    expect(advisor.argumentHint).toContain('off')
  })

  test('description matches densable', () => {
    expect(advisor.description).toBe(
      'Let Claude consult a stronger model at key moments',
    )
  })
})
