/**
 * densable 2.1.251 SEA peel extract — lane G covering functions.
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

function dumpHits(needle, n = 6, before = 100, after = 200) {
  const hits = allHits(buf, needle)
  console.log(`\n### ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const fn = lastFnStartGeneric(buf, h, 20000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log('   ', asciiSlice(buf, h - before, h + after).replace(/\n/g, ' ').slice(0, 360))
  }
}

function showFn(label, i, maxLen = 20000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} miss=${!!ex.miss} missEnd=${!!ex.missEnd} len=${ex.len} sha=${ex.sha}`)
  if (ex.body) console.log(ex.body.slice(0, 4000))
  else console.log('PREVIEW', ex.preview?.slice(0, 400))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

// ---- #11 ----
showFn('#11 pte', 185012882, 8000)
showFn('#11 lU jlt neighbor', 184252083, 800)
win('#11 thinking nudge', 186914350, 200, 900)

dumpHits('empty_text_block', 8, 80, 160)
dumpHits('thinking_only_retry', 6, 80, 160)
dumpHits('strip empty', 4)
dumpHits('type==="text"&&!e.text', 6)
dumpHits('text.trim().length===0', 8, 80, 160)

// ---- #15 ----
showFn('#15 iCe', 200914924, 8000)
dumpHits('replace-last-ephemeral-progress', 6, 80, 200)
dumpHits('case"replace-last-ephemeral-progress"', 4, 40, 200)

// ---- #20 ----
dumpHits('isProfileAuthShadowed', 6, 40, 80)
dumpHits('isUsableClaudeAILoginRecord', 6, 40, 80)
dumpHits('function hqt', 4, 0, 400)
dumpHits('function Aqt', 6, 0, 400)
dumpHits('function Pre', 4, 0, 80)
dumpHits('consoleProfile', 10, 60, 140)
dumpHits('gatewayAuth', 8, 40, 120)
dumpHits('/status', 8, 40, 80)
dumpHits('storedClaudeAi', 4)
dumpHits('claudeAiOauth', 8, 40, 100)
dumpHits('oauth_console_profile', 6, 60, 140)

// ---- #28 ----
showFn('#28 W load-buffer', 183541127, 2000)
showFn('#28 yy', 183541519, 3000)
showFn('#28 int', 192280399, 800)
showFn('#28 uL', 199185607, 800)
dumpHits('function zue', 4, 0, 400)
dumpHits('function TN(', 4, 0, 200)
dumpHits('osc52', 12, 40, 120)
dumpHits('copiedVia', 8, 40, 140)

// ---- #32 ----
showFn('#32 ive', 185793030, 16000)
dumpHits('function X3', 4, 0, 400)
dumpHits('function Gct', 2, 0, 80)
dumpHits('function l7n', 4, 0, 300)

// ---- #43 ----
showFn('#43 Zor', 179883181, 800)
showFn('#43 ae', 190733303, 4000)
showFn('#43 ee', 190730118, 4000)
showFn('#43 ie', 190733145, 400)
dumpHits('function fEt', 4, 0, 400)
dumpHits('function wt(', 6, 0, 200)
dumpHits('login_handoff', 8, 60, 160)

// ---- #52 ----
dumpHits('sanitizedName', 10, 40, 140)
dumpHits('formatMcp', 6)
dumpHits('mcp server "', 6, 40, 80)
dumpHits('sanitizeMcp', 4)
dumpHits('replace(/[^', 8, 40, 80)
dumpHits('server name', 8, 40, 80)
dumpHits('invalid characters', 6, 40, 80)

// ---- #64 ----
dumpHits('class kyt', 3, 20, 400)
dumpHits('function kyt', 3, 0, 200)
dumpHits('open refused a swapped leaf', 4, 80, 200)
dumpHits('outputPathBindings', 6, 60, 160)
dumpHits('.output`', 8, 60, 160)

// ---- #65 ----
showFn('#65 G$', 202807287, 2000)
dumpHits('function Vct', 4, 0, 400)
dumpHits('plugin/LSP', 4)
dumpHits('lsp install', 6, 40, 80)
dumpHits('Install the', 8, 40, 80)
dumpHits('suggestion', 8, 40, 80)

// ---- #68 ----
dumpHits('CLAUDE_CONFIG_DIR no longer', 4, 40, 200)
dumpHits('not handing it on', 4, 80, 200)
dumpHits('CLAUDE_CODE_TMPDIR', 10, 40, 140)
dumpHits('SAFE_ENV', 4)
dumpHits('safeEnv', 6, 40, 80)
dumpHits('env allowlist', 4)
dumpHits('blockedSettingsEnv', 4)
dumpHits('settingsEnv', 8, 40, 100)
