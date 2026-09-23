/**
 * densable 2.1.251 SEA peel extract8 — #52 fr/Qt + #65 Fte overlays.
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

function dumpHits(needle, n = 12, before = 80, after = 200) {
  const hits = allHits(buf, needle)
  console.log(`\n### ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const fn = lastFnStartGeneric(buf, h, 25000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log('   ', asciiSlice(buf, h - before, h + after).replace(/\n/g, ' ').slice(0, 500))
  }
}

function showFn(label, i, maxLen = 2000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 2000))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 300))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

showFn('#52 fr sanitize', 179685602, 400)
showFn('#52 Qt', 179686479, 350)
dumpHits('function JU(', 3, 0, 200)
dumpHits('function Ze(', 4, 0, 200)

dumpHits('lsp-plugin', 8, 80, 200)
dumpHits('auto-default-nudge', 8, 80, 200)
dumpHits('auto_default_nudge', 8, 80, 180)
dumpHits('pendingHint', 8, 60, 160)
dumpHits('pendingLsp', 6, 60, 140)
dumpHits('if(Vct)', 8, 40, 120)
dumpHits('if(R)return', 4, 20, 40)

// Fte-local needles
const lo = 203600000
const hi = 203700000
for (const needle of [
  'lspRecommendation',
  'hintRecommendation',
  'auto_default',
  'auto-default',
  'plugin-hint',
  'lsp-plugin',
  'Vct',
  'isPromptInputActive',
  'T9t',
  'frontend-design',
]) {
  const hits = allHits(buf, needle).filter((h) => h >= lo && h < hi)
  console.log(`Fte-range ${JSON.stringify(needle)} hits=${hits.length} ${hits.slice(0, 6).join(',')}`)
  for (const h of hits.slice(0, 3)) {
    console.log('  ', asciiSlice(buf, h - 70, h + 160).replace(/\n/g, ' ').slice(0, 280))
  }
}

// also search getFocused-like early return before suggestions
dumpHits('if(R)return;let we=', 2, 0, 200)
win('#65 G$ full', 202807287, 0, 380)
win('#65 G$ call+lte', 203619050, 0, 400)

// filterSettingsEnv chain
showFn('#68 j filterSettingsEnv', 181421892, 200)
win('#68 filterSettingsEnv', 181422800, 0, 280)
