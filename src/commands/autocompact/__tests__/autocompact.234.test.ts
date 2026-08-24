import { describe, expect, test } from 'bun:test'
import autocompact from '../index.js'

describe('/autocompact densable 2.1.234', () => {
  test('is local-jsx with immediate true', () => {
    expect(autocompact.type).toBe('local-jsx')
    expect(autocompact.immediate).toBe(true)
  })

  test('argumentHint and description', () => {
    expect(autocompact.argumentHint).toBe('[auto|<tokens>]')
    expect(autocompact.description).toBe(
      'Set how full the context gets before auto-summarizing',
    )
  })
})
