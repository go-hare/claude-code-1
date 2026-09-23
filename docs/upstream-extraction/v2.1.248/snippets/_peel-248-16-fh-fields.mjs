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

const outGold = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-fh-fields.txt'
const b = loadSea(EXE_248)
const lines = [
  '# gold-248-16-fh-fields',
  `exe=${EXE_248}`,
  `bytes=${b.length}`,
  `when=${new Date().toISOString()}`,
  '',
  'Official Fh leftover-missing fields: how gc.load / #O / #P / rp / Ss use them.',
  '',
]

function dumpFn(label, i, maxLen = 8000) {
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
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  lines.push(asciiSlice(b, i - before, i + after))
  lines.push('')
}

function firstJsHit(needle, preferNear) {
  const hits = allHits(b, needle)
  if (hits.length === 0) return -1
  if (preferNear != null) {
    let best = hits[0]
    let bestD = Math.abs(best - preferNear)
    for (const h of hits) {
      const d = Math.abs(h - preferNear)
      if (d < bestD) {
        best = h
        bestD = d
      }
    }
    return best
  }
  return hits[0]
}

const FLEET = 192130000

for (const name of [
  'function lo(',
  'function ac(',
  'function Ir(',
  'function Ji(',
  'function $ye(',
  'function sS(',
  'function zu(',
  'function hn(',
  'function zc(',
  'function Cf(',
  'function Ih(',
  'async function ic(',
  'async function Fi(',
  'async function ec(',
  'function Xu(',
  'function nc(',
  'function Li(',
]) {
  const hits = allHits(b, name)
  const near = hits.filter(h => h > 182000000 && h < 193000000)
  lines.push(`## hits ${name}`)
  lines.push(`all=${hits.length} nearFleet=${near.slice(0, 8).join(',')}`)
  const pick = near[0] ?? hits[0] ?? -1
  if (pick >= 0) dumpFn(name, pick, name.includes('ec(') ? 4000 : 2500)
}

// noteDeleteRefusal call sites
const noteHits = allHits(b, 'noteDeleteRefusal')
lines.push(`## noteDeleteRefusal hits=${noteHits.length}`)
for (const h of noteHits.slice(0, 8)) {
  dumpWin(`noteDeleteRefusal`, h, 80, 220)
}

const refuseHits = allHits(b, 'deleteRefusals')
lines.push(`## deleteRefusals hits=${refuseHits.length} offs=${refuseHits.slice(0, 12).join(',')}`)
for (const h of refuseHits.slice(0, 8)) {
  dumpWin(`deleteRefusals`, h, 60, 240)
}

const overHits = allHits(b, 'overlaidLoadLanded')
lines.push(`## overlaidLoadLanded hits=${overHits.length} offs=${overHits.join(',')}`)
for (const h of overHits.slice(0, 8)) {
  dumpWin(`overlaidLoadLanded`, h, 80, 280)
}

const logHits = allHits(b, 'logTails')
lines.push(`## logTails hits=${logHits.length} offs=${logHits.slice(0, 16).join(',')}`)
for (const h of logHits.slice(0, 10)) {
  dumpWin(`logTails`, h, 40, 200)
}

const kickHits = allHits(b, 'loopKicks')
lines.push(`## loopKicks hits=${kickHits.length} offs=${kickHits.slice(0, 16).join(',')}`)
for (const h of kickHits.slice(0, 10)) {
  dumpWin(`loopKicks`, h, 40, 200)
}

const pendHits = allHits(b, 'updatePendings')
lines.push(`## updatePendings hits=${pendHits.length}`)
for (const h of pendHits.slice(0, 8)) {
  dumpWin(`updatePendings`, h, 40, 180)
}

const liveHits = allHits(b, 'liveStatus(')
lines.push(`## liveStatus( hits=${liveHits.length}`)
for (const h of liveHits.slice(0, 6)) {
  dumpWin(`liveStatus(`, h, 20, 200)
}

// Ss call site: logTail / deleteRefused / loopKickCount
for (const needle of [
  'logTail:',
  'deleteRefused:',
  'loopKickCount:',
  'not deleted',
  'remoteListLoaded',
  'adoptedPeers',
]) {
  const hits = allHits(b, needle)
  const near = hits.filter(h => h > 192000000 && h < 192400000)
  lines.push(`## needle ${JSON.stringify(needle)} all=${hits.length} fleet=${near.join(',')}`)
  const pick = near[0] ?? hits.find(h => h > 190000000) ?? hits[0]
  if (pick != null) dumpWin(needle, pick, 80, 320)
}

// statuses map fill in #O
const stHits = allHits(b, '#p("statuses"')
lines.push(`## #p("statuses" hits=${stHits.length}`)
for (const h of stHits) dumpWin('#p statuses', h, 40, 200)

writeFileSync(outGold, lines.join('\n'))
console.log('wrote', outGold, 'lines', lines.length)
