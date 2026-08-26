/**
 * densable 2.1.239 #47 — official flo/mlo: ihr("hook_exec", ees) /
 * finally shr("hook_exec", ees) with ees="startup-hook-hold".
 * Holder id bumps keepalive refcount, not mainLoopRefcount.
 * SubagentStart (dno) / SessionEnd (cvr) stay unbracketed.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getMainLoopRefcount,
  getSessionActivityRefcountForTests,
  resetSessionActivityForTests,
  startSessionActivity,
  stopSessionActivity,
} from '../sessionActivity.js'

const HOOKS_SRC = readFileSync(join(import.meta.dir, '../hooks.ts'), 'utf8')

describe('densable 2.1.239 #47 startup-hook-hold', () => {
  afterEach(() => {
    resetSessionActivityForTests()
  })

  test('hook_exec + startup-hook-hold holds keepalive without mainLoop bump', () => {
    startSessionActivity('hook_exec', 'startup-hook-hold')
    expect(getSessionActivityRefcountForTests()).toBe(1)
    expect(getMainLoopRefcount()).toBe(0)
    stopSessionActivity('hook_exec', 'startup-hook-hold')
    expect(getSessionActivityRefcountForTests()).toBe(0)
    expect(getMainLoopRefcount()).toBe(0)
  })

  test('flo/mlo wrap SessionStart and Setup only', () => {
    expect(HOOKS_SRC).toContain("const STARTUP_HOOK_HOLD = 'startup-hook-hold'")
    expect(HOOKS_SRC).toContain(
      "startSessionActivity('hook_exec', STARTUP_HOOK_HOLD)",
    )
    expect(HOOKS_SRC).toContain(
      "stopSessionActivity('hook_exec', STARTUP_HOOK_HOLD)",
    )
    expect(HOOKS_SRC.match(/startSessionActivity\('hook_exec'/g)?.length).toBe(
      2,
    )
    expect(HOOKS_SRC.match(/stopSessionActivity\('hook_exec'/g)?.length).toBe(2)
    const subagent = HOOKS_SRC.slice(
      HOOKS_SRC.indexOf('export async function* executeSubagentStartHooks'),
    )
    expect(
      subagent.startsWith('export async function* executeSubagentStartHooks'),
    ).toBe(true)
    expect(subagent.slice(0, 800)).not.toContain('startSessionActivity')
  })
})
