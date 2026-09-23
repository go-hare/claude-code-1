/**
 * Find two-arg sp(e,t) used by P0n at 186369915.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const lines = ['# gold-248-20-sp2', '']
const p0n = 186369915

// dump module header / imports near worktree UMs
const umsBand = 186320000
lines.push('## worktree-band start @186320000')
lines.push(asciiSlice(b, umsBand, umsBand + 1500))
lines.push('')

// search function sp(e,t) / function sp(e,t, in 178e6-187e6
for (const n of [
  'function sp(e,t)',
  'function sp(e,t)',
  'sp=(e,t)',
  'sp=function(e,t)',
  ',sp,',
]) {
  const hits = allHits(b, n).filter((i) => i > 178000000 && i < 187000000)
  lines.push(`## ${JSON.stringify(n)} in 178-187M hits=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    lines.push(`- @${i} ${asciiSlice(b, i - 40, i + 220)}`)
  }
  lines.push('')
}

// all "function sp(" between 186000000 and 186369915
{
  const needle = Buffer.from('function sp(')
  let i = 186000000
  const hits = []
  while (i < p0n) {
    const k = b.indexOf(needle, i)
    if (k < 0 || k >= p0n) break
    hits.push(k)
    i = k + needle.length
  }
  lines.push(`## function sp( in 186M-P0n hits=${hits.length}`)
  for (const i2 of hits) {
    lines.push(`- @${i2} ${asciiSlice(b, i2, i2 + 300)}`)
  }
  lines.push('')
}

// Look at how v0n uses jn(sp(...)) and define those
const v0n = b.indexOf(Buffer.from('async function v0n('))
lines.push(`## v0n @${v0n}`)
const ext = extractFnAt(b, v0n, 2500)
if (ext.body) lines.push(ext.body)
lines.push('')

// Find last "function sp" of any arity before 186369915 in whole file via lookback 2MB
{
  const start = Math.max(0, p0n - 2_000_000)
  const win = asciiSlice(b, start, p0n)
  const re = /function sp\([^)]*\)\{/g
  let m
  const all = []
  while ((m = re.exec(win))) all.push({ rel: m.index, abs: start + m.index, sig: m[0] })
  lines.push(`## function sp( in 2MB before P0n count=${all.length}`)
  for (const x of all) lines.push(`- @${x.abs} ${x.sig}`)
  if (all.length) {
    const last = all[all.length - 1]
    const fn = extractFnAt(b, last.abs, 800)
    lines.push(`## last-sp-body @${last.abs}`)
    lines.push(fn.body || JSON.stringify(fn))
  }
  lines.push('')
}

// Maybe sp is resolve: search "function sp(e,t){return" in whole
for (const n of [
  'function sp(e,t){return',
  'function sp(e,t){let',
  'sp(e,p)===sp(e,g)',
]) {
  const hits = allHits(b, n)
  lines.push(`## exact ${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    lines.push(`- @${i} ${asciiSlice(b, i - 80, i + 250)}`)
    if (n.startsWith('function')) {
      const fn = extractFnAt(b, i, 400)
      if (fn.body) lines.push(fn.body)
    }
  }
  lines.push('')
}

// import {X as sp} near worktree chunk
{
  const win = asciiSlice(b, 186250000, 186330000)
  const imps = [...win.matchAll(/as sp[},]/g)]
  lines.push(`## as sp in 186250-186330 count=${imps.length}`)
  for (const m of imps.slice(0, 10)) {
    lines.push(win.slice(Math.max(0, m.index - 80), m.index + 80))
  }
  lines.push('')
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-20-sp2.txt',
  lines.join('\n'),
)
console.log('WROTE gold-248-20-sp2.txt', lines.length)
