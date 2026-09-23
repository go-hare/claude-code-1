import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)

function extractFnAt(i, maxLen = 2000) {
  const win = asciiSlice(buf, i, i + maxLen)
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
        const body = win.slice(0, p + 1)
        return { body, sha: sha(body), len: body.length }
      }
    }
  }
  return { missEnd: true, preview: win.slice(0, 300) }
}

function extractClassAt(i, maxLen = 12000) {
  return extractFnAt(i, maxLen)
}

const lines = ['# gold-248-host-missing', '']

const needles = [
  'function MHs(',
  'function TL(',
  'function Awn(',
  'accountCreditLatches.fableCreditsRequired',
  'accountCreditLatches.longContext1m',
  'proactivity.selectorGate',
  'replaceSelectorGate',
  'function Gri(',
  'function Vri(',
  'class Be{',
  'class mGt',
  'mGt.of(',
  'function ra()',
  'connectNonBlocking()',
]

for (const n of needles) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    const near = asciiSlice(buf, Math.max(0, i - 40), i + 400)
    lines.push(`@${i} ${near.replace(/\n/g, ' ')}`)
    lines.push('')
  }
}

// Full Be / mGt class bodies near session host band
for (const n of ['class Be{', 'class mGt{', 'class mGt ']) {
  const hits = allHits(buf, n).filter(i => i > 178500000 && i < 180200000)
  lines.push(`## EXTRACT ${n} band=${hits[0]}`)
  if (hits[0]) {
    lines.push(JSON.stringify(extractClassAt(hits[0], 15000)))
  }
  lines.push('')
}

// Wrappers that mention host bags
for (const n of [
  'n().host.accountCreditLatches',
  'n().host.proactivity',
  'n().host.mcpProcessWiring',
  'n().host.telemetryHandles',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 12)) {
    lines.push(`@${i} ${asciiSlice(buf, i - 80, i + 200).replace(/\n/g, ' ')}`)
    lines.push('')
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-host-missing.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-host-missing.txt')
