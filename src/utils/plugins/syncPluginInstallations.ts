/**
 * densable 2.1.224 #13 — multi-project install record sync helpers.
 *
 * densable Gry (migrateFromEnabledPlugins) must NOT overwrite installations[0]
 * when the same plugin is installed under another projectPath. That silently
 * corrupts peer project install records. Instead:
 * - managed: force single managed entry (collapse extras)
 * - else: find scope+projectPath; if missing, push a clone of an existing
 *   installPath entry for the new scope/projectPath
 * - dedupe by `${scope}|${projectPath??""}` and drop stale managed when
 *   non-managed scope is the settings source of truth for this plugin
 *
 * Pure so unit tests can pin the multi-project cases without marketplace I/O.
 */

import type { PluginInstallationEntry } from './schemas.js'

export type ScopeInfo = {
  scope: PluginInstallationEntry['scope']
  projectPath?: string
}

function scopeKey(entry: { scope: string; projectPath?: string }): string {
  return `${entry.scope}|${entry.projectPath ?? ''}`
}

/**
 * densable skip gate fragment: does this plugin already have the needed record?
 * managed → exactly one managed entry; else → some entry matches scope+path.
 */
export function hasMatchingInstallRecord(
  installations: PluginInstallationEntry[] | undefined,
  scopeInfo: ScopeInfo,
  isPolicyManaged: boolean,
): boolean {
  if (!installations || installations.length === 0) return false
  if (isPolicyManaged) {
    return installations.length === 1 && installations[0]?.scope === 'managed'
  }
  return installations.some(
    e => e.scope === scopeInfo.scope && e.projectPath === scopeInfo.projectPath,
  )
}

/**
 * densable Gry existing-entry branch for one plugin id.
 * Mutates `installations` in place when collapsing/updating managed[0];
 * returns the next array (may be a new array when push/dedupe).
 *
 * @returns { next, changed }
 */
export function syncExistingInstallationsForScope(
  installations: PluginInstallationEntry[],
  scopeInfo: ScopeInfo,
  now: string,
): { next: PluginInstallationEntry[]; changed: boolean } {
  if (installations.length === 0) {
    return { next: installations, changed: false }
  }

  let changed = false
  let next = installations

  if (scopeInfo.scope === 'managed') {
    const first = next[0]
    if (
      first &&
      (first.scope !== 'managed' || first.projectPath !== undefined)
    ) {
      first.scope = 'managed'
      delete first.projectPath
      first.lastUpdated = now
      changed = true
    }
    if (next.length > 1) {
      next = next.slice(0, 1)
      changed = true
    }
    return { next, changed }
  }

  // Non-managed: find exact scope+projectPath (do NOT rewrite [0])
  const match = next.find(
    e => e.scope === scopeInfo.scope && e.projectPath === scopeInfo.projectPath,
  )

  if (!match) {
    // densable: clone installPath from best existing entry, then push new record
    const sameProject =
      next.find(
        e =>
          e.projectPath !== undefined &&
          e.projectPath === scopeInfo.projectPath,
      ) ?? undefined
    const userEntry = next.find(e => e.scope === 'user')
    const newest = next.reduce((a, b) =>
      (b.lastUpdated ?? '') > (a.lastUpdated ?? '') ? b : a,
    )
    const donor = sameProject ?? userEntry ?? newest
    next = [
      ...next,
      {
        scope: scopeInfo.scope,
        installPath: donor.installPath,
        ...(donor.version !== undefined && { version: donor.version }),
        installedAt: now,
        lastUpdated: now,
        ...(donor.gitCommitSha !== undefined && {
          gitCommitSha: donor.gitCommitSha,
        }),
        ...(scopeInfo.projectPath && { projectPath: scopeInfo.projectPath }),
      },
    ]
    changed = true
  }

  // densable: drop managed + dedupe scope|projectPath for non-managed settings truth
  const seen = new Set<string>()
  const cleaned = next.filter(e => {
    if (e.scope === 'managed') return false
    const k = scopeKey(e)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (cleaned.length < next.length) {
    next = cleaned
    changed = true
  }

  return { next, changed }
}
