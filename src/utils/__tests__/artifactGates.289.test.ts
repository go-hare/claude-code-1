/**
 * densable 2.1.289 D() He/Tt arms + ASe consumer polarity.
 * Gold minify `ASe` is hooks-async / transcript — Artifact registration is
 * exported `OT`/`isArtifactToolRegistered` and consumes D() via ne().
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  getArtifactSdkDefaultOffReason,
  isArtifactSdkDefaultAllowed,
} from '../artifactGates.js'
import { isArtifactToolRegistered } from '../artifactUrl.js'

const STASH = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_ARTIFACT',
  'CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT',
  'CLAUDE_CODE_ENTRYPOINT',
] as const

const saved: Record<string, string | undefined> = {}
for (const key of STASH) saved[key] = process.env[key]

afterEach(() => {
  for (const key of STASH) {
    const prior = saved[key]
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
  }
})

describe('densable 2.1.289 D() He/Tt before CHILD', () => {
  test('third_party_provider withholds even with ARTIFACT + CHILD', () => {
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
        CLAUDE_CODE_ARTIFACT: '1',
        CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT: '1',
      }),
    ).toBe('third_party_provider')
    expect(
      isArtifactSdkDefaultAllowed({
        CLAUDE_CODE_USE_VERTEX: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
      }),
    ).toBe(false)
  })

  test('essential_traffic_only withholds even with CHILD', () => {
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_ENTRYPOINT: 'sdk-py',
        CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT: '1',
      }),
    ).toBe('essential_traffic_only')
  })

  test('He/Tt do not invent openai as gold He', () => {
    expect(
      getArtifactSdkDefaultOffReason({
        CLAUDE_CODE_USE_OPENAI: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
      }),
    ).toBeNull()
  })

  test('ASe stays closed under D withhold even with CHILD stamp', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT = '1'
    process.env.CLAUDE_CODE_ARTIFACT = '1'
    expect(isArtifactToolRegistered()).toBe(false)
  })
})
