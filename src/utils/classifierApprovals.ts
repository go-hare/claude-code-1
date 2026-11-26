/**
 * Tracks which tool uses were auto-approved by classifiers.
 * Populated from useCanUseTool.ts and permissions.ts, read from UserToolSuccessMessage.tsx.
 */

import { feature } from 'bun:bundle'
import { getBootstrapSession, RootSessionSlot } from './sessionHost.js'
import { createSignal, type Signal } from './signal.js'

type ClassifierApproval = {
  classifier: 'bash' | 'auto-mode'
  matchedRule?: string
  reason?: string
}

type ClassifierApprovalsState = {
  approvals: Map<string, ClassifierApproval>
  checking: Set<string>
  checkingSignal: Signal
}

const classifierApprovalsBySession =
  new RootSessionSlot<ClassifierApprovalsState>(() => ({
    approvals: new Map<string, ClassifierApproval>(),
    checking: new Set<string>(),
    checkingSignal: createSignal(),
  }))

function getClassifierState(): ClassifierApprovalsState {
  return classifierApprovalsBySession.of(getBootstrapSession())
}

export function _getClassifierApprovalsStateForTesting(): ClassifierApprovalsState {
  return getClassifierState()
}

export function setClassifierApproval(
  toolUseID: string,
  matchedRule: string,
): void {
  if (!feature('BASH_CLASSIFIER')) {
    return
  }
  getClassifierState().approvals.set(toolUseID, {
    classifier: 'bash',
    matchedRule,
  })
}

export function getClassifierApproval(toolUseID: string): string | undefined {
  if (!feature('BASH_CLASSIFIER')) {
    return undefined
  }
  const approval = getClassifierState().approvals.get(toolUseID)
  if (!approval || approval.classifier !== 'bash') return undefined
  return approval.matchedRule
}

export function setYoloClassifierApproval(
  toolUseID: string,
  reason: string,
): void {
  if (!feature('TRANSCRIPT_CLASSIFIER')) {
    return
  }
  getClassifierState().approvals.set(toolUseID, {
    classifier: 'auto-mode',
    reason,
  })
}

export function getYoloClassifierApproval(
  toolUseID: string,
): string | undefined {
  if (!feature('TRANSCRIPT_CLASSIFIER')) {
    return undefined
  }
  const approval = getClassifierState().approvals.get(toolUseID)
  if (!approval || approval.classifier !== 'auto-mode') return undefined
  return approval.reason
}

export function setClassifierChecking(toolUseID: string): void {
  if (!feature('BASH_CLASSIFIER')) {
    if (!feature('TRANSCRIPT_CLASSIFIER')) return
  }
  const state = getClassifierState()
  state.checking.add(toolUseID)
  state.checkingSignal.emit()
}

export function clearClassifierChecking(toolUseID: string): void {
  if (!feature('BASH_CLASSIFIER')) {
    if (!feature('TRANSCRIPT_CLASSIFIER')) return
  }
  const state = getClassifierState()
  state.checking.delete(toolUseID)
  state.checkingSignal.emit()
}

export function subscribeClassifierChecking(listener: () => void): () => void {
  return getClassifierState().checkingSignal.subscribe(listener)
}

export function isClassifierChecking(toolUseID: string): boolean {
  return getClassifierState().checking.has(toolUseID)
}

export function deleteClassifierApproval(toolUseID: string): void {
  getClassifierState().approvals.delete(toolUseID)
}

export function clearClassifierApprovals(): void {
  const state = getClassifierState()
  state.approvals.clear()
  state.checking.clear()
  state.checkingSignal.emit()
}
