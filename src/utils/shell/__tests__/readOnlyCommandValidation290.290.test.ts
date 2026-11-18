import { describe, expect, test } from 'bun:test'
import {
  DOCKER_READ_ONLY_COMMANDS,
  GH_READ_ONLY_COMMANDS,
  GIT_READ_ONLY_COMMANDS,
  gitFormatOrSentinelIsDangerous,
  hasSentinelToken,
  hasTildeExpansionArg,
  startsWithSentinelToken,
  validateFlags,
} from '../readOnlyCommandValidation.js'

describe('v2.1.290 #78 & #143 readOnlyCommandValidation', () => {
  test('sentinel token helpers detect __CMDSUB_OUTPUT__, __TRACKED_VAR__, __UNCERTAIN_VAR__', () => {
    expect(hasSentinelToken('foo__CMDSUB_OUTPUT__bar')).toBe(true)
    expect(hasSentinelToken('__TRACKED_VAR__')).toBe(true)
    expect(hasSentinelToken('__UNCERTAIN_VAR__')).toBe(true)
    expect(hasSentinelToken('normal_arg')).toBe(false)

    expect(startsWithSentinelToken('__TRACKED_VAR__/foo')).toBe(true)
    expect(startsWithSentinelToken('prefix__TRACKED_VAR__')).toBe(false)
  })

  test('validateFlags rejects sentinel tokens in flag values and positional args', () => {
    const cfg = { safeFlags: { '--format': 'string', '-n': 'number' } } as const
    expect(validateFlags(['--format', '__CMDSUB_OUTPUT__'], 0, cfg)).toBe(false)
    expect(validateFlags(['--format=__TRACKED_VAR__'], 0, cfg)).toBe(false)
    expect(validateFlags(['__UNCERTAIN_VAR__'], 0, cfg)).toBe(false)
    expect(validateFlags(['--format', 'short', 'HEAD'], 0, cfg)).toBe(true)
  })

  test('hasTildeExpansionArg and docker callbacks block tilde and sentinel args', () => {
    expect(hasTildeExpansionArg(['~root'])).toBe(true)
    expect(hasTildeExpansionArg(['--flag=~user'])).toBe(true)
    expect(hasTildeExpansionArg(['a~{b,c}'])).toBe(true)
    expect(hasTildeExpansionArg(['normal'])).toBe(false)

    const logsCb =
      DOCKER_READ_ONLY_COMMANDS['docker logs']!
        .additionalCommandIsDangerousCallback!
    expect(logsCb('docker logs ~root', ['~root'])).toBe(true)
    expect(logsCb('docker logs __TRACKED_VAR__', ['__TRACKED_VAR__'])).toBe(
      true,
    )
    expect(logsCb('docker logs my-container', ['my-container'])).toBe(false)
  })

  test('ghIsDangerousCallback blocks tilde and sentinel tokens', () => {
    const ghCb =
      GH_READ_ONLY_COMMANDS['gh pr view']!.additionalCommandIsDangerousCallback!
    expect(ghCb('gh pr view ~1', ['~1'])).toBe(true)
    expect(
      ghCb('gh pr view --repo=__TRACKED_VAR__', ['--repo=__TRACKED_VAR__']),
    ).toBe(true)
  })

  test('gitFormatOrSentinelIsDangerous blocks signature formats, unknown pretty names, tilde, and sentinels', () => {
    expect(gitFormatOrSentinelIsDangerous(['--format=%G?'])).toBe(true)
    expect(gitFormatOrSentinelIsDangerous(['--format=%(signature)'])).toBe(true)
    expect(gitFormatOrSentinelIsDangerous(['--pretty=custom_evil'])).toBe(true)
    expect(gitFormatOrSentinelIsDangerous(['--pretty=oneline'])).toBe(false)
    expect(gitFormatOrSentinelIsDangerous(['--format=format:%H'])).toBe(false)
    expect(
      gitFormatOrSentinelIsDangerous(['--format', '__CMDSUB_OUTPUT__']),
    ).toBe(true)
    expect(gitFormatOrSentinelIsDangerous(['--sort=~refname'])).toBe(true)

    const gitLogCb =
      GIT_READ_ONLY_COMMANDS['git log']!.additionalCommandIsDangerousCallback!
    expect(gitLogCb('git log --format=%G?', ['--format=%G?'])).toBe(true)
    expect(gitLogCb('git log --pretty=oneline', ['--pretty=oneline'])).toBe(
      false,
    )
  })
})
