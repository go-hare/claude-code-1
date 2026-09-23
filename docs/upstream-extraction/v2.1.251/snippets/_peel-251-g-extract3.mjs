/**
 * densable 2.1.251 SEA peel extract3 — #20 #52 #64 #65 #68 lock.
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
if (buf.length !== 217360032) throw new Error(`size ${buf.length}`)

function dumpHits(needle, n = 8, before = 80, after = 200) {
  const hits = allHits(buf, needle)
  console.log(`\n### ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const fn = lastFnStartGeneric(buf, h, 20000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log('   ', asciiSlice(buf, h - before, h + after).replace(/\n/g, ' ').slice(0, 420))
  }
}

function showFn(label, i, maxLen = 16000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 5000))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 500))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

// #68
showFn('#68 gE', 183669796, 4000)
showFn('#68 T env', 181415333, 8000)
dumpHits('mMe=[', 3, 40, 400)
dumpHits('pn=["CLAUDE_CODE_TMPDIR"', 3, 80, 500)
dumpHits('set in the shell, not a s', 4, 80, 240)

// #64
showFn('#64 nt', 182196816, 4000)
showFn('#64 XX', 182197719, 3000)
dumpHits('function rLe', 3, 0, 600)
dumpHits('function tLe', 2, 0, 250)
dumpHits('sandbox cannot redirect', 2)
dumpHits('exclusive', 8, 40, 80)

// #20
showFn('#20 dS', 180261787, 1500)
showFn('#20 b precedence', 180261941, 800)
showFn('#20 Wd', 181223921, 400)
showFn('#20 hqt', 181223778, 250)
showFn('#20 Aqt', 181263175, 200)
showFn('#20 vJe', 180262806, 120)
dumpHits('Using Anthropic profile auth', 6, 80, 240)
dumpHits('function /status', 2)
dumpHits('name:"status"', 6, 40, 200)
dumpHits('Auth token', 6, 40, 80)
dumpHits('statusAuth', 4)
dumpHits('profile auth', 8, 40, 140)
dumpHits('401', 6, 20, 40)
dumpHits('retry.*profile', 4)
dumpHits('isUsableClaudeAILoginRecord', 4, 40, 80)
dumpHits('gateway 401', 4)
dumpHits('status===401&&', 10, 80, 220)
dumpHits('claude.ai login', 8, 40, 120)

// #52 MCP label sanitize
dumpHits('function An(e)', 3, 0, 200)
dumpHits('sanitizeLabelSegment', 2)
dumpHits('labelSegment', 4)
dumpHits('MCP:', 8, 20, 60)
dumpHits('`mcp__', 6, 40, 80)
dumpHits('serverName)', 8, 40, 80)
dumpHits('formatMcpServer', 2)
dumpHits('mcpDisplay', 4)
dumpHits('displayName', 8, 40, 80)
dumpHits('replace(/[\\p{Cc}', 6, 80, 160)
dumpHits('invalid MCP server name', 4, 40, 120)
dumpHits('reserved MCP server name', 6, 80, 200)

// #65
dumpHits('focusedInputDialog', 10, 60, 180)
dumpHits('function wN', 3, 0, 800)
dumpHits('plugin install suggestion', 4)
dumpHits('Install LSP', 4)
dumpHits('lsp server', 8, 40, 80)
dumpHits('suggestInstall', 4)
dumpHits('installNudge', 4)
dumpHits('autoDefault', 8, 40, 140)
dumpHits('shouldShowAutoDefaultNudge', 6, 60, 200)
dumpHits('make auto mode the default', 4, 80, 200)
dumpHits('Ll===', 6, 40, 80)
dumpHits('=== "effort-medium-nudge"', 4, 40, 80)
dumpHits('pluginSuggestionShown', 6, 80, 200)
dumpHits('contextual install', 4, 80, 200)
