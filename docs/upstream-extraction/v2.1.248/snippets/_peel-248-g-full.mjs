/**
 * Peel official 248 _G callees: qje/Nj/hPt/ja/mEe/$ie/g/E/C/WL-p/kGe/s5.
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

function dumpHits(label, needle, max = 6) {
  const hits = allHits(b, needle)
  out.push(`\n## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    out.push(`- @${h} ${asciiSlice(b, h - 80, h + 200).replace(/\n/g, ' ')}`)
  }
}

function dumpFnAt(label, i, maxLen = 12000) {
  out.push(`\n## ${label} @${i}`)
  const ext = extractFnAt(b, i, maxLen)
  if (ext.body) {
    out.push(`len=${ext.len} sha=${ext.sha}`)
    out.push(ext.body)
  } else {
    out.push(JSON.stringify(ext).slice(0, 500))
    out.push(asciiSlice(b, i, i + 1800))
  }
}

function dumpFnNear(label, names, near, lookback = 16000) {
  const hits = allHits(b, near)
  out.push(`\n## fn ${label} near ${JSON.stringify(near)} hits=${hits.length}`)
  for (const h of hits.slice(0, 3)) {
    const start = lastFnStart(b, h, names)
    const generic = lastFnStartGeneric(b, h, lookback)
    const i = start.i > 0 ? start.i : generic.i
    out.push(`- hit @${h} start=${start.name || generic.name}@${i}`)
    if (i < 0) {
      out.push(asciiSlice(b, h - 200, h + 200))
      continue
    }
    dumpFnAt(`${label}-body`, i)
  }
}

dumpHits('qje()', 'qje()')
dumpHits('function qje', 'function qje(')
dumpHits('hPt()', 'hPt()')
dumpHits('function hPt', 'function hPt(')
dumpHits('ja()', 'qt(ja()')
dumpHits('async function ja', 'async function ja(')
dumpHits('$ie()', '$ie()')
dumpHits('function $ie', 'function $ie(')
dumpHits('async function $ie', 'async function $ie(')
dumpHits('function mEe', 'async function mEe(')
dumpHits('relaunch_spawn_error', 'relaunch_spawn_error')
dumpHits('flush timeout (relaunch)', 'flush timeout (relaunch)')
dumpHits('function kGe', 'function kGe(')
dumpHits('s5(', 's5(')
dumpHits('function s5', 'function s5(')

dumpFnNear('qje', ['function qje('], 'qje(),Nj(),hPt()')
dumpFnNear('hPt', ['function hPt('], 'qje(),Nj(),hPt()')
dumpFnNear('ja', ['async function ja(', 'function ja('], 'qt(ja(),30000')
dumpFnNear('$ie', ['async function $ie(', 'function $ie('], 'qt($ie(),1000')
dumpFnNear('mEe', ['async function mEe('], 'qt(mEe(),tde')
dumpFnNear('g', ['async function g('], 'debug flush timeout (relaunch)')
dumpFnNear('E', ['function E('], 'E(o,[o,...r,...i],s,m)')
dumpFnNear('C', ['function C('], 'let c=C(o,[...r,...i],{stdio:"inherit"')
dumpFnNear('kGe', ['function kGe('], 's5(')
dumpFnNear('s5', ['function s5('], 's5(S, E, I, T, kGe)')

// WL copies p/d/R just before WL
out.push('\n## WL-window @189574500')
out.push(asciiSlice(b, 189573900, 189574900))

// g() full after _G
out.push('\n## g-window after _G')
const gHit = allHits(b, 'async function g(){await Promise.all([qt(Rq()')
out.push(`gHits=${gHit}`)
if (gHit[0]) dumpFnAt('g-full', gHit[0], 4000)

// qje/hPt near _G
out.push('\n## _G-preamble 189574900-189575531')
out.push(asciiSlice(b, 189574900, 189575531))

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-g-full.txt',
  out.join('\n'),
)
console.log('wrote', out.length)
