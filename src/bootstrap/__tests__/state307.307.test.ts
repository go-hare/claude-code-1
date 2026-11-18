import { afterEach, describe, expect, test } from 'bun:test'
import {
  getAutoCompactWindowSurface,
  getFlagMcpConfigFilePaths,
  setAutoCompactWindowSurface,
  setFlagMcpConfigFilePaths,
} from '../state.js'

describe('bootstrap state v2.1.307 & v2.1.309 (#1083, #1120)', () => {
  afterEach(() => {
    setAutoCompactWindowSurface(undefined)
    setFlagMcpConfigFilePaths([])
  })

  test('#1083: getAutoCompactWindowSurface / setAutoCompactWindowSurface round-trips', () => {
    expect(getAutoCompactWindowSurface()).toBeUndefined()
    setAutoCompactWindowSurface('claude-code-remote')
    expect(getAutoCompactWindowSurface()).toBe('claude-code-remote')
  })

  test('#1120: getFlagMcpConfigFilePaths / setFlagMcpConfigFilePaths stores immutable paths', () => {
    expect(getFlagMcpConfigFilePaths()).toEqual([])
    const input = ['/tmp/a.json', '/tmp/b.json']
    setFlagMcpConfigFilePaths(input)
    input.push('/tmp/c.json')
    expect(getFlagMcpConfigFilePaths()).toEqual(['/tmp/a.json', '/tmp/b.json'])
  })
})
