/**
 * Peel official 248 footer / usePrStatus / y5e / uJt call sites for #41.
 */
import { writeFileSync } from 'fs'
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
let b247
try {
  b247 = loadSea(EXE_247)
} catch {
  b247 = null
}

const lines = ['# gold-248-41-footer-peel', `exe=${EXE_248}`, '']

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(label, needle, around = 100, cap = 12) {
  const hits = allHits(b248, needle)
  const h247 = b247 ? allHits(b247, needle).length : 'NO247'
  lines.push(
    `## ${label} needle=${JSON.stringify(needle)} hits248=${hits.length} hits247=${h247}`,
  )
  for (const [idx, off] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${off} ${asciiSlice(b248, off - around, off + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

// hook class around known 248 streak sites
dumpAround('#41 streak-setInputs', 203021124, 400, 200)
dumpAround('#41 streak-b', 203021705, 400, 250)
dumpAround('#41 streak-S', 203022291, 500, 250)
dumpAround('#41 streak-T', 203022837, 600, 400)

// find class start before 203021124
{
  const start = 203018000
  const win = asciiSlice(b248, start, 203021200)
  const m = [...win.matchAll(/class ([A-Za-z_$][\w$]*)\{/g)]
  lines.push('## class names before 203021200')
  for (const x of m) {
    lines.push(`- class ${x[1]} rel=${x.index} abs=${start + x.index}`)
  }
  lines.push('')
  if (m.length) {
    const last = m[m.length - 1]
    const abs = start + last.index
    dumpAround('#41 class-head', abs, 220, 400)
    // extract class-ish window
    lines.push(`## #41 class-window @${abs}`)
    lines.push(asciiSlice(b248, abs - 250, abs + 4500))
    lines.push('')
  }
}

dumpHits('#41 function y5e', 'function y5e')
dumpHits('#41 var y5e', 'var y5e=')
dumpHits('#41 y5e(', 'y5e(')
dumpHits('#41 function wY', 'function wY')
dumpHits('#41 class wY', 'class wY{')
dumpHits('#41 p5e=', 'p5e=')
dumpHits('#41 var p5e', 'var p5e=')
dumpHits('#41 Wut=', 'Wut=')
dumpHits('#41 var Wut', 'var Wut=')
dumpHits('#41 xfe=', 'xfe=')
dumpHits('#41 Hut=', 'Hut=')
dumpHits('#41 function N5e', 'function N5e')
dumpHits('#41 new y6', 'new y6')
dumpHits('#41 isDirectApiEnabled', 'isDirectApiEnabled')
dumpHits('#41 pollerNotModifiedStreak=Re', 'pollerNotModifiedStreak=Re')
dumpHits('#41 shared.pollerNotModifiedStreak', 'shared.pollerNotModifiedStreak')
dumpHits('#41 function uJt', 'function uJt')
dumpHits('#41 async function uJt', 'async function uJt')
dumpHits('#41 uJt=', 'uJt=')

// 247 Kut successor names
dumpHits('#41 function Kut', 'function Kut')
dumpHits('#41 PRe(', 'function PRe')
dumpHits('#41 RRe(', 'function RRe')
dumpHits('#41 DRe(', 'function DRe')
dumpHits('#41 KO()', 'function KO')

// footer hook likely near N5e @203037384
dumpAround('#41 N5e-win', 203037384, 80, 200)
dumpAround('#41 before-N5e', 203037000, 0, 500)

// look for useSyncExternalStore / setInputs near hook
dumpHits('#41 setInputs', 'setInputs({isLoading')
dumpHits('#41 focused:r', 'focused:r')
dumpHits('#41 fetchPrStatus:()=>', 'fetchPrStatus:()=>')

writeFileSync(`${outDir}/gold-248-41-footer-peel.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-41-footer-peel.txt`, 'chars', lines.join('\n').length)
