/**
 * File-backed store for PR webhook subscriptions (KAIROS_GITHUB_WEBHOOKS).
 *
 * Shared by `/subscribe-pr` and the SubscribePR tool so both product surfaces
 * write the same `~/.claude/pr-subscriptions.json` list. Bridge inbound
 * filtering (useReplBridge + webhookSanitizer) reads this list when the flag
 * is on — cloud GitHub App registration is out of scope for local CLI.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

export type PRSubscription = {
  repo: string // "owner/repo"
  prNumber: number
  subscribedAt: string // ISO 8601
  /** Optional event filter; omitted = all events the bridge delivers. */
  events?: Array<'comment' | 'review' | 'ci' | 'merge' | 'close'>
}

export function getPRSubscriptionsFilePath(): string {
  return path.join(getClaudeConfigHomeDir(), 'pr-subscriptions.json')
}

export function readPRSubscriptions(): PRSubscription[] {
  const filePath = getPRSubscriptionsFilePath()
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is PRSubscription =>
      Boolean(
        s &&
          typeof s === 'object' &&
          typeof (s as PRSubscription).repo === 'string' &&
          typeof (s as PRSubscription).prNumber === 'number',
      ),
    )
  } catch {
    return []
  }
}

export function writePRSubscriptions(subs: PRSubscription[]): void {
  const filePath = getPRSubscriptionsFilePath()
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(subs, null, 2), 'utf-8')
}

export function findPRSubscription(
  repo: string,
  prNumber: number,
  subs: PRSubscription[] = readPRSubscriptions(),
): PRSubscription | undefined {
  return subs.find(s => s.repo === repo && s.prNumber === prNumber)
}

/**
 * Upsert a subscription. Returns the stored entry and whether it was new.
 */
export function upsertPRSubscription(input: {
  repo: string
  prNumber: number
  events?: PRSubscription['events']
}): { subscription: PRSubscription; created: boolean } {
  const subs = readPRSubscriptions()
  const existing = findPRSubscription(input.repo, input.prNumber, subs)
  if (existing) {
    if (input.events) {
      existing.events = input.events
      writePRSubscriptions(subs)
    }
    return { subscription: existing, created: false }
  }
  const subscription: PRSubscription = {
    repo: input.repo,
    prNumber: input.prNumber,
    subscribedAt: new Date().toISOString(),
    ...(input.events ? { events: input.events } : {}),
  }
  subs.push(subscription)
  writePRSubscriptions(subs)
  return { subscription, created: true }
}

export function removePRSubscription(repo: string, prNumber: number): boolean {
  const subs = readPRSubscriptions()
  const after = subs.filter(s => !(s.repo === repo && s.prNumber === prNumber))
  if (after.length === subs.length) return false
  writePRSubscriptions(after)
  return true
}

/** Stable id for tool results (local store only — not a cloud subscription id). */
export function prSubscriptionId(sub: PRSubscription): string {
  return `local:${sub.repo}#${sub.prNumber}`
}
