import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PURGE_DESCRIPTION,
  PURGE_RENAME_NOTICE,
  buildPurgePlanForProject,
} from '../purgeProject.js'

const REGISTER = join(import.meta.dir, '../../registerCliHostCommands.ts')
const GRAPH = join(import.meta.dir, '../../cliCommandGraph.ts')

describe('densable 2.1.289 claude purge registration', () => {
  test('registers purge [path] with gold flags and hidden project alias', () => {
    const src = readFileSync(REGISTER, 'utf8')
    expect(src).toContain("command('purge [path]'")
    expect(src).toContain('--dry-run')
    expect(src).toContain('List what would be deleted without deleting anything')
    expect(src).toContain('-y, --yes')
    expect(src).toContain('-i, --interactive')
    expect(src).toContain('--all')
    expect(src).toContain(
      'Purge state for every project (mutually exclusive with [path])',
    )
    expect(src).toContain("command('project', { hidden: true })")
    expect(src).toContain('purgeProjectHandler')
  })

  test('cliCommandGraph carries gold descriptions', () => {
    const src = readFileSync(GRAPH, 'utf8')
    expect(src).toContain(PURGE_DESCRIPTION)
    expect(src).toContain(PURGE_RENAME_NOTICE)
    expect(src).toContain("['purge']")
    expect(src).toContain("['project', 'purge']")
  })

  test('mutual exclusion messages are in the handler', () => {
    const src = readFileSync(
      join(import.meta.dir, '../purgeProject.ts'),
      'utf8',
    )
    expect(src).toContain('Cannot specify both a path and --all.')
    expect(src).toContain('Cannot use -i/--interactive with --all.')
    expect(src).toContain('shell-snapshots/ are not project-scoped')
    expect(src).toContain('tengu_dead_probe_project_purge_alias')
  })

  test('buildPurgePlanForProject returns warnings for shell-snapshots and backups', async () => {
    const plan = await buildPurgePlanForProject('/tmp/claude-purge-no-such-project')
    expect(plan.warnings.some(w => w.includes('shell-snapshots/'))).toBe(true)
    expect(plan.warnings.some(w => w.includes('backups/'))).toBe(true)
  })
})
