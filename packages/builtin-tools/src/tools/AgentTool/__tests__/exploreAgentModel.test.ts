import { describe, expect, test } from 'bun:test'
import {
  EXPLORE_AGENT,
  resolveAgentDefinitionModel,
  resolveBuiltInExploreModel,
} from '../built-in/exploreAgent.js'

describe('EXPLORE_AGENT model (official 208)', () => {
  test('definition model is inherit for all users (no ant/haiku split)', () => {
    expect(EXPLORE_AGENT.model).toBe('inherit')
  })
})

describe('resolveBuiltInExploreModel ($6e/zbg)', () => {
  test('firstParty + parent in tier list → inherit', () => {
    expect(resolveBuiltInExploreModel('claude-sonnet-4-6', 'firstParty')).toBe(
      'inherit',
    )
    expect(resolveBuiltInExploreModel('claude-opus-4-7', 'firstParty')).toBe(
      'inherit',
    )
    expect(resolveBuiltInExploreModel('claude-haiku-4-5', 'firstParty')).toBe(
      'inherit',
    )
  })

  test('firstParty + parent outside haiku/sonnet/opus → cap opus', () => {
    expect(resolveBuiltInExploreModel('claude-fable-5', 'firstParty')).toBe(
      'opus',
    )
    expect(
      resolveBuiltInExploreModel('some-internal-model', 'firstParty'),
    ).toBe('opus')
  })

  test('non-firstParty always inherit (no cap)', () => {
    expect(resolveBuiltInExploreModel('claude-fable-5', 'bedrock')).toBe(
      'inherit',
    )
    expect(resolveBuiltInExploreModel('custom-model', 'vertex')).toBe('inherit')
  })
})

describe('resolveAgentDefinitionModel', () => {
  test('only rewrites built-in Explore', () => {
    expect(
      resolveAgentDefinitionModel(
        { agentType: 'Explore', source: 'built-in', model: 'inherit' },
        'claude-fable-5',
        'firstParty',
      ),
    ).toBe('opus')
    expect(
      resolveAgentDefinitionModel(
        { agentType: 'Explore', source: 'projectSettings', model: 'haiku' },
        'claude-fable-5',
        'firstParty',
      ),
    ).toBe('haiku')
    expect(
      resolveAgentDefinitionModel(
        { agentType: 'Plan', source: 'built-in', model: 'inherit' },
        'claude-fable-5',
        'firstParty',
      ),
    ).toBe('inherit')
  })
})
