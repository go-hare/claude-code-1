/**
 * densable 2.1.251 SEA peel — GAP #1/#3 MISSING CALLEES.
 * Invent-ban. Writes hit inventory only (stdout). Gold written by _peel-251-i-write.mjs.
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

const ANCHORS = {
  hdt: 186760884,
  ydt: 186762751,
  KSn: 185573233,
  Ewe: 185569345,
  X1e: 202991096,
  Dl: 208975936,
}

const MUST = [
  'Osn',
  'Lsn',
  'z_',
  '$sn',
  'Y_e',
  'vwe',
  'VSn',
  'gRn',
]
const GATES = ['dD', 'cre', 'hJ', 'pEt', 'LOe', 'Kle', 'Hye', 'yBn', 'yEt']
const GAP3 = ['HPe', 'jL', 'Jt']
const ALL = [...MUST, ...GATES, ...GAP3]

function extractGrow(i, caps = [4000, 12000, 40000, 120000, 400000]) {
  let last = { i, miss: true }
  for (const cap of caps) {
    last = extractFnAt(buf, i, cap)
    if (last.body) return last
  }
  return last
}

function pickNear(hits, sites, maxDist = 8_000_000) {
  let best = null
  for (const h of hits) {
    for (const s of sites) {
      const dist = Math.abs(h - s)
      if (dist > maxDist) continue
      if (!best || dist < best.dist) best = { h, s, dist }
    }
  }
  return best
}

function walkNameFromCall(callOff, name, lookbacks = [2000, 8000, 40000, 200000]) {
  for (const look of lookbacks) {
    const start = Math.max(0, callOff - look)
    const win = asciiSlice(buf, start, callOff)
    const re = new RegExp(
      `(?:async )?function\\*? ?${name.replace(/[$*]/g, '\\$&')}\\s*\\(`,
      'g',
    )
    let m
    let last = -1
    while ((m = re.exec(win))) last = m.index
    if (last >= 0) return start + last
  }
  return -1
}

function callHitsNear(name, sites, radius = 2500) {
  const needles = [`${name}(`, `${name}.of(`, `${name}?.`]
  const out = []
  for (const n of needles) {
    for (const h of allHits(buf, n)) {
      for (const s of sites) {
        if (Math.abs(h - s) <= radius) out.push({ h, n, s, dist: Math.abs(h - s) })
      }
    }
  }
  out.sort((a, b) => a.dist - b.dist)
  return out
}

console.log('SEA bytes', buf.length)

for (const name of ALL) {
  const needle = `function ${name}`
  const hits = allHits(buf, needle)
  const parenHits = allHits(buf, `function ${name}(`)
  const asyncHits = allHits(buf, `async function ${name}(`)
  console.log(
    `\n=== ${name} functionHits=${hits.length} paren=${parenHits.length} async=${asyncHits.length} first8=${hits.slice(0, 8).join(',')}`,
  )
  const sites =
    name === 'HPe' || name === 'jL' || name === 'Jt'
      ? [ANCHORS.Dl, ANCHORS.X1e]
      : name === '$sn' ||
          name === 'Y_e' ||
          name === 'vwe' ||
          name === 'VSn' ||
          name === 'gRn'
        ? [ANCHORS.KSn, ANCHORS.Ewe]
        : [ANCHORS.hdt, ANCHORS.ydt, ANCHORS.KSn]
  const near = pickNear(hits, sites)
  if (near) {
    console.log(
      `  nearestDef @${near.h} dist=${near.dist} site=${near.s} preview=${asciiSlice(buf, near.h, near.h + 80)}`,
    )
  }
  const calls = callHitsNear(name, sites)
  console.log(
    `  callNear (${calls.length}): ${calls
      .slice(0, 6)
      .map((c) => `${c.n}@${c.h}~${c.s} d=${c.dist}`)
      .join(' | ')}`,
  )
  if (calls[0]) {
    const walked = walkNameFromCall(calls[0].h, name)
    console.log(`  walkFromCall ${calls[0].h} -> ${walked}`)
  }
}

const spend = allHits(buf, 'Spend limit · shown once your gateway reports one')
const spendEsc = allHits(
  buf,
  'Spend limit \\xB7 shown once your gateway reports one',
)
const spendMid = allHits(buf, 'shown once your gateway reports one')
console.log(
  `\nSpend-limit empty-window string: exact=${spend.length} ${spend.join(',')} mid=${spendMid.length} ${spendMid.slice(0, 8).join(',')}`,
)

for (const [label, off] of Object.entries(ANCHORS)) {
  console.log(`anchor ${label} @${off}: ${asciiSlice(buf, off, off + 60)}`)
}
