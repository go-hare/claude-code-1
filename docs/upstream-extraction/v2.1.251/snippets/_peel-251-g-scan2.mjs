/**
 * densable 2.1.251 SEA peel scan2 — deepen weak needles for lane G.
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

function dump(label, needle, n = 8, before = 120, after = 220) {
  const hits = allHits(buf, needle)
  console.log(`\n=== ${label} ${JSON.stringify(needle)} hits=${hits.length} ===`)
  for (const h of hits.slice(0, n)) {
    const win = asciiSlice(buf, h - before, h + after)
    const fn = lastFnStartGeneric(buf, h, 16000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log(`    ${win.replace(/\n/g, ' ').slice(0, 320)}`)
  }
}

function extractAround(off, lookback = 8000, maxLen = 20000) {
  const fn = lastFnStartGeneric(buf, off, lookback)
  console.log(`\n--- extract around ${off} lastFn=${fn.name}@${fn.i} ---`)
  if (fn.i < 0) {
    console.log(asciiSlice(buf, off - 400, off + 800).slice(0, 1200))
    return
  }
  const ex = extractFnAt(buf, fn.i, maxLen)
  if (!ex.body) {
    console.log('miss', ex.preview?.slice(0, 300))
    console.log('WINDOW', asciiSlice(buf, fn.i, fn.i + 400))
    return
  }
  console.log(`${fn.name} len=${ex.len} sha=${ex.sha}`)
  console.log(ex.body.slice(0, 1500))
}

// #11 thinking-only nudge window + pte + jlt
dump('#11 jlt', 'jlt=', 3, 40, 200)
dump('#11 query_thinking', 'query_thinking_only_response', 6, 200, 280)
dump('#11 pte return', 'text content blocks must contain non-whitespace', 2, 80, 200)
dump('#11 empty content', 'empty content', 6, 60, 120)

// #15 replace predecessor ticks
dump('#15 parentToolUseID same', 'parentToolUseID===', 8, 80, 160)
dump('#15 parentToolUseID==', 'parentToolUseID==', 8, 80, 160)
dump('#15 ephemeral', 'ephemeral', 12, 60, 140)
dump('#15 subtype progress', 'subtype:"progress"', 8, 80, 160)
dump('#15 type progress', 'type:"progress"', 8, 40, 160)
dump('#15 replace tick', 'replace:', 4, 40, 80)

// #20 gateway profile
dump('#20 storedClaude', 'storedClaude', 6)
dump('#20 ClaudeAi', 'ClaudeAi', 8)
dump('#20 claude.ai profile', 'claude.ai', 8, 40, 80)
dump('#20 profile active', 'profileActive', 6)
dump('#20 isProfile', 'isProfile', 8)
dump('#20 anthropic console profile', 'Console profile', 6)
dump('#20 401 retry', 'status===401', 8, 80, 200)
dump('#20 stored profile', 'stored profile', 4)
dump('#20 login profile', 'loginProfile', 6)
dump('#20 credentialSlots', 'credentialSlots', 8, 40, 120)

// #28 clipboard path
dump('#28 via tmux', 'via:"tmux-buffer"', 6, 80, 120)
dump('#28 ===tmux-buffer', '==="tmux-buffer"', 8, 80, 200)
dump('#28 osc52 case', 'case"osc52"', 6, 80, 160)
dump('#28 tmux copy', 'load-buffer', 6, 80, 200)
dump('#28 set-buffer', 'set-buffer', 8, 80, 200)

// #43 consent baseline
dump('#43 dangerousSettingsHash', 'dangerousSettingsHash', 8, 80, 160)
dump('#43 consented_payload', 'consented_payload', 6, 80, 200)
dump('#43 lastApproved', 'lastApproved', 6)
dump('#43 settingsBaseline', 'settingsBaseline', 6)
dump('#43 approvalHash', 'approvalHash', 6)
dump('#43 againstBaseline', 'againstBaseline', 4)
dump('#43 same gateway', 'same Claude', 4)

// #52 sanitize MCP
dump('#52 sanitize', 'sanitize', 12, 40, 80)
dump('#52 mcp label', 'mcpLabel', 6)
dump('#52 serverLabel', 'serverLabel', 8)
dump('#52 No MCP server named', 'No MCP server named', 4, 40, 200)
dump('#52 mcpName', 'mcpServerName', 6)

// #64 disk output sandbox
dump('#64 diskOutputs', 'diskOutputs', 8, 60, 140)
dump('#64 O_NOFOLLOW output', 'O_NOFOLLOW', 8, 40, 80)
dump('#64 class $O', 'class $O', 3, 20, 200)
dump('#64 pendingOutputOps', 'pendingOutputOps', 6, 60, 140)

// #65 prompt input gate
dump('#65 isPromptInputActive', 'isPromptInputActive', 6, 80, 200)
dump('#65 plugin suggestion', 'pluginSuggestion', 6)
dump('#65 lspSuggestion', 'lspSuggestion', 6)
dump('#65 installSuggestion', 'installSuggestion', 8, 60, 140)
dump('#65 shouldShowInstall', 'shouldShowInstall', 6)
dump('#65 autoDefaultNudge', 'autoDefaultNudge', 8, 60, 140)

// #68 env allowlist
dump('#68 TMPDIR', 'TMPDIR', 10, 40, 80)
dump('#68 CLAUDE_CONFIG_DIR settings', 'CLAUDE_CONFIG_DIR', 8, 60, 120)
dump('#68 env allow', 'allowedEnv', 6)
dump('#68 project env', 'projectSettingsEnv', 4)
dump('#68 blocked env', 'blockedEnv', 6)
dump('#68 unsafe env', 'UNSAFE_ENV', 6)
