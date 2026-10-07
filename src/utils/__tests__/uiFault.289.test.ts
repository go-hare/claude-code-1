/**
 * densable 2.1.289 — Client fail → owning plugin `ui.fault` (terminal).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLIENT_FAULT_EMPTY_REASON,
  scrubClientFaultReason,
  setClientFaultReporter,
} from '../plugins/functionHooksClient.js'

const CLIENT = join(import.meta.dir, '../plugins/functionHooksClient.ts')
const MODULES = join(import.meta.dir, '../plugins/functionHooksModules.ts')

afterEach(() => {
  setClientFaultReporter(undefined)
})

describe('densable 2.1.289 ui.fault Client isolation', () => {
  test('scrubClientFaultReason strips plugin/module prefixes and empties', () => {
    expect(
      scrubClientFaultReason('demo', './board', 'demo: Client ./board: boom'),
    ).toBe('boom')
    expect(scrubClientFaultReason('demo', './board', '')).toBe(
      CLIENT_FAULT_EMPTY_REASON,
    )
    expect(
      scrubClientFaultReason('demo', './board', 'demo: Client ./board:   '),
    ).toBe(CLIENT_FAULT_EMPTY_REASON)
  })

  test('scrubClientFaultReason caps at 200 and replaces line separators', () => {
    const long = 'x'.repeat(250)
    const out = scrubClientFaultReason('p', 'm', long)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.endsWith('…')).toBe(true)
    expect(
      scrubClientFaultReason('p', 'm', `line break`),
    ).toBe('line break')
  })

  test('client failRecord reports phase-tagged ui.fault; modules wire reporter', () => {
    const client = readFileSync(CLIENT, 'utf8')
    const modules = readFileSync(MODULES, 'utf8')
    expect(client).toContain('setClientFaultReporter')
    expect(client).toContain("failRecord(record, errorMessage(err), 'render')")
    expect(client).toContain("failRecord(record, errorMessage(err), 'load')")
    expect(client).toContain("failRecord(record, errorMessage(err), 'run')")
    expect(client).toContain('clientFaultReporter?.(')
    expect(modules).toContain("'ui.fault'")
    expect(modules).toContain('function dispatchClientFault')
    expect(modules).toContain('setClientFaultReporter(')
    expect(modules).toContain('taken as heard')
    expect(modules).toContain("mod.name !== report.plugin")
  })
})
