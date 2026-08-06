import { describe, expect, test } from 'bun:test'
import {
  CLOUD_BG_CONFLICT,
  collectUncWarnPaths,
  doubleDashIndex,
  extractPositionalIntent,
  filterAllowlistedRespawnFlags,
  flagsOnlyArgv,
  isUncLikePath,
  peelRespawnFlags,
  peelShortFlags,
  peelUqArgv,
  readFlagValue,
  readResumeSessionId,
  stripSessionIdFlags,
  valueIndexSet,
} from '../uqArgvPeel.js'
import { gateBgSpawnArgs } from '../xSeSpawn.js'

describe('uqArgvPeel densable Uq_ helpers', () => {
  test('IUe peelShortFlags peels -c/-p chains', () => {
    expect(peelShortFlags('-cp')).toEqual({
      peeled: ['-c'],
      rest: '-p',
    })
    expect(peelShortFlags('-p')).toEqual({ peeled: [], rest: '-p' })
  })

  test('yie valueIndexSet marks value tokens', () => {
    const idx = valueIndexSet(['--name', 'job', 'do work', '--model', 'opus'])
    expect(idx.has(1)).toBe(true) // job
    expect(idx.has(4)).toBe(true) // opus
    expect(idx.has(2)).toBe(false) // do work
  })

  test('Qyr doubleDashIndex ignores value that is --', () => {
    // rare: value of a flag is literally -- should be marked by yie only if value flag
    expect(doubleDashIndex(['hi', '--', 'rest'])).toBe(1)
    expect(doubleDashIndex(['--name', 'x'])).toBe(-1)
  })

  test('r2o readFlagValue long/short/=/combined', () => {
    expect(readFlagValue(['--agent', 'explore'], '--agent')).toBe('explore')
    expect(readFlagValue(['--name=foo'], '--name', '-n')).toBe('foo')
    expect(readFlagValue(['-nbar'], '--name', '-n')).toBe('bar')
    expect(readFlagValue(['-n', 'baz'], '--name', '-n')).toBe('baz')
  })

  test('WLp readResumeSessionId', () => {
    expect(readResumeSessionId(['--resume', 'abc'])).toBe('abc')
    expect(readResumeSessionId(['--resume=def'])).toBe('def')
    expect(readResumeSessionId(['-rxyz'])).toBe('xyz')
    expect(readResumeSessionId(['--name', 'n'])).toBeUndefined()
  })

  test('t6_ extractPositionalIntent last non-flag', () => {
    expect(
      extractPositionalIntent(['--name', 'n', 'first', 'second'], undefined),
    ).toBe('second')
    expect(extractPositionalIntent(['--resume', 'sid', 'task'], 'sid')).toBe(
      'task',
    )
  })

  test('n2o peelRespawnFlags strips resume/session-id/fork/continue', () => {
    const out = peelRespawnFlags([
      '--resume',
      'sid',
      '--session-id',
      'x',
      '--fork-session',
      '--continue',
      '--model',
      'opus',
      'positional',
    ])
    expect(out).toContain('--model')
    expect(out).toContain('opus')
    expect(out).toContain('positional')
    expect(out).not.toContain('--resume')
    expect(out).not.toContain('sid')
    expect(out).not.toContain('--session-id')
    expect(out).not.toContain('--fork-session')
    expect(out).not.toContain('--continue')
  })

  test('GLp stripSessionIdFlags', () => {
    expect(
      stripSessionIdFlags(['--session-id', 'x', '--model', 'm', 'hi']),
    ).toEqual(['--model', 'm', 'hi'])
    expect(stripSessionIdFlags(['--session-id=x', 'hi'])).toEqual(['hi'])
  })

  test('VLp flagsOnlyArgv drops bare positionals', () => {
    expect(flagsOnlyArgv(['--model', 'opus', 'do it'])).toEqual([
      '--model',
      'opus',
    ])
  })

  test('qat filterAllowlistedRespawnFlags keeps known flags', () => {
    const out = filterAllowlistedRespawnFlags([
      '--model',
      'opus',
      '--verbose',
      '--unknown-flag',
      'x',
    ])
    expect(out).toContain('--model')
    expect(out).toContain('opus')
    expect(out).toContain('--verbose')
    expect(out).not.toContain('--unknown-flag')
  })

  test('peelUqArgv integrates head/intent/name/agent/resume', () => {
    const p = peelUqArgv([
      '--agent',
      'explore',
      '-n',
      'myjob',
      '--model',
      'opus',
      'fix tests',
    ])
    expect(p.agent).toBe('explore')
    expect(p.name).toBe('myjob')
    expect(p.intent).toBe('fix tests')
    expect(p.hasResumeOrContinue).toBe(false)
    expect(p.allowlistedRespawnFlags).toContain('--model')
  })

  test('peelUqArgv -- after separator is full intent', () => {
    const p = peelUqArgv(['--name', 'n', '--', 'hello', 'world'])
    expect(p.intent).toBe('hello world')
    expect(p.dd).toBe(2)
  })

  test('peelUqArgv resume + fork detection', () => {
    const p = peelUqArgv(['--resume', 'abc12345', '--fork-session'])
    expect(p.resumeSessionId).toBe('abc12345')
    expect(p.hasResumeOrContinue).toBe(true)
    expect(p.hasForkSession).toBe(true)
    expect(p.hadSessionIdFlag).toBe(false)
  })

  test('peelUqArgv detects session-id flag for warn', () => {
    expect(peelUqArgv(['--session-id', 'x', 'hi']).hadSessionIdFlag).toBe(true)
  })

  test('UNC detect + collect', () => {
    expect(isUncLikePath('\\\\server\\share')).toBe(true)
    expect(isUncLikePath('C:\\Users\\x')).toBe(false)
    const paths = collectUncWarnPaths({
      cwd: '\\\\nas\\proj',
      respawnFlags: ['--add-dir', '\\\\nas\\other'],
    })
    expect(paths).toContain('\\\\nas\\proj')
  })

  test('e6_ gate uses peel: cloud conflict + print peel', () => {
    expect(gateBgSpawnArgs(['--cloud', 'x'])).toBe(CLOUD_BG_CONFLICT)
    expect(gateBgSpawnArgs(['-cp', 'hi'])).toContain('--print')
    expect(gateBgSpawnArgs(['hello'])).toBeNull()
  })
})
