/**
 * densable 2.1.251 SEA peel recon4 — prove #33 imports + leftover bodies.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea()
const lines = []
const log = s => {
  lines.push(s)
  console.log(s)
}

function dumpHits(needle, cap = 20) {
  const hits = allHits(buf, needle)
  log(`${JSON.stringify(needle)} hits=${hits.length}`)
  for (const i of hits.slice(0, cap)) {
    log(`  @${i} | ${asciiSlice(buf, i - 40, i + 90).replace(/\s+/g, ' ')}`)
  }
  return hits
}

function extractAt(i, maxLen = 8000) {
  const fn = extractFnAt(buf, i, maxLen)
  log(
    `extract @${i} miss=${!!fn.miss || !!fn.missEnd} len=${fn.len ?? 0} sha=${fn.sha ?? '-'}`,
  )
  if (fn.body) log(fn.body)
  else log((fn.preview || '').slice(0, 400))
  log('---')
  return fn
}

const uo = 204655316
log('=== pp8hjrn6 / 81n9r8qk near uo ===')
for (const n of [
  'chunk-pp8hjrn6',
  'chunk-81n9r8qk',
  'import{_,f,g}',
  'import{J,H$e}',
  'import{J,',
]) {
  const hits = allHits(buf, n).filter(i => i > 203000000 && i < uo)
  log(`${n} in (203e6, uo)=${hits.length} ${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiSlice(buf, i - 20, i + 80).replace(/\s+/g, ' ')}`)
  }
}

log('\n=== last @bun before L ===')
{
  const needle = Buffer.from('.// @bun @bytecode')
  let last = -1
  let i = 203500000
  while (i < 204651605) {
    const k = buf.indexOf(needle, i)
    if (k < 0 || k >= 204651605) break
    last = k
    i = k + 1
  }
  log(`last @bun before L: ${last}`)
  if (last >= 0) {
    log(asciiSlice(buf, last, last + 400))
    const imp = asciiSlice(buf, last, last + 2500)
    const names = [...imp.matchAll(/import\{([^}]+)\}/g)].map(m => m[1])
    log('named imports: ' + names.slice(0, 40).join(' || '))
    const has = {
      underscore: /\b_\b/.test(imp),
      g: /(^|[,{])g([,}])/.test(imp),
      J: /(^|[,{])J([,}])/.test(imp),
      pp8: imp.includes('pp8hjrn6'),
      r8qk: imp.includes('81n9r8qk'),
    }
    log('flags ' + JSON.stringify(has))
  }
}

log('\n=== search named import of _ g J in 2044-2046 ===')
{
  const winStart = 204400000
  const win = asciiSlice(buf, winStart, 204651605)
  const re = /import\{[^}]*\b(_|g|J)\b[^}]*\}from"B:\/~BUN\/root\/chunk-[^"]+"/g
  let m
  const found = []
  while ((m = re.exec(win))) found.push({ rel: m.index, text: m[0] })
  log(`matching imports ${found.length}`)
  for (const f of found.slice(0, 30)) {
    log(`  @${winStart + f.rel} ${f.text}`)
  }
}

log('\n=== qe before gRt ===')
extractAt(210227142, 2000)
log(asciiSlice(buf, 210226900, 210227360))

log('\n=== fke ===')
extractAt(179690054, 2000)

log('\n=== class u italic ===')
{
  const hits = allHits(buf, 'class u{proc;constructor(r=process)')
  log('class u hits ' + hits.join(','))
  for (const i of hits) {
    const win = asciiSlice(buf, i, i + 2500)
    const end = win.indexOf('rendersItalicAsStandout(){')
    log(`class u @${i} italicRel=${end}`)
    log(win.slice(0, 200))
  }
}

log('\n=== export _ g J from telemetry ===')
log(asciiSlice(buf, 179407580, 179408050))
{
  const hits = allHits(buf, 'export{_,f,g')
  log('export{_,f,g hits ' + hits.length)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${asciiSlice(buf, i, i + 80)}`)
  }
}

log('\n=== J export neighborhood ===')
log(asciiSlice(buf, 179949300, 179949500))
dumpHits('export{J,', 8)

log('\n=== bug command load/call ===')
log(asciiSlice(buf, 187510850, 187511200))
dumpHits('aliases:["share"]', 3)
dumpHits('m==="share"?"/share":"/bug"', 3)

log('\n=== $Y neighborhood zS goe ===')
extractAt(187704335, 400)
log(asciiSlice(buf, 179689090, 179689250))

const out = join(__dir, '_peel-251-k-recon4.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.error('wrote', out)
