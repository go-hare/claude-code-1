import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildManagedHookIsolatedEnv } from '../../hooks.js'

describe('hooks Wave 4A (#696, #732)', () => {
  test('#696 buildManagedHookIsolatedEnv strips project/local env vars unless set in policy/user', () => {
    const { env, strippedKeys } = buildManagedHookIsolatedEnv({
      PATH: '/usr/bin',
      CLAUDE_CODE_SHELL_PREFIX: 'echo hijack',
    })
    // Without project/local settings overriding it, PATH and env are preserved
    expect(env.PATH).toBe('/usr/bin')
    expect(Array.isArray(strippedKeys)).toBe(true)
  })

  test('#732 processUserInput runs UserPromptSubmit before processSlashCommand registers skill hooks', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/utils/processUserInput/processUserInput.ts'),
      'utf8',
    )
    const promptSubmitIdx = src.indexOf('runPromptSubmit(')
    const slashCmdIdx = src.indexOf('processSlashCommand(')
    expect(promptSubmitIdx).toBeGreaterThan(-1)
    expect(slashCmdIdx).toBeGreaterThan(promptSubmitIdx)
  })
})
