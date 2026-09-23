/**
 * #36 host-hunt — Ejn caller Bn fold + typeahead @ regex + isComposing
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
  '# gold-248-36-host-hunt',
  `when=${new Date().toISOString()}`,
  'job=leftover mention match sites that skip dr / IME fold',
  '',
]

function dumpNear(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(buf, label, i, maxLen = 2500) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
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
}

function dumpHits(label, needle) {
  const a = allHits(b248, needle)
  const b = allHits(b247, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  248=${a.length}@${a.slice(0, 8)}  247=${b.length}@${b.slice(0, 8)}`)
}

// Ejn definition + caller
dumpFn(b248, 'Ejn-def', 186136100, 2000)
dumpNear(b248, 'Ejn-call-wide', 202924708, 2500, 400)

{
  const fn = lastFnStartGeneric(b248, 202924708, 12000)
  lines.push(`## Ejn-caller-fn name=${fn.name} i=${fn.i}`)
  dumpFn(b248, `Ejn-caller ${fn.name}`, fn.i, 8000)
}

// How Bn is assigned near the call
for (const n of [
  'let Bn=',
  'Bn=',
  ',Bn=',
  'Bn=Mo',
  'partial===Bn',
  'Ejn(gn.current.roster,Bn)',
  'Ejn(gn.current.roster,dr(',
  'dcu(',
]) {
  dumpHits(`assign ${n}`, n)
}

// 247 dcu caller
{
  const hits = allHits(b247, 'dcu(').filter(x => x !== 218150953)
  lines.push(`## 247 dcu-calls besides def ${hits.slice(0, 12)}`)
  for (const i of hits.slice(0, 4)) {
    dumpNear(b247, '247 dcu-call-wide', i, 800, 200)
    const fn = lastFnStartGeneric(b247, i, 12000)
    lines.push(`## 247 dcu-caller-fn name=${fn.name} i=${fn.i}`)
  }
}

// leftover typeahead trigger vs official
for (const n of [
  '(^|\\s)@([\\w-]*)$',
  '(^|\\s)@[\\w-]*$',
  '@([\\w-]*)$',
  '@([\\w-]+)',
  '(?:^|\\s)@(\\S*)$',
  'DM_MEMBER_RE',
  '@([\\p{L}',
  '@([\\p{L}\\p{N}_-]*)',
  'partialName',
  '.toLowerCase().startsWith(partialName)',
  '.toLowerCase().startsWith(',
  'normalize("NFKC")',
]) {
  dumpHits(`re ${n}`, n)
}

// official typeahead around send message / teammates
for (const n of [
  'send message',
  'send message \\xB7',
  'teamContext.teammates',
  'agentNameRegistry',
  'processPeerMentionsTypeahead',
  'dm-peer-',
  'gn.current.roster',
]) {
  dumpHits(`ui ${n}`, n)
}

// isComposing around mention?
{
  const hits = allHits(b248, 'isComposing')
  lines.push(`## isComposing 248 hits=${hits.length}`)
  for (const i of hits) {
    dumpNear(b248, 'isComposing-win', i, 120, 180)
    const fn = lastFnStartGeneric(b248, i, 4000)
    lines.push(`## isComposing-fn name=${fn.name} i=${fn.i}`)
  }
}

{
  const hits247 = allHits(b247, 'isComposing')
  lines.push(`## isComposing 247 hits=${hits247.length}`)
  for (const i of hits247) {
    dumpNear(b247, '247 isComposing-win', i, 80, 120)
  }
}

// compositionend / compositionstart
for (const n of ['compositionend', 'compositionstart', 'compositionupdate']) {
  dumpHits(`ime ${n}`, n)
}

// Find typeahead @ regex near Ejn caller (useTypeahead equivalent)
dumpNear(b248, 'before-Ejn-regex-scan', 202924708, 4000, 50)

writeFileSync(`${outDir}/gold-248-36-host-hunt.txt`, lines.join('\n'), 'utf8')
console.log('wrote', `${outDir}/gold-248-36-host-hunt.txt`, 'lines', lines.length)
