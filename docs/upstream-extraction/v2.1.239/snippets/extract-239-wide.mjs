#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BIN =
  process.env.OFFICIAL_239_BIN ||
  String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239-pkg\package\claude.exe`
const outDir = join(import.meta.dirname)
const buf = readFileSync(BIN)

function decode(start, end) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const b = buf[i]
    if (b === 0x09) s += '\t'
    else if (b === 0x0a) s += '\n'
    else if (b === 0x0d) s += '\r'
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
    else s += '.'
  }
  return s
}

function firstHit(kw) {
  const i = buf.indexOf(Buffer.from(kw, 'utf8'))
  if (i < 0) throw new Error(`not found: ${kw}`)
  return i
}

function dumpAround(name, kw, before, after) {
  const off = firstHit(kw)
  const start = Math.max(0, off - before)
  const end = Math.min(buf.length, off + after)
  const file = join(outDir, `gold-wide-${name}.txt`)
  writeFileSync(
    file,
    `# offset=${off} (0x${off.toString(16)}) kw=${JSON.stringify(kw)} bytes=${end - start}\n\n${decode(start, end)}\n`,
  )
  console.error(`wrote ${file} off=${off} bytes=${end - start}`)
}

function dumpHits(name, kw, before, after, max = 4) {
  const needle = Buffer.from(kw, 'utf8')
  let from = 0
  let n = 0
  while (n < max) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    const start = Math.max(0, i - before)
    const end = Math.min(buf.length, i + after)
    const file = join(outDir, `gold-wide-${name}-${n}.txt`)
    writeFileSync(
      file,
      `# offset=${i} (0x${i.toString(16)}) kw=${JSON.stringify(kw)} bytes=${end - start}\n\n${decode(start, end)}\n`,
    )
    console.error(`wrote ${file} off=${i} bytes=${end - start}`)
    from = i + needle.length
    n++
  }
  if (n === 0) console.error(`MISS ${kw}`)
}

dumpAround('nlg', 'function nlg(', 200, 80000)
dumpAround('elg', 'function elg(', 50, 4000)
dumpAround('llg', 'function llg(', 200, 25000)
dumpAround('Ny0', 'async function Ny0(', 50, 20000)
dumpAround('Grn', 'async function Grn(', 50, 25000)
dumpAround('i$m', 'async function i$m(', 200, 40000)
dumpAround('svr', 'async function svr(', 50, 8000)
dumpAround('V3w', 'async function V3w(', 50, 25000)
dumpAround('TPl', 'function TPl(', 50, 8000)
dumpAround('uhs', 'function uhs(', 50, 3000)
dumpAround('$y0', '$y0=async', 200, 12000)
dumpAround('xPl', 'name:"auto-mode-setup"', 200, 8000)
dumpAround('Nrn', 'function Nrn(', 50, 4000)
dumpAround('Dag', 'function Dag(', 50, 4000)
dumpAround('hmn', 'function hmn(', 50, 20000)

dumpHits('step-existing', 'c==="existing"', 200, 6000, 3)
dumpHits('step-confirm', 'c==="confirm"', 200, 8000, 4)
dumpHits('step-scan', '"scanning"', 100, 3000, 3)
dumpHits('posture', 'posture:"mixed"', 200, 4000, 2)
dumpHits('wizard-shown', 'tengu_auto_mode_setup_wizard_shown', 200, 2000, 2)
dumpHits('b3w', 'async function b3w(', 50, 8000, 2)
dumpHits('A3w', 'async function A3w(', 50, 8000, 2)
dumpHits('I3w', 'async function I3w(', 50, 8000, 2)
dumpHits('B3w', 'async function B3w(', 50, 8000, 2)
dumpHits('j3w', 'function j3w(', 50, 4000, 2)
dumpHits('JNm', 'function JNm(', 50, 8000, 2)
dumpHits('ZNm', 'function ZNm(', 50, 8000, 2)
dumpHits('QNm', 'function QNm(', 50, 8000, 2)
dumpHits('w3w', 'async function w3w(', 50, 8000, 2)
dumpHits('$Nm', 'async function $Nm(', 50, 8000, 2)
dumpHits('v3w', 'function v3w(', 50, 4000, 2)
dumpHits('roe', 'const roe=', 20, 200, 2)
