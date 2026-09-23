/**
 * densable 2.1.251 SEA peel — GAP #1/#3 callee bodies (pass 2).
 * Strict `function NAME(` / assignment / .of lookups. Invent-ban.
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

function extractGrow(i, caps = [2000, 8000, 20000, 60000, 200000, 600000]) {
  let last = { i, miss: true }
  for (const cap of caps) {
    last = extractFnAt(buf, i, cap)
    if (last.body) return { ...last, cap }
  }
  return last
}

function dumpFn(label, i, previewLen = 220) {
  if (i < 0) {
    console.log(`\n## ${label} MISS i=-1`)
    return null
  }
  const head = asciiSlice(buf, Math.max(0, i - 20), i + 80)
  const fn = extractGrow(i)
  console.log(
    `\n## ${label} @${i} miss=${!!fn.miss} missEnd=${!!fn.missEnd} len=${fn.len ?? '-'} sha=${fn.sha ?? '-'} cap=${fn.cap ?? '-'}`,
  )
  console.log(`HEAD ${head}`)
  if (fn.body) {
    console.log(`BODY_START ${fn.body.slice(0, previewLen)}`)
    console.log(`BODY_END ${fn.body.slice(-180)}`)
  } else {
    console.log(`PREVIEW ${fn.preview ?? asciiSlice(buf, i, i + 280)}`)
  }
  return fn
}

function hitsExactFn(name) {
  const out = []
  for (const prefix of ['function ', 'async function ', 'function* ']) {
    const n = `${prefix}${name}(`
    for (const h of allHits(buf, n)) out.push({ h, prefix: prefix.trim() })
  }
  return out
}

console.log('--- exact function NAME( ---')
const names = [
  'Osn',
  'Lsn',
  'z_',
  '$sn',
  'Y_e',
  'vwe',
  'VSn',
  'gRn',
  'dD',
  'cre',
  'hJ',
  'pEt',
  'LOe',
  'Hye',
  'yBn',
  'HPe',
  'jL',
  'Jt',
]
for (const name of names) {
  const hs = hitsExactFn(name)
  console.log(
    `${name}: ${hs.length} ${hs.map((x) => `${x.prefix}@${x.h}`).join(' | ')}`,
  )
}

console.log('\n--- Kle / yEt / Hye / HPe / jL assignments ---')
for (const n of [
  'Kle=',
  'var Kle=',
  'let Kle=',
  'class Kle',
  'Kle.of=',
  'yEt=',
  'var yEt=',
  'let yEt=',
  'class yEt',
  'yEt.of=',
  'Hye=',
  'var Hye=',
  'let Hye=',
  'HPe=',
  'var HPe=',
  'jL=',
  'var jL=',
]) {
  const hs = allHits(buf, n)
  console.log(
    `${JSON.stringify(n)} hits=${hs.length} first=${hs.slice(0, 8).join(',')}`,
  )
}

// Hye used as timeoutMs??Hye — search that pattern
for (const n of ['timeoutMs??Hye', 'timeoutMs:r.timeoutMs??Hye', ',Hye=', 'Hye=']) {
  const hs = allHits(buf, n)
  console.log(`pat ${JSON.stringify(n)} hits=${hs.length} ${hs.slice(0, 6).join(',')}`)
}

// HPe window around def and around Spend-limit mid-dot
console.log('\n--- HPe / spend string windows ---')
const hpeHits = hitsExactFn('HPe')
for (const x of hpeHits) dumpFn('HPe', x.h)
for (const off of allHits(buf, 'shown once your gateway reports one')) {
  console.log(`spendMid @${off}: ${asciiSlice(buf, off - 80, off + 80)}`)
}

// extract unique / known-good defs
const EXTRACT = [
  ['Osn', 186758304],
  ['Lsn-async-maybe', 186757898],
  ['Lsn', 186757904],
  ['$sn', 185574156],
  ['Y_e-185568683', 185568683],
  ['Y_e-203470577', 203470577],
  ['vwe-183444010', 183444010],
  ['vwe-185568973', 185568973],
  ['VSn', 185573811],
  ['gRn', 179049328],
  ['dD-186760799', 186760799],
  ['pEt', 179887321],
  ['LOe', 180780907],
  ['yBn', 186764691],
  ['Hye-fn', 194737254],
  ['Jt-bar', 208972948],
]

console.log('\n--- extract known offsets ---')
for (const [label, i] of EXTRACT) dumpFn(label, i, 300)

console.log('\n--- extract ALL exact paren hits for collisions ---')
for (const name of ['z_', 'hJ', 'jL', 'cre', 'dD', 'Y_e', 'vwe', 'Jt']) {
  for (const x of hitsExactFn(name)) {
    dumpFn(`${name} ${x.prefix}`, x.h, 240)
  }
}
