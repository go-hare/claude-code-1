/**
 * Peel BY / i4t / G9e / FSn / ie / F used by Ior skipIf.
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

const buf = loadSea(EXE_248)
const lines = ['# gold-248-na-10-by-i4t', '']

function dumpFn(label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

// Unique Ior skipIf needles
const byCall = buf.indexOf(Buffer.from('S=BY(C,"entrypoint"),O=i4t(T,"entrypoint")'))
dumpAround('# BY-i4t-call', byCall, 80, 200)

// Import line in cleanup module
const imp = buf.indexOf(Buffer.from('import{Wd,BY,i4t,G9e,FSn}from'))
dumpAround('# import-BY', imp, 20, 200)

// Find function BY / i4t / G9e / FSn near JS (not too many hits)
for (const name of ['BY', 'i4t', 'G9e', 'FSn']) {
  const hits = allHits(buf, `function ${name}(`)
  const asyncHits = allHits(buf, `async function ${name}(`)
  lines.push(`## decl ${name} sync=${hits.length} async=${asyncHits.length}`)
  for (const i of [...hits, ...asyncHits].slice(0, 4)) {
    dumpFn(`${name} @${i}`, i, 6000)
    dumpAround(`${name}-win`, i, 120, 80)
  }
}

// ie release reader — unique from Ae-before
const ie = buf.indexOf(
  Buffer.from('async function ie(e,t,r){let a=await t.readFileFdGated(e,Ie)'),
)
dumpFn('# ie', ie, 3000)
dumpAround('# ie-win', ie, 200, 400)

// X companion path
const xfn = buf.indexOf(Buffer.from('function X(e){return e.slice(0,-6)+U}'))
dumpFn('# X', xfn, 400)

// F unlink-with-skipIf
const ffn = buf.indexOf(
  Buffer.from('async function F(e,t,r,a,o=t,u){let p;try{p=await r.stat(e)}'),
)
dumpFn('# F', ffn, 2000)

// FSn near G9e / Wd
const fsnCall = buf.indexOf(Buffer.from('R.size>Wd?FSn(k):k'))
dumpAround('# FSn-call', fsnCall, 40, 80)

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-na-10-by-i4t.txt',
  lines.join('\n'),
)
console.log('WROTE by-i4t', lines.join('\n').length)
