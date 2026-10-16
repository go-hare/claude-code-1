import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

mock.module('../../../services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (
    _feature: string,
    defaultValue: unknown,
  ) => defaultValue,
}))

import {
  demoteInheritedPermissionMode,
  parseAgentsDispatchArgv,
  serializeFleetDispatchDefaults,
} from '../fleetDispatchDefaults.js'

describe('densable 2.1.289 fleetDispatchDefaults', () => {
  test('parse: inherit alone → permissionModeInherited true', () => {
    const { dispatchDefaults, rest } = parseAgentsDispatchArgv([
      '--inherit-permission-mode',
      'acceptEdits',
      '--cwd',
      '/tmp/x',
    ])
    expect(dispatchDefaults).toEqual({
      permissionMode: 'acceptEdits',
      permissionModeInherited: true,
      model: undefined,
      effort: undefined,
      agent: undefined,
      allowBypass: undefined,
      jsonSchema: undefined,
      appendSystemPrompt: undefined,
    })
    expect(rest).toEqual(['--cwd', '/tmp/x'])
  })

  test('parse: permission-mode alone → no inherited', () => {
    const { dispatchDefaults } = parseAgentsDispatchArgv([
      '--permission-mode',
      'plan',
    ])
    expect(dispatchDefaults?.permissionMode).toBe('plan')
    expect(dispatchDefaults?.permissionModeInherited).toBeUndefined()
  })

  test('parse: both → permission wins, no inherited', () => {
    const { dispatchDefaults } = parseAgentsDispatchArgv([
      '--inherit-permission-mode',
      'acceptEdits',
      '--permission-mode',
      'bypassPermissions',
    ])
    expect(dispatchDefaults?.permissionMode).toBe('bypassPermissions')
    expect(dispatchDefaults?.permissionModeInherited).toBeUndefined()
  })

  test('parse: dangerously-skip sets bypass; allowBypass flag; model/effort/agent', () => {
    const { dispatchDefaults, rest } = parseAgentsDispatchArgv([
      '--dangerously-skip-permissions',
      '--allow-dangerously-skip-permissions',
      '--model',
      'opus',
      '--effort',
      'high',
      '--agent',
      'Explore',
      '--json-schema',
      '{}',
      '--append-system-prompt',
      'hi',
      'leftover',
    ])
    expect(dispatchDefaults).toMatchObject({
      permissionMode: 'bypassPermissions',
      allowBypass: true,
      model: 'opus',
      effort: 'high',
      agent: 'Explore',
      jsonSchema: '{}',
      appendSystemPrompt: 'hi',
    })
    expect(dispatchDefaults?.permissionModeInherited).toBeUndefined()
    expect(rest).toEqual(['leftover'])
  })

  test('parse: next token starting with - is not a value (YBn / passthrough)', () => {
    const effortCwd = parseAgentsDispatchArgv(['--effort', '--cwd', '/tmp/x'])
    expect(effortCwd.dispatchDefaults).toBeUndefined()
    expect(effortCwd.rest).toEqual(['--cwd', '/tmp/x'])

    const modeModel = parseAgentsDispatchArgv([
      '--permission-mode',
      '--model',
      'opus',
    ])
    expect(modeModel.dispatchDefaults).toEqual({
      permissionMode: undefined,
      model: 'opus',
      effort: undefined,
      agent: undefined,
      allowBypass: undefined,
      jsonSchema: undefined,
      appendSystemPrompt: undefined,
    })
    expect(modeModel.rest).toEqual([])
  })

  test('parse: bare --effort dropped; --effort=high still works', () => {
    expect(
      parseAgentsDispatchArgv(['--effort']).dispatchDefaults,
    ).toBeUndefined()
    expect(parseAgentsDispatchArgv(['--effort']).rest).toEqual([])
    expect(
      parseAgentsDispatchArgv(['--effort=high', '--cwd', '/tmp'])
        .dispatchDefaults?.effort,
    ).toBe('high')
    expect(
      parseAgentsDispatchArgv(['--effort=high', '--cwd', '/tmp']).rest,
    ).toEqual(['--cwd', '/tmp'])
  })

  test('serialize: inherited → --inherit-permission-mode', () => {
    expect(
      serializeFleetDispatchDefaults({
        permissionMode: 'acceptEdits',
        permissionModeInherited: true,
        model: 'sonnet',
      }),
    ).toEqual(['--model', 'sonnet', '--inherit-permission-mode', 'acceptEdits'])
  })

  test('serialize: agent from bag is emitted (fleetSpawnExtraArgs / relaunch)', () => {
    expect(
      serializeFleetDispatchDefaults({
        agent: 'Explore',
        model: 'opus',
      }),
    ).toEqual(['--model', 'opus', '--agent', 'Explore'])
  })

  test('serialize: not inherited → --permission-mode', () => {
    expect(
      serializeFleetDispatchDefaults({
        permissionMode: 'plan',
        allowBypass: true,
        effort: 'low',
      }),
    ).toEqual([
      '--effort',
      'low',
      '--permission-mode',
      'plan',
      '--allow-dangerously-skip-permissions',
    ])
  })

  test('serialize: undefined bag → []', () => {
    expect(serializeFleetDispatchDefaults(undefined)).toEqual([])
  })

  test('demote: with gate default true stamps inherited', () => {
    expect(demoteInheritedPermissionMode('acceptEdits')).toEqual({
      permissionMode: 'acceptEdits',
      permissionModeInherited: true,
    })
  })

  test('invent-ban: source must not export minify names cVe|Rdt|sf', () => {
    const src = readFileSync(
      join(import.meta.dirname, '../fleetDispatchDefaults.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/export\s+(?:async\s+)?function\s+(?:cVe|Rdt|sf)\b/)
    expect(src).not.toMatch(/export\s+(?:const|let|var)\s+(?:cVe|Rdt|sf)\b/)
  })
})
