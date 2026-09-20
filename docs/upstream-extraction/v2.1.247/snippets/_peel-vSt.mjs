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
  while (i < buf.length && buf[i] !== 123) i++ // {
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
  return { start: begin, end: begin + 200, text: asciiWindow(buf, begin, begin + 200) }
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

log(`# vSt peel official-247 size=${buf.length}`)

const uniqueNeedles = [
  'Official marketplace GCS fetch failed',
  'fetchOfficialMarketplaceFromGcs',
  'refusing path outside cache dir',
  'latest pointer returned empty body',
  'tengu_plugin_remote_fetch',
  'marketplace_gcs',
  'downloads.claude.ai/claude-code-releases/plugins/claude-plugins-official',
  'marketplaces/claude-plugins-official/',
  '.gcs-sha',
  'plugin_official_marketplace_fetch',
  'tengu_plugin_official_mkt_git_fallback',
  'gcs_failed_fallback_disabled',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(buf, i - 80, i + n.length + 80).replace(/\n/g, ' ')}`)
  }
}

const fnNeedles = [
  'async function vSt(',
  'function vSt(',
  'var vSt=',
  'let vSt=',
  'const vSt=',
  'vSt=async',
  'async function nBo(',
  'function nBo(',
  'function tBo(',
  'async function SSt(',
  'function SSt(',
  'async function wSt(',
  'function wSt(',
  'await vSt(',
]

for (const n of fnNeedles) {
  const hits = findAll(n, 30)
  log(`FN ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 12)) {
    const win = asciiWindow(buf, i, i + 220).replace(/\n/g, ' ')
    log(`  @${i} ${win}`)
  }
}

// collision-ban: other vSt bindings
const collisionNeedles = [
  'let vSt;',
  'let vSt,',
  ',vSt;',
  ',vSt=',
  'vSt=(',
  'vSt=async',
  'qn[97]=vSt',
  'else vSt=',
]

for (const n of collisionNeedles) {
  const hits = findAll(n, 20)
  log(`COLLIDE ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(buf, i - 60, i + 140).replace(/\n/g, ' ')}`)
  }
}

const aliasNeedles = [
  'vSt as ',
  ' as vSt',
  'export{vSt',
  ',vSt,',
  '{vSt}',
]

for (const n of aliasNeedles) {
  const hits = findAll(n, 15)
  log(`ALIAS ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(buf, i - 40, i + 80).replace(/\n/g, ' ')}`)
  }
}

const gcsHits = findAll('async function vSt(', 8)
for (const [idx, i] of gcsHits.entries()) {
  const fn = extractFn(i)
  dump(
    `gold-vSt-def-${idx}-${i}.txt`,
    `# needle=async function vSt( pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP async-vSt @${i} end=${fn.end} len=${fn.end - i}`)
}

const syncHits = findAll('function vSt(', 12)
for (const [idx, i] of syncHits.entries()) {
  // skip those already covered as async function vSt(
  if (gcsHits.includes(i - 6)) {
    log(`SKIP function vSt( @${i} (async prefix)`)
    continue
  }
  const fn = extractFn(i)
  dump(
    `gold-vSt-sync-${idx}-${i}.txt`,
    `# needle=function vSt( pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`DUMP sync-vSt @${i} end=${fn.end} len=${fn.end - i}`)
}

const failHits = findAll('Official marketplace GCS fetch failed', 5)
if (failHits[0] != null) {
  const i = failHits[0]
  dump(
    'gold-vSt-fail-before-8k.txt',
    `# Official marketplace GCS fetch failed @${i} before 8k\n${asciiWindow(buf, i - 8000, i)}\n`,
  )
  dump(
    'gold-vSt-fail-after-2k.txt',
    `# Official marketplace GCS fetch failed @${i} after 2k\n${asciiWindow(buf, i, i + 2000)}\n`,
  )
  log(`DUMP fail-neighborhood @${i}`)
}

// IBo / hza call-site windows
for (const n of ['await vSt(a.installLocation,_B(),', 'await vSt(a,_B(),']) {
  const hits = findAll(n, 8)
  log(`CALL ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits) {
    dump(
      `gold-vSt-call-${i}.txt`,
      `# call ${n} @${i}\n${asciiWindow(buf, i - 120, i + 200)}\n`,
    )
  }
}

dump('gold-vSt-scan.txt', report.join('\n') + '\n')
