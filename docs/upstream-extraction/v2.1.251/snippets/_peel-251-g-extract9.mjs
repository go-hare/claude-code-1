/**
 * densable 2.1.251 SEA peel extract9 — #65 Gb/kU/cAe + #52 JU/An.
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

function dumpHits(needle, n = 8, before = 80, after = 220) {
  const hits = allHits(buf, needle)
  console.log(`\n### ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const fn = lastFnStartGeneric(buf, h, 20000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log('   ', asciiSlice(buf, h - before, h + after).replace(/\n/g, ' ').slice(0, 500))
  }
}

function showFn(label, i, maxLen = 6000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 3500))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 400))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

dumpHits('function Gb(', 6, 0, 250)
showFn('#65 kU', 203580789, 4000)
showFn('#65 cAe', 203579728, 4000)
dumpHits('function kU(', 2, 0, 200)
dumpHits('pendingHint', 8, 80, 200)
dumpHits('"typing"', 8, 40, 80)
dumpHits("'typing'", 6, 40, 80)
dumpHits('=== "typing"', 4, 40, 80)
dumpHits('kind:"typing"', 4, 40, 80)
dumpHits('promptInputStoreActive', 4)
dumpHits('setPromptInputStoreActive', 4)
dumpHits('function Gb()', 4, 0, 200)

showFn('#52 JU', 179685343, 120)
showFn('#52 An', 179517526, 120)
win('#52 fr line', 179685602, 0, 220)
win('#52 Qt line', 179686479, 0, 280)

// auto default offer wait
dumpHits('shouldShowAutoDefaultNudge', 6, 100, 300)
dumpHits('auto_default_nudge:"choose', 3, 40, 80)
win('#65 lrt keymap', 203433075, 0, 200)

// Rre auto default
showFn('#65 Rre', 202641310, 800)
win('#65 Rre shouldShow', 202642300, 80, 280)
