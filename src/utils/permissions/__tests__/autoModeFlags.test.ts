import { describe, expect, test } from 'bun:test'
import {
  AUTO_MODE_EDIT_REMOVAL_CAP_DEFAULT,
  AUTO_MODE_GIT_STATUS_LIMIT_DEFAULT,
  AUTO_MODE_SEVERITY_T1_FALLBACK,
  AUTO_MODE_SEVERITY_T2_FALLBACK,
  BAKED_AUTO_MODE_CONFIG,
  EMPTY_AUTO_MODE_CONFIG,
  countGitStatusPorcelain,
  getAutoModeModelLookupKeys,
  isAutoModeClassifyEditTool,
  isFleetPastSessionsEnabled,
  mapAutoModeOutcomeCode,
  parseOptionalEnvBool,
  resolveClassifyEdits,
  resolveEditRemovalCap,
  resolveEditRemovalVisibility,
  resolveGitStatusTruncationLimit,
  resolveGitStatusType,
  resolveOutcomeVisibility,
  resolvePriorAssistantContext,
  resolveRepoVisibility,
  resolveSameTurnSiblingContext,
  shouldGateEditClassification,
  truncateGitStatusLines,
} from '../autoModeFlags.js'

describe('parseOptionalEnvBool', () => {
  test('unset / empty → undefined', () => {
    expect(parseOptionalEnvBool(undefined)).toBeUndefined()
    expect(parseOptionalEnvBool('')).toBeUndefined()
  })
  test('truthy / falsy', () => {
    expect(parseOptionalEnvBool('1')).toBe(true)
    expect(parseOptionalEnvBool('true')).toBe(true)
    expect(parseOptionalEnvBool('0')).toBe(false)
    expect(parseOptionalEnvBool('false')).toBe(false)
  })
})

describe('densable 2.1.236 qTa / Eri frozen defaults', () => {
  test('EMPTY_AUTO_MODE_CONFIG is frozen empty Eri', () => {
    expect(EMPTY_AUTO_MODE_CONFIG).toEqual({})
    expect(Object.isFrozen(EMPTY_AUTO_MODE_CONFIG)).toBe(true)
  })

  test('BAKED_AUTO_MODE_CONFIG matches SEA qTa incl severityByModel', () => {
    expect(BAKED_AUTO_MODE_CONFIG.twoStageClassifier).toBe(true)
    expect(BAKED_AUTO_MODE_CONFIG.sameTurnSiblingContext).toBe(true)
    expect(BAKED_AUTO_MODE_CONFIG.jsonlTranscript).toBe(true)
    expect(BAKED_AUTO_MODE_CONFIG.editRemovalVisibility).toBe(true)
    expect(BAKED_AUTO_MODE_CONFIG.editRemovalCap).toBe(3000)
    expect(BAKED_AUTO_MODE_CONFIG.outcomeVisibility).toBe(false)
    expect(BAKED_AUTO_MODE_CONFIG.repoVisibility).toBe(true)
    expect(BAKED_AUTO_MODE_CONFIG.gitStatusType).toBe(true)
    expect(BAKED_AUTO_MODE_CONFIG.gitStatusUploads).toBe(false)
    expect(BAKED_AUTO_MODE_CONFIG.severityByModel).toEqual({
      'claude-sonnet-5[1m]': { t1: 25, t2: 35 },
      'claude-opus-4-8[1m]': { t1: 45, t2: 35 },
      'claude-sonnet-5': { t1: 25, t2: 35 },
      'claude-opus-4-8': { t1: 45, t2: 35 },
    })
    expect(AUTO_MODE_SEVERITY_T1_FALLBACK).toBe(15)
    expect(AUTO_MODE_SEVERITY_T2_FALLBACK).toBe(20)
  })
})

