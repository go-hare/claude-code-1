/**
 * densable 2.1.251 — Xxt (z_ callee), Ln, gEt, hook-store Jt, DOe, W6n, nVn.
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

function extractClass(off, maxLen = 8000) {
  const win = asciiSlice(buf, off, off + maxLen)
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
        return { i: off, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { missEnd: true, preview: win.slice(0, 240) }
}

function dumpFn(label, i) {
  const fn = extractGrow(i)
  console.log(
    `\n## ${label} @${i} miss=${!!fn.miss}${fn.missEnd ? ' missEnd' : ''} len=${fn.len ?? '-'} sha=${fn.sha ?? '-'}`,
  )
  console.log('HEAD', asciiSlice(buf, Math.max(0, i - 30), i + 50))
  if (fn.body) {
    console.log('FULL')
    console.log(fn.body)
  } else console.log('PREVIEW', fn.preview)
  return fn
}

console.log('--- Xxt / W6n / xo / dm / DOe / nVn ---')
for (const n of [
  'async function*Xxt',
  'function*Xxt',
  'function Xxt',
  'async function Xxt',
  'var W6n=',
  'W6n=new Set',
  'function xo(',
  'function xo()',
  'async function dm',
  'function dm(',
  'function DOe',
  'function nVn',
  'function se(',
]) {
  const hs = allHits(buf, n)
  console.log(`${JSON.stringify(n)} hits=${hs.length} ${hs.slice(0, 8).join(',')}`)
}

const xxtHits = [
  ...allHits(buf, 'async function*Xxt'),
  ...allHits(buf, 'function*Xxt'),
  ...allHits(buf, 'function Xxt('),
  ...allHits(buf, 'async function Xxt('),
]
console.log('Xxt starts', xxtHits)
for (const h of xxtHits) dumpFn('Xxt', h)

for (const h of allHits(buf, 'var W6n=')) {
  console.log('W6n @', h, asciiSlice(buf, h, h + 400))
}
for (const h of allHits(buf, 'W6n=new Set')) {
  console.log('W6n=new @', h, asciiSlice(buf, h - 20, h + 400))
}

const ln = extractClass(179027862)
console.log('\n## class Ln @179027862', ln.len, ln.sha)
console.log(ln.body || ln.preview)

const get = extractClass(186762671)
console.log('\n## class gEt @186762671', get.len, get.sha)
console.log(get.body || get.preview)

dumpFn('nVn', 186758371)
dumpFn('se-hookinit', 181784689)
dumpFn('Jt-registry', 181786426)

for (const h of allHits(buf, 'function DOe(')) dumpFn('DOe', h)
for (const h of allHits(buf, 'function xo()')) dumpFn('xo', h)
for (const h of allHits(buf, 'async function dm(')) dumpFn('dm', h)
for (const h of allHits(buf, 'function dm(')) dumpFn('dm-sync', h)

// Jt used by Osn — search function Jt() that returns something with hookRegistration
console.log('\n--- Jt() no-arg near hook cluster ---')
for (const h of allHits(buf, 'function Jt()')) {
  const fn = extractGrow(h)
  console.log(
    `Jt() @${h} len=${fn.len} ${fn.body?.slice(0, 160)}`,
  )
}

// ae() store that se initializes
console.log('\nse neighborhood:')
console.log(asciiSlice(buf, 181784650, 181786500))
