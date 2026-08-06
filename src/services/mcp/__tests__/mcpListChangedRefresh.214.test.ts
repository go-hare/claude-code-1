/**
 * densable 2.1.214 #42 — MCP list_changed keep previous on transient failure
 */
import { describe, expect, test } from 'bun:test'
import {
  formatListChangedRefreshFailed,
  resolvePromptsListChangedRefresh,
  resolveResourcesListChangedRefresh,
} from '../mcpListChangedRefresh.js'

describe('resolvePromptsListChangedRefresh densable keep previous commands', () => {
  test('success replaces previous', () => {
    const r = resolvePromptsListChangedRefresh(['old'], {
      ok: true,
      value: ['new'],
    })
    expect(r).toEqual({ next: ['new'], keptPrevious: false })
  })

  test('failure keeps previous (does not clear to empty)', () => {
    const r = resolvePromptsListChangedRefresh(['a', 'b'], {
      ok: false,
      error: 'ECONNRESET',
    })
    expect(r).toEqual({ next: ['a', 'b'], keptPrevious: true })
  })
})

describe('resolveResourcesListChangedRefresh densable partial keep', () => {
  test('all ok applies both fields', () => {
    const r = resolveResourcesListChangedRefresh(
      { resources: ['r0'], commands: ['c0'] },
      {
        resources: { ok: true, value: ['r1'] },
        commands: { ok: true, value: ['c1'] },
      },
    )
    expect(r.resources).toEqual(['r1'])
    expect(r.commands).toEqual(['c1'])
    expect(r.failedFields).toEqual([])
    expect(r.appliedAny).toBe(true)
  })

  test('resources fail keeps previous resources; commands ok updates', () => {
    const r = resolveResourcesListChangedRefresh(
      { resources: ['r0'], commands: ['c0'] },
      {
        resources: { ok: false, error: 'timeout' },
        commands: { ok: true, value: ['c1'] },
      },
    )
    expect(r.resources).toEqual(['r0'])
    expect(r.commands).toEqual(['c1'])
    expect(r.failedFields).toEqual(['resources'])
  })

  test('commands fail keeps previous commands; resources ok updates', () => {
    const r = resolveResourcesListChangedRefresh(
      { resources: ['r0'], commands: ['c0'] },
      {
        resources: { ok: true, value: ['r1'] },
        commands: { ok: false, error: 'timeout' },
      },
    )
    expect(r.resources).toEqual(['r1'])
    expect(r.commands).toEqual(['c0'])
    expect(r.failedFields).toEqual(['commands'])
  })
})

describe('formatListChangedRefreshFailed densable copy', () => {
  test('prompts full failure copy', () => {
    expect(
      formatListChangedRefreshFailed('srv', 'prompts', 'ECONNRESET', 'full'),
    ).toBe(
      '[mcp] srv: prompts/list_changed refresh failed (ECONNRESET); keeping previous commands',
    )
  })

  test('resources partial failure copy', () => {
    expect(
      formatListChangedRefreshFailed(
        'srv',
        'resources',
        'resources',
        'partial',
      ),
    ).toBe(
      '[mcp] srv: resources/list_changed refresh partial failure (resources); keeping previous for failed fields',
    )
  })
})
