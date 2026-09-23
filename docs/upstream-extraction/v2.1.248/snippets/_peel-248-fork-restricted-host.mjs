/**
 * densable 2.1.248 leftover — Yt #w / GC / Cwn (NOT #1 Yk).
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
const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-fork-restricted-host',
  `exe=${EXE_248}`,
  `bytes=${buf.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 16000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(label, needle, around = 160, cap = 20) {
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

// Known offsets from feat-1 gold
dumpAround('methods-178537404', 178537404, 800, 800)
dumpAround('wrappers-178553301', 178553301, 400, 600)
dumpAround('export-192785069', 192785069, 200, 200)

for (const name of [
  'function GC(',
  'function Cwn(',
  'function Hei(',
  'function xei(',
]) {
  const hits = allHits(buf, name)
  lines.push(`## ${name} hits=${hits.length} @${hits.slice(0, 12)}`)
  for (const i of hits.slice(0, 6)) dumpFn(name + i, i, 2000)
}

dumpHits('forkRestrictedLaunchConfig()', 'forkRestrictedLaunchConfig()')
dumpHits(
  'replaceForkRestrictedLaunchConfig',
  'replaceForkRestrictedLaunchConfig',
)
dumpHits('Cwn(', 'Cwn(')
dumpHits('GC()', 'GC()')
dumpHits('Cwn as setForkRestrictedLaunchConfig', 'Cwn as setForkRestrictedLaunchConfig')
dumpHits('GC as ', 'GC as ')
dumpHits('this.#w', 'this.#w')
dumpHits('#w=', '#w=')
dumpHits('this.#w=', 'this.#w=')
dumpHits('Hei()', 'Hei()')
dumpHits('xei(', 'xei(')

// Yt constructor / class start near methods
const methodI = 178537404
const classNear = lastFnStartGeneric(buf, methodI, 20000)
lines.push(`## lastFn before methods name=${classNear.name} @${classNear.i}`)
if (classNear.i >= 0) dumpFn('fn-before-methods', classNear.i, 8000)
dumpAround('class-win-before-methods', methodI, 4000, 200)

// hunt class Yt / constructor #w init
for (const n of [
  'class Yt',
  'Yt=class',
  '#w=',
  '#w;',
  'this.#w=',
  'new Yt',
]) {
  dumpHits(`hunt ${n}`, n, 120, 12)
}

writeFileSync(`${outDir}/gold-248-fork-restricted-host.txt`, lines.join('\n'))
console.log('wrote gold-248-fork-restricted-host.txt lines', lines.length)
