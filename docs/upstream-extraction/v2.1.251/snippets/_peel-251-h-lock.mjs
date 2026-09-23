/**
 * Lock extracts for gold-251-h: SendMessage call, Ce.from, V_e, teleport retry.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea()
if (buf.length !== 217360032) throw new Error(String(buf.length))

function extractMethodFrom(i, maxLen = 20000) {
  const win = asciiSlice(buf, i, i + maxLen)
  const brace = win.indexOf('{')
  if (brace < 0) return { miss: true }
  let depth = 0
  let inStr = null
  let esc = false
  for (let p = brace; p < win.length; p++) {
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
  return { missEnd: true, preview: win.slice(0, 200) }
}

function capExcerpt(off, before, after) {
  const max = 2500
  let a = Math.max(0, off - before)
  let b = Math.min(buf.length, a + before + after)
  if (b - a > max) b = a + max
  const text = asciiSlice(buf, a, b)
  return { off, text, sha: sha(text), len: text.length }
}

const callAt = buf.indexOf(Buffer.from('async call(e,s,u,o){let d=s.agentId,y=Date.now();function r(h,T,P){re({route:h'))
console.log('callAt', callAt)
const callEx = extractMethodFrom(callAt, 20000)
console.log('call method', callEx.len, callEx.sha, callEx.missEnd)
if (callEx.body) {
  console.log('call head', callEx.body.slice(0, 2200))
  console.log('--- call desktop slice ---')
  const k = callEx.body.indexOf('if(Ke(e.to))')
  console.log(callEx.body.slice(k, k + 1800))
}

// U5e definition
for (const n of ['var U5e=', 'U5e="', 'U5e=`']) {
  const hits = allHits(buf, n).filter((h) => h > 170e6)
  console.log(n, hits)
  for (const h of hits.slice(0, 3)) console.log(asciiSlice(buf, h, h + 220))
}

// Ke / Yo / qe near SendMessage
for (const n of [
  'function Ke(',
  'function Yo(',
  'function qe(',
  'function je(',
  'function Ce(',
]) {
  const hits = allHits(buf, n)
  console.log(n, 'hits', hits.length, hits.filter((h) => h > 190e6 && h < 197e6).slice(0, 8))
}

// Ce.from assignment patterns
for (const n of [
  '.from=',
  'from:e.agentType',
  'from:t.agentType',
  'from:e.agentName',
  'from:t.agentName',
  'from:e.name',
  'from:gmt(',
  'from:lE(',
  'from:d,',
  'from:s.agentId',
  'from:t.agentId',
]) {
  const hits = allHits(buf, n)
  console.log(`from-assign ${JSON.stringify(n)} hits=${hits.length} ${hits.filter((h) => h > 170e6).slice(0, 6)}`)
}

// find function Ce near SendMessage chunk
const ceHits = allHits(buf, 'function Ce(').filter((h) => h > 196000000 && h < 197000000)
console.log('Ce near send', ceHits)
for (const h of ceHits.slice(0, 5)) {
  const ex = extractFnAt(buf, h, 4000)
  console.log('Ce', h, ex.len, ex.sha, ex.body?.slice(0, 400))
}

// also Ce(s,d) definition hunt: lastFn before first Ce(s,d) in call
const ceUse = buf.indexOf(Buffer.from('Ce(s,d).from'))
console.log('Ce(s,d).from', ceUse)
console.log(asciiSlice(buf, ceUse - 80, ceUse + 80))

// wT teleport
const wT = 185738595
console.log('\n==== around wT ====')
console.log(asciiSlice(buf, wT, wT + 180))
const wTEx = extractFnAt(buf, wT, 50000)
console.log('wT extract', wTEx.len, wTEx.sha, wTEx.missEnd, wTEx.preview?.slice(0, 120))

const retryOff = 185753684
const retryFn = lastFnStartGeneric(buf, retryOff, 25000)
console.log('retry lastFn', retryFn)
if (retryFn.i >= 0) {
  const ex = extractFnAt(buf, retryFn.i, 50000)
  console.log('retry fn', retryFn.name, ex.len, ex.sha, !!ex.body)
}

// dump excerpts for gold
const excerpts = {
  callDesktop: capExcerpt(196618369, 0, 2500),
  callForward: capExcerpt(196619400, 0, 900),
  Ve: capExcerpt(185450781, 0, 2500),
  ghRetry: capExcerpt(185753620, 80, 900),
  ghSetup: capExcerpt(185755880, 80, 700),
  yGt: capExcerpt(182518308, 0, 700),
  oe: capExcerpt(209384187, 0, 380),
  yit: capExcerpt(185877803, 0, 900),
  XEn: capExcerpt(185879240, 0, 700),
  An: capExcerpt(204219850, 80, 500),
  Nt: capExcerpt(182396200, 80, 400),
  It: capExcerpt(199299300, 80, 400),
  footer: capExcerpt(180879480, 40, 280),
  fromAddr: capExcerpt(181642560, 40, 280),
}

for (const [k, v] of Object.entries(excerpts)) {
  console.log(`\nEXCERPT ${k} off=${v.off} sha=${v.sha} len=${v.len}`)
}

// more needles for #45
for (const n of [
  'Retry in a moment',
  'set up GitHub on',
  'Please set up GitHub',
  'preflight failed transiently',
  'checkGithubAppInstalled',
]) {
  const hits = allHits(buf, n)
  console.log(`45 ${JSON.stringify(n)} hits=${hits.length} ${hits.slice(0, 8)}`)
}

writeFileSync(
  join(__dir, '_peel-251-h-lock.json'),
  JSON.stringify(
    {
      callAt,
      callLen: callEx.len,
      callSha: callEx.sha,
      callBody: callEx.body ?? null,
      wT: { i: wT, len: wTEx.len, sha: wTEx.sha },
      excerpts,
    },
    null,
    2,
  ),
)
console.log('wrote lock json')
