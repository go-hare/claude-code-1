/**
 * Pass 3: lock _360 uL/vL bodies, Td/h=FV, uk().host, wa/Hnd.
 * Invent-ban. Collision-ban Ohe/Nhe/FV/We.
 */
import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(needle, limit = 40) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFn(start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  const begin = start
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        const end = i + 1
        return { start: begin, end, text: asciiWindow(buf, begin, end) }
      }
    }
  }
  return {
    start: begin,
    end: begin + 200,
    text: asciiWindow(buf, begin, begin + 200),
  }
}

function dump(name, content) {
  const p = `${outDir}/${name}`
  writeFileSync(p, content)
  return p
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log(`# tip-pluginId pass3 size=${buf.length}`)

const uniqueNeedles = [
  'export{p as tL,a as uL,h as vL,m as wL',
  'function a(n){return s().tipLifetimeShownCounts?.[n]??0}',
  'function h(n){return s().pluginSuggestionShownCounts?.[n]??0}',
  'pluginSuggestionShownCounts',
  'pluginSuggestionDiscoverShownCounts',
  'Td as FV',
  'h as Td',
  'var h=new ye(()=>new Xt)',
  'Hnd as wa',
  'Hnd as ye',
  'from"B:/~BUN/root/_360.js"',
  'from"B:/~BUN/root/_35.js"',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(
      `  @${i} ${asciiWindow(buf, i - 60, i + n.length + 180).replace(/\n/g, ' ')}`,
    )
  }
}

// uk().host windows
const ukHost = findAll('uk().host', 10)
for (const [n, i] of ukHost.entries()) {
  dump(
    `gold-tip-pluginId-uk-host-${n}.txt`,
    `# uk().host @${i}\n${asciiWindow(buf, i - 200, i + 250)}\n`,
  )
  log(`UKHOST @${i} ${asciiWindow(buf, i - 80, i + 120).replace(/\n/g, ' ')}`)
}

// as uk near Qhe bundle (23202xxxx–23239xxxx)
const asUk = findAll(' as uk', 20)
for (const i of asUk) {
  if (i < 232000000 || i > 232400000) continue
  log(`ASUK-QHE @${i} ${asciiWindow(buf, i - 80, i + 160).replace(/\n/g, ' ')}`)
  dump(
    `gold-tip-pluginId-as-uk-${i}.txt`,
    `# as uk @${i}\n${asciiWindow(buf, i - 200, i + 400)}\n`,
  )
}

// Td export / h as Td
for (const n of ['h as Td', 'Td as FV', 'export{h as', 'h as h,', ',h as ']) {
  const hits = findAll(n, 15)
  log(`TD ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i - 80, i + 200).replace(/\n/g, ' ')}`)
  }
}

// _35.js module: find export{ ... Td
const t35 = findAll('from"B:/~BUN/root/_35.js"', 10)
for (const [n, i] of t35.entries()) {
  dump(
    `gold-tip-pluginId-35-import-${n}.txt`,
    `# _35.js import @${i}\n${asciiWindow(buf, i - 120, i + 200)}\n`,
  )
}

// Find _35.js itself via unique neighbor of Td export
const tdExport = findAll(' as Td', 20)
for (const i of tdExport) {
  const win = asciiWindow(buf, i - 100, i + 80)
  log(`AS-Td @${i} ${win.replace(/\n/g, ' ')}`)
}

// _360 full module dump around export
const exp360 = findAll('export{p as tL,a as uL,h as vL,m as wL', 3)
for (const [n, i] of exp360.entries()) {
  dump(
    `gold-tip-pluginId-360-export-${n}.txt`,
    `# _360 export @${i}\n${asciiWindow(buf, i - 1200, i + 200)}\n`,
  )
  log(`DUMP 360-export @${i}`)
}

// function a(n) tipLifetime — unique body
const aHits = findAll(
  'function a(n){return s().tipLifetimeShownCounts?.[n]??0}',
  5,
)
for (const [n, i] of aHits.entries()) {
  const fn = extractFn(i)
  dump(
    `gold-tip-pluginId-Nhe-uL-${n}.txt`,
    `# uL=a=Nhe pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP Nhe-uL @${i} len=${fn.end - i}`)
}

const hHits = findAll(
  'function h(n){return s().pluginSuggestionShownCounts?.[n]??0}',
  5,
)
for (const [n, i] of hHits.entries()) {
  const fn = extractFn(i)
  dump(
    `gold-tip-pluginId-Ohe-vL-${n}.txt`,
    `# vL=h=Ohe pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP Ohe-vL @${i} len=${fn.end - i}`)
}

// Xt class + h factory + getMarketplacePluginTips
const xt = findAll('class Xt{knownMarketplaces=void 0;marketplacePluginTips', 5)
for (const [n, i] of xt.entries()) {
  dump(
    `gold-tip-pluginId-Xt-${n}.txt`,
    `# class Xt @${i}\n${asciiWindow(buf, i, i + 1800)}\n`,
  )
  log(`DUMP Xt @${i}`)
}

// wa factory class — Hnd from _839
const waHits = findAll('Hnd as wa', 10)
for (const i of waHits) {
  if (i < 232000000 || i > 232400000) continue
  log(`Hnd-wa @${i} ${asciiWindow(buf, i - 40, i + 80).replace(/\n/g, ' ')}`)
}

dump('gold-tip-pluginId-scan3.txt', report.join('\n') + '\n')
