import { describe, expect, test } from 'bun:test'
import {
  computeDeferredToolNamesForRequest,
  getHeldInlineTools,
  latchDeclaredTools,
} from '../claude.js'
import type { Tool, Tools } from '../../../Tool.js'

function fakeTool(name: string): Tool {
  return { name } as unknown as Tool
}

describe('2.1.302 #901 stickyBetas.declaredTools / heldInlineTools', () => {
  test('latches inline tools per stickyBetas object and defers mid-session additions', () => {
    const stickyBetas = { sent: new Set<string>(), rejected: new Set<string>() }
    expect(getHeldInlineTools(stickyBetas)).toBeUndefined()

    const initialTools = [
      fakeTool('Read'),
      fakeTool('Edit'),
      fakeTool('ToolSearch'),
      fakeTool('DeferredTool'),
    ] as unknown as Tools

    // First request: heldInlineTools is undefined -> uses isDeferredFn
    const firstDeferred = computeDeferredToolNamesForRequest(
      initialTools,
      true,
      getHeldInlineTools(stickyBetas),
      t => t.name === 'DeferredTool',
    )
    expect([...firstDeferred]).toEqual(['DeferredTool'])

    // Latch inline tools (Read, Edit, ToolSearch)
    latchDeclaredTools(stickyBetas, ['Read', 'Edit', 'ToolSearch'])
    expect([...(getHeldInlineTools(stickyBetas) ?? [])]).toEqual([
      'Read',
      'Edit',
      'ToolSearch',
    ])

    // Second request (after mid-session tool addition or compaction):
    // MidSessionAddedTool is NOT in heldInlineTools -> must be deferred even if isDeferredFn would say false!
    const nextTools = [
      ...initialTools,
      fakeTool('MidSessionAddedTool'),
    ] as unknown as Tools
    const nextDeferred = computeDeferredToolNamesForRequest(
      nextTools,
      true,
      getHeldInlineTools(stickyBetas),
      () => false,
    )
    expect(nextDeferred.has('Read')).toBe(false)
    expect(nextDeferred.has('Edit')).toBe(false)
    expect(nextDeferred.has('ToolSearch')).toBe(false)
    expect(nextDeferred.has('DeferredTool')).toBe(true)
    expect(nextDeferred.has('MidSessionAddedTool')).toBe(true)
  })

  test('new stickyBetas instance (e.g. after /clear) starts unlatched', () => {
    const freshStickyBetas = {
      sent: new Set<string>(),
      rejected: new Set<string>(),
    }
    expect(getHeldInlineTools(freshStickyBetas)).toBeUndefined()
  })
})
