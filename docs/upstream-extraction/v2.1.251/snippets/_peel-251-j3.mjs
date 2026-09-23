/**
 * Pass 3: extract the real decls found in j2, plus cL tracker, ao, K, lY,
 * Qan origin, foreground-subagent windows.
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

function grow(i, max = 80000) {
  for (const cap of [2000, 8000, 20000, 40000, max]) {
    const ex = extractFnAt(buf, i, cap)
    if (ex.body) return { ...ex, at: i }
  }
  return { at: i, miss: true }
}

function show(label, i, cap = 2000) {
  const win = asciiSlice(buf, i - 20, i + 8)
  const st = lastFnStartGeneric(buf, i + 1, 4000)
  const ex = grow(st.i >= 0 ? st.i : i)
  console.log(`\n#### ${label} @${i} lastFn=${st.name}@${st.i}`)
  if (ex.body) {
    console.log(`BODY ${ex.body.slice(0, 12)}… @${ex.at} len=${ex.len} sha=${ex.sha}`)
    console.log(ex.body.length <= cap ? ex.body : ex.body.slice(0, cap) + `\n… +${ex.body.length - cap}`)
  } else {
    console.log('MISS', asciiSlice(buf, i, i + 180))
  }
}

function dump(needle, n = 8) {
  const hits = allHits(buf, needle)
  console.log(`\n=== ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    console.log(`  @${h} ${asciiSlice(buf, h - 40, h + needle.length + 100).replace(/\s+/g, ' ')}`)
  }
  return hits
}

// known good offsets
show('vp-msg', 188065722, 2500)
show('tX', 188064834, 800)
show('MLe', 181896185, 800)
show('MLe-alt', 202748537, 400)
show('c$t', 185036528, 200)
show('u$t', 185036585, 200)
show('qhn-net', 182004789, 400)
show('hM-policy', 180217949, 200)
show('toe', 180217980, 200)
show('o5-survivor', 180218041, 800)
show('Hyt', 182202187, 500)

// cL tracker
dump('function cL')
dump('cL().summary')
dump('cL().expectDrop')
dump('estimateRecacheTokens')
dump('expectDrop')
dump('class ')
const clHits = allHits(buf, 'estimateRecacheTokens')
for (const h of clHits) {
  const st = lastFnStartGeneric(buf, h + 1, 20000)
  const ex = grow(st.i >= 0 ? st.i : h, 40000)
  console.log(
    `\ncL-ish @${h} fn=${st.name}@${st.i} len=${ex.len} sha=${ex.sha} hasSummary=${(ex.body || '').includes('summary(')} hasMiss=${(ex.body || '').includes('miss')}`,
  )
  if (ex.body && ex.len < 8000) console.log(ex.body)
  else if (ex.body) console.log(ex.body.slice(0, 2500) + `\n… +${ex.body.length - 2500}`)
}

// ao used by UWt — search cluster
console.log('\n######## ao in UWt cluster 182180000-182210000')
const aoCluster = asciiSlice(buf, 182180000, 182210000)
const aoIdx = []
let p = 0
while (true) {
  const k = aoCluster.indexOf('function ao', p)
  if (k < 0) break
  aoIdx.push(182180000 + k)
  p = k + 1
}
console.log('function ao in cluster', aoIdx)
dump('function ao(', 20)

// import ao
dump('ao as ', 10)
dump('{ao as', 8)
dump('ao,', 5)

// ancestors helper names
dump('function ao(t)', 8)
dump('function ao(e)', 12)

// K session id
dump('function K(){', 20)
dump('function K(){return', 12)
const kCall = allHits(buf, 'session_id:K()')
console.log('session_id:K() count', kCall.length)

// Look around san cluster for function K
const sanWin = asciiSlice(buf, 185850000, 185870000)
const kInSan = sanWin.indexOf('function K(')
console.log('function K in san cluster', kInSan >= 0 ? 185850000 + kInSan : -1)

// lY
dump('function lY', 8)
dump('lY(`/proc/self/fd', 4)

// Qan origin
dump('function db()', 8)
dump('function Fx(', 10)
dump('function yN()', 8)
dump('function Bdt(', 8)

// foreground subagent windows
dump('foreground subagent', 2)
for (const h of allHits(buf, 'foreground subagent')) {
  console.log('\nFG @', h)
  console.log(asciiSlice(buf, h - 200, h + 250))
  const st = lastFnStartGeneric(buf, h + 1, 12000)
  const ex = grow(st.i)
  console.log('enclosing', st.name, st.i, ex.len, ex.sha)
}

// iJ near Oo
dump('function iJ(', 6)

// Ht regex near Ut
show('Ht-ish', 182184724, 200)
