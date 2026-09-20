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

function findAll(needle, limit = 20) {
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
        return { start, end, text: asciiWindow(start, end) }
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

// _506 export + ie host
dump('gold-gza-506-export-ie-Ahb.txt', `# @210754920\n${asciiWindow(210753800, 210755200)}\n`)
for (const n of ['function ie(', 'async function ie(', 'ie=e=>', 'ie=(e', 'function ie(e)']) {
  const hits = findAll(n, 15)
  log(`IE ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    const near506 = i > 210000000 && i < 210760000
    log(`  @${i}${near506 ? ' NEAR506' : ''} ${asciiWindow(i, i + 160).replace(/\n/g, ' ')}`)
    if (near506) {
      dump(`gold-gza-qFe-ie-${i}.txt`, `# ie@${i}\n${extractFn(i).text}\n`)
    }
  }
}

// _584/plugin Bm host for r0n
dump('gold-gza-584-export-Bm-DOb.txt', `# @209536872\n${asciiWindow(209534800, 209537400)}\n`)
for (const n of ['function Bm(', 'async function Bm(', 'Bm=e=>', 'Bm=(e', 'function Bm(e)']) {
  const hits = findAll(n, 12)
  log(`BM ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    const near = i > 209000000 && i < 209540000
    log(`  @${i}${near ? ' NEAR584' : ''} ${asciiWindow(i, i + 180).replace(/\n/g, ' ')}`)
    if (near || hits.length <= 4) {
      dump(`gold-gza-r0n-Bm-${i}.txt`, `# Bm@${i}\n${extractFn(i).text}\n`)
    }
  }
}

// marketplaceRemoveHandler
for (const n of [
  'async function Tr(',
  'function Tr(',
  'Use: user, project, or local',
  'cli_marketplace_remove',
  'from ${t.scope} settings',
]) {
  const hits = findAll(n, 8)
  log(`TR ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 40, i + 200).replace(/\n/g, ' ')}`)
  }
}
dump('gold-gza-remove-handler-233794.txt', `# @233794200\n${asciiWindow(233793800, 233795000)}\n`)
dump('gold-gza-remove-ui-236024.txt', `# @236024700\n${asciiWindow(236023800, 236025400)}\n`)

// find function containing await Wn(n,a,r)
const wn = findAll('await Wn(n,a,r)', 5)
for (const i of wn) {
  // walk back to function
  let s = i
  while (s > i - 4000 && !asciiWindow(s, s + 20).startsWith('async function') && !asciiWindow(s, s + 15).startsWith('function ')) s--
  dump('gold-gza-Wn-caller.txt', `# Wn@${i} walk@${s}\n${asciiWindow(s, i + 400)}\n`)
  log(`WN walk ${s} ${asciiWindow(s, s + 80)}`)
}

// nPe module Jr import
dump('gold-gza-nPe-before.txt', `# nPe@213644976 before\n${asciiWindow(213640000, 213645000)}\n`)
for (const n of ['Jr as ', ' as Jr', 'getSecureStorage', 'function Jr(){']) {
  const hits = findAll(n, 10)
  log(`JRN ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    const near = i > 213600000 && i < 213660000
    log(`  @${i}${near ? ' NEARnPe' : ''} ${asciiWindow(i - 40, i + 100).replace(/\n/g, ' ')}`)
  }
}

// Yt official set + Bm nearby
dump('gold-gza-Yt-official-set.txt', `# @207877115\n${asciiWindow(207876900, 207878200)}\n`)

// hUe scope map in _506 — neighbor of qFe
for (const n of ['function hUe(', 'hUe=', 'zhb as hUe']) {
  const hits = findAll(n, 6)
  log(`HUE ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) log(`  @${i} ${asciiWindow(i, i + 160).replace(/\n/g, ' ')}`)
}

dump('gold-gza-callee-pass4.txt', report.join('\n') + '\n')
