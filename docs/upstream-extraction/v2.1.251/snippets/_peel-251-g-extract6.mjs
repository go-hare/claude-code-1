/**
 * densable 2.1.251 SEA peel extract6 — leftover windows.
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

function dumpHits(needle, n = 8, before = 80, after = 240) {
  const hits = allHits(buf, needle)
  console.log(`\n### ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const fn = lastFnStartGeneric(buf, h, 20000)
    console.log(`  @${h} lastFn=${fn.name}@${fn.i}`)
    console.log('   ', asciiSlice(buf, h - before, h + after).replace(/\n/g, ' ').slice(0, 500))
  }
}

function showFn(label, i, maxLen = 8000) {
  const ex = extractFnAt(buf, i, maxLen)
  console.log(`\n==== ${label} @${i} len=${ex.len} sha=${ex.sha} missEnd=${!!ex.missEnd}`)
  if (ex.body) console.log(ex.body.slice(0, 4000))
  else console.log('PREVIEW', (ex.preview || '').slice(0, 400))
}

function win(label, i, before, after) {
  const t = asciiSlice(buf, i - before, i + after)
  console.log(`\n==== WIN ${label} @${i} len=${t.length} sha=${sha(t)}`)
  console.log(t)
}

showFn('#20 Ztt status', 200738320, 1500)
win('#20 Ztt Wd row', 200738650, 80, 250)
win('#20 odn 401', 185309800, 200, 250)
win('#20 Nl profile', 181226380, 40, 220)
win('#20 IN skip', 181223250, 20, 280)

showFn('#68 N', 181417358, 800)
win('#68 vyr head', 181415600, 0, 900)

dumpHits('(from plugin ', 8, 100, 260)
dumpHits('startsWith("plugin:")', 8, 80, 260)
dumpHits('from plugin ${', 6, 80, 240)

dumpHits('lspRecommendation', 8, 80, 220)
dumpHits('hintRecommendation', 8, 80, 220)
dumpHits('plugin hint', 6, 40, 80)
dumpHits('LSP server', 8, 40, 100)
dumpHits('recommend installing', 4, 80, 160)
showFn('#65 T9t', 200927115, 600)
showFn('#65 G$', 202807287, 400)

win('#11 jlt', 184252330, 0, 180)
win('#11 thinking', 186914380, 0, 700)
showFn('#11 pte empty only window', 185014620, 80)

win('#64 Que exclusive create', 182205090, 0, 220)
showFn('#64 rLe', 182205090, 200)
showFn('#64 Que', 182205160, 250)
win('#64 rt O_NOFOLLOW', 182190880, 0, 80)

showFn('#32 ive prNumber slice', 185793030, 200)
win('#32 ive gitlab', 185794700, 80, 450)
showFn('#32 X3', 182455332, 200)
showFn('#32 l7n', 182455488, 220)
win('#32 G=', 182455280, 0, 60)

dumpHits('function Co(', 8, 0, 180)
// Co used at thinking-only site — find definition nearest 186914471
const hits = allHits(buf, 'function Co(')
for (const h of hits) {
  if (h > 186800000 && h < 186914471) {
    console.log('nearby Co', h)
    const ex = extractFnAt(buf, h, 4000)
    console.log(ex.len, ex.sha, (ex.body || '').slice(0, 400))
  }
}

dumpHits('An Anthropic profile', 4, 40, 200)
dumpHits('if(Wd())s.push', 3, 40, 200)
