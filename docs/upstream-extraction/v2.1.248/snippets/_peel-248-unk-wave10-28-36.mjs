/**
 * densable 2.1.248 wave10 — #28 trust-emoji-trunc + #36 mention-ime
 * Unique body + leftover host only. Invent-ban.
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

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)

const lines = [
  '# gold-248-unk-wave10-28-36',
  `when=${new Date().toISOString()}`,
  `sea248=${EXE_248} bytes=${b248.length}`,
  `sea247=${EXE_247} bytes=${b247.length}`,
  'items=#28 #36',
  'rule=unique 248 body AND leftover host, else stay UNKNOWN',
  '',
]

function cnt(buf, n) {
  return allHits(buf, n).length
}

function only248(n) {
  const a = cnt(b248, n)
  const b = cnt(b247, n)
  return { a, b, uniq: a > 0 && b === 0 }
}

function dumpHits(label, needle, around = 140, cap = 8, minOff = 0) {
  const hits = allHits(b248, needle).filter(i => i >= minOff)
  const c247 = cnt(b247, needle)
  lines.push(
    `## ${label}  needle=${JSON.stringify(needle)}  248=${hits.length} 247=${c247}${c247 === 0 && hits.length ? '  **NEW248**' : ''}`,
  )
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b248, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpHits247(label, needle, around = 140, cap = 6, minOff = 0) {
  const hits = allHits(b247, needle).filter(i => i >= minOff)
  lines.push(
    `## 247 ${label}  needle=${JSON.stringify(needle)}  247=${hits.length}`,
  )
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b247, i - around, i + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

function dumpFn(buf, label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return { miss: true }
  }
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    const other = buf === b248 ? b247 : b248
    const inOther = other.indexOf(Buffer.from(ext.body))
    lines.push(
      `len=${ext.len} sha=${ext.sha} exactOther=${inOther >= 0 ? inOther : 0}`,
    )
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
  return ext
}

function dumpNear(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function extractNear(buf, label, i, maxLook = 8000, maxLen = 8000) {
  const start = lastFnStartGeneric(buf, i, maxLook)
  lines.push(`## ${label} near@${i} fn=${start.name} @${start.i}`)
  return dumpFn(buf, `${label} ${start.name}`, start.i, maxLen)
}

// ============================================================================
// #28 trust-emoji-trunc
// ============================================================================
lines.push('# ==== #28 trust-emoji-trunc ====')

for (const n of [
  'This folder pre-approves',
  'This directory pre-approves',
  'rule names contain unprintable',
  'directory names contain unprintable',
  '<unprintable entry>',
  'unprintable entry',
  'hasProjectAllowRules',
  '$_(_.rules',
  'cTe()',
  'uTe()',
  'slice(0,200)',
  'slice(0, 200)',
  '.slice(0,200)+"\\u2026"',
  '.slice(0,200)+"…"',
  'function cTe(',
  'function uTe(',
  'MAX_DISCLOSURE',
]) {
  const { a, b, uniq } = only248(n)
  lines.push(`- count ${JSON.stringify(n)} 248=${a} 247=${b}${uniq ? ' **NEW248**' : ''}`)
}
lines.push('')

// Official leftover-shaped naive slice (cdDisclosures)
dumpHits('#28 leftover-slice-shape', 'slice(0,200)', 80, 12, 170000000)
dumpHits('#28 leftover-slice-shape-sp', 'slice(0, 200)', 80, 8, 170000000)
dumpHits('#28 unprintable-entry', '<unprintable entry>', 120, 6)
dumpHits('#28 unprintable-entry-bare', 'unprintable entry', 120, 6)
dumpHits247('#28 unprintable-entry', '<unprintable entry>', 120, 6)
dumpHits247('#28 leftover-slice-shape', 'slice(0,200)', 80, 8, 170000000)

// folder / directory pre-approves windows
for (const n of [
  'This folder pre-approves',
  'This directory pre-approves',
  'rule names contain unprintable',
]) {
  for (const i of allHits(b248, n).filter(x => x > 170000000).slice(0, 3)) {
    dumpNear(b248, `#28 248 ${n}`, i, 200, 400)
    extractNear(b248, `#28 248 ${n}-fn`, i, 12000, 9000)
  }
  for (const i of allHits(b247, n).filter(x => x > 170000000).slice(0, 3)) {
    dumpNear(b247, `#28 247 ${n}`, i, 200, 400)
    extractNear(b247, `#28 247 ${n}-fn`, i, 12000, 9000)
  }
}

// cTe / uTe — rule builders
for (const n of ['function cTe(', 'function uTe(']) {
  for (const i of allHits(b248, n).slice(0, 4)) dumpFn(b248, `#28 ${n}`, i, 6000)
}

// $_.rules / dirs join site — look for R( / slice / segment on each rule
dumpHits('#28 rules-join', '$_(_.rules', 200, 3)
dumpHits('#28 dirs-join', '$_(T.dirs', 200, 3)
dumpHits247('#28 .rules,8', '.rules,8', 160, 6)
dumpHits247('#28 .rules', 'rules,8', 120, 8, 200000000)

// Does Go / cTe call grapheme R / Xi / toWellFormed / sliceGraphemes?
const goHits = allHits(b248, 'function Go(').filter(i => {
  const win = asciiSlice(b248, i, i + 200)
  return win.includes('tengu_trust') || win.includes('onDone')
})
lines.push(`## #28 Go-trust-cands ${goHits.join(',')}`)
for (const i of goHits.slice(0, 2)) {
  const ext = dumpFn(b248, '#28 Go', i, 12000)
  if (ext.body) {
    for (const needle of [
      'slice(',
      'Segmenter',
      'grapheme',
      'toWellFormed',
      'Xi()',
      'R(',
      'W(',
      '_.rules',
      'cTe',
      'uTe',
    ]) {
      lines.push(`- Go has ${JSON.stringify(needle)}: ${ext.body.includes(needle)}`)
    }
  }
}

// Find 247 TrustDialog Cr body needles
const cr247 = allHits(b247, 'tengu_trust_dialog_shown').filter(x => x > 200000000)
for (const i of cr247.slice(0, 2)) {
  extractNear(b247, '#28 247 trust-shown', i, 20000, 12000)
}

// Search unique 248 truncate wrappers near 200 + ellipsis
for (const n of [
  'R(e,200)',
  'R(t,200)',
  'R(e, 200)',
  'bp(e,200)',
  'sliceGrapheme',
  'truncateGrapheme',
  ',"\\u2026"',
  '+"\\u2026"',
]) {
  dumpHits(`#28 trunc ${n}`, n, 80, 6, 170000000)
}

// disclosure helper: length>200 ?
dumpHits('#28 len>200', '.length>200', 100, 10, 170000000)
dumpHits247('#28 len>200', '.length>200', 100, 10, 170000000)

// safeDisclosure leftover shape
const leftoverSafe =
  'value.length > MAX_DISCLOSURE_ENTRY_LENGTH'
dumpHits('#28 leftover-safe-src', leftoverSafe, 40, 2)
dumpHits('#28 200-ellipsis', 'slice(0,200)+', 80, 8, 170000000)
dumpHits('#28 200-ellipsis2', '.slice(0,200)+`', 80, 6)

// Look at functions that map rules through a sanitizer
for (const n of [
  '.rules.map(',
  'rules.map(',
  'allow.map(',
  '.allow.map(',
]) {
  dumpHits(`#28 ${n}`, n, 120, 8, 170000000)
}

// ============================================================================
// #36 mention-ime
// ============================================================================
lines.push('# ==== #36 mention-ime ====')

for (const n of [
  'tengu_at_mention_peer_',
  'function dr(',
  'normalize("NFKC")',
  'isComposing',
  'Hangul',
  'hangul',
  '\\p{L}',
  '\\p{Letter}',
  '\\p{Script=Hangul}',
  'toLocaleLowerCase',
  'localeCompare',
  '[\w-]',
  '[\\w-]',
  '[\\p{L}',
  '\\p{XID_Continue}',
  'compositionend',
  'compositionstart',
]) {
  const { a, b, uniq } = only248(n)
  lines.push(`- count ${JSON.stringify(n)} 248=${a} 247=${b}${uniq ? ' **NEW248**' : ''}`)
}
lines.push('')

const leftoverDr =
  'function dr(e){return e.normalize("NFKC").replace(/[\\p{Cc}\\p{Cf}]/gu,(t)=>/\\s/.test(t)?t:"").trim().toLowerCase().replace(/\\s+/g,"-")}'
const leftoverDrHits248 = allHits(b248, leftoverDr)
const leftoverDrHits247 = allHits(b247, leftoverDr)
lines.push(
  `## leftover-dr-exact 248=${leftoverDrHits248.join(',')} 247=${leftoverDrHits247.join(',')}`,
)
lines.push('')

// extract official mention regex-ish near tengu_at_mention
for (const i of allHits(b248, 'tengu_at_mention_peer_').filter(x => x > 170000000)) {
  dumpNear(b248, '#36 248 mention-analytics', i, 80, 240)
  extractNear(b248, '#36 248 mention-fn', i, 8000, 8000)
}
for (const i of allHits(b247, 'tengu_at_mention_peer_').filter(x => x > 170000000)) {
  dumpNear(b247, '#36 247 mention-analytics', i, 80, 240)
  extractNear(b247, '#36 247 mention-fn', i, 8000, 8000)
}

// leftover PEER_AT_MENTION_RE unique pieces
const mentionNeedles = [
  '[\u3002\u3001\uff1f\uff01])@',
  '@(?:"([^"\\n]{1,200})"',
  '([\\w-]{1,128})',
  '[\\w-]{1,128}',
  '[\\p{L}\\p{N}_-]{1,128}',
  '[\\p{L}',
  '\\p{XID_Start}',
  'message session',
  'dm-peer-',
  'function XTe(',
]
for (const n of mentionNeedles) dumpHits(`#36 re ${n}`, n, 120, 6)

// leftover regex exact
const leftoverRe =
  '(?:^|[\\s。、？！])@(?:"([^"\\n]{1,200})"|([\\w-]{1,128})'
dumpHits('#36 leftover-re', leftoverRe, 80, 4)
dumpHits247('#36 leftover-re', leftoverRe, 80, 4)

// Find mention parse function near leftover-re
for (const i of allHits(b248, leftoverRe)) {
  extractNear(b248, '#36 248 leftover-re-fn', i, 4000, 4000)
}
for (const i of allHits(b247, leftoverRe)) {
  extractNear(b247, '#36 247 leftover-re-fn', i, 4000, 4000)
}

// dr callers near mention (180525410)
const drAt = 180525410
dumpNear(b248, '#36 dr-home', drAt, 200, 400)
// scan 50k around dr for mention-related callers
const around = asciiSlice(b248, drAt - 8000, drAt + 20000)
lines.push('## #36 around-dr mention needles')
for (const n of [
  'tengu_at_mention',
  'dm-peer',
  'message session',
  '@(?:"',
  'normalize("NFKC")',
  'isComposing',
  '\\p{L}',
  'Hangul',
  'toLocaleLowerCase',
]) {
  lines.push(`- around-dr has ${JSON.stringify(n)}: ${around.includes(n)}`)
}
lines.push('')

// Compare 247 dr neighborhood
const dr247hits = allHits(b247, leftoverDr)
for (const i of dr247hits.slice(0, 2)) {
  dumpNear(b247, '#36 247 leftover-dr', i, 200, 400)
  const around247 = asciiSlice(b247, i - 8000, i + 20000)
  lines.push(`## #36 around-247-dr@${i}`)
  for (const n of [
    'tengu_at_mention',
    'dm-peer',
    'message session',
    '@(?:"',
    '[\\w-]{1,128}',
    '\\p{L}',
  ]) {
    lines.push(`- around-247-dr has ${JSON.stringify(n)}: ${around247.includes(n)}`)
  }
  lines.push('')
}

// Extract functions immediately after dr (mention module)
dumpFn(b248, '#36 after-dr window start', drAt, 400)
// find next few function names after dr
{
  const win = asciiSlice(b248, drAt, drAt + 25000)
  const names = [...win.matchAll(/(?:async )?function ([A-Za-z_$][\w$]*)\(/g)].slice(0, 20)
  lines.push('## #36 fns-after-dr-248')
  for (const m of names) {
    lines.push(`- ${m[1]} @${drAt + m.index}`)
  }
  lines.push('')
  // dump first 8 after dr itself
  for (const m of names.slice(0, 10)) {
    dumpFn(b248, `#36 post-dr ${m[1]}`, drAt + m.index, 3500)
  }
}

if (dr247hits[0] >= 0) {
  const i = dr247hits[0]
  const win = asciiSlice(b247, i, i + 25000)
  const names = [...win.matchAll(/(?:async )?function ([A-Za-z_$][\w$]*)\(/g)].slice(0, 20)
  lines.push('## #36 fns-after-dr-247')
  for (const m of names) {
    lines.push(`- ${m[1]} @${i + m.index}`)
  }
  lines.push('')
  for (const m of names.slice(0, 10)) {
    dumpFn(b247, `#36 247 post-dr ${m[1]}`, i + m.index, 3500)
  }
}

// Unique 248 mention-ish strings
for (const n of [
  'IME',
  'ime',
  'composing',
  'jamo',
  'NFKD',
  'normalize("NFKD")',
  'startsWith(prefix)',
  'startsWith(dr(',
]) {
  dumpHits(`#36 extra ${n}`, n, 80, 4, 170000000)
}

writeFileSync(`${outDir}/gold-248-unk-wave10-28-36.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-unk-wave10-28-36.txt`, 'lines', lines.length)
