import { afterEach, describe, expect, test } from 'bun:test'
import {
  canUserConfigureAdvisor,
  getExperimentAdvisorModels,
  isAdvisorEnabled,
} from '../advisor.js'

describe('2.1.300 #759 advisor on anthropicAws / anthropicGoogleCloud', () => {
  const prevEnv = { ...process.env }

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prevEnv)) delete process.env[k]
    }
    Object.assign(process.env, prevEnv)
  })

  test('CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 disables advisor even on anthropicAws', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL = '1'
    expect(isAdvisorEnabled()).toBe(false)
    expect(canUserConfigureAdvisor()).toBe(false)
  })

  test('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 disables advisor', () => {
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
    process.env.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL = '1'
    expect(isAdvisorEnabled()).toBe(false)
  })

  test('HIPAA policy disables advisor', () => {
    process.env.CLAUDE_CODE_HIPAA = '1'
    process.env.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL = '1'
    expect(isAdvisorEnabled()).toBe(false)
  })

  test('getExperimentAdvisorModels returns undefined (user picks via /advisor, advisorModel, or --advisor)', () => {
    expect(getExperimentAdvisorModels()).toBeUndefined()
  })
})
