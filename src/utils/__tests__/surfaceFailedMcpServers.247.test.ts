/**
 * densable 2.1.247 #26 — Xb default true (246 Lb default false).
 */
import { describe, expect, test } from 'bun:test'
import { shouldSurfaceFailedMcpServers } from '../surfaceFailedMcpServers.js'

describe('densable 2.1.247 #26 tengu_surface_failed_mcp_servers', () => {
  test('Xb default is true when GrowthBook is unavailable', () => {
    expect(shouldSurfaceFailedMcpServers()).toBe(true)
  })
})
