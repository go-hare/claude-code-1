/**
 * Pass 4 — remaining unique leftover bodies only.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const lines = ['# gold-248-na-extract3', '']

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(label, needle, around = 90, cap = 6) {
  const hits = allHits(b248, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [idx, off] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${off} ${asciiSlice(b248, off - around, off + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

// #30 Xn regex + zn + Yn
dumpAround('#30 Xn-ke-zn', b248.indexOf(Buffer.from('ke=".env",Vn=".claude.json"')), 200, 400)
dumpHits('#30 zn.test', 'zn.test')
dumpHits('#30 var zn', 'var zn=')
dumpHits('#30 var Yn', 'var Yn=')

// #33 C / b / R
dumpHits('#33 function C supplied', 'function C(')
const exportAt = b248.indexOf(Buffer.from('C as rootOptionsRemoteControlRefuses'))
dumpAround('#33 export-table', exportAt, 2500, 200)

// walk back for function C / function b / async function R
for (const name of [
  'function C(',
  'function b(',
  'function R(',
  'async function R(',
  'function y(',
]) {
  const loc = lastFnStartGeneric(b248, exportAt, 4000)
  lines.push(`## probe lastFn ${name} generic=${loc.name}@${loc.i}`)
}
const cHit = (() => {
  let best = -1
  const n = Buffer.from('function C(')
  let i = exportAt - 8000
  while (i < exportAt) {
    const k = b248.indexOf(n, i)
    if (k < 0 || k >= exportAt) break
    best = k
    i = k + n.length
  }
  return best
})()
dumpFn('#33 C-last-before-export', cHit, 2500)
dumpAround('#33 C-win', cHit, 40, 800)

const bHit = (() => {
  let best = -1
  const n = Buffer.from('function b(')
  let i = exportAt - 8000
  while (i < exportAt) {
    const k = b248.indexOf(n, i)
    if (k < 0 || k >= exportAt) break
    best = k
    i = k + n.length
  }
  return best
})()
dumpFn('#33 b-suppliedRootOptions', bHit, 2000)

const rHit = (() => {
  let best = -1
  for (const s of ['async function R(', 'function R(']) {
    const n = Buffer.from(s)
    let i = exportAt - 8000
    while (i < exportAt) {
      const k = b248.indexOf(n, i)
      if (k < 0 || k >= exportAt) break
      if (k > best) best = k
      i = k + n.length
    }
  }
  return best
})()
dumpFn('#33 R-enterRemoteControl', rHit, 4000)

// #40 pXt + Fmr
dumpHits('#40 pXt', 'pXt')
dumpHits('#40 var pXt', 'var pXt=')
dumpHits('#40 pXt=', 'pXt=')
const fmr = b248.indexOf(Buffer.from('function Fmr(){Wr({name:$w'))
dumpFn('#40 Fmr', fmr, 2500)
dumpAround('#40 Fmr-win', fmr, 200, 1500)
dumpAround('#40 pXt-import', b248.indexOf(Buffer.from('function gTt(){return[{type:"text",text:pXt}]}')), 400, 80)

// #41 A$ TTL + not-modified
dumpHits('#41 function A$', 'function A$')
const aDollar = b248.indexOf(Buffer.from('prStatusByUrl=A$(_Jt,30000)'))
const aDef = lastFnStartGeneric(b248, aDollar, 2000)
dumpFn('#41 A$-near', aDef.i, 1500)
dumpAround('#41 poller-class-head', b248.indexOf(Buffer.from('class dXe{')), 20, 900)
dumpAround('#41 notModified-use', b248.indexOf(Buffer.from('pollerNotModifiedStreak=0,this.#e.emit()')), 80, 1200)
dumpHits('#41 pollerNotModifiedStreak++', 'pollerNotModifiedStreak++')
dumpHits('#41 Not Modified', 'Not Modified')
dumpHits('#41 not_modified', 'not_modified')
dumpHits('#41 304 skip', '===304')
dumpHits('#41 status===304', 'status===304')

// #43 bxt slice around github probe only
const probe = b248.indexOf(
  Buffer.from('tengu_review_remote_github_access_probe'),
  193000000,
)
dumpAround('#43 probe-in-bxt', probe, 600, 1600)
dumpFn('#43 k-verdict', b248.indexOf(Buffer.from('function k(e,t){if(e!==401&&e!==404)')), 800)
dumpHits('#43 oae', 'function oae')
const oae = b248.indexOf(Buffer.from('async function oae('))
dumpFn('#43 oae', oae, 4000)

// #46 loop register — always self-pace?
dumpAround(
  '#46 loop-register',
  b248.indexOf(
    Buffer.from(
      'Omit the interval to let the model self-pace.",whenToUse:',
    ),
  ),
  400,
  800,
)
dumpHits('#46 isEnabled loop', 'isEnabled:()=>xu()')
dumpHits('#46 xu loop', 'function xu')

writeFileSync(`${outDir}/gold-248-na-extract3.txt`, lines.join('\n'))
console.log(
  'WROTE',
  `${outDir}/gold-248-na-extract3.txt`,
  'chars',
  lines.join('\n').length,
)
