import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import memory from '../memory/index.js'
import mode from '../mode/index.js'
import monitor from '../monitor.js'
import { autoModeSetup } from '../auto-mode-setup/index.js'

const modeSrc = readFileSync(join(import.meta.dir, '../mode/index.ts'), 'utf8')
const monitorSrc = readFileSync(join(import.meta.dir, '../monitor.ts'), 'utf8')
const memorySrc = readFileSync(
  join(import.meta.dir, '../memory/index.ts'),
  'utf8',
)

describe('densable 2.1.289 /mo slash list', () => {
  test('/mode and /monitor are hidden from slash; still loadable', () => {
    expect(mode.name).toBe('mode')
    expect(mode.isHidden).toBe(true)
    expect(typeof mode.load).toBe('function')
    expect(monitor.name).toBe('monitor')
    expect(monitor.isHidden).toBe(true)
    expect(modeSrc).toContain('isHidden: true')
    expect(monitorSrc).toContain('isHidden: true')
  })

  test('/memory is visible with official CLAUDE.md description', () => {
    expect(memory.name).toBe('memory')
    expect(memory.isHidden).toBeFalsy()
    expect(memory.description).toBe('Edit CLAUDE.md files and memory settings')
    expect(memorySrc).not.toContain('isHidden: true')
  })

  test('/auto-mode-setup exists and is not force-hidden', () => {
    expect(autoModeSetup.name).toBe('auto-mode-setup')
    expect(autoModeSetup.description).toContain('auto mode')
  })
})
