/**
 * densable 2.1.251 SEA peel extract2 — remaining lane G callees.
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

function dumpHits(needle, n = 8, before = 80, after = 180) {
  const hits = allHits(buf, needle)
  console.log(`\n### ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const fn = lastFnStartGeneric(buf, h, 16000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log('   ', asciiSlice(buf, h - before, h + after).replace(/\n/g, ' ').slice(0, 380))
  }
}

function showFn(label, i, maxLen = 12000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 4500))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 400))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

// #11 empty text strip / retry
dumpHits('empty_text_block', 6, 40, 200)
dumpHits('"empty_text_block"', 6, 80, 200)
dumpHits('case"empty_text_block"', 4, 80, 240)
dumpHits('thinkingOnlyNudged', 8, 40, 120)
dumpHits('function Co(', 6, 0, 200)
dumpHits('content:jlt', 4, 40, 80)

// #15 caller + mcn
showFn('#15 q_e head', 203397390, 2000)
win('#15 q_e progress replace', 203412900, 80, 200)
dumpHits('function mcn', 4, 0, 400)
dumpHits('mcn(', 8, 40, 80)

// #20 profile as active
dumpHits('profile-implicit', 8, 80, 200)
dumpHits('function Wd(', 3, 0, 500)
dumpHits('function dS(', 4, 0, 300)
dumpHits('function vJe', 4, 0, 300)
dumpHits('function xN(', 6, 0, 200)
dumpHits('function IN(', 4, 0, 200)
dumpHits('function Xt(', 6, 0, 200)
dumpHits('Anthropic profile', 6, 40, 120)
dumpHits('Console profile', 8, 40, 80)
dumpHits('status" Anthropic', 4)
dumpHits('Auth: Anthropic', 4)
dumpHits('stored login', 4)
dumpHits('withRetry', 8, 40, 80)
dumpHits('storedClaudeAiLogin', 2)
dumpHits('claudeAiLogin', 6, 40, 80)
dumpHits('retrying with', 6, 40, 80)
dumpHits('retry with stored', 4)

// #28 bg session copy
showFn('#28 zue', 183540369, 800)
dumpHits('function h()', 8, 0, 200)
dumpHits('copySelection', 8, 40, 140)
dumpHits('function p()', 8, 0, 150)
dumpHits('bg session', 6, 40, 80)
dumpHits('background session', 6, 40, 80)
dumpHits('selection-copied', 6, 60, 140)

// #32 X3 full
showFn('#32 X3', 182455332, 400)

// #43 rt + FNe + wt + c5
showFn('#43 wt', 179883085, 400)
showFn('#43 FNe', 202641434, 400)
showFn('#43 rt', 190743659, 2500)
dumpHits('function c5(', 4, 0, 200)
dumpHits('function Gu(', 4, 0, 200)

// #52 ln sanitize MCP
showFn('#52 ln', 179736283, 800)
dumpHits('function ln(_)', 2, 0, 500)
dumpHits('claude.ai ', 8, 40, 120)
dumpHits('mcp__', 8, 40, 80)
dumpHits('formatServer', 4)
dumpHits('serverName.replace', 6, 40, 80)
dumpHits('Hpe(', 8, 40, 80)
showFn('#52 Hpe', 179517472, 400)
dumpHits('function An(e){return e.replace', 4, 0, 300)

// #64 kyt class + open flags
win('#64 kyt class start', 182191881, 0, 3500)
dumpHits('O_NOFOLLOW', 20, 40, 100)
dumpHits('O_EXCL', 10, 40, 100)
dumpHits('function Fpe', 4, 0, 400)
dumpHits('function XX(', 6, 0, 200)
dumpHits('sandbox.*output', 4)

// #65 prompt gate + plugin/lsp suggestions
win('#65 G$ call site', 203619000, 200, 400)
dumpHits('pluginSuggestion', 10, 60, 160)
dumpHits('lspSuggestion', 4)
dumpHits('LspInstall', 6, 40, 80)
dumpHits('lsp_install', 6, 40, 80)
dumpHits('install plugin', 6, 40, 80)
dumpHits('shouldShowPlugin', 4)
dumpHits('plugin tip', 6, 40, 80)
dumpHits('isPromptInputActive', 6, 80, 200)
dumpHits('focusedInput', 6, 40, 80)
dumpHits('inputActive', 8, 40, 80)
dumpHits('auto_default_nudge', 10, 60, 140)

// #68 settings env apply
dumpHits('settingsEnv', 6, 80, 200)
dumpHits('globalEnv', 8, 60, 140)
dumpHits('projectSettings', 8, 40, 80)
dumpHits('applySettingsEnv', 4)
dumpHits('process.env[', 8, 40, 120)
dumpHits('CLAUDE_CONFIG_DIR', 16, 60, 140)
dumpHits('"TMPDIR"', 10, 40, 100)
dumpHits("'TMPDIR'", 8, 40, 80)
dumpHits('CLAUDE_CODE_TMPDIR', 16, 60, 140)
