import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
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

function findAll(needle, limit = 20, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (hits.length < limit) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j > to) break
    hits.push(j)
    i = j + n.length
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
        return { start, end: i + 1, text: asciiWindow(start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# ho-yo pass2 $t/vo/fo/caps')

// complete vo quote
const voNeedle =
  "vo='Bare source names resolve under metadata.pluginRoot"
const voHits = findAll(voNeedle, 5)
log(`VO needle count=${voHits.length} ${voHits.join(',')}`)
for (const i of voHits) {
  const win = asciiWindow(i, i + 400)
  dump('gold-ho-yo-vo.txt', `# vo@${i}\n${win}\n`)
  log(`VO @${i} ${win}`)
}

// fo assignment complete
const foHits = findAll(
  'fo=new Set(["npm","url","github","git-subdir","archive","command","unsupported"])',
  5,
)
log(`FO count=${foHits.length} ${foHits.join(',')}`)
for (const i of foHits) {
  const win = asciiWindow(i, i + 180)
  dump('gold-ho-yo-fo.txt', `# fo@${i}\n${win}\n`)
  log(`FO @${i} ${win}`)
}

// So/ko unique assignment cluster
const soHits = findAll(',fo,_o,So=3,ko=160,xo,vo=', 4)
log(`SOKO count=${soHits.length} ${soHits.join(',')}`)
for (const i of soHits) {
  dump(
    'gold-ho-yo-So-ko.txt',
    `# So/ko@${i}\n${asciiWindow(i, i + 220)}\n`,
  )
  log(`SOKO @${i} ${asciiWindow(i, i + 80)}`)
}

// _o / xo
const xoHits = findAll('xo=/^[A-Za-z0-9][-A-Za-z0-9._]*$/', 6)
const _oHits = findAll('_o=/^[A-Za-z0-9_$.-]{1,40}$/', 6)
log(`XO count=${xoHits.length} ${xoHits.join(',')}`)
log(`_O count=${_oHits.length} ${_oHits.join(',')}`)
for (const i of xoHits) {
  dump('gold-ho-yo-xo.txt', `# xo@${i}\n${asciiWindow(i, i + 80)}\n`)
}
for (const i of _oHits) {
  dump('gold-ho-yo-_o.txt', `# _o@${i}\n${asciiWindow(i, i + 80)}\n`)
}

// $t bind: _716 imports AQc as $t; _717 exports d as AQc
dump(
  'gold-ho-yo-dollar-import.txt',
  `# @207835172\n${asciiWindow(207835150, 207835280)}\n`,
)
dump(
  'gold-ho-yo-AQc-export.txt',
  `# @207828236\n${asciiWindow(207828180, 207828320)}\n`,
)

// walk _717 module for function d
const bun717 = findAll('// @bun @bytecode', 8, 207780000, 207828236)
log(`bun before AQc export ${bun717.join(',')}`)
const lastBun = bun717[bun717.length - 1]
if (lastBun) {
  dump(
    'gold-ho-yo-717-head.txt',
    `# bun@${lastBun}\n${asciiWindow(lastBun, lastBun + 2500)}\n`,
  )
}

for (const pat of [
  'function d(e,t)',
  'function d(e,t){',
  'function d(t,e)',
  'd=(e,t)=>',
  'function d(e){',
]) {
  const hits = findAll(pat, 15, 207780000, 207828236)
  log(`D717 ${JSON.stringify(pat)} ${hits.join(',')}`)
  for (const i of hits) {
    const fn = extractFn(i)
    log(`  @${i} len=${fn.end - i} ${fn.text.slice(0, 200)}`)
  }
}

// unique $t truncate patterns used with ko=160
for (const pat of [
  'function d(e,t){return typeof e==="string"',
  'function d(e,t){if(typeof e!=="string")',
  'function d(e,t){return e.length',
  'function d(e,t){if(e.length',
  '.slice(0,t)+"..."',
  '.slice(0,t)+"…"',
  'slice(0,t)+"',
]) {
  const hits = findAll(pat, 12)
  log(`TRUNC ${JSON.stringify(pat)} count=${hits.length} ${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 40, i + 160).replace(/\n/g, ' ')}`)
  }
}

// export line complete
dump(
  'gold-ho-yo-716-export.txt',
  `# @207915890\n${asciiWindow(207915800, 207916050)}\n`,
)

// confirm bo not in export
const exp = asciiWindow(207915294, 207916050)
log(`EXPORT has bo as? ${exp.includes('bo as ')}`)
log(`EXPORT snippet ${exp}`)

// os uniqueness of THIS body
const osBody = findAll(
  'function os(e){return typeof e==="string"&&xo.test(e)&&!e.includes("..")}',
  8,
)
log(`OS BODY UNIQUE count=${osBody.length} ${osBody.join(',')}`)

const yoBody = findAll(
  'function yo(e){if(!e||typeof e!=="object")return!1;let t=e.source',
  8,
)
log(`YO BODY UNIQUE count=${yoBody.length} ${yoBody.join(',')}`)

const boBody = findAll(
  'function bo(e){let t=e.find((o)=>o.path.length===1&&o.path[0]==="source")',
  8,
)
log(`BO BODY UNIQUE count=${boBody.length} ${boBody.join(',')}`)

const nsBody = findAll(
  'function ns(e){let t=e.slice(0,So).map((o)=>{let n=o.path.map(String)',
  8,
)
log(`NS BODY UNIQUE count=${nsBody.length} ${nsBody.join(',')}`)

// local-equivalent note: marketplacePluginRoot isBare
dump(
  'gold-ho-yo-os-vs-local.txt',
  `# os@207875596 === local isBareMarketplacePluginSource
# os: function os(e){return typeof e==="string"&&xo.test(e)&&!e.includes("..")}
# xo@207910796: xo=/^[A-Za-z0-9][-A-Za-z0-9._]*$/
# local marketplacePluginRoot.ts:
#   BARE_PLUGIN_SOURCE_RE = /^[A-Za-z0-9][-A-Za-z0-9._]*$/
#   isBareMarketplacePluginSource: typeof string && RE.test && !includes("..")
# NOT RelativePath (that is j=p(()=>i().startsWith("./")) @ Ao init)
`,
)

dump('gold-ho-yo-pass2-scan.txt', report.join('\n') + '\n')
