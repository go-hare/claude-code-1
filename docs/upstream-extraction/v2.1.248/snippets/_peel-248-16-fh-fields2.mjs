import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStart,
} from './_peel-248-na-helpers.mjs'

const outGold =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-fh-fields2.txt'
const b = loadSea(EXE_248)
const lines = [
  '# gold-248-16-fh-fields2',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpFn(label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  const ext = extractFnAt(b, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
}

function dumpWin(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(b, i - before, i + after))
  lines.push('')
}

const FLEET_LO = 192125206
const FLEET_AC = 192126408
const FLEET_IR = 192126376
const FLEET_JI = 192125844
const FLEET_ZU = 192120270
const FLEET_ZC = 192171330
const FLEET_IH = 192123625
const FLEET_XU = 192121946
const FLEET_NC = 192123510
const FLEET_LI = 192124642
const FLEET_CF = 182998017

dumpFn('lo fleet', FLEET_LO, 800)
dumpFn('ac fleet', FLEET_AC, 400)
dumpFn('Ir fleet', FLEET_IR, 200)
dumpFn('Ji fleet', FLEET_JI, 800)
dumpFn('zu fleet', FLEET_ZU, 800)
dumpFn('zc fleet', FLEET_ZC, 800)
dumpFn('Ih fleet', FLEET_IH, 800)
dumpFn('Xu fleet', FLEET_XU, 200)
dumpFn('nc fleet', FLEET_NC, 200)
dumpFn('Li fleet', FLEET_LI, 200)
dumpFn('Cf job-state', FLEET_CF, 200)

// hn used in load() — search near fleet
const hnHits = allHits(b, 'function hn(')
const hnNear = hnHits.filter(h => h > 192110000 && h < 192180000)
lines.push(`## hn near fleet ${hnNear.join(',')}`)
for (const h of hnNear.slice(0, 3)) dumpFn('hn fleet', h, 400)
if (hnNear.length === 0) {
  // load uses hn(V?w.map...)
  const use = allHits(b, 'K=hn(V?w.map')
  lines.push(`## hn use ${use.join(',')}`)
  if (use[0]) {
    const start = lastFnStart(b, use[0], ['function hn('])
    dumpFn('hn via use', start.i, 400)
  }
}

// Ss caller — logTail: nf / deleteRefusals
const ssCall = allHits(b, 'logTail:')
for (const h of ssCall) {
  if (h > 192200000 && h < 192220000) dumpWin('Ss caller logTail', h, 400, 500)
}

// overlaidLoadLanded de usage after Ze
dumpWin('overlaid de after Ze', 192267120, 20, 2500)

// _c remoteListLoaded
const cHits = allHits(b, 'function _c(')
const cNear = cHits.filter(h => h > 192140000 && h < 192160000)
lines.push(`## function _c( near ${cNear.join(',')}`)
for (const h of cNear.slice(0, 2)) dumpFn('_c', h, 1200)
const cUse = allHits(b, '_c(Ne,Q,{jobs')
lines.push(`## _c use ${cUse.join(',')}`)
if (cUse[0]) {
  const start = lastFnStart(b, cUse[0], ['function _c('])
  dumpFn('_c via use', start.i, 1500)
}

// cp noteDeleteRefusal
const cpUse = allHits(b, 'Q.noteDeleteRefusal')
lines.push(`## cp noteDeleteRefusal ${cpUse.join(',')}`)
for (const h of cpUse) dumpWin('cp use', h, 80, 200)
const cpHits = allHits(b, 'function cp(')
const cpNear = cpHits.filter(h => h > 192180000 && h < 192200000)
lines.push(`## function cp( near ${cpNear.join(',')}`)
for (const h of cpNear.slice(0, 3)) dumpFn('cp', h, 2000)

// how logTails nf / deleteRefusals Tl get to Ss
const nfHits = allHits(b, 'logTails:nf')
lines.push(`## logTails:nf ${nfHits.join(',')}`)
const nfUse = allHits(b, 'nf[')
// search logTail:nf or nf? or nf.
for (const needle of ['logTail:nf', 'logTail:nf.', 'nf[ht', 'Tl.get', 'deleteRefusals:Tl']) {
  const hits = allHits(b, needle)
  lines.push(`## needle ${needle} ${hits.filter(h => h > 192190000 && h < 192280000).join(',')}`)
}

// search Ss props assembly
const wrHits = allHits(b, 'heldInTerminal:Wr')
for (const h of wrHits) {
  if (h > 192210000 && h < 192220000) dumpWin('Ss props', h, 800, 200)
}

// loopKickCount assembly
const slHits = allHits(b, 'loopKickCount:')
for (const h of slHits) {
  if (h > 192210000 && h < 192220000) dumpWin('loopKickCount caller', h, 200, 80)
}

writeFileSync(outGold, lines.join('\n'))
console.log('wrote', outGold, lines.length)
