import { afterEach, describe, expect, test } from 'bun:test'
import {
  applySubagentModelForce,
  isSubagentModelForceEnabled,
  resolveForcedSpawnModel,
} from '../subagentModelForce.js'

const FORCE = 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE'
const DEFAULT = 'CLAUDE_CODE_SUBAGENT_MODEL'
const savedForce = process.env[FORCE]
const savedDefault = process.env[DEFAULT]

afterEach(() => {
  if (savedForce === undefined) delete process.env[FORCE]
  else process.env[FORCE] = savedForce
  if (savedDefault === undefined) delete process.env[DEFAULT]
  else process.env[DEFAULT] = savedDefault
})

describe('CLAUDE_CODE_SUBAGENT_MODEL_FORCE densable Rs', () => {
  test('off: frontmatter and tool model pass through', () => {
    delete process.env[FORCE]
    expect(isSubagentModelForceEnabled()).toBe(false)
    expect(applySubagentModelForce('opus', 'haiku')).toEqual(['opus', 'haiku'])
    expect(resolveForcedSpawnModel('opus', 'haiku')).toBe('haiku')
  })

  test('on: zeros frontmatter unless env default is inherit, zeros tool unless inherit', () => {
    process.env[FORCE] = '1'
    delete process.env[DEFAULT]
    expect(isSubagentModelForceEnabled()).toBe(true)
    expect(applySubagentModelForce('opus', 'haiku')).toEqual([
      'opus',
      undefined,
    ])
    expect(applySubagentModelForce('opus', 'inherit')).toEqual([
      'opus',
      'inherit',
    ])
    process.env[DEFAULT] = 'haiku'
    expect(applySubagentModelForce('opus', 'sonnet')).toEqual([
      undefined,
      undefined,
    ])
  })

  test('spawn uses remaining tool inherit or dropped frontmatter', () => {
    process.env[FORCE] = 'true'
    delete process.env[DEFAULT]
    // env default inherit: frontmatter kept; tool haiku zeroed → frontmatter
    expect(resolveForcedSpawnModel('opus', undefined)).toBe('opus')
    expect(resolveForcedSpawnModel('opus', 'haiku')).toBe('opus')
    expect(resolveForcedSpawnModel('opus', 'inherit')).toBe('inherit')
    process.env[DEFAULT] = 'haiku'
    expect(resolveForcedSpawnModel('opus', 'haiku')).toBeUndefined()
  })
})
