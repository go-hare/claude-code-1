/**
 * densable 2.1.218 #9 — CLI surface only.
 *
 * Official changelog #9 is **gateway spend metering** for application-inference-profile
 * ARNs (product: gateway / x-gateway-spend-admin). go-hare does **not** ship that
 * gateway path. This pack claims the **CLI Bedrock cost-resolution** cousin:
 * extractModelIdFromArn + getInferenceProfileBackingModel used when
 * model includes `application-inference-profile` (claude.ts resolvedModel).
 */
import { describe, expect, test } from 'bun:test'
import {
  extractModelIdFromArn,
  getBedrockRegionPrefix,
  isFoundationModel,
} from '../bedrock.js'

describe('densable 2.1.218 #9 CLI Bedrock application-inference-profile helpers', () => {
  test('extractModelIdFromArn strips application-inference-profile ARN', () => {
    const arn =
      'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/my-app-profile'
    expect(extractModelIdFromArn(arn)).toBe('my-app-profile')
  })

  test('extractModelIdFromArn strips inference-profile ARN', () => {
    const arn =
      'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    expect(extractModelIdFromArn(arn)).toBe(
      'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    )
  })

  test('extractModelIdFromArn leaves bare model ids unchanged', () => {
    expect(
      extractModelIdFromArn('anthropic.claude-sonnet-4-5-20250929-v1:0'),
    ).toBe('anthropic.claude-sonnet-4-5-20250929-v1:0')
  })

  test('application-inference-profile needle is the claude.ts branch gate', () => {
    // Mirrors src/services/api/claude.ts:
    // getAPIProvider() === 'bedrock' && options.model.includes('application-inference-profile')
    const model =
      'arn:aws:bedrock:us-east-1:123:application-inference-profile/prod-profile'
    expect(model.includes('application-inference-profile')).toBe(true)
    expect(extractModelIdFromArn(model)).toBe('prod-profile')
  })

  test('region prefix still resolves after ARN strip', () => {
    const arn =
      'arn:aws:bedrock:ap-northeast-2:123:inference-profile/global.anthropic.claude-opus-4-6-v1'
    expect(getBedrockRegionPrefix(arn)).toBe('global')
    expect(isFoundationModel('anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(
      true,
    )
  })
})
