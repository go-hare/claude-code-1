/**
 * densable elg / Oy0 — interactive /auto-mode-setup wizard state.
 * Gold: gold-wide-elg.txt · gold-wide-nlg.txt
 */
import type { AutoModeSetupAnswers } from './answers.js'
import type { AutoModeSetupProposedConfig } from './propose.js'
import type { AutoModeWriteResult } from './write.js'

export type WizardStep =
  | 'existing'
  | 'confirm'
  | 'propose'
  | 'review'
  | 'write'
  | 'flagged'
  | 'error'

export type WizardResolution = 'none' | 'cancel' | 'done'

export type AutoModeSetupWizardState = {
  step: WizardStep
  hasExisting: boolean
  mode: 'append' | 'replace'
  posture: AutoModeSetupAnswers['posture']
  gathersFromGitHubOrg: boolean
  flaggedPicking: boolean
  flaggedSelection: string[]
  confirmSelection: string[]
  confirmFocus: number
  confirmSrAtPosture: boolean
  shownLogged: boolean
  resolution: WizardResolution
  lastAcceptAt?: number
  notify?: () => void
  proposal?: AutoModeSetupProposedConfig
  saved?: AutoModeWriteResult
  error?: string
}

/** densable elg */
export function createAutoModeSetupWizardState(
  hasExisting = false,
): AutoModeSetupWizardState {
  return {
    step: hasExisting ? 'existing' : 'confirm',
    hasExisting,
    mode: 'append',
    posture: 'mixed',
    gathersFromGitHubOrg: false,
    flaggedPicking: false,
    flaggedSelection: [],
    confirmSelection: ['shell'],
    confirmFocus: 1,
    confirmSrAtPosture: true,
    shownLogged: false,
    resolution: 'none',
  }
}

/** densable Oy0 */
export function depthSelectionFromDepth(
  depth: AutoModeSetupAnswers['depth'],
): string[] {
  switch (depth) {
    case 'both':
      return ['shell', 'repos']
    case 'shell':
      return ['shell']
    case 'repos':
      return ['repos']
    case 'here':
      return []
  }
}

export function answersFromConfirmSelection(
  posture: AutoModeSetupAnswers['posture'],
  selection: string[],
): AutoModeSetupAnswers {
  const shell = selection.includes('shell')
  const repos = selection.includes('repos')
  return {
    posture,
    scope: 'project',
    depth: shell && repos ? 'both' : shell ? 'shell' : repos ? 'repos' : 'here',
  }
}
