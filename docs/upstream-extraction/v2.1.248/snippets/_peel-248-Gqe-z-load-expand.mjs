/**
 * Expand Gqe call-site gold: extract FULL nHe + deeplink host around await Gqe,
 * plus export alias resetSettingsCacheWithBackendRead.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStart,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-Gqe-z-load',
  '',
  'Official densable 2.1.248 SEA. Settings load under backendReadResetTail + retain.',
  'Leftover names: loadSettingsUnderPrime / resetSettingsCacheWithBackendRead ≈ Gqe;',
  'inner z; Yl → invalidateAll; export from chunk-qapedxb8.',
  '',
  '## CALL SITES (official — wire these; do not invent)',
  '',
]

function peelFn(label, i, maxLen = 12000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`sha=${ext.sha} len=${ext.len}`)
    lines.push(ext.body)
  } else {
    lines.push(`EXTRACT_FAIL`)
    lines.push(asciiSlice(buf, i, i + Math.min(maxLen, 3000)))
  }
  lines.push('')
  return ext
}

// Core defs
peelFn('Gqe', 179527369, 2000)
peelFn('z', 179527519, 4000)
peelFn('kur', 179527816, 2000)
peelFn('async L (ownership ahead)', 179522914, 2000)
peelFn('async Dgn', 179502701, 4000)
peelFn('async N (managed re-seed)', 179533672, 4000)
peelFn('Yl → invalidateAll', 179035765, 500)
peelFn('Mgn', 179503367, 1000)
peelFn('Ogn', 179505056, 1000)
peelFn('$pn settingsPrime', 179527115, 2000)

// Real await Gqe call sites
const awaitHits = allHits(buf, 'await Gqe(')
lines.push(`## await Gqe( hits=${awaitHits.length}`)
for (const i of awaitHits) {
  lines.push(`### call @${i}`)
  lines.push(`ctx: ${asciiSlice(buf, Math.max(0, i - 200), i + 220)}`)
  const named = lastFnStart(buf, i, [
    'async function nHe(',
    'async function ',
    'function ',
  ])
  const gen = lastFnStartGeneric(buf, i, 12000)
  lines.push(`lastFn=${JSON.stringify(named)} gen=${JSON.stringify(gen)}`)
  const start = named.i >= 0 ? named.i : gen.i
  const name = named.i >= 0 ? named.name : gen.name
  if (start >= 0) {
    const ext = extractFnAt(buf, start, 30000)
    if (ext.body) {
      lines.push(`## owning ${name} @${start} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body)
    } else {
      // maybe too large — dump window
      lines.push(`EXTRACT_PARTIAL owning ${name} @${start}`)
      lines.push(asciiSlice(buf, start, start + 8000))
    }
  }
  lines.push('')
}

// Export alias
{
  const hits = allHits(buf, 'Gqe as resetSettingsCacheWithBackendRead')
  lines.push(`## export alias hits=${hits.length}`)
  for (const i of hits) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 200), i + 120)}`)
  }
  lines.push('')
}

// chunk export
{
  const hits = allHits(buf, 'export{Npn,SKn,$pn,Gqe,kur,vKn,Tur,wKn}')
  lines.push(`## chunk export hits=${hits.length}`)
  for (const i of hits) {
    lines.push(`@${i} ${asciiSlice(buf, i, i + 80)}`)
  }
  lines.push('')
}

// All Gqe( with classification
{
  const hits = allHits(buf, 'Gqe(')
  lines.push(`## Gqe( all hits=${hits.length} (classified)`)
  for (const i of hits) {
    const win = asciiSlice(buf, Math.max(0, i - 80), i + 100)
    let kind = 'other'
    if (win.includes('async function Gqe(') || win.includes('function Gqe('))
      kind = 'DEF'
    else if (win.includes('await Gqe(')) kind = 'CALL'
    else if (win.includes('a=Gqe(') || win.includes('=Gqe(')) kind = 'D3_OTHER'
    lines.push(`@${i} [${kind}] ${win}`)
    lines.push('')
  }
}

// $pn init call site
{
  const hits = allHits(buf, 'await $pn(')
  lines.push(`## await $pn( hits=${hits.length}`)
  for (const i of hits) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 150), i + 200)}`)
    const gen = lastFnStartGeneric(buf, i, 8000)
    lines.push(`  gen=${JSON.stringify(gen)}`)
    if (gen.i >= 0) {
      const ext = extractFnAt(buf, gen.i, 15000)
      if (ext.body) {
        lines.push(`  ## owning ${gen.name} @${gen.i} sha=${ext.sha} len=${ext.len}`)
        lines.push(ext.body.length > 8000 ? ext.body.slice(0, 8000) + '…' : ext.body)
      }
    }
    lines.push('')
  }
}

// ra() used by Gqe — find settings getSettingsOwner near import
{
  lines.push('## ra() for Gqe (settings owner — NOT jobs.clear)')
  const hits = allHits(buf, 'function ra(').filter(i => i > 178000000 && i < 180000000)
  for (const i of hits.slice(0, 10)) {
    const ext = extractFnAt(buf, i, 500)
    lines.push(`@${i} ${ext.body ?? asciiSlice(buf, i, i + 120)}`)
  }
  // also search get / singleton patterns near fGt
  const importHits = allHits(buf, 'import{ra,Yl,_Ke}')
  for (const i of importHits) {
    lines.push(`import-site @${i} ${asciiSlice(buf, i, i + 200)}`)
  }
  const raGet = allHits(buf, 'function ra(){').filter(i => i > 178000000 && i < 180000000)
  lines.push(`function ra(){ hits=${raGet.length}`)
  for (const i of raGet) {
    const ext = extractFnAt(buf, i, 500)
    lines.push(`@${i} ${ext.body ?? asciiSlice(buf, i, i + 200)}`)
  }
  lines.push('')
}

writeFileSync(new URL('./gold-248-Gqe-z-load.txt', import.meta.url), lines.join('\n'))
console.log('wrote gold-248-Gqe-z-load.txt lines=', lines.length)
