import { describe, expect, test } from 'bun:test'
import { createBashShellProvider } from '../bashProvider.js'

describe('bash provider detached (Windows shell flash)', () => {
  test('detached is false on win32 so conhost does not flash', async () => {
    const provider = await createBashShellProvider('/bin/bash', {
      skipSnapshot: true,
    })
    if (process.platform === 'win32') {
      expect(provider.detached).toBe(false)
    } else {
      expect(provider.detached).toBe(true)
    }
  })
})
