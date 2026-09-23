/**
 * densable 2.1.251 SEA peel extract7 — #52 fr/Qt, #65 suggestion gate, #68 N callers.
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

function dumpHits(needle, n = 10, before = 80, after = 220) {
  const hits = allHits(buf, needle)
  console.log(`\n### ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const fn = lastFnStartGeneric(buf, h, 20000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log('   ', asciiSlice(buf, h - before, h + after).replace(/\n/g, ' ').slice(0, 480))
  }
}

function showFn(label, i, maxLen = 4000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 2500))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 400))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

// #52
showFn('#52 Bfe', 179791099, 250)
showFn('#52 BXe', 179791242, 200)
showFn('#52 jfe', 179791389, 150)
showFn('#52 ln', 179736283, 200)
dumpHits('function fr(', 8, 0, 250)
dumpHits('function Qt(', 8, 0, 250)
dumpHits('Bfe(', 8, 40, 80)
dumpHits('MCP server "', 8, 40, 160)
win('#52 Bfe cluster', 179791099, 0, 420)

// #65
dumpHits('useLspPluginRecommendation', 6, 60, 180)
dumpHits('lsp-plugin', 8, 60, 180)
dumpHits('[lspRecommendation]', 6, 40, 80)
dumpHits('function useLsp', 4, 0, 200)
dumpHits('hintRecommendation', 6, 80, 200)
dumpHits('plugin_hint', 8, 60, 180)
dumpHits('Install plugin', 6, 40, 120)
dumpHits('isPromptInputActive', 6, 80, 220)
dumpHits('Vct', 8, 40, 80)
dumpHits('setIsPromptInputActive', 4)
dumpHits('promptInputActive', 8, 40, 80)
dumpHits('auto_default_nudge', 8, 80, 200)
dumpHits('hasSeenAutoDefaultNudge', 6, 60, 140)

// #68 N callers
dumpHits('N(t,', 6, 40, 80)
dumpHits('function N(t,s,e)', 2, 0, 80)
dumpHits('.claude/settings.json"} is ignored', 2, 200, 80)
dumpHits('vyr.has', 6, 80, 160)
dumpHits('filterSettingsEnv', 2)
dumpHits('function L(', 6, 0, 80)
win('#68 vyr TMPDIR keys', 181417150, 0, 120)

// #20 AJe
showFn('#20 AJe', 180262874, 500)
showFn('#20 Wd', 181223921, 200)
showFn('#20 hqt', 181223778, 160)
showFn('#20 vJe', 180262806, 80)

// #15 iCe + caller
showFn('#15 iCe', 200914924, 1000)
win('#15 caller', 203412900, 40, 80)

// #28 zue + W + yy
showFn('#28 zue', 183540369, 200)
showFn('#28 W', 183541127, 500)
showFn('#28 Al caps', 179057643, 80)
