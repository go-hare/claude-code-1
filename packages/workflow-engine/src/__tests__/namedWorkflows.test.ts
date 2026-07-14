import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearBundledWorkflows,
  registerBundledWorkflow,
} from '../engine/bundledWorkflows.js'
import {
  listNamedWorkflows,
  resolveNamedWorkflow,
} from '../engine/namedWorkflows.js'

afterEach(() => {
  clearBundledWorkflows()
})

test('resolves named workflow by extension priority', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wf-named-'))
  try {
    await writeFile(
      join(dir, 'a.ts'),
      'export const meta = { name: "a", description: "d" }\nreturn 1',
    )
    await writeFile(join(dir, 'b.js'), 'return 2')
    await writeFile(join(dir, 'c.mjs'), 'return 3')
    await writeFile(join(dir, 'ignore.md'), '# not a workflow')

    const a = await resolveNamedWorkflow(dir, 'a')
    expect(a?.path.endsWith('a.ts')).toBe(true)
    expect(a?.content).toContain('meta')

    expect(await resolveNamedWorkflow(dir, 'missing')).toBeNull()

    const names = await listNamedWorkflows(dir)
    expect(names).toEqual(['a', 'b', 'c']) // excludes .md
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('listNamedWorkflows returns empty array for non-existent directory', async () => {
  expect(
    await listNamedWorkflows(join(tmpdir(), 'wf-nope-' + Date.now())),
  ).toEqual([])
})

test('resolveNamedWorkflow falls back to .js/.mjs when .ts is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wf-named-'))
  try {
    await writeFile(join(dir, 'onlyjs.js'), 'return 1')
    await writeFile(join(dir, 'onlymjs.mjs'), 'return 2')
    expect(
      (await resolveNamedWorkflow(dir, 'onlyjs'))?.path.endsWith('onlyjs.js'),
    ).toBe(true)
    expect(
      (await resolveNamedWorkflow(dir, 'onlymjs'))?.path.endsWith(
        'onlymjs.mjs',
      ),
    ).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('listNamedWorkflows returns sorted names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wf-named-'))
  try {
    await writeFile(join(dir, 'zeta.ts'), 'return 1')
    await writeFile(join(dir, 'alpha.js'), 'return 2')
    await writeFile(join(dir, 'mid.mjs'), 'return 3')
    expect(await listNamedWorkflows(dir)).toEqual(['alpha', 'mid', 'zeta'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('bundled registry is used when disk miss; disk shadows bundled', async () => {
  registerBundledWorkflow(
    'deep-research',
    'export const meta = { name: "deep-research", description: "d" }\nreturn 1',
  )
  const missingDir = join(tmpdir(), 'wf-nope-' + Date.now())
  const bundled = await resolveNamedWorkflow(missingDir, 'deep-research')
  expect(bundled?.path).toBe('<bundled:deep-research>')
  expect(await listNamedWorkflows(missingDir)).toEqual(['deep-research'])

  const dir = await mkdtemp(join(tmpdir(), 'wf-named-'))
  try {
    await writeFile(join(dir, 'deep-research.js'), 'return "disk"')
    const disk = await resolveNamedWorkflow(dir, 'deep-research')
    expect(disk?.content).toBe('return "disk"')
    expect(disk?.path.endsWith('deep-research.js')).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('hidden bundled workflows resolve but are omitted from list', async () => {
  registerBundledWorkflow(
    'code-review',
    'export const meta = { name: "code-review", description: "d" }\nreturn 1',
    { hidden: true },
  )
  registerBundledWorkflow(
    'deep-research',
    'export const meta = { name: "deep-research", description: "d" }\nreturn 1',
  )
  const missingDir = join(tmpdir(), 'wf-nope-' + Date.now())
  expect(await listNamedWorkflows(missingDir)).toEqual(['deep-research'])
  const found = await resolveNamedWorkflow(missingDir, 'code-review')
  expect(found?.path).toBe('<bundled:code-review>')
})
