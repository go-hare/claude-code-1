/**
 * Peel: who WRITES official pluginSuggestionShownCounts.
 * Invent-ban. Scan 247 AND 246. Do not invent a writer.
 */
import { readFileSync, writeFileSync } from 'fs'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const EXPECT = { 247: 253204128, 246: 250948768 }
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const KEY = 'pluginSuggestionShownCounts'

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

function findAll(buf, needle, limit = 80) {
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

function utf16le(s) {
  return Buffer.from(s, 'utf16le')
}

function classifyAfter(buf, i, keyLen) {
  const after = asciiWindow(buf, i + keyLen, i + keyLen + 8)
  const before = asciiWindow(buf, i - 12, i)
  if (after.startsWith('?.[')) return 'READER_OPTIONAL'
  if (after.startsWith('??')) return 'WRITE_DEFAULT'
  if (after.startsWith(':')) return 'PROP_COLON'
  if (after.startsWith('=')) return 'ASSIGN'
  if (after.startsWith('[')) return 'BRACKET'
  if (after.startsWith('.')) return 'DOT_OR_SMAP'
  if (before.includes("['") || before.includes('["') || before.includes('[`')) {
    return 'COMPUTED_KEY'
  }
  if (after.startsWith('#') || before.includes('file:') || before.includes('.js')) {
    return 'STRING_TABLE_OR_SMAP'
  }
  return `OTHER after=${JSON.stringify(after)} before=${JSON.stringify(before)}`
}

function extractFnBack(buf, pos) {
  let i = pos
  while (i > 0) {
    if (
      buf[i] === 102 &&
      buf[i + 1] === 117 &&
      buf[i + 2] === 110 &&
      buf[i + 3] === 99 &&
      buf[i + 4] === 116 &&
      buf[i + 5] === 105 &&
      buf[i + 6] === 111 &&
      buf[i + 7] === 110 &&
      (buf[i + 8] === 32 || buf[i + 8] === 40)
    ) {
      break
    }
    i--
    if (pos - i > 4000) {
      return {
        start: Math.max(0, pos - 200),
        end: pos + 200,
        text: asciiWindow(buf, pos - 200, pos + 200),
        truncated: true,
      }
    }
  }
  let j = i
  while (j < buf.length && buf[j] !== 123) j++
  if (j >= buf.length) {
    return { start: i, end: i, text: '', truncated: true }
  }
  let depth = 0
  let inS = 0
  let esc = false
  for (; j < buf.length; j++) {
    const c = buf[j]
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
        const end = j + 1
        return { start: i, end, text: asciiWindow(buf, i, end), truncated: false }
      }
    }
    if (j - i > 8000) {
      return {
        start: i,
        end: i + 800,
        text: asciiWindow(buf, i, i + 800),
        truncated: true,
      }
    }
  }
  return { start: i, end: i + 200, text: asciiWindow(buf, i, i + 200), truncated: true }
}

