/**
 * Pass2: extract complete jdb spread-mount callers.
 * 247: Qu(LR,{...o,children:i}) @211364646
 * 247: n(Ar,{...Dn,children:_r}) @223181692
 * 246 leftover: Provider exported as ubb not jdb — follow ubb as.
 * Invent-ban.
 */
import { readFileSync, writeFileSync } from 'fs'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf247 = readFileSync(SEA[247])
const buf246 = readFileSync(SEA[246])

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
  return s
}

function compact(s) {
  return s.replace(/[.]{4,}/g, '...').replace(/\n/g, ' ')
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
  }
  return { start, end: start + 200, text: asciiWindow(buf, start, start + 200) }
}

function walkBackFunction(buf, pos, maxBack = 12000) {
  const floor = Math.max(0, pos - maxBack)
  const n = Buffer.from('function ')
  let from = floor
  let last = -1
  while (from < pos) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= pos) break
    last = i
    from = i + n.length
  }
  return last
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# PASS2 extract jdb spread-mount callers')

// ---- LR mount @211364646 ----
{
  const i = 211364646
  const fnAt = walkBackFunction(buf247, i, 20000)
  log(`LR-mount call@${i} walkBack function@${fnAt}`)
  dump(
    'gold-We-provider-mount-LR-before-2k.txt',
    `# LR Qu(LR,{...o,children:i}) @${i}\n${asciiWindow(buf247, i - 2000, i + 400)}\n`,
  )
  if (fnAt >= 0) {
    const fn = extractFn(buf247, fnAt)
    log(`LR-caller @${fnAt} end=${fn.end} len=${fn.end - fnAt}`)
    dump(
      `gold-We-provider-mount-LR-fn-${fnAt}.txt`,
      `# LR caller @${fnAt} end=${fn.end} len=${fn.end - fnAt}\n${fn.text}\n`,
    )
    // also previous function (maybe helper)
    const prev = walkBackFunction(buf247, fnAt - 1, 8000)
    if (prev >= 0) {
      const pfn = extractFn(buf247, prev)
      log(`LR-prevfn @${prev} end=${pfn.end} len=${pfn.end - prev}`)
      dump(
        `gold-We-provider-mount-LR-prevfn-${prev}.txt`,
        `# prev fn @${prev} end=${pfn.end} len=${pfn.end - prev}\n${pfn.text}\n`,
      )
    }
  }
  // next few functions after mount
  let nxt = buf247.indexOf(Buffer.from('function '), i)
  for (let k = 0; k < 4 && nxt >= 0 && nxt < i + 4000; k++) {
    const fn = extractFn(buf247, nxt)
    log(`LR-afterfn${k} @${nxt} len=${fn.end - nxt} ${compact(fn.text).slice(0, 180)}`)
    dump(
      `gold-We-provider-mount-LR-afterfn${k}-${nxt}.txt`,
      `# afterfn${k} @${nxt} end=${fn.end}\n${fn.text}\n`,
    )
    nxt = buf247.indexOf(Buffer.from('function '), fn.end)
  }
}

// ---- Ar mount @223181692 ----
{
  const i = 223181692
  const fnAt = walkBackFunction(buf247, i, 20000)
  log(`Ar-mount call@${i} walkBack function@${fnAt}`)
  dump(
    'gold-We-provider-mount-Ar-before-2k.txt',
    `# Ar n(Ar,{...Dn,children:_r}) @${i}\n${asciiWindow(buf247, i - 2000, i + 400)}\n`,
  )
  if (fnAt >= 0) {
    const fn = extractFn(buf247, fnAt)
    log(`Ar-caller @${fnAt} end=${fn.end} len=${fn.end - fnAt}`)
    dump(
      `gold-We-provider-mount-Ar-fn-${fnAt}.txt`,
      `# Ar caller @${fnAt} end=${fn.end} len=${fn.end - fnAt}\n${fn.text}\n`,
    )
  }
  // dump ENTIRE Ar module — 23k
  dump(
    'gold-We-provider-mount-Ar-mod-full.txt',
    `# Ar/jdb module @223158870..223182569\n${asciiWindow(buf247, 223158870, 223182569)}\n`,
  )
}

