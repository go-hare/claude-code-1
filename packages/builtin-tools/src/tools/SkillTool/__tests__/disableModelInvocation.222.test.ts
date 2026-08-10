/**
 * densable 2.1.222 #18 — disable-model-invocation refusal:
 * ask user to run skill; do not replicate workflow.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { formatDisableModelInvocationMessage } from '../SkillTool.js'
import { SKILL_TOOL_NAME } from '../constants.js'

describe('densable 2.1.222 #18 formatDisableModelInvocationMessage', () => {
  test('asks user to run /skill and forbids replication', () => {
    const msg = formatDisableModelInvocationMessage('deep-research')
    expect(msg).toContain(
      `Skill deep-research cannot be used with ${SKILL_TOOL_NAME} tool due to disable-model-invocation`,
    )
    expect(msg).toContain('Ask the user to run /deep-research themselves')
    expect(msg).toContain(
      "Do not replicate this skill's workflow by other means",
    )
    expect(msg).toContain('reserved for explicit user invocation')
    // densable uses em dash —
    expect(msg).toContain('—')
  })

  test('wire-up: validateInput uses formatDisableModelInvocationMessage', () => {
    const src = readFileSync(join(import.meta.dir, '../SkillTool.ts'), 'utf8')
    expect(src).toContain('formatDisableModelInvocationMessage')
    expect(src).toContain(
      "Do not replicate this skill's workflow by other means",
    )
    expect(src).toContain('Ask the user to run /')
    expect(src).toContain('isCoordinatorMode')
  })
})
