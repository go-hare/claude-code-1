/**
 * 248 #20 — extract b1t / P0n / mGe next to deleteJob unpushed gate.
 */
import { existsSync, writeFileSync } from 'fs'
import {
  EXE_247,
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
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null

const lines = [
  '# gold-248-20-b1t',
  `when=${new Date().toISOString()}`,
  `bytes248=${b248.length} bytes247=${b247 ? b247.length : 'ABSENT'}`,
  '',
]

function dumpAround(label, buf, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(label, buf, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(buf, label, needle, around = 160, cap = 8) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(buf, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

// --- unique idents ---
for (const n of [
  'primaryCheckoutVouches',
  'function b1t(',
  'async function b1t(',
  'function P0n(',
  'async function P0n(',
  'function mGe(',
  'async function mGe(',
  'P0n(',
]) {
  dumpHits(b248, `#20-248 ${n}`, n, 120, 10)
}

const b1t = b248.indexOf(Buffer.from('async function b1t('))
dumpFn('#20-248 b1t', b248, b1t, 4000)
dumpAround('#20-248 b1t-win', b248, b1t, 200, 2500)

const p0n = b248.indexOf(Buffer.from('async function P0n('))
const p0n2 = b248.indexOf(Buffer.from('function P0n('))
dumpFn('#20-248 async P0n', b248, p0n, 4000)
dumpFn('#20-248 P0n', b248, p0n2, 4000)
dumpAround('#20-248 P0n-win', b248, p0n >= 0 ? p0n : p0n2, 200, 2500)

const mGe = b248.indexOf(Buffer.from('async function mGe('))
dumpFn('#20-248 mGe', b248, mGe, 2000)
dumpAround('#20-248 mGe-win', b248, mGe, 80, 1500)

// callers of b1t / P0n
dumpHits(b248, '#20-248 await b1t(', 'await b1t(', 80, 10)
dumpHits(b248, '#20-248 await P0n(', 'await P0n(', 80, 10)

// 247 counterparts
if (b247) {
  lines.push('## #20 247 counterpart hit counts')
  for (const n of [
    'primaryCheckoutVouches',
    'async function b1t(',
    'async function P0n(',
    'function P0n(',
    'async function mGe(',
    'HEAD","--not","--remotes"',
  ]) {
    lines.push(`- ${JSON.stringify(n)} 247=${allHits(b247, n).length} 248=${allHits(b248, n).length}`)
  }
  lines.push('')

  const b1t247 = b247.indexOf(Buffer.from('async function b1t('))
  dumpFn('#20-247 b1t', b247, b1t247, 4000)
  dumpAround('#20-247 b1t-win', b247, b1t247, 80, 800)

  // 247 UMs-like near HEAD --not --remotes
  const ums247 = b247.indexOf(Buffer.from('"HEAD","--not","--remotes"'))
  dumpAround('#20-247 HEAD-not-remotes', b247, ums247, 400, 1200)
  if (ums247 >= 0) {
    const { i, name } = lastFnStartGeneric(b247, ums247, 4000)
    dumpFn(`#20-247 covering ${name}`, b247, i, 4000)
  }

  const vouch247 = b247.indexOf(Buffer.from('primaryCheckoutVouches'))
  dumpAround('#20-247 primaryCheckoutVouches', b247, vouch247, 200, 800)
  if (vouch247 >= 0) {
    const { i, name } = lastFnStartGeneric(b247, vouch247, 4000)
    dumpFn(`#20-247 vouch covering ${name}`, b247, i, 4000)
  }

  const oG247 = b247.indexOf(
    Buffer.from('has commits that are on no remote, kept'),
  )
  dumpAround('#20-247 on-no-remote js', b247, oG247, 200, 400)
  if (oG247 >= 0) {
    const { i, name } = lastFnStartGeneric(b247, oG247, 8000)
    dumpFn(`#20-247 delete-unpushed ${name}`, b247, i, 8000)
  }
}

// Nearby helpers after mGe / before b1t
{
  const start = mGe > 0 ? mGe : b1t
  const win = asciiSlice(b248, start, start + 4000)
  lines.push('## #20 helpers around mGe/b1t')
  const re = /(?:async )?function ([A-Za-z_$][\w$]*)\(/g
  let m
  while ((m = re.exec(win))) {
    lines.push(`- ${m[1]} @${start + m.index}`)
  }
  lines.push('')
}

writeFileSync(`${outDir}/gold-248-20-b1t.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-20-b1t.txt`, 'lines', lines.length)
