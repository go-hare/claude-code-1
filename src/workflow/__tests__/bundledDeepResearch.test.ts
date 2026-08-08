import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearBundledWorkflows,
  getBundledWorkflow,
  listBundledWorkflows,
  parseScript,
  resolveNamedWorkflow,
} from '@claude-code/workflow-engine'
import {
  __resetBundledWorkflowsInitForTests,
  initBundledWorkflows,
} from '../bundled/init.js'

afterEach(() => {
  clearBundledWorkflows()
  __resetBundledWorkflowsInitForTests()
})

describe('bundled deep-research workflow (2.1.207 IDd)', () => {
  test('initBundledWorkflows registers deep-research once (hidden, 218 #29)', () => {
    initBundledWorkflows()
    initBundledWorkflows()
    // densable 2.1.218: deep-research + code-review both hidden from model list
    expect(listBundledWorkflows()).toEqual([])
    expect(listBundledWorkflows({ includeHidden: true })).toEqual([
      'code-review',
      'deep-research',
    ])
    const script = getBundledWorkflow('deep-research')
    expect(script).toBeDefined()
    expect(script).toContain("name: 'deep-research'")
    expect(script).toContain('VOTES_PER_CLAIM')
    expect(script).toContain('URL_HOST_PATTERN')
  })

  test('script parses (meta + syntax) via engine parseScript', () => {
    initBundledWorkflows()
    const script = getBundledWorkflow('deep-research')!
    const parsed = parseScript(script)
    expect(parsed.meta).not.toBeNull()
    expect(parsed.meta!.name).toBe('deep-research')
    expect(parsed.meta!.description).toMatch(/Deep research/i)
    expect(parsed.meta!.phases?.map(p => p.title)).toEqual([
      'Scope',
      'Search',
      'Fetch',
      'Verify',
      'Synthesize',
    ])
  })

  test('resolveNamedWorkflow falls back to bundled when dir empty', async () => {
    initBundledWorkflows()
    const found = await resolveNamedWorkflow(
      '/tmp/nonexistent-workflow-dir-xyz',
      'deep-research',
    )
    expect(found).not.toBeNull()
    expect(found?.path).toBe('<bundled:deep-research>')
    expect(found?.content).toContain('MAX_FETCH')
  })
})

describe('bundled code-review workflow (2.1.207 CDd)', () => {
  test('registers hidden and resolves by name', async () => {
    initBundledWorkflows()
    expect(listBundledWorkflows()).not.toContain('code-review')
    const script = getBundledWorkflow('code-review')
    expect(script).toBeDefined()
    expect(script).toContain('name: "code-review"')
    expect(script).toContain('LEVEL_PARAMS')
    expect(script).toContain('CORRECTNESS_ANGLES')
    expect(script).toContain('verifyGroups')

    const found = await resolveNamedWorkflow(
      '/tmp/nonexistent-workflow-dir-xyz',
      'code-review',
    )
    expect(found?.path).toBe('<bundled:code-review>')
  })

  test('script parses meta + phases', () => {
    initBundledWorkflows()
    const script = getBundledWorkflow('code-review')!
    const parsed = parseScript(script)
    expect(parsed.meta).not.toBeNull()
    expect(parsed.meta!.name).toBe('code-review')
    expect(parsed.meta!.description).toMatch(/code review/i)
    expect(parsed.meta!.phases?.map(p => p.title)).toEqual([
      'Scope',
      'Find',
      'Verify',
      'Sweep',
      'Synthesize',
    ])
  })
})
