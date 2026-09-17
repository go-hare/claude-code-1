/**
 * densable 2.1.246 — FS Cr(path)&&Tr() pause gate.
 * Cr=isAutoMemPath, Tr=memoryToggledOff. Before project/auto-mem allow.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  memoryToggledOff,
  replaceMemoryToggledOff,
  resetStateForTests,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../../bootstrap/state.js'
import { getAutoMemPath } from '../../../memdir/paths.js'
import {
  checkEditableInternalPath,
  checkReadableInternalPath,
} from '../filesystem.js'

const suiteCwd = process.cwd()

beforeEach(() => {
  resetStateForTests()
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  setProjectRoot(suiteCwd)
})

afterEach(() => {
  resetStateForTests()
})

describe('densable 2.1.246 FS Cr&&Tr pause-memory', () => {
  test('source: official deny copy + Mu reason', () => {
    const src = readFileSync(join(import.meta.dir, '../filesystem.ts'), 'utf8')
    expect(src).toContain(
      'isAutoMemPath(normalizedPath) || !memoryToggledOff()',
    )
    expect(src).toContain(
      'Cannot read memory while it is paused. Run /pause-memory to resume automemory.',
    )
    expect(src).toContain(
      'Cannot write to memory while it is paused. Run /pause-memory to resume automemory.',
    )
    expect(src).toContain('memory access blocked by /pause-memory')
    expect(src).toContain('classifierApprovable: false')
  })

  test('Tr default false: auto-mem still allow', () => {
    expect(memoryToggledOff()).toBe(false)
    const path = join(getAutoMemPath(), 'MEMORY.md')
    expect(checkReadableInternalPath(path, {}).behavior).toBe('allow')
    expect(checkEditableInternalPath(path, {}).behavior).toBe('allow')
  })

  test('Cr&&Tr: paused auto-mem read/write deny before project allow', () => {
    replaceMemoryToggledOff(true)
    const path = join(getAutoMemPath(), 'MEMORY.md')
    const read = checkReadableInternalPath(path, {})
    expect(read.behavior).toBe('deny')
    if (read.behavior !== 'deny') return
    expect(read.message).toBe(
      'Cannot read memory while it is paused. Run /pause-memory to resume automemory.',
    )
    expect(read.decisionReason).toEqual({
      type: 'safetyCheck',
      reason: 'memory access blocked by /pause-memory',
      classifierApprovable: false,
    })
    const write = checkEditableInternalPath(path, {})
    expect(write.behavior).toBe('deny')
    if (write.behavior !== 'deny') return
    expect(write.message).toBe(
      'Cannot write to memory while it is paused. Run /pause-memory to resume automemory.',
    )
    expect(write.decisionReason).toEqual({
      type: 'safetyCheck',
      reason: 'memory access blocked by /pause-memory',
      classifierApprovable: false,
    })
  })

  test('paused latch does not deny a non-auto-mem path', () => {
    replaceMemoryToggledOff(true)
    const other = join(suiteCwd, 'README.md')
    expect(checkReadableInternalPath(other, {}).behavior).not.toBe('deny')
    expect(checkEditableInternalPath(other, {}).behavior).not.toBe('deny')
  })
})
