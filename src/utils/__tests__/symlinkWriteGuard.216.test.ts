/**
 * densable 2.1.216 — YNn / M6 / nWr symlink write guard
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  SymlinkWriteRefusedError,
  assertDirChainReal,
  assertProjectClaudeDirWritable,
  writeFileAndFlush,
} from '../symlinkWriteGuard.js'
import { writeCronTasks, readCronTasks } from '../cronTasks.js'
import { saveDynamicWorkflow } from '../../workflow/saveDynamicWorkflow.js'

describe('assertDirChainReal (densable YNn)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true })
    }
  })
  async function tmp(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'ynn-'))
    dirs.push(d)
    return d
  }

  test('missing intermediate segment is OK (ENOENT return)', async () => {
    const root = await tmp()
    await expect(
      assertDirChainReal(root, join(root, '.claude')),
    ).resolves.toBeUndefined()
  })

  test('real directory chain is OK', async () => {
    const root = await tmp()
    await mkdir(join(root, '.claude'))
    await expect(
      assertDirChainReal(root, join(root, '.claude')),
    ).resolves.toBeUndefined()
  })

  test('symlink segment is refused (ELOOP/ENOTDIR)', async () => {
    const root = await tmp()
    const outside = await tmp()
    await symlink(outside, join(root, '.claude'))
    await expect(
      assertDirChainReal(root, join(root, '.claude')),
    ).rejects.toBeInstanceOf(SymlinkWriteRefusedError)
    await expect(
      assertDirChainReal(root, join(root, '.claude')),
    ).rejects.toThrow(/symlinked or non-directory path/)
  })

  test('assertProjectClaudeDirWritable refuses escape symlink', async () => {
    const root = await tmp()
    const outside = await tmp()
    await symlink(outside, join(root, '.claude'))
    await expect(assertProjectClaudeDirWritable(root)).rejects.toBeInstanceOf(
      SymlinkWriteRefusedError,
    )
  })
})

describe('writeFileAndFlush (densable M6)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true })
    }
  })
  async function tmp(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'm6-'))
    dirs.push(d)
    return d
  }

  test('writes new file and content', async () => {
    const root = await tmp()
    const p = join(root, 'a.json')
    await writeFileAndFlush(p, '{"ok":true}\n', { encoding: 'utf-8' })
    expect(await readFile(p, 'utf-8')).toBe('{"ok":true}\n')
  })

  test('refuses target that is a symlink', async () => {
    const root = await tmp()
    const outside = await tmp()
    const target = join(outside, 'secret')
    await writeFile(target, 'secret')
    const link = join(root, 'tasks.json')
    await symlink(target, link)
    await expect(
      writeFileAndFlush(link, 'pwned', { encoding: 'utf-8' }),
    ).rejects.toBeInstanceOf(SymlinkWriteRefusedError)
    expect(await readFile(target, 'utf-8')).toBe('secret')
  })

  test('checkParentDir refuses when parent is symlink', async () => {
    const root = await tmp()
    const outside = await tmp()
    const realParent = join(outside, 'dir')
    await mkdir(realParent)
    const linkedParent = join(root, 'linked')
    await symlink(realParent, linkedParent)
    const file = join(linkedParent, 'x.json')
    await expect(
      writeFileAndFlush(file, 'x', {
        encoding: 'utf-8',
        checkParentDir: true,
      }),
    ).rejects.toBeInstanceOf(SymlinkWriteRefusedError)
  })
})

describe('writeCronTasks (densable nWr)', () => {
  const dirs: string[] = []
  let prevRoot: string | undefined
  afterEach(async () => {
    if (prevRoot !== undefined) {
      // getProjectRoot is bootstrap; we pass dir explicitly so no restore needed
    }
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true })
    }
  })
  async function tmp(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'nwr-'))
    dirs.push(d)
    return d
  }

  test('normal project write succeeds', async () => {
    const root = await tmp()
    await writeCronTasks(
      [
        {
          id: 'abcd1234',
          cron: '0 * * * *',
          prompt: 'hi',
          createdAt: Date.now(),
        },
      ],
      root,
    )
    const tasks = await readCronTasks(root)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.id).toBe('abcd1234')
  })

  test('refuses when .claude is symlink outside project', async () => {
    const root = await tmp()
    const outside = await tmp()
    await symlink(outside, join(root, '.claude'))
    await expect(
      writeCronTasks(
        [
          {
            id: 'abcd1234',
            cron: '0 * * * *',
            prompt: 'hi',
            createdAt: Date.now(),
          },
        ],
        root,
      ),
    ).rejects.toBeInstanceOf(SymlinkWriteRefusedError)
    // outside target must not gain scheduled_tasks.json content from our write
    // (mkdir may have been blocked before write)
  })
})

describe('saveDynamicWorkflow (densable L1a)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true })
    }
  })
  async function tmp(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'l1a-'))
    dirs.push(d)
    return d
  }

  test('project scope writes under .claude/workflows', async () => {
    const root = await tmp()
    const r = await saveDynamicWorkflow({
      name: 'My Flow',
      scope: 'project',
      script: 'export const meta = {name:"x",description:"d"}\nreturn 1\n',
      overwrite: false,
      cwd: root,
    })
    expect(r.name).toBe('my-flow')
    expect(
      r.path.endsWith(`${join('.claude', 'workflows', 'my-flow.js')}`),
    ).toBe(true)
    const body = await readFile(r.path, 'utf-8')
    expect(body).toContain('export const meta')
  })

  test('refuses when .claude is escape symlink', async () => {
    const root = await tmp()
    const outside = await tmp()
    await symlink(outside, join(root, '.claude'))
    await expect(
      saveDynamicWorkflow({
        name: 'x',
        scope: 'project',
        script: 'return 1',
        overwrite: true,
        cwd: root,
      }),
    ).rejects.toBeInstanceOf(SymlinkWriteRefusedError)
  })

  test('EEXIST on create without overwrite', async () => {
    const root = await tmp()
    await saveDynamicWorkflow({
      name: 'dup',
      scope: 'project',
      script: 'return 1',
      overwrite: false,
      cwd: root,
    })
    await expect(
      saveDynamicWorkflow({
        name: 'dup',
        scope: 'project',
        script: 'return 2',
        overwrite: false,
        cwd: root,
      }),
    ).rejects.toThrow(/already exists/)
  })
})
