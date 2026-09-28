import { describe, expect, test } from 'bun:test'
import {
  PLUGIN_EVAL_MIN_GIT,
  assertPluginEvalGitVersion,
  clearPluginEvalGitVersionCache,
  PluginEvalGitError,
} from '../pluginEvalGit.js'

describe('densable 2.1.283 plugin eval git >= 2.31 (Li)', () => {
  test('PLUGIN_EVAL_MIN_GIT is 2.31', () => {
    expect([...PLUGIN_EVAL_MIN_GIT]).toEqual([2, 31])
  })

  test('throws when git is too old for GIT_CONFIG_COUNT', async () => {
    clearPluginEvalGitVersionCache()
    try {
      await assertPluginEvalGitVersion({ PATH: '/mock-old-git' }, async () => ({
        stdout: 'git version 2.30.2',
        stderr: '',
        code: 0,
      }))
      expect.unreachable('expected too-old git to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PluginEvalGitError)
      expect((error as PluginEvalGitError).code).toBe(
        'eval: git too old for env-scoped config',
      )
      expect((error as PluginEvalGitError).message).toContain(
        'GIT_CONFIG_COUNT',
      )
    }
  })

  test('host git --version is new enough or absent', async () => {
    clearPluginEvalGitVersionCache()
    await assertPluginEvalGitVersion()
  })
})
