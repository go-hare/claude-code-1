/**
 * Peel FULL class xt (backendView host bag) + w/Ndr/hzt around remote settings.
 */
import { writeFileSync, readFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-_Ke-Ut-uo APPEND: class xt + w/Ndr', '']

function extractClassAt(i, maxLen = 80000) {
  const win = asciiSlice(buf, i, i + maxLen)
  if (!win.startsWith('class ')) return null
  let d = 0
  let st = false
  let inS = null
  let esc = false
  for (let p = 0; p < win.length; p++) {
    const c = win[p]
    if (inS) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inS) inS = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inS = c
      continue
    }
    if (c === '{') {
      d++
      st = true
    } else if (c === '}') {
      d--
      if (st && d === 0) return win.slice(0, p + 1)
    }
  }
  return null
}

// Find class xt{ near backendView
const xtHits = allHits(buf, 'class xt{').filter(i => i > 178800000 && i < 180200000)
lines.push(`## class xt{ hits=${xtHits.length}: ${xtHits.join(',')}`)
for (const i of xtHits) {
  const b = extractClassAt(i, 80000)
  if (b) {
    lines.push(`@${i} sha=${sha(b)} len=${b.length}`)
    lines.push(b)
    const meth = [
      ...b.matchAll(
        /(?:^|[;{}])((?:async\s+)?[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
      ),
    ].map(m => m[1].replace(/^async\s+/, ''))
    lines.push(`methods: ${[...new Set(meth)].filter(n => !['if','for','while','switch','catch'].includes(n)).join(', ')}`)
  } else {
    lines.push(`@${i} FAIL ${asciiSlice(buf, i, i + 500)}`)
  }
  lines.push('')
}

// w that returns Ndr
for (const i of [179160929]) {
  const ext = extractFnAt(buf, i, 500)
  lines.push(`## w @${i} sha=${ext.sha} len=${ext.len}`)
  lines.push(ext.body ?? asciiSlice(buf, i, i + 200))
  lines.push('')
}

// Ndr / hzt
for (const n of ['var Ndr=', 'Ndr=new', 'class Ndr', 'function hzt(', 'var hzt=', 'Ndr.of']) {
  const hits = allHits(buf, n).filter(i => i > 178800000 && i < 180200000)
  lines.push(`## ${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    if (n.startsWith('function ') || n.startsWith('class ')) {
      const b = n.startsWith('class ')
        ? extractClassAt(i, 20000)
        : extractFnAt(buf, i, 8000)?.body
      lines.push(`@${i} ${typeof b === 'string' ? `len=${b.length}\n${b}` : asciiSlice(buf, i, i + 300)}`)
    } else {
      lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 40), i + 250)}`)
    }
    lines.push('')
  }
}

// ge() used by Ut for configHome — find near remote settings
{
  const hits = allHits(buf, 'configHome=ge()')
  lines.push(`## configHome=ge() hits=${hits.length}`)
  for (const i of hits) {
    lines.push(`@${i} ${asciiSlice(buf, i - 50, i + 80)}`)
  }
  // find function ge() just before Ut that returns config home
  const geHits = allHits(buf, 'function ge()').filter(i => i > 179100000 && i < 179170000)
  lines.push(`## function ge() in Ut band hits=${geHits.length}`)
  for (const i of geHits) {
    const ext = extractFnAt(buf, i, 500)
    lines.push(`@${i} ${ext.body ?? asciiSlice(buf, i, i + 100)}`)
  }
  lines.push('')
}

// Dde near remote
{
  const hits = allHits(buf, 'function Dde(')
  lines.push(`## function Dde( all hits=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const ext = extractFnAt(buf, i, 2000)
    lines.push(`@${i} ${ext.body ?? asciiSlice(buf, i, i + 200)}`)
    lines.push('')
  }
}

// Pu near Ut
{
  const hits = allHits(buf, 'function Pu(').filter(i => i > 179100000 && i < 179200000)
  lines.push(`## function Pu( Ut-band hits=${hits.length}`)
  for (const i of hits) {
    const ext = extractFnAt(buf, i, 1000)
    lines.push(`@${i} ${ext.body ?? asciiSlice(buf, i, i + 200)}`)
  }
  lines.push('')
}

// ce size limit near Ut
{
  const hits = allHits(buf, 'var ce=').filter(i => i > 179100000 && i < 179200000)
  lines.push(`## var ce= Ut-band hits=${hits.length}`)
  for (const i of hits) lines.push(`@${i} ${asciiSlice(buf, i, i + 80)}`)
  const ce2 = allHits(buf, ',ce=').filter(i => i > 179150000 && i < 179170000)
  for (const i of ce2) lines.push(`@${i} ${asciiSlice(buf, i, i + 80)}`)
  lines.push('')
}

const out = new URL('./gold-248-_Ke-xt-w.txt', import.meta.url)
writeFileSync(out, lines.join('\n'))
console.log('wrote', out.pathname, 'lines', lines.length)

// Also patch main gold: append xt/w section
const main = new URL('./gold-248-_Ke-Ut-uo.txt', import.meta.url)
const existing = readFileSync(main, 'utf8')
const append = [
  '',
  '---',
  '',
  '## OWNING BAG: class xt + accessor w()',
  '',
  '### w @179160929 — returns remote-managed-settings sync state bag',
  'sha=4bddec68e72f2949 len=37',
  'function w(){return Ndr.of(z().host)}',
  '',
]
// Insert full xt if we got it
if (xtHits[0] !== undefined) {
  const b = extractClassAt(xtHits[0], 80000)
  if (b) {
    append.push(`### class xt @${xtHits[0]} sha=${sha(b)} len=${b.length}`)
    append.push(b)
    append.push('')
  }
}
writeFileSync(main, existing + append.join('\n') + '\n' + lines.join('\n'))
console.log('appended to gold-248-_Ke-Ut-uo.txt; xtLen=', extractClassAt(xtHits[0], 80000)?.length)