function dump(name, content) {
  const p = `${outDir}/${name}`
  writeFileSync(p, content.endsWith('\n') ? content : `${content}\n`)
  return p
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

const WRITE_SHAPES = [
  `${KEY}:`,
  `${KEY}??`,
  `${KEY}[`,
  `${KEY}=`,
  `['${KEY}']`,
  `["${KEY}"]`,
  `[\`${KEY}\`]`,
  `${KEY}:{`,
  `${KEY}:{}`,
  `${KEY}:n`,
  `${KEY}:e`,
  `${KEY}:t`,
  `${KEY}:r`,
  `${KEY}:o`,
  `${KEY}:i`,
  `${KEY}:a`,
  `,${KEY}:`,
  `{${KEY}:`,
  `... ,${KEY}`,
  `pluginSuggestionShownCounts`,
  'pluginSuggestionDiscoverShownCounts',
  'pluginSuggestionDiscoverShownCounts:',
  'pluginSuggestionDiscoverShownCounts??',
  'tipLifetimeShownCounts:',
  'tipLifetimeShownCounts??',
  'tipLifetimeShownCounts:{}',
  'tipsHistory:{}',
]

const NEIGHBOR = [
  'function h(n){return s().pluginSuggestionShownCounts?.[n]??0}',
  'function a(n){return s().tipLifetimeShownCounts?.[n]??0}',
  'tL as Lhe',
  'vL as Ohe',
  'uL as Nhe',
  'function mL(e,t="spinner",o){Lhe(e.id',
  'async function Qhe(e){if(MV().spinnerTipsEnabled',
  'Lhe(e.id',
  'Ohe(r.pluginId)',
  'Nhe(r.id)',
]

const COLLIDE = [
  'function Ohe(e){',
  'function Ohe(e,t){',
  'function Nhe(e){',
  'function Nhe(e,t){',
  'var Ohe=',
  'Ohe=e=>',
  'var Nhe=',
  'Nhe=e=>',
]

for (const ver of [247, 246]) {
  const buf = bufs[ver]
  log(`\n======== SEA ${ver} size=${buf.length} expect=${EXPECT[ver]} match=${buf.length === EXPECT[ver]}`)

  const all = findAll(buf, KEY, 40)
  log(`STR ${JSON.stringify(KEY)} count=${all.length} hits=${all.join(',')}`)
  for (const [n, i] of all.entries()) {
    const kind = classifyAfter(buf, i, KEY.length)
    const win = asciiWindow(buf, i - 100, i + KEY.length + 180).replace(/\n/g, ' ')
    log(`  HIT${n} @${i} kind=${kind}`)
    log(`    ${win}`)
    const fn = extractFnBack(buf, i)
    dump(
      `gold-pluginSuggestionShownCounts-writer-${ver}-hit${n}.txt`,
      `# ${ver} ${KEY} hit${n} @${i} kind=${kind} fn@${fn.start}..${fn.end} trunc=${fn.truncated}\n${fn.text}\n`,
    )
    dump(
      `gold-pluginSuggestionShownCounts-writer-${ver}-hit${n}-win.txt`,
      `# ${ver} win @${i}\n${asciiWindow(buf, i - 240, i + 360)}\n`,
    )
  }

  const u16 = findAll(buf, utf16le(KEY), 20)
  log(`UTF16LE ${JSON.stringify(KEY)} count=${u16.length} hits=${u16.join(',')}`)
  for (const i of u16.slice(0, 8)) {
    log(`  U16 @${i} ${asciiWindow(buf, i - 40, i + 80).replace(/\n/g, ' ')}`)
  }

  for (const n of WRITE_SHAPES) {
    const hits = findAll(buf, n, 25)
    log(`SHAPE ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
    for (const i of hits.slice(0, 8)) {
      log(`  @${i} ${asciiWindow(buf, i - 70, i + n.length + 140).replace(/\n/g, ' ')}`)
    }
  }

  for (const n of NEIGHBOR) {
    const hits = findAll(buf, n, 15)
    log(`NEI ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
    for (const i of hits.slice(0, 6)) {
      log(`  @${i} ${asciiWindow(buf, i, i + Math.min(n.length + 160, 220)).replace(/\n/g, ' ')}`)
    }
  }

  if (ver === 247) {
    for (const n of COLLIDE) {
      const hits = findAll(buf, n, 15)
      log(`COLLIDE ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
      for (const i of hits.slice(0, 6)) {
        log(`  @${i} ${asciiWindow(buf, i, i + 160).replace(/\n/g, ' ')}`)
      }
    }
  }

  const defHits = findAll(buf, 'tipLifetimeShownCounts:{}', 10)
  log(`SCHEMA tipLifetimeShownCounts:{} count=${defHits.length}`)
  for (const [n, i] of defHits.entries()) {
    const win = asciiWindow(buf, i - 220, i + 420)
    dump(
      `gold-pluginSuggestionShownCounts-writer-${ver}-schema-${n}.txt`,
      `# ${ver} tipLifetimeShownCounts:{} @${i}\n${win}\n`,
    )
    log(`  SCHEMA @${i} hasKey=${win.includes(KEY)} win=${win.replace(/\n/g, ' ').slice(0, 280)}`)
  }

  const tipsHist = findAll(buf, 'tipsHistory:{}', 10)
  log(`SCHEMA tipsHistory:{} count=${tipsHist.length}`)
  for (const [n, i] of tipsHist.entries()) {
    const win = asciiWindow(buf, i - 80, i + 360)
    const hasKey = win.includes(KEY)
    log(`  tipsHistory:{} @${i} hasKey=${hasKey}`)
    if (hasKey || n < 3) {
      dump(
        `gold-pluginSuggestionShownCounts-writer-${ver}-tipsHistory-${n}.txt`,
        `# ${ver} tipsHistory:{} @${i} hasKey=${hasKey}\n${win}\n`,
      )
    }
  }
}

dump('gold-pluginSuggestionShownCounts-writer-scan.txt', report.join('\n') + '\n')
console.log('WROTE gold-pluginSuggestionShownCounts-writer-scan.txt')
