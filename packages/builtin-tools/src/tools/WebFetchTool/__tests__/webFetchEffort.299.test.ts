import { describe, expect, test } from 'bun:test'
import { resolveWebFetchModelAndEffort } from '../utils.js'

describe('WebFetchTool Wave 4A (#720)', () => {
  test('#720 uses caller model and caller effort when provided', () => {
    const res = resolveWebFetchModelAndEffort('claude-opus-4-6', 'high')
    expect(res.useCallerModel).toBe(true)
    expect(res.model).toBe('claude-opus-4-6')
    expect(res.effortValue).toBe('high')
  })

  test('#720 falls back to small model when caller model is omitted', () => {
    const res = resolveWebFetchModelAndEffort(undefined, undefined)
    expect(res.useCallerModel).toBe(false)
    expect(typeof res.model).toBe('string')
    expect(res.model.length).toBeGreaterThan(0)
  })
})
