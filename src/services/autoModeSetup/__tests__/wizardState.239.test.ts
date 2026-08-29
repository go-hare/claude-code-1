import { describe, expect, test } from 'bun:test'
import {
  answersFromConfirmSelection,
  createAutoModeSetupWizardState,
  depthSelectionFromDepth,
} from '../wizardState.js'
import { hasExistingAutoModeConfig } from '../existing.js'

describe('autoModeSetup wizardState', () => {
  test('elg defaults confirm when no existing', () => {
    const state = createAutoModeSetupWizardState(false)
    expect(state.step).toBe('confirm')
    expect(state.mode).toBe('append')
    expect(state.posture).toBe('mixed')
    expect(state.confirmSelection).toEqual(['shell'])
  })

  test('elg starts on existing when hasExisting', () => {
    expect(createAutoModeSetupWizardState(true).step).toBe('existing')
  })

  test('Oy0 depth mapping', () => {
    expect(depthSelectionFromDepth('both')).toEqual(['shell', 'repos'])
    expect(depthSelectionFromDepth('here')).toEqual([])
  })

  test('confirm selection → answers (scope always project in wizard)', () => {
    expect(
      answersFromConfirmSelection('enterprise', ['shell', 'repos']),
    ).toEqual({
      posture: 'enterprise',
      scope: 'project',
      depth: 'both',
    })
    expect(answersFromConfirmSelection('mixed', [])).toEqual({
      posture: 'mixed',
      scope: 'project',
      depth: 'here',
    })
  })
})

describe('hasExistingAutoModeConfig', () => {
  test('is a function (ulg)', () => {
    expect(typeof hasExistingAutoModeConfig).toBe('function')
  })
})
