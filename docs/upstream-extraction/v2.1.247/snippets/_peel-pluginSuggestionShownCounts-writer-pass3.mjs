/**
 * Pass 3: unique fye/Ohe binds, 246 wye/yN bodies, pluginSuggestion*
 * inventory, default-config neighbor, kwc/Le updater not this key.
 */
import { readFileSync, writeFileSync } from 'fs'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const bufs = {
  246: readFileSync(SEA[246]),
  247: readFileSync(SEA[247]),
}

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

function findAll(buf, needle, limit = 40) {
  const n = Buffer.from(needle)
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

function extractFn(buf, start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
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
        return { start, end: i + 1, text: asciiWindow(buf, start, i + 1) }
      }
    }
    if (i - start > 8000) break
  }
  return { start, end: start + 500, text: asciiWindow(buf, start, start + 500) }
}

function dump(name, content) {
  writeFileSync(
    `${outDir}/${name}`,
    content.endsWith('\n') ? content : `${content}\n`,
  )
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

const n247 = [
  'vL as Ohe',
  'Ohe(r.pluginId)',
  'from"B:/~BUN/root/_360.js"',
  'pluginSuggestion',
  'Le as kwc',
  'k as owc',
  'function Ye(){return{numStartups:0',
  'tipLifetimeShownCounts:{}',
  'pluginSuggestionShownCounts:{}',
  'pluginSuggestionDiscoverShownCounts:{}',
]

const n246 = [
  'VJ as fye',
  'fye(r.pluginId)',
  'fye(',
  'from"B:/~BUN/root/_345.js"',
  'async function wye(e){if(LV().spinnerTipsEnabled',
  'function yN(e,t="spinner",o){mye(e.id',
  'pluginSuggestion',
  'function je(){return{numStartups:0',
]

for (const [ver, list] of [
  [247, n247],
  [246, n246],
]) {
  const buf = bufs[ver]
  log(`\n======== PASS3 SEA ${ver}`)
  for (const n of list) {
    const hits = findAll(buf, n, 40)
    log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
    for (const i of hits.slice(0, 15)) {
      log(
        `  @${i} ${asciiWindow(buf, i - 40, i + n.length + 140).replace(/\n/g, ' ')}`,
      )
    }
  }
}

{
  const b = bufs[246]
  const w = b.indexOf('async function wye(e){if(LV().spinnerTipsEnabled')
  const y = b.indexOf('function yN(e,t="spinner",o){mye(e.id')
  const h = b.indexOf(
    'function h(n){return s().pluginSuggestionShownCounts?.[n]??0}',
  )
  dump(
    'gold-pluginSuggestionShownCounts-writer-246-wye.txt',
    `# wye @${w}\n${extractFn(b, w).text}\n`,
  )
  dump(
    'gold-pluginSuggestionShownCounts-writer-246-yN.txt',
    `# yN @${y}\n${extractFn(b, y).text}\n`,
  )
  dump(
    'gold-pluginSuggestionShownCounts-writer-246-h-VJ.txt',
    `# h=VJ @${h}\n${extractFn(b, h).text}\n`,
  )
  log(`DUMP 246 wye@${w} yN@${y} h@${h}`)
}

{
  const b = bufs[247]
  const h = b.indexOf(
    'function h(n){return s().pluginSuggestionShownCounts?.[n]??0}',
  )
  const p = b.indexOf('function p(n,i){let t=s().numStartups;u((o)=>{')
  const l = b.indexOf(
    'function l(n,i){if(n.length===0)return;u((t)=>{let o=t.pluginSuggestionDiscoverShownCounts',
  )
  dump(
    'gold-pluginSuggestionShownCounts-writer-247-h-vL.txt',
    `# h=vL=Ohe @${h}\n${extractFn(b, h).text}\n`,
  )
  dump(
    'gold-pluginSuggestionShownCounts-writer-247-p-tL-Lhe.txt',
    `# p=tL=Lhe @${p}\n${extractFn(b, p).text}\n`,
  )
  dump(
    'gold-pluginSuggestionShownCounts-writer-247-l-yL-discover.txt',
    `# l=yL discover WRITER @${l}\n${extractFn(b, l).text}\n`,
  )
  log(`DUMP 247 h@${h} p@${p} l@${l}`)
}

// classify every pluginSuggestion* hit
for (const ver of [247, 246]) {
  const buf = bufs[ver]
  const hits = findAll(buf, 'pluginSuggestion', 30)
  log(`\nCLASS ${ver} pluginSuggestion count=${hits.length}`)
  for (const [n, i] of hits.entries()) {
    const ident = asciiWindow(buf, i, i + 48)
    const after = asciiWindow(buf, i + ident.indexOf('C') >= 0 ? i + 21 : i, i + 40)
    log(`  #${n} @${i} ident=${JSON.stringify(ident)}`)
    dump(
      `gold-pluginSuggestionShownCounts-writer-${ver}-pluginSuggestion-${n}.txt`,
      `# ${ver} pluginSuggestion #${n} @${i}\n${asciiWindow(buf, i - 80, i + 200)}\n`,
    )
  }
}

dump('gold-pluginSuggestionShownCounts-writer-scan3.txt', report.join('\n') + '\n')
console.log('WROTE scan3')
