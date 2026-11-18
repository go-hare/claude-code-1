import { describe, expect, test } from 'bun:test'
import {
  getPluginAuthoringComplianceOff,
  registerPluginAuthoringHooks,
  SCAN_SECRETS_FULL_TOOL_NAME,
  SKILL_PROMPT_COMPLIANCE_REASONS,
  TOOL_CALL_COMPLIANCE_REASONS,
} from '../pluginAuthoring.js'

describe('pluginAuthoring complianceOff (#972)', () => {
  test('returns tainted when hipaa or zdr taint is active and pending when unsettled', () => {
    expect(
      getPluginAuthoringComplianceOff({
        complianceTaints: [],
        hintedTaints: [],
        verdict: { complianceTaintsSettled: () => true },
      }),
    ).toBeUndefined()

    expect(
      getPluginAuthoringComplianceOff({
        complianceTaints: ['hipaa'],
        hintedTaints: [],
        verdict: { complianceTaintsSettled: () => true },
      }),
    ).toBe('tainted')

    expect(
      getPluginAuthoringComplianceOff({
        complianceTaints: [],
        hintedTaints: ['zdr'],
        verdict: { complianceTaintsSettled: () => true },
      }),
    ).toBe('tainted')

    expect(
      getPluginAuthoringComplianceOff({
        complianceTaints: [],
        hintedTaints: [],
        verdict: { complianceTaintsSettled: () => false },
      }),
    ).toBe('pending')
  })

  test('skill.prompt and tool.call hooks block when complianceOff is tainted', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    registerPluginAuthoringHooks(
      (event, _matcher, handler) => {
        handlers.set(event, handler as (...args: unknown[]) => Promise<unknown>)
      },
      () => 'tainted',
    )

    const skillPrompt = handlers.get('skill.prompt')!
    const promptRes = (await skillPrompt(
      {},
      { text: 'base' },
      async (arg: unknown) => arg,
    )) as { text: string }
    expect(promptRes.text).toContain(SKILL_PROMPT_COMPLIANCE_REASONS.tainted)

    const toolCall = handlers.get('tool.call')!
    const callRes = (await toolCall({}, { folder: '/tmp/mod' }, async () => ({
      result: 'ok',
    }))) as { result: string; isError: boolean }
    expect(callRes.isError).toBe(true)
    expect(callRes.result).toContain(TOOL_CALL_COMPLIANCE_REASONS.tainted)
    expect(SCAN_SECRETS_FULL_TOOL_NAME).toBe(
      'mcp__plugin-authoring__scan_secrets',
    )
  })
})
