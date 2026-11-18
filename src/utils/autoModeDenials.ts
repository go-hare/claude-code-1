/**
 * Tracks commands recently denied by the auto mode classifier.
 * Populated from useCanUseTool.ts, read from RecentDenialsTab.tsx in /permissions.
 */

import { feature } from 'bun:bundle'
import { jsonStringify } from './slowOperations.js'

export type AutoModeDenial = {
  toolName: string
  /** Human-readable description of the denied command (e.g. bash command string) */
  display: string
  /** Raw shell command when denied tool is Bash/PowerShell (#1087) */
  command?: string
  /** Canonical input key for matching retried commands after user approval (#1087) */
  inputKey?: string
  /** Set to true when user approves this denial in /permissions > Recently denied (#1087) */
  approved?: boolean
  reason: string
  timestamp: number
}

let DENIALS: readonly AutoModeDenial[] = []
const MAX_DENIALS = 20

const STRIPPED_SHELL_KEYS = new Set(['description', 'timeout'])
const FALSE_STRIPPED_SHELL_KEYS = new Set([
  'dangerouslyDisableSandbox',
  'run_in_background',
])

/**
 * Official 325 `iTt(toolName, input)` — computes a stable input key for
 * matching a retried command against a previously denied/approved entry.
 * Strips non-semantic shell keys (`description`, `timeout`, and false
 * `dangerouslyDisableSandbox` / `run_in_background`).
 */
export function computeAutoModeDenialInputKey(
  toolName: string,
  input: unknown,
): string {
  try {
    let normalized = input
    if (
      (toolName === 'Bash' || toolName === 'PowerShell') &&
      input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input)
    ) {
      const cleaned: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined || STRIPPED_SHELL_KEYS.has(k)) continue
        if (v === false && FALSE_STRIPPED_SHELL_KEYS.has(k)) continue
        cleaned[k] = v
      }
      normalized = cleaned
    }
    return jsonStringify(normalized)
  } catch {
    return `unserializable:${toolName}`
  }
}

export function recordAutoModeDenial(denial: AutoModeDenial): void {
  if (!feature('TRANSCRIPT_CLASSIFIER')) return
  DENIALS = [denial, ...DENIALS.slice(0, MAX_DENIALS - 1)]
}

export function removeAutoModeDenial(
  toolName: string,
  inputKey: string | undefined,
): void {
  if (inputKey === undefined) return
  DENIALS = DENIALS.filter(
    d => d.toolName !== toolName || d.inputKey !== inputKey,
  )
}

export function markAutoModeDenialApproved(
  denial: Pick<AutoModeDenial, 'toolName' | 'inputKey' | 'timestamp'>,
): void {
  if (!feature('TRANSCRIPT_CLASSIFIER')) return
  DENIALS = DENIALS.map(d => {
    const match =
      denial.inputKey !== undefined
        ? d.toolName === denial.toolName && d.inputKey === denial.inputKey
        : d.toolName === denial.toolName && d.timestamp === denial.timestamp
    return match ? { ...d, approved: true } : d
  })
}

export function consumeApprovedAutoModeDenial(
  toolName: string,
  inputKey: string,
): AutoModeDenial | undefined {
  if (!feature('TRANSCRIPT_CLASSIFIER')) return undefined
  const match = DENIALS.find(
    d => d.toolName === toolName && d.inputKey === inputKey && d.approved,
  )
  if (!match) return undefined
  DENIALS = DENIALS.filter(d => d !== match)
  return match
}

export function getAutoModeDenials(): readonly AutoModeDenial[] {
  return DENIALS
}

export function clearAutoModeDenialsForTesting(): void {
  DENIALS = []
}
