import { afterEach, describe, expect, test } from 'bun:test'
import {
  getPrecomputeCompactionDefault,
  isPrecomputeCompactionEnabled,
} from '../autoCompact.js'

const prevAuto = process.env.DISABLE_AUTO_COMPACT
const prevRemote = process.env.CLAUDE_CODE_REMOTE

afterEach(() => {
  if (prevAuto === undefined) delete process.env.DISABLE_AUTO_COMPACT
  else process.env.DISABLE_AUTO_COMPACT = prevAuto
  if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
  else process.env.CLAUDE_CODE_REMOTE = prevRemote
})

describe('densable 2.1.239 UJr / LJr', () => {
  test('LJr default is false', () => {
    expect(getPrecomputeCompactionDefault()).toBe(false)
  })

  test('UJr is off when auto-compact env is disabled', () => {
    process.env.DISABLE_AUTO_COMPACT = '1'
    expect(isPrecomputeCompactionEnabled()).toBe(false)
  })

  test('UJr is off without tengu_sepia_moth', () => {
    delete process.env.DISABLE_AUTO_COMPACT
    delete process.env.CLAUDE_CODE_REMOTE
    expect(isPrecomputeCompactionEnabled()).toBe(false)
  })
})
