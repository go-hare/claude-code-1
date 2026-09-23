/**
 * FAST peel expansion: FULL class Ut, async uo, function w() (backendView host),
 * helpers Pe/Ne/vt/fue/Ie/lo, for gold-248-_Ke-Ut-uo.txt.
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
  '# gold-248-_Ke-Ut-uo',
  '',
  'Official densable 2.1.248 SEA. Remote-settings storage view prime chain.',
  '`_Ke(storageV5)` → `new Ut(e)` + `uo(view, storageV5, sessionBag)`.',
  '`w()` owns `backendView`; `Yv()` is CLAUDE_CODE_REMOTE_SETTINGS_PATH stub (empty).',
  'Do NOT invent cloud helper attestation — sidecar is just storageV5 key read.',
  '',
]

function extractClassAt(i, maxLen = 40000) {
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

function peelFn(label, i, maxLen = 12000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`sha=${ext.sha} len=${ext.len}`)
    lines.push(ext.body)
  } else {
    lines.push(`EXTRACT_FAIL ${JSON.stringify(ext)}`)
    lines.push(asciiSlice(buf, i, i + 2000))
  }
  lines.push('')
  return ext
}

function peelClass(label, i, maxLen = 40000) {
  lines.push(`## ${label} @${i}`)
  const b = extractClassAt(i, maxLen)
  if (b) {
    lines.push(`sha=${sha(b)} len=${b.length}`)
    lines.push(b)
    // method roster
    const methods = [...b.matchAll(/(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g)]
      .map(m => m[1])
      .filter(n => !['if', 'for', 'while', 'switch', 'catch', 'function'].includes(n))
    const uniq = [...new Set(methods)]
    lines.push(`## ${label} method-ish names (${uniq.length}): ${uniq.join(', ')}`)
  } else {
    lines.push('EXTRACT_FAIL')
    lines.push(asciiSlice(buf, i, i + 4000))
  }
  lines.push('')
  return b
}

// Known offsets from parent peel
peelFn('_Ke', 179162866, 2000)
peelFn('async uo', 179163180, 4000)

const utHits = allHits(buf, 'class Ut{').filter(i => i > 178800000 && i < 180200000)
lines.push(`## class Ut{ hits near-prime=${utHits.length}: ${utHits.join(',')}`)
lines.push('')
const utBody = peelClass('class Ut', utHits[0] ?? 179163791, 40000)

// Find function w() that owns backendView — look back from first backendView field
const bvHits = allHits(buf, 'backendView=void 0').filter(
  i => i > 178800000 && i < 180200000,
)
lines.push(`## backendView=void 0 hits=${bvHits.length}`)
for (const i of bvHits) {
  lines.push(`@${i} ctx=${asciiSlice(buf, Math.max(0, i - 200), i + 80)}`)
  const named = lastFnStart(buf, i, [
    'function w(',
    'function w ()',
    'class ',
  ])
  const gen = lastFnStartGeneric(buf, i, 8000)
  lines.push(`  lastFnStart=${JSON.stringify(named)} gen=${JSON.stringify(gen)}`)
  if (named.i >= 0) {
    const ext = extractFnAt(buf, named.i, 20000)
    if (ext.body) {
      lines.push(`  ## owning ${named.name} @${named.i} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body)
    } else {
      // maybe class — try extractClassAt looking back for "class "
      const classHit = allHits(buf, 'class ').filter(k => k < i && k > i - 8000)
      const lastClass = classHit[classHit.length - 1]
      if (lastClass !== undefined) {
        const cb = extractClassAt(lastClass, 25000)
        if (cb && cb.includes('backendView')) {
          lines.push(
            `  ## owning class @${lastClass} sha=${sha(cb)} len=${cb.length}`,
          )
          lines.push(cb)
        }
      }
    }
  } else if (gen.i >= 0) {
    const ext = extractFnAt(buf, gen.i, 20000)
    if (ext.body) {
      lines.push(`  ## owning ${gen.name} @${gen.i} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body)
    }
  }
  lines.push('')
}

// Also search function w( near prime that mentions backendView in body
{
  const whits = allHits(buf, 'function w(').filter(
    i => i > 178800000 && i < 180200000,
  )
  lines.push(`## function w( near-prime hits=${whits.length}`)
  for (const i of whits) {
    const ext = extractFnAt(buf, i, 25000)
    if (ext.body?.includes('backendView')) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len} HAS_backendView`)
      lines.push(ext.body)
    } else if (ext.body) {
      lines.push(
        `@${i} sha=${ext.sha} len=${ext.len} no-backendView preview=${ext.body.slice(0, 120)}`,
      )
    } else {
      lines.push(`@${i} miss ${asciiSlice(buf, i, i + 80)}`)
    }
    lines.push('')
  }
}

// Helpers used by Ut/_Ke/uo
for (const [label, needle] of [
  ['function Yv(', 'function Yv('],
  ['function Ie(', 'function Ie('],
  ['function lo(', 'function lo('],
  ['function fue(', 'function fue('],
  ['function vt(', 'function vt('],
  ['function ge(', 'function ge('],
  ['function Dde(', 'function Dde('],
  ['function po(', 'function po('],
  ['function $ue(', 'function $ue('],
  ['function zt(', 'function zt('],
  ['function Pu(', 'function Pu('],
  ['function Ht(', 'function Ht('],
  ['var Pe=', 'var Pe='],
  ['var Ne=', 'var Ne='],
  ['gKe', 'gKe'],
]) {
  const hits = allHits(buf, needle).filter(i => i > 178800000 && i < 180200000)
  lines.push(`## ${label} near-prime hits=${hits.length}`)
  for (const i of hits.slice(0, 4)) {
    if (needle.startsWith('function ') || needle.startsWith('async ')) {
      const ext = extractFnAt(buf, i, 4000)
      if (ext.body) {
        lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
        lines.push(ext.body)
      } else {
        lines.push(`@${i} ${asciiSlice(buf, i, i + 400)}`)
      }
    } else {
      lines.push(`@${i} ${asciiSlice(buf, i, i + 200)}`)
    }
    lines.push('')
  }
}

// export of _Ke
for (const n of ['_Ke as ', 'export{_Ke', ',_Ke,', ',_Ke}', '{_Ke,']) {
  const hits = allHits(buf, n)
  lines.push(`## needle ${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 80), i + 200)}`)
    lines.push('')
  }
}

// Storage API surface Ut consumes
lines.push('## Ut → storageV5 API surface (from body)')
if (utBody) {
  const apis = [
    'storageV5.read',
    't.subscribe',
    'subscribe(',
    '.read([',
    'written(',
  ]
  for (const a of apis) {
    lines.push(`- mentions ${a}: ${utBody.includes(a) || false}`)
  }
  // list Ut methods via regex on method decls
  const meth = [
    ...utBody.matchAll(
      /(?:^|[;{}])((?:async\s+)?[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
    ),
  ].map(m => m[1].replace(/^async\s+/, ''))
  lines.push(`- method decls: ${[...new Set(meth)].join(', ')}`)
}
lines.push('')

writeFileSync(new URL('./gold-248-_Ke-Ut-uo.txt', import.meta.url), lines.join('\n'))
console.log('wrote gold-248-_Ke-Ut-uo.txt lines=', lines.length, 'utLen=', utBody?.length)
