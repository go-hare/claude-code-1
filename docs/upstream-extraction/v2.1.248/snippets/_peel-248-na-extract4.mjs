/**
 * Pass 5 — Ke backup suffix, A$ TTL, pXt skill string, #41 304 skip, #33 f-map.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const lines = ['# gold-248-na-extract4', '']

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
}

// #30 Ke / Xn
dumpAround(
  '#30 Ke-before-Xn',
  b248.indexOf(Buffer.from('Xn=new RegExp(`(?:${Ke})$`,"i")')),
  400,
  80,
)
const keHits = allHits(b248, 'var Ke=')
lines.push(`## var Ke= hits=${keHits.length}`)
for (const i of keHits.slice(0, 8)) {
  const win = asciiSlice(b248, i, i + 180)
  if (win.includes('swp') || win.includes('tmp') || win.includes('bak') || win.includes('swo')) {
    lines.push(`- @${i} ${win}`)
  }
}
lines.push('')
dumpAround(
  '#30 Xn-Ke-assign',
  b248.indexOf(Buffer.from(',Xn=new RegExp(`(?:${Ke})$`,"i")')),
  80,
  20,
)

// look for Ke= near seed module
const seedKe = b248.lastIndexOf(
  Buffer.from('Ke='),
  b248.indexOf(Buffer.from('Xn=new RegExp(`(?:${Ke})$`,"i")')),
)
dumpAround('#30 last-Ke-before-Xn', seedKe, 20, 200)

// #33 f-map
dumpAround(
  '#33 f-map',
  b248.indexOf(Buffer.from('var f=new Map([["verbose",()=>!0]')),
  20,
  900,
)
dumpFn(
  '#33 y-startRemoteControl',
  b248.indexOf(Buffer.from('async function y(t,e,r,n){let[{preflightTrustedDeviceBlocking:o}')),
  2500,
)
dumpFn(
  '#33 R-enter',
  b248.indexOf(Buffer.from('async function R(t,e,r){let n=await m()')),
  400,
)

// #40 pXt string
const pxt = b248.indexOf(Buffer.from('pXt=`# Workflow authoring reference'))
dumpAround('#40 pXt-head', pxt, 20, 400)
if (pxt >= 0) {
  const win = asciiSlice(b248, pxt, pxt + 20000)
  const end = win.indexOf('`;')
  lines.push(`## #40 pXt-string endRel=${end}`)
  if (end > 0) {
    const body = win.slice(0, end + 2)
    lines.push(`len=${body.length} sha=${sha(body)}`)
    if (body.length <= 6000) lines.push(body)
    else {
      lines.push(body.slice(0, 1200))
      lines.push('…')
      lines.push(body.slice(-400))
    }
  }
  lines.push('')
}

// #41 A$ TTL
dumpFn(
  '#41 A$-ttl',
  b248.indexOf(Buffer.from('function A$(i,u=300000,l){let o=(c)=>typeof u==="function"?u(c):u')),
  2500,
)
dumpAround(
  '#41 304-skip-win',
  b248.indexOf(Buffer.from('Te.status===304);else if(Te.ok)')),
  200,
  600,
)
const bump = b248.indexOf(Buffer.from('this.pollerNotModifiedStreak'))
dumpAround('#41 streak-uses', bump, 40, 80)
const streakHits = allHits(b248, 'pollerNotModifiedStreak')
lines.push('## pollerNotModifiedStreak js')
for (const i of streakHits) {
  if (i > 184000000 && i < 204000000) {
    lines.push(`- @${i} ${asciiSlice(b248, i - 60, i + 140)}`)
  }
}
lines.push('')

// #43 be/TUn access probe
function dumpHits(label, needle) {
  const hits = allHits(b248, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, 5).entries()) {
    lines.push(`- #${idx} @${i} ${asciiSlice(b248, i - 70, i + needle.length + 90)}`)
  }
  lines.push('')
  return hits
}
dumpHits('#43 TUn', 'function TUn')
dumpHits('#43 linkedAccountAccess', 'linkedAccountAccess')
const beCall = b248.indexOf(Buffer.from('be(u.owner,u.name,d?.accessProbeBudgetMs'))
const beFn = lastFnStartGeneric(b248, beCall, 100)
lines.push(`## #43 be-call @${beCall} lastFn=${beFn.name}@${beFn.i}`)
dumpAround('#43 be-call', beCall, 80, 80)

writeFileSync(`${outDir}/gold-248-na-extract4.txt`, lines.join('\n'))
console.log(
  'WROTE',
  `${outDir}/gold-248-na-extract4.txt`,
  'chars',
  lines.join('\n').length,
)
