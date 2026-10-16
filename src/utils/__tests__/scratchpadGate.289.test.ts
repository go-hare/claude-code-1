/**
 * densable 2.1.289 `Jw` = tengu_scratch || `Rms` (isArtifactToolEligible).
 * `Rms` = !switched_off && `Vht` && !surface_excluded && `D()` clear — it does
 * not need tengu_cobalt_plinth, unlike ASe/isArtifactToolRegistered.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realAuth from 'src/utils/auth.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

const authSnap = snapshotModuleExports(realAuth)
let subscriber = true
mock.module('src/utils/auth.js', () => ({
  ...authSnap,
  isClaudeAISubscriber: () => subscriber,
}))

const { isArtifactToolEligible, isArtifactToolRegistered } = await import(
  'src/utils/artifactUrl.js'
)
const { isScratchpadEnabled } = await import(
  'src/utils/permissions/filesystem.js'
)

const ENV_KEYS = [
  'CLAUDE_CODE_DISABLE_ARTIFACT',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_ARTIFACT',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
for (const k of ENV_KEYS) delete process.env[k]

afterEach(() => {
  subscriber = true
  for (const k of ENV_KEYS) delete process.env[k]
})

afterAll(() => {
  mock.module('src/utils/auth.js', () => ({ ...authSnap }))
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('Rms isArtifactToolEligible (289)', () => {
  test('claude.ai subscriber on first party is eligible without cobalt plinth', () => {
    expect(isArtifactToolEligible()).toBe(true)
    expect(isArtifactToolRegistered()).toBe(false)
  })

  test('Vht: no claude.ai login → not eligible', () => {
    subscriber = false
    expect(isArtifactToolEligible()).toBe(false)
  })

  test('switched off / surface excluded / D() withhold → not eligible', () => {
    process.env.CLAUDE_CODE_DISABLE_ARTIFACT = '1'
    expect(isArtifactToolEligible()).toBe(false)
    delete process.env.CLAUDE_CODE_DISABLE_ARTIFACT

    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-coworker-x'
    expect(isArtifactToolEligible()).toBe(false)

    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts'
    expect(isArtifactToolEligible()).toBe(false)
    delete process.env.CLAUDE_CODE_ENTRYPOINT

    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(isArtifactToolEligible()).toBe(false)
  })
})

describe('Jw isScratchpadEnabled (289)', () => {
  test('follows Rms when tengu_scratch is off', () => {
    expect(isScratchpadEnabled()).toBe(true)
    subscriber = false
    expect(isScratchpadEnabled()).toBe(false)
  })
})
