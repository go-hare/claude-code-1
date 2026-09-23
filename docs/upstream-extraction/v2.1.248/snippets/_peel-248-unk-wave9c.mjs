/**
 * wave9 pass3 — extract #14 em/wm; leftover-shaped 247 wrap; #36 extra NFKC bodies
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-unk-wave9c.txt'
const lines = ['# gold-248-unk-wave9c', `when=${new Date().toISOString()}`, '']

function dumpFn(buf, label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    const other = buf === b248 ? b247 : b248
    const hit = other.indexOf(Buffer.from(ext.body))
    lines.push(`len=${ext.len} sha=${ext.sha} exactOther=${hit >= 0 ? hit : 0}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

function dumpNear(buf, label, i, b, a) {
  lines.push(`## ${label} @${i}`)
  lines.push(i < 0 ? 'MISS' : asciiSlice(buf, i - b, i + a))
  lines.push('')
}

// em definition near export{em,i9
const exp = b248.indexOf(Buffer.from('export{em,i9,SZ,wNt,ENt,kNt,$Ie,FIe,cGn}'))
dumpNear(b248, '#14 export', exp, 800, 80)

const emHits = allHits(b248, 'function em(')
lines.push(`function em( 248=${emHits.length} 247=${allHits(b247, 'function em(').length}`)
for (const i of emHits.slice(0, 12)) {
  dumpFn(b248, '#14 em', i, 800)
}

// em(wm( and em( calls near model
for (const n of ['em(wm(', 'function wm(', 'function em(e)', 'function em(t)', 'function em(n)']) {
  const a = allHits(b248, n)
  lines.push(`- ${n} 248=${a.length} 247=${allHits(b247, n).length}`)
  for (const i of a.slice(0, 4)) {
    dumpNear(b248, `#14 ${n}`, i, 60, 160)
    const st = lastFnStartGeneric(b248, i, 1500)
    if (st.i >= 0) dumpFn(b248, `#14 ${n}-fn ${st.name}`, st.i, 600)
  }
}

// 247 Set model to `
const s247 = allHits(b247, 'Set model to `')
lines.push(`247 Set model to \` hits=${s247.length}`)
for (const i of s247) dumpNear(b247, '#14 247 Set-model-backtick', i, 80, 160)

// 247 Kept model as / Current model with bold vs tick
for (const n of ['Kept model as `', 'Current model: `', 'Kept model as ', 'function cGn(']) {
  lines.push(`247 ${JSON.stringify(n)}=${allHits(b247, n).length}`)
}

// leftover chalk.bold vs 248 em
for (const n of ['chalk.bold', 'ae.bold', 'em(', 'i9+', '`${i9}`']) {
  lines.push(`count ${n} 248=${allHits(b248, n).length} 247=${allHits(b247, n).length}`)
}

// #36 extra NFKC bodies in mention-ish range
for (const [name, needle] of [
  ['Hjn', 'function Hjn('],
  ['lFe', 'function lFe('],
  ['jin', 'function jin('],
  ['dar', 'function dar('],
  ['g2t', 'function g2t('],
  ['y2t', 'function y2t('],
]) {
  const a = allHits(b248, needle)
  lines.push(`- ${name} 248=${a.length}`)
  if (a.length) dumpFn(b248, `#36 ${name}`, a[0], 2500)
}

// 248 NFKC @186196999 mention-adjacent
dumpNear(b248, '#36 NFKC-186M', 186196999, 200, 200)
const st = lastFnStartGeneric(b248, 186196999, 3000)
dumpFn(b248, `#36 NFKC-186M ${st.name}`, st.i, 2500)

// 248 NFKC @183705977 lFe
dumpFn(b248, '#36 lFe', b248.indexOf(Buffer.from('function lFe(')), 800)

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'lines', lines.length)
