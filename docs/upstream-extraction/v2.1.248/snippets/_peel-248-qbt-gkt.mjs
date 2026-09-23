/**
 * Peel official 248 Qbt / W / fe / svt / gKt / Zs / ve / Wa / an.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
  lastFnStart,
  lastFnStartGeneric,
  allHits,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const out = [`when=${new Date().toISOString()}`]

function dumpHits(label, needle, max = 8) {
  const hits = allHits(b, needle)
  out.push(`\n## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    out.push(`- @${h} ${asciiSlice(b, h - 120, h + 220).replace(/\n/g, ' ')}`)
  }
}

function dumpFnAt(label, i, maxLen = 8000) {
  out.push(`\n## ${label} @${i}`)
  const ext = extractFnAt(b, i, maxLen)
  if (ext.body) {
    out.push(`len=${ext.len} sha=${ext.sha}`)
    out.push(ext.body)
  } else {
    out.push(JSON.stringify(ext).slice(0, 600))
    out.push(asciiSlice(b, i, i + 1600))
  }
}

function dumpFnNear(label, names, near, lookback = 20000) {
  const hits = allHits(b, near)
  out.push(`\n## fn ${label} near ${JSON.stringify(near)} hits=${hits.length}`)
  for (const h of hits.slice(0, 4)) {
    const start = lastFnStart(b, h, names)
    const generic = lastFnStartGeneric(b, h, lookback)
    const i = start.i > 0 ? start.i : generic.i
    out.push(`- hit @${h} start=${start.name || generic.name}@${i}`)
    if (i < 0) {
      out.push(asciiSlice(b, h - 240, h + 240))
      continue
    }
    dumpFnAt(`${label}-body`, i)
  }
}

dumpHits('function Qbt', 'function Qbt(')
dumpHits('async function Qbt', 'async function Qbt(')
dumpHits('Qbt()', 'Qbt()')
dumpHits('diag flush timeout', 'diag flush timeout (relaunch)')
dumpHits('pre-exit flush timeout', 'pre-exit flush timeout (relaunch)')
dumpHits('function svt', 'async function svt(')
dumpHits('function Vk', 'function Vk(')
dumpHits('function gKt', 'function gKt(')
dumpHits('gKt()', 'gKt()')
dumpHits('class fe', 'class fe{cleanup=new W')
dumpHits('class W', 'class W{')
dumpHits('function Zs', 'function Zs(')
dumpHits('function ve', 'function ve(')
dumpHits('function an(', 'function an()')
dumpHits('function Wa', 'function Wa(')

dumpFnNear('Qbt', ['async function Qbt(', 'function Qbt('], 'qt(Qbt(),2000')
dumpFnNear('svt', ['async function svt('], 'qt(svt(),2000')
dumpFnNear('gKt', ['function gKt('], 'function gKt(){let e=Zs()')
dumpFnNear('Zs', ['function Zs('], 'function gKt(){let e=Zs(),t=ve()')
dumpFnNear('ve', ['function ve('], 'function gKt(){let e=Zs(),t=ve()')
dumpFnNear('an', ['function an('], 'function gKt(){let e=Zs(),t=ve();if(e&&T(e)===Wa(t))return t;return an()}')
dumpFnNear('Wa', ['function Wa('], 'T(e)===Wa(t)')

// class W window before fe
const feHits = allHits(b, 'class fe{cleanup=new W;preExitFlush=new W}')
out.push(`\n## fe hits=${feHits}`)
if (feHits[0]) {
  out.push(asciiSlice(b, feHits[0] - 2500, feHits[0] + 600))
}

// gKt window
const gktHits = allHits(b, 'function gKt(){')
out.push(`\n## gKt raw hits=${gktHits}`)
for (const h of gktHits.slice(0, 3)) {
  dumpFnAt('gKt-raw', h, 2000)
  out.push(asciiSlice(b, h - 400, h + 800))
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-qbt-gkt.txt',
  out.join('\n'),
)
console.log('wrote', out.length)