// unique strings near LR mount (skip import paths)
{
  const win = asciiWindow(buf247, 211350000, 211367378)
  const strs = []
  const re = /"((?:[^"\\]|\\.){6,80})"/g
  let m
  while ((m = re.exec(win))) {
    if (!m[1].includes('B:/~BUN')) strs.push(m[1])
  }
  log(`LR-near-export strings count=${strs.length}`)
  for (const s of strs.slice(0, 40)) log(`  STR ${JSON.stringify(s)}`)
}

{
  const win = asciiWindow(buf247, 223158870, 223182569)
  const strs = []
  const re = /"((?:[^"\\]|\\.){6,80})"/g
  let m
  while ((m = re.exec(win))) {
    if (!m[1].includes('B:/~BUN')) strs.push(m[1])
  }
  log(`Ar-mod strings count=${strs.length}`)
  for (const s of strs.slice(0, 50)) log(`  STR ${JSON.stringify(s)}`)
}

// needles around LR caller: o / sessionServices / ce / Y7b
for (const n of [
  'Qu(LR,{...o,children:i})',
  'o!==void 0?Qu(LR',
  'n(Ar,{...Dn,children:_r})',
  'sessionServices',
  'Y7b as ',
  'X7b as ',
  'ce as ',
  'function ce(',
]) {
  const hits = findAll(buf247, n, 15)
  log(`${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 50, i + 120))}`)
  }
}

// Y7b / ce imports inside LR module range
{
  const start = 210987644
  const end = 211367378
  for (const n of ['Y7b as ', 'X7b as ', 'Z7b as ', 'ce(', 'sessionServicesFor', 'credentialsStoreFor']) {
    const nbuf = Buffer.from(n)
    const hits = []
    let from = start
    while (hits.length < 20) {
      const i = buf247.indexOf(nbuf, from)
      if (i < 0 || i >= end) break
      hits.push(i)
      from = i + nbuf.length
    }
    log(`LRmod ${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
    for (const i of hits.slice(0, 5)) {
      log(`  @${i} ${compact(asciiWindow(buf247, i - 40, i + 100))}`)
    }
  }
}

// ---- 246: Provider export ubb / vbb and mounts ----
log('\n# 246 Provider export + mounts')
for (const n of [
  ' as ubb',
  'ubb as ',
  ' as vbb',
  'vbb as ',
  'export{z as ubb',
  '{...o,children:',
  '{...Dn,children:',
  '!==void 0?',
]) {
  const a = findAll(buf246, n, 20)
  const b = findAll(buf247, n, 20)
  log(`${a.length === b.length ? 'same' : 'DIFF'} 246=${a.length} 247=${b.length} ${JSON.stringify(n)}`)
  for (const i of a.slice(0, 6)) {
    log(`  246 @${i} ${compact(asciiWindow(buf246, i - 40, i + 140))}`)
  }
}

// 246 unique: function z Provider then search ubb as in 246
{
  const hits = findAll(buf246, 'ubb as ', 20)
  log(`246 ubb as count=${hits.length}`)
  for (const i of hits) {
    log(`  246 ubb-import @${i} ${compact(asciiWindow(buf246, i - 80, i + 160))}`)
  }
}

// 246 same spread mount shape near Provider consumers
for (const n of [
  '{...o,children:i}',
  '{...o,children:',
  'children:i}):i}',
  '!==void 0?Qu(',
  '!==void 0?n(',
  '!==void 0?a(',
  '!==void 0?t(',
]) {
  const hits = findAll(buf246, n, 15)
  log(`246 ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${compact(asciiWindow(buf246, i - 60, i + 140))}`)
  }
}

dump('gold-We-provider-mount-pass2-scan.txt', report.join('\n') + '\n')