describe('auto-mode flag resolvers (env > gb > default)', () => {
  const emptyGb = {}

  test('priorAssistantContext defaults false; env wins', () => {
    expect(resolvePriorAssistantContext({}, emptyGb)).toEqual({
      value: false,
      src: 'default',
    })
    expect(
      resolvePriorAssistantContext(
        { CLAUDE_CODE_AUTO_MODE_PRIOR_ASSISTANT_CONTEXT: '1' },
        emptyGb,
      ),
    ).toEqual({ value: true, src: 'env' })
    expect(
      resolvePriorAssistantContext({}, { priorAssistantContext: true }),
    ).toEqual({ value: true, src: 'gb' })
  })

  test('sibling / edit removal / outcome defaults false', () => {
    expect(resolveSameTurnSiblingContext({}, emptyGb).value).toBe(false)
    expect(resolveEditRemovalVisibility({}, emptyGb).value).toBe(false)
    expect(resolveOutcomeVisibility({}, emptyGb).value).toBe(false)
  })

  test('editRemovalCap default 3000', () => {
    expect(resolveEditRemovalCap({}, emptyGb)).toEqual({
      value: AUTO_MODE_EDIT_REMOVAL_CAP_DEFAULT,
      src: 'default',
    })
    expect(AUTO_MODE_EDIT_REMOVAL_CAP_DEFAULT).toBe(3000)
    expect(
      resolveEditRemovalCap(
        { CLAUDE_CODE_AUTO_MODE_EDIT_REMOVAL_CAP: '1200' },
        emptyGb,
      ).value,
    ).toBe(1200)
  })

  test('git status limit default 2000', () => {
    expect(resolveGitStatusTruncationLimit({}, emptyGb)).toEqual({
      value: AUTO_MODE_GIT_STATUS_LIMIT_DEFAULT,
      src: 'default',
    })
    expect(AUTO_MODE_GIT_STATUS_LIMIT_DEFAULT).toBe(2000)
    expect(resolveGitStatusType({}, emptyGb).value).toBe(false)
  })

  test('classifyEdits env bool and gb model set', () => {
    expect(resolveClassifyEdits('claude-opus', {}, emptyGb).value).toBe(false)
    expect(
      resolveClassifyEdits(
        'claude-opus',
        { CLAUDE_CODE_AUTO_MODE_CLASSIFY_EDITS: '1' },
        emptyGb,
      ),
    ).toEqual({ value: true, src: 'env' })
    expect(
      resolveClassifyEdits(
        'claude-opus',
        {},
        {
          classifyEditsModels: ['claude-opus', 'claude-sonnet'],
        },
      ),
    ).toEqual({ value: true, src: 'gb' })
    expect(
      resolveClassifyEdits(
        'other',
        {},
        {
          classifyEditsModels: ['claude-opus'],
        },
      ).value,
    ).toBe(false)
    // Official kkr: 1m suffix tries base[1m] then base
    expect(getAutoModeModelLookupKeys('claude-opus[1m]')).toEqual([
      'claude-opus[1m]',
      'claude-opus',
    ])
    expect(
      resolveClassifyEdits(
        'claude-opus[1m]',
        {},
        {
          classifyEditsModels: ['claude-opus'],
        },
      ).value,
    ).toBe(true)
  })

  test('shouldGateEditClassification (KDu && VDu)', () => {
    expect(isAutoModeClassifyEditTool('Edit')).toBe(true)
    expect(isAutoModeClassifyEditTool('Write')).toBe(true)
    expect(isAutoModeClassifyEditTool('NotebookEdit')).toBe(true)
    expect(isAutoModeClassifyEditTool('Bash')).toBe(false)
    expect(
      shouldGateEditClassification('Edit', 'm', {
        CLAUDE_CODE_AUTO_MODE_CLASSIFY_EDITS: '1',
      }),
    ).toBe(true)
    expect(
      shouldGateEditClassification('Bash', 'm', {
        CLAUDE_CODE_AUTO_MODE_CLASSIFY_EDITS: '1',
      }),
    ).toBe(false)
    expect(shouldGateEditClassification('Edit', 'm', {})).toBe(false)
  })

  test('repoVisibility defaults false', () => {
    expect(resolveRepoVisibility({}, emptyGb)).toBe(false)
    expect(
      resolveRepoVisibility(
        { CLAUDE_CODE_AUTO_MODE_REPO_VISIBILITY: '1' },
        emptyGb,
      ),
    ).toBe(true)
  })
})

describe('git status helpers (xDg / kDg)', () => {
  test('countGitStatusPorcelain', () => {
    // Official xDg: per-line XY — staged if X not space/?; modified if Y not space.
    // ' M' → modified only; 'M ' → staged only; 'MM' → both; '??' → untracked.
    // '##' branch header also increments staged+modified (official does not special-case it).
    const text = [' M a.ts', 'M  b.ts', 'MM c.ts', '?? d.ts', '## main'].join(
      '\n',
    )
    expect(countGitStatusPorcelain(text)).toEqual({
      staged: 3,
      modified: 3,
      untracked: 1,
    })
  })

  test('truncateGitStatusLines', () => {
    const text = ['aa', 'bb', 'cc'].join('\n')
    expect(truncateGitStatusLines(text, 5)).toContain('more lines')
    expect(truncateGitStatusLines(text, 100)).toBe(text)
  })
})

describe('mapAutoModeOutcomeCode / fleet', () => {
  test('outcome codes', () => {
    expect(mapAutoModeOutcomeCode({ unavailable: true })).toBe(
      'automode-unavailable',
    )
    expect(
      mapAutoModeOutcomeCode({
        reason:
          'Auto mode could not evaluate this action and is blocking it for safety',
      }),
    ).toBe('automode-parsing-error')
    expect(mapAutoModeOutcomeCode({ shouldBlock: true })).toBe(
      'automode-blocked',
    )
  })

  test('fleet past sessions env', () => {
    expect(
      isFleetPastSessionsEnabled({ CLAUDE_CODE_FLEET_PAST_SESSIONS: '1' }),
    ).toBe(true)
    // without env and without GB mock, default false
    expect(isFleetPastSessionsEnabled({})).toBe(false)
  })
})
