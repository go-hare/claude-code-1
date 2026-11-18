import { afterEach, describe, expect, test } from 'bun:test'
import { hJ } from '../modelSwitchHooks.js'

describe('modelSwitchHooks #859 non-Bedrock application-inference-profile short-circuit', () => {
  const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
  const prevVertex = process.env.CLAUDE_CODE_USE_VERTEX
  const prevFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY

  afterEach(() => {
    if (prevBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK
    else process.env.CLAUDE_CODE_USE_BEDROCK = prevBedrock
    if (prevVertex === undefined) delete process.env.CLAUDE_CODE_USE_VERTEX
    else process.env.CLAUDE_CODE_USE_VERTEX = prevVertex
    if (prevFoundry === undefined) delete process.env.CLAUDE_CODE_USE_FOUNDRY
    else process.env.CLAUDE_CODE_USE_FOUNDRY = prevFoundry
  })

  test('hJ resolves null immediately when provider is not bedrock', async () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    const res = await hJ(
      'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123',
    )
    expect(res).toBeNull()
  })
})
