/**
 * densable 2.1.251 SEA peel scan — changelog #11 #15 #20 #28 #32 #43 #52 #64 #65 #68.
 * Scan-only: hit counts + lastFnStartGeneric around first JS-ish hits.
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
if (buf.length !== 217360032) {
  throw new Error(`unexpected SEA size ${buf.length}`)
}

const groups = {
  11: [
    'text content blocks must be non-empty',
    'text content blocks must be',
    'thinking-only',
    'thinkingOnly',
    'thinking_only',
    'thinkingOnlyNudged',
    'query_thinking_only',
    'normalizeMessagesForAPI',
    'empty text block',
    'non-empty after thinking',
    'produced only thinking',
  ],
  15: [
    'per-second progress',
    'progress ticks',
    'replace their predecessor',
    'parentToolUseID',
    'ephemeral tick',
    'progress_tick',
    'task_progress',
    'TUI lag',
    'replace ephemeral',
  ],
  20: [
    'storedClaudeAiLogin',
    'isProfileAuthActive',
    'anthropicProfile',
    'stored Anthropic',
    'Console sign-in',
    'claudeAiLogin',
    'profileAuthActive',
    'treating a stored',
  ],
  28: [
    'tmux-buffer',
    'tmux buffer',
    'OSC 52',
    'OSC52',
    'getClipboardPath',
    'clipboardPath',
    'opened background session',
  ],
  32: [
    'merge-request',
    'merge_request',
    'gitlab.com',
    'resolvePrFetchSpecs',
    'GitHub-style',
    'refs/merge-requests',
    'merge-requests/',
  ],
  43: [
    'hasDangerousSettingsChangedAgainstBaseline',
    'dangerousSettingsChanged',
    'orgConsent',
    'managed-settings',
    'managedSettings',
    'unchanged since your last approval',
    'signing in again',
  ],
  52: [
    'sanitizeLabelSegment',
    'formatMcpServerLabel',
    'sanitizeLabel',
    'MCP server name',
    'invalid MCP server',
  ],
  64: [
    'diskOutput',
    'command output file',
    'O_EXCL',
    'sandbox output',
    'redirect or replace',
    'bash output',
  ],
  65: [
    'isPromptInputActive',
    'getFocusedInputDialog',
    'auto_default_nudge',
    'hasSeenAutoDefaultNudge',
    'plugin install',
    'LSP install',
    'install suggestion',
  ],
  68: [
    'SAFE_ENV_VARS',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_CODE_TMPDIR',
    'settings.json env',
  ],
}

function jsScore(win) {
  let s = 0
  if (/function [A-Za-z_$]/.test(win)) s += 40
  if (/=>\{/.test(win) || /=>/.test(win)) s += 10
  if (/if\(/.test(win)) s += 15
  if (/return/.test(win)) s += 10
  if (/const |let |var /.test(win)) s += 10
  if (/"use strict"/.test(win)) s += 5
  if (win.includes('changelog') || win.includes('Fixed ')) s -= 30
  return s
}

for (const [n, needles] of Object.entries(groups)) {
  console.log(`\n======== #${n} ========`)
  for (const needle of needles) {
    const hits = allHits(buf, needle)
    console.log(`  ${JSON.stringify(needle)} hits=${hits.length} first=${hits.slice(0, 6).join(',') || '-'}`)
    if (hits.length === 0) continue
    // score first 8 hits
    const scored = hits.slice(0, 12).map((h) => {
      const win = asciiSlice(buf, h - 80, h + 180)
      return { h, score: jsScore(win), win }
    })
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]
    const fn = lastFnStartGeneric(buf, best.h, 12000)
    console.log(`    bestHit@${best.h} jsScore=${best.score} lastFn=${fn.name}@${fn.i}`)
    if (fn.i >= 0) {
      const ex = extractFnAt(buf, fn.i, 16000)
      if (ex.body) {
        console.log(`    extract ${fn.name} len=${ex.len} sha=${ex.sha} hasNeedle=${ex.body.includes(needle)}`)
        console.log(`    preview: ${ex.body.slice(0, 220).replace(/\n/g, ' ')}`)
      } else {
        console.log(`    extract miss ${ex.preview?.slice(0, 160) ?? ''}`)
      }
    }
    console.log(`    win: ${best.win.slice(0, 200).replace(/\n/g, ' ')}`)
  }
}
