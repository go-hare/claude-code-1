import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { BACKGROUND_BASH_SUMMARY_PREFIX } from '../LocalShellTask.js'

describe('LocalShellTask densable _Xi / stall notify', () => {
  const src = readFileSync(
    join(import.meta.dir, '../LocalShellTask.tsx'),
    'utf8',
  )

  test('BACKGROUND_BASH_SUMMARY_PREFIX matches densable zYe', () => {
    // densable: zYe="Background command "
    expect(BACKGROUND_BASH_SUMMARY_PREFIX).toBe('Background command ')
  })

  test('stall wording is densable "Stop this task" not Kill', () => {
    // densable interactive-stall body:
    //   "Stop this task and re-run with piped input..."
    expect(src).toContain('Stop this task and re-run with piped input')
    expect(src).not.toContain('Kill this task and re-run with piped input')
    // comment must not leak into the stall template payload (message = `...`)
    const messageStart = src.indexOf(
      'const message = `<${TASK_NOTIFICATION_TAG}>',
    )
    const stallEnd = src.indexOf(
      'or a non-interactive flag if one exists.`',
      messageStart,
    )
    expect(messageStart).toBeGreaterThan(-1)
    expect(stallEnd).toBeGreaterThan(messageStart)
    const stallPayload = src.slice(messageStart, stallEnd + 40)
    expect(stallPayload).toContain('Stop this task and re-run with piped input')
    expect(stallPayload).not.toContain('// densable')
    expect(stallPayload).not.toContain('Kill this task')
  })

  test('_Xi completion notify priority is always next + agentId as-is', () => {
    // Official _Xi: priority always next; agentId left undefined for main AL
    expect(src).toMatch(/priority:\s*'next'/)
    expect(src).toMatch(/agentId,?/)
    expect(src).not.toContain('agentId ?? asAgentId(getSessionId())')
    expect(src).not.toContain("feature('MONITOR_TOOL') ? 'next' : 'later'")
    // densable _Xi: if(a!==void 0) lf(...) only for nested agent shells
    expect(src).toContain('if (agentId !== undefined)')
    expect(src).toContain("status === 'killed' ? 'stopped' : status")
    expect(src).toContain('emitTaskTerminatedSdk')
  })

  test('yXi summary formulas match densable bash + monitor wording', () => {
    // densable yXi bash:
    //   completed → `${zYe}"${t}" completed${n!==void 0?` (exit code ${n})`:""}`
    //   failed → `${zYe}"${t}" failed${n!==void 0?` with exit code ${n}`:""}`
    //   killed → `${zYe}"${t}" was stopped`
    expect(src).toContain(
      '`${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" completed${exitCode !== undefined ? ` (exit code ${exitCode})` : \'\'}`',
    )
    expect(src).toContain(
      '`${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" failed${exitCode !== undefined ? ` with exit code ${exitCode}` : \'\'}`',
    )
    expect(src).toContain(
      '`${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" was stopped`',
    )
    // densable monitor branch
    expect(src).toContain('Monitor "${description}" stream ended')
    expect(src).toContain('Monitor "${description}" script failed')
    expect(src).toContain('Monitor "${description}" stopped')
  })

  test('_Xi / stall analytics event names match densable Ee/me', () => {
    // densable: Ee("task_local_shell_stall_detected"); Ee("task_local_shell"); me(...failed)
    expect(src).toContain("logEvent('task_local_shell_stall_detected'")
    expect(src).toContain("logEvent('task_local_shell'")
    expect(src).toContain("logEvent('task_local_shell_failed'")
  })
})
