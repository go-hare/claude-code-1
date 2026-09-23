/**
 * Method-span extract around SendMessage Desktop + teleport GitHub retry.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea()
if (buf.length !== 217360032) throw new Error(String(buf.length))

function extractMethodAt(i, maxLen = 20000) {
  const win = asciiSlice(buf, i, i + maxLen)
  const paren = win.indexOf('(')
  if (paren < 0) return { miss: true }
  let depth = 0
  let inStr = null
  let esc = false
  let closeParen = -1
  for (let p = paren; p < win.length; p++) {
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
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        closeParen = p
        break
      }
    }
  }
  if (closeParen < 0) return { missEnd: true, preview: win.slice(0, 200) }
  const bodyStart = win.indexOf('{', closeParen)
  if (bodyStart < 0) return { missEnd: true, preview: win.slice(0, 200) }
  depth = 0
  inStr = null
  esc = false
  for (let p = bodyStart; p < win.length; p++) {
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
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { missEnd: true, preview: win.slice(0, 280) }
}

function lastMethodStart(before, maxLookback = 12000) {
  const start = Math.max(0, before - maxLookback)
  const win = asciiSlice(buf, start, before)
  let bestRel = -1
  let name = ''
  const re =
    /(?:async )?(?:function )?([A-Za-z_$][\w$]*)\s*\([^)]{0,200}\)\s*\{/g
  let m
  while ((m = re.exec(win))) {
    bestRel = m.index
    name = m[1]
  }
  if (bestRel < 0) return { i: -1, name: '' }
  return { i: start + bestRel, name }
}

const jsDesktop = 196618369
console.log('==== window before desktop_host ====')
console.log(asciiSlice(buf, jsDesktop - 2500, jsDesktop + 80))

const meth = lastMethodStart(jsDesktop + 20, 8000)
console.log('\nlastMethod', meth)
if (meth.i >= 0) {
  const ex = extractMethodAt(meth.i, 24000)
  console.log('method extract', ex.len, ex.sha, ex.missEnd)
  if (ex.body) console.log(ex.body.slice(0, 2000))
}

// also try extractFnAt on nearby function keywords
const pre = asciiSlice(buf, jsDesktop - 8000, jsDesktop)
const re = /(?:async )?function ([A-Za-z_$][\w$]*)\(/g
let m
const fns = []
while ((m = re.exec(pre))) fns.push({ name: m[1], rel: m.index })
console.log(
  'nearby fns',
  fns.slice(-8).map((f) => `${f.name}@${jsDesktop - 8000 + f.rel}`),
)
for (const f of fns.slice(-5)) {
  const i = jsDesktop - 8000 + f.rel
  const ex = extractFnAt(buf, i, 30000)
  console.log(
    `fn ${f.name}@${i} len=${ex.len} covers=${ex.body && jsDesktop >= i && jsDesktop < i + (ex.len || 0)}`,
  )
}

// dump a large raw window of the SendMessage desktop branch
const sendWin = asciiSlice(buf, 196617800, 196621200)
console.log('\n==== SEND RAW 196617800-196621200 ====')
console.log(sendWin)

// teleport create fail around JS copy of transient
const jsGh = allHits(
  buf,
  'the GitHub App preflight failed transiently (network or service hiccup)',
).filter((h) => h > 170e6)
console.log('\ngh transient js', jsGh)
for (const off of jsGh) {
  const meth2 = lastMethodStart(off, 20000)
  console.log('meth', meth2)
  const walkedPre = asciiSlice(buf, off - 4000, off + 40)
  const re2 = /(?:async )?function ([A-Za-z_$][\w$]*)\(/g
  const nearby = []
  let mm
  while ((mm = re2.exec(walkedPre)))
    nearby.push({ name: mm[1], i: off - 4000 + mm.index })
  console.log(
    'nearby',
    nearby.slice(-6).map((x) => `${x.name}@${x.i}`),
  )
  for (const x of nearby.slice(-4)) {
    const ex = extractFnAt(buf, x.i, 40000)
    console.log(
      `  ${x.name} len=${ex.len} covers=${!!(ex.body && off >= x.i && off < x.i + ex.len)} sha=${ex.sha}`,
    )
    if (ex.body && off >= x.i && off < x.i + ex.len) {
      console.log(ex.body.slice(0, 500))
      console.log('...snip...')
      const rel = off - x.i
      console.log(ex.body.slice(Math.max(0, rel - 200), rel + 700))
    }
  }
}

// V_e full
const Ve = 185450781
const VeEx = extractFnAt(buf, Ve, 8000)
console.log('\n==== V_e full ====')
console.log('len', VeEx.len, VeEx.sha)
console.log(VeEx.body)

// #21 host model / only setting / told Claude
for (const [n, off] of [
  ['host model', 190101550],
  ['only setting 1', 185247975],
  ['told Claude', 193183076],
]) {
  console.log(`\n==== ${n} @${off} ====`)
  console.log(asciiSlice(buf, off - 160, off + 280))
}

// #48 connection reset js hits besides An
for (const off of [204215215, 204215755, 204219624, 213251810, 215088420]) {
  console.log(`\n==== 48 connection reset @${off} ====`)
  console.log(asciiSlice(buf, off - 140, off + 220))
}

writeFileSync(
  join(__dir, '_peel-251-h-methods.json'),
  JSON.stringify(
    {
      sendWin,
      Ve: { i: Ve, len: VeEx.len, sha: VeEx.sha, body: VeEx.body },
      jsGh,
    },
    null,
    2,
  ),
)
