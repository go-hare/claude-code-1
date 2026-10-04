/**
 * densable `Cl` @179665171 / `Rt` `j` @175652165 — hop-walk unresolved deny.
 * EACCES/EPERM/ENAMETOOLONG without a hop is canonicalize, not Cl.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}

import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/constants.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import {
  type FsOperations,
  getFsImplementation,
  setFsImplementation,
  setOriginalFsImplementation,
  walkPermissionPaths,
} from '../../fsOperations.js'
import {
  checkReadPermissionForTool,
  checkWritePermissionForTool,
  unresolvedPathDeny,
} from '../filesystem.js'

const COPY =
  'where it leads on disk could not be determined (a link on the way could not be examined, or the links do not resolve).'

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function withFs<T>(overrides: Partial<FsOperations>, fn: () => T): T {
  const inner = getFsImplementation()
  setFsImplementation({ ...inner, ...overrides })
  try {
    return fn()
  } finally {
    setOriginalFsImplementation()
  }
}

describe('densable Cl unresolved path deny', () => {
  const roots: string[] = []
  afterEach(() => {
    setOriginalFsImplementation()
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Cl copy: write to → write, else read', () => {
    const read = unresolvedPathDeny('read from', '/tmp/x')
    expect(read.behavior).toBe('deny')
    expect(read.message).toBe(`Refusing to read /tmp/x: ${COPY}`)
    expect(read.decisionReason.type).toBe('other')
    const write = unresolvedPathDeny('write to', '/tmp/x')
    expect(write.message).toBe(`Refusing to write /tmp/x: ${COPY}`)
  })

  test('Rt j: no-hop EACCES/EPERM/ENAMETOOLONG is not unresolved', () => {
    const path = '/tmp/cl-nohop'
    for (const code of ['EACCES', 'EPERM', 'ENAMETOOLONG'] as const) {
      const inner = getFsImplementation()
      const walk = withFs(
        {
          lstatSync: (p: string) => {
            if (p === path) throw errno(code)
            return inner.lstatSync(p)
          },
        },
        () => walkPermissionPaths(path),
      )
      expect(walk.unresolved).toBe(false)
      expect(walk.paths).toContain(path)
    }
  })

  test('hop then landing EACCES is unresolved', () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'cl-hop-'))
    roots.push(root)
    const landing = join(root, 'secret')
    writeFileSync(landing, 'x')
    const link = join(root, 'link')
    symlinkSync(landing, link)
    const inner = getFsImplementation()
    const walk = withFs(
      {
        lstatSync: (p: string) => {
          if (p === landing) throw errno('EACCES')
          return inner.lstatSync(p)
        },
      },
      () => walkPermissionPaths(link),
    )
    expect(walk.unresolved).toBe(true)
    expect(walk.paths).toContain(link)
    expect(walk.paths).toContain(landing)
  })

  test('hop then readlink throw is unresolved', () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'cl-readlink-'))
    roots.push(root)
    const landing = join(root, 'secret')
    writeFileSync(landing, 'x')
    const link = join(root, 'link')
    symlinkSync(landing, link)
    const inner = getFsImplementation()
    const walk = withFs(
      {
        readlinkSync: (p: string) => {
          if (p === link) throw errno('EACCES')
          return inner.readlinkSync(p)
        },
      },
      () => walkPermissionPaths(link),
    )
    expect(walk.unresolved).toBe(true)
  })

  test('Iv: unresolved read is Cl deny', () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'cl-read-'))
    roots.push(root)
    const landing = join(root, 'secret')
    writeFileSync(landing, 'x')
    const link = join(root, 'link')
    symlinkSync(landing, link)
    const inner = getFsImplementation()
    const tool = { name: FILE_READ_TOOL_NAME, getPath: () => link }
    const result = withFs(
      {
        lstatSync: (p: string) => {
          if (p === landing) throw errno('EACCES')
          return inner.lstatSync(p)
        },
      },
      () =>
        checkReadPermissionForTool(
          tool as never,
          {},
          getEmptyToolPermissionContext(),
        ),
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toBe(`Refusing to read ${link}: ${COPY}`)
      expect(result.decisionReason.type).toBe('other')
    }
  })

  test('NS: unresolved write is Cl deny before session .claude allow', () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'cl-write-'))
    roots.push(root)
    const landing = join(root, 'secret')
    writeFileSync(landing, 'x')
    const link = join(root, 'link')
    symlinkSync(landing, link)
    const inner = getFsImplementation()
    const tool = { name: 'Write', getPath: () => link }
    const result = withFs(
      {
        lstatSync: (p: string) => {
          if (p === landing) throw errno('EACCES')
          return inner.lstatSync(p)
        },
      },
      () =>
        checkWritePermissionForTool(
          tool as never,
          {},
          {
            ...getEmptyToolPermissionContext(),
            alwaysAllowRules: { session: ['Write', 'Edit'] },
          },
        ),
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toBe(`Refusing to write ${link}: ${COPY}`)
    }
  })
})
