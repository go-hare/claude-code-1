/**
 * Peel zL helpers (ptt/dtt/rS/It/lR), _G full, kb, getProactivityLevel.
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
    out.push(`- @${h} ${asciiSlice(b, h - 100, h + 220).replace(/\n/g, ' ')}`)
  }
}

function dumpFnAt(label, i, maxLen = 20000) {
  out.push(`\n## ${label} @${i}`)
  const ext = extractFnAt(b, i, maxLen)
  if (ext.body) {
    out.push(`len=${ext.len} sha=${ext.sha}`)
    out.push(ext.body)
  } else {
    out.push(JSON.stringify(ext).slice(0, 400))
    out.push(asciiSlice(b, i, i + 2000))
  }
}

function dumpFnNear(label, names, near, lookback = 12000) {
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

dumpHits('function ptt', 'function ptt(')
dumpHits('var dtt', 'var dtt=')
dumpHits('dtt[', 'dtt[t]')
dumpHits('function rS', 'async function rS(')
dumpHits('function It(', 'function It(')
dumpHits('async function lR', 'async function lR(')
dumpHits('function kb', 'function kb(')
dumpHits('function Tdr', 'function Tdr(')
dumpHits('getProactivityLevel=', 'getProactivityLevel(){')
dumpHits('getProactivityLevel:', 'getProactivityLevel:')
dumpHits('proactivityLevel:', 'proactivityLevel:')
dumpHits('_G proactivity', 'e.proactivity')
dumpHits('ptt("relaunch")', 'ptt("relaunch")')

dumpFnNear('ptt', ['function ptt('], 'ptt(t)')
dumpFnNear('kb', ['function kb('], 'if(kb())return!0;return Tdr()')
dumpFnNear('_G', ['async function _G('], 'await lUe();let a=e.extraArgs??[]')
dumpFnNear('lR', ['async function lR('], 'if(t==="relaunch")await lR(e,r)')

// Extract zL with more context before it (dtt / ptt)
out.push('\n## zL-window @189573900')
out.push(asciiSlice(b, 189573700, 189574400))

out.push('\n## _G-window @189575531')
out.push(asciiSlice(b, 189575531, 189577200))

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-mhr-hosts2.txt',
  out.join('\n'),
)
console.log('wrote', out.length)
