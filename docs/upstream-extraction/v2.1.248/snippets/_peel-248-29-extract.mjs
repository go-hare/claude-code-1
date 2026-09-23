/**
 * Targeted extract of 248 #29 handleCycleMode at known code offsets.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  EXE_247,
  loadSea,
  asciiSlice,
  sha,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [`when=${new Date().toISOString()}`]

function extractFrom(buf, off, maxLen) {
  const win = asciiSlice(buf, off, off + maxLen)
  let depth = 0
  let inStr = null
  let esc = false
  let started = false
  for (let p = 0; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') {
      depth++
      started = true
    } else if (c === '}') {
      depth--
      if (started && depth === 0) {
        return win.slice(0, p + 1)
      }
    }
  }
  return win
}

// Walk back from known needle to callback start
function findCbStart(buf, needleOff, lookback = 2500) {
  const win = asciiSlice(buf, needleOff - lookback, needleOff + 20)
  const pats = ['=U((Io)=>{', '=U((E)=>{', '=B((E)=>{', '=B((Io=>{']
  let best = -1
  let pat = ''
  for (const p of pats) {
    const i = win.lastIndexOf(p)
    if (i > best) {
      best = i
      pat = p
    }
  }
  // also generic useCallback-like
  const re = /=[A-Za-z_$]{1,3}\(\([A-Za-z_$][\w$]*\)=>\{/g
  let m
  let last = -1
  let lastPat = ''
  while ((m = re.exec(win))) {
    last = m.index
    lastPat = m[0]
  }
  if (last > best) {
    best = last
    pat = lastPat
  }
  return { abs: needleOff - lookback + best, pat, best }
}

const off248 = 203088756
const off247 = 232689604

const s248 = findCbStart(b248, off248, 3000)
const s247 = findCbStart(b247, off247, 3000)
lines.push(`248 start ${JSON.stringify(s248)}`)
lines.push(`247 start ${JSON.stringify(s247)}`)

const body248 = extractFrom(b248, s248.abs, 8000)
const body247 = extractFrom(b247, s247.abs, 8000)
lines.push('')
lines.push(`## 248-handleCycleMode abs=${s248.abs} len=${body248.length} sha=${sha(body248)}`)
lines.push(body248)
lines.push('')
lines.push(`## 247-handleCycleMode abs=${s247.abs} len=${body247.length} sha=${sha(body247)}`)
lines.push(body247)

// also dump raw windows if start miss
lines.push('')
lines.push('## 248 raw before needle')
lines.push(asciiSlice(b248, off248 - 800, off248 + 2200))
lines.push('')
lines.push('## 247 raw before needle')
lines.push(asciiSlice(b247, off247 - 800, off247 + 2200))

// footer FY
const fy = b248.indexOf(Buffer.from('function FY({exitMessage'))
lines.push('')
lines.push(`## FY @${fy}`)
if (fy >= 0) lines.push(asciiSlice(b248, fy, fy + 2500))

// PromptInput footer left: exitMessage.show
const em = b248.indexOf(Buffer.from('d.exitMessage.show'))
lines.push('')
lines.push(`## exitMessage.show @${em}`)
if (em >= 0) lines.push(asciiSlice(b248, em - 200, em + 400))

writeFileSync(`${outDir}/gold-248-29-extract.txt`, lines.join('\n'))
console.log('wrote extract', body248.length, body247.length)
