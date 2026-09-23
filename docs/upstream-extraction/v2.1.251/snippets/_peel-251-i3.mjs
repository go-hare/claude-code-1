/**
 * densable 2.1.251 — find z_ hook runner, Kle/yEt stores, Hye timeout.
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

function extractGrow(i, caps = [2000, 8000, 20000, 60000, 200000, 800000]) {
  let last = { i, miss: true }
  for (const cap of caps) {
    last = extractFnAt(buf, i, cap)
    if (last.body) return { ...last, cap }
  }
  return last
}

function dump(label, i, n = 200) {
  console.log(`\n## ${label} @${i}`)
  console.log(asciiSlice(buf, i, i + n))
}

const needles = [
  'function*z_',
  'function* z_',
  'async function*z_',
  'async function* z_',
  'function *z_',
  'async function *z_',
  'var z_=',
  'let z_=',
  'z_=async',
  'z_=function',
  'z_=async function',
  ',z_=async',
  'z_={',
  'async function*z_(',
  'function*z_(',
]

for (const n of needles) {
  const hs = allHits(buf, n)
  console.log(
    `${JSON.stringify(n)} hits=${hs.length} ${hs.slice(0, 10).join(',')}`,
  )
}

// all `z_(` near hook runners
const zCall = allHits(buf, 'z_({session:')
console.log(`\nz_({session: hits=${zCall.length} ${zCall.join(',')}`)
for (const h of zCall) {
  console.log(`\n--- call @${h} ---`)
  console.log(asciiSlice(buf, h - 40, h + 180))
  const walk = lastFnStartGeneric(buf, h, 20000)
  console.log(`lastFnStartGeneric look20k: ${walk.name} @${walk.i}`)
  const walk2 = lastFnStartGeneric(buf, h, 200000)
  console.log(`lastFnStartGeneric look200k: ${walk2.name} @${walk2.i}`)
}

// Kle / yEt stores
dump('var Kle=', 186765144, 400)
dump('var yEt=', 186762723, 400)
dump('yEt= @179642684', 179642684, 200)

const kleOf = allHits(buf, 'Kle.of=')
const kleOf2 = allHits(buf, 'Kle.of')
console.log(`Kle.of= ${kleOf.length} Kle.of ${kleOf2.length} first=${kleOf2.slice(0, 12).join(',')}`)

// extract Kle/yEt as assignment objects — walk back for class-like
function extractAssign(off, maxLen = 8000) {
  const win = asciiSlice(buf, off, off + maxLen)
  // var NAME=... through matching brace/paren or next ; at depth 0
  let depth = 0
  let inStr = null
  let esc = false
  let started = false
  for (let p = 0; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{' || c === '(' || c === '[') {
      depth++
      started = true
    } else if (c === '}' || c === ')' || c === ']') {
      depth--
      if (started && depth === 0) {
        // continue to ; or next statement
        let end = p + 1
        if (win[end] === ';') end++
        const body = win.slice(0, end)
        return { body, sha: sha(body), len: body.length }
      }
    } else if (c === ';' && !started) {
      return { body: win.slice(0, p + 1), sha: sha(win.slice(0, p + 1)), len: p + 1 }
    }
  }
  return { miss: true, preview: win.slice(0, 300) }
}

for (const [label, off] of [
  ['Kle', 186765144],
  ['yEt-var', 186762723],
  ['yEt-other', 179642684],
  ['Hye=', 185263247],
  ['HPe=', 203566277],
]) {
  const a = extractAssign(off - (label.startsWith('H') ? 0 : 4), 20000)
  // retry at exact
  const b = extractAssign(off, 20000)
  console.log(`\n## assign ${label} @${off}`)
  console.log('A', a.body ? `${a.len} ${a.sha} ${a.body.slice(0, 220)}` : a.preview)
  console.log('B', b.body ? `${b.len} ${b.sha} ${b.body.slice(0, 220)}` : b.preview)
}

// Hye context
dump('Hye= ctx', 185263200, 120)

// Search for hook runner signatures used by z_
for (const n of [
  'sessionHooks:Kle.of',
  'hookInput:',
  'matchQuery:LOe',
  'function* z',
  'async function*z',
]) {
  const hs = allHits(buf, n)
  console.log(`${JSON.stringify(n)} hits=${hs.length} ${hs.slice(0, 8).join(',')}`)
}

// Look for async generator functions near hook cluster 18675xxxx
const cluster = asciiSlice(buf, 186750000, 186770000)
const genRe = /(?:async )?function\*? ?([A-Za-z_$][\w$]*)\(/g
let m
const gens = []
while ((m = genRe.exec(cluster))) {
  gens.push({ name: m[1], rel: m.index, abs: 186750000 + m.index })
}
console.log('\nfunctions in 186750000-186770000:')
for (const g of gens) console.log(`  ${g.name} @${g.abs}`)

// also search async function* in that window
const star = []
const starRe = /async function\*? ?([A-Za-z_$][\w$]*)/g
while ((m = starRe.exec(cluster))) {
  star.push({ name: m[1], abs: 186750000 + m.index })
}
console.log('async function* in cluster:', star)

// broader: all async function* names that might be z_
const win2start = 186700000
const win2 = asciiSlice(buf, win2start, 186800000)
const star2 = []
const starRe2 = /async function\*? ?([A-Za-z_$][\w$]*)/g
while ((m = starRe2.exec(win2))) {
  star2.push({ name: m[1], abs: win2start + m.index })
}
console.log(
  'async function* 186700000-186800000:',
  star2.map((x) => `${x.name}@${x.abs}`).join(' '),
)
