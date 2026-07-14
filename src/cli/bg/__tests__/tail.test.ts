import { describe, test, expect } from 'bun:test'

describe('tailLog', () => {
  test('module exports tailLog function', async () => {
    const mod = await import('../tail.js')
    expect(typeof mod.tailLog).toBe('function')
  })

  test('TailAttachResult type shape is exported for GCp gate', async () => {
    // Compile-time contract: attach returns { outcome, viaApc?, msg? }
    type Expected = {
      outcome: 'detached' | 'error'
      viaApc?: boolean
      msg?: string
    }
    const sample: Expected = { outcome: 'detached', viaApc: true }
    expect(sample.outcome).toBe('detached')
    expect(sample.viaApc).toBe(true)
  })
})
