/**
 * Peel official 248 Mhr leftover hosts: zL / EBt / lUe / ha / Ket / _G /
 * getProactivityLevel / wle.
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

function dumpHits(label, needle, max = 12) {
  const hits = allHits(b, needle)
  out.push(`\n## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    out.push(`- @${h} ${asciiSlice(b, h - 80, h + 160).replace(/\n/g, ' ')}`)
  }
}

function dumpFn(label, names, nearNeedle) {
  const hits = allHits(b, nearNeedle)
  out.push(`\n## fn ${label} near ${JSON.stringify(nearNeedle)} hits=${hits.length}`)
  for (const h of hits.slice(0, 6)) {
    const start = lastFnStart(b, h, names)
    const generic = lastFnStartGeneric(b, h, 8000)
    const i = start.i > 0 ? start.i : generic.i
    const name = start.i > 0 ? start.name : generic.name
    out.push(`- hit @${h} start=${name}@${i}`)
    if (i < 0) {
      out.push(asciiSlice(b, h - 200, h + 200))
      continue
    }
    const ext = extractFnAt(b, i, 16000)
    if (ext.body) {
      out.push(`len=${ext.len} sha=${ext.sha}`)
      out.push(ext.body)
    } else {
      out.push(JSON.stringify(ext).slice(0, 500))
      out.push(asciiSlice(b, i, i + 800))
    }
  }
}

dumpHits('zL relaunch', 'zL(t.messages,"relaunch"')
dumpHits('zL relaunch2', 'await zL(')
dumpHits('EBt switching', 'Switching to latest Claude Code')
dumpHits('EBt(', 'EBt("')
dumpHits('lUe', 'await lUe()')
dumpHits('ha team', 'ha()?void 0:t.getAppState()')
dumpHits('getProactivityLevel', 'getProactivityLevel()')
dumpHits('Ket(', 'await Ket(')
dumpHits('wle(', 'wle(t)')
dumpHits('function zL', 'function zL(')
dumpHits('async function zL', 'async function zL(')
dumpHits('function EBt', 'function EBt(')
dumpHits('async function EBt', 'async function EBt(')
dumpHits('function lUe', 'function lUe(')
dumpHits('async function lUe', 'async function lUe(')
dumpHits('function ha', 'function ha(')
dumpHits('function Ket', 'function Ket(')
dumpHits('async function Ket', 'async function Ket(')
dumpHits('function _G', 'function _G(')
dumpHits('async function _G', 'async function _G(')
dumpHits('function wle', 'function wle(')

dumpFn('zL', ['async function zL(', 'function zL('], 'zL(t.messages,"relaunch"')
dumpFn('zL2', ['async function zL(', 'function zL('], 'await zL(y,"relaunch"')
dumpFn('EBt', ['function EBt(', 'async function EBt('], 'EBt("Switching to latest Claude Code')
dumpFn('lUe', ['async function lUe(', 'function lUe('], 'await lUe()')
dumpFn('ha', ['function ha('], 'ha()?void 0:t.getAppState()')
dumpFn('Ket', ['async function Ket(', 'function Ket('], 'await Ket(C,{launcher:B,freshIfNoTranscript')
dumpFn('wle', ['function wle('], 'o5(w,wle(t))')
dumpFn('getProactivity', ['getProactivityLevel()'], 'getProactivityLevel()')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-mhr-hosts.txt',
  out.join('\n'),
)
console.log('wrote', out.length, 'lines')
