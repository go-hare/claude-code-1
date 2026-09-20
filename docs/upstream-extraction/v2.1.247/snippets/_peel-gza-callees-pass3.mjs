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

// locked export maps
dump('gold-gza-705-export-ii-cHc.txt', `# @208321700\n${asciiWindow(208321400, 208322000)}\n`)
dump('gold-gza-709-near-ks.txt', `# @208099400\n${asciiWindow(208097200, 208100800)}\n`)
dump('gold-gza-py-mMb-export.txt', `# @209535600\n${asciiWindow(209535400, 209536000)}\n`)
dump('gold-gza-ii-Rs-body.txt', `# Rs@208311609 ii@208311653\n${asciiWindow(208311600, 208313200)}\n`)

// _709 export eIc
for (const n of ['ks as eIc', 'Os as eIc', 'Es as eIc', ' as eIc', 'eIc=', 'var eIc']) {
  const hits = findAll(n, 8)
  log(`EIC ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) log(`  @${i} ${asciiWindow(i - 50, i + 90).replace(/\n/g, ' ')}`)
}

// _506 Ahb host
for (const n of [' as Ahb', 'Ahb=', 'function Ahb', 'gs as Ahb', 'hs as Ahb', 'ds as Ahb', 'cs as Ahb', 'bs as Ahb']) {
  const hits = findAll(n, 8)
  log(`AHB ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) log(`  @${i} ${asciiWindow(i - 50, i + 90).replace(/\n/g, ' ')}`)
}

// _584 DOb host
for (const n of [' as DOb', 'DOb=', 'function DOb', 'fPe as DOb']) {
  const hits = findAll(n, 8)
  log(`DOB ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) log(`  @${i} ${asciiWindow(i - 50, i + 90).replace(/\n/g, ' ')}`)
}

// fPe / official names
for (const n of [
  'var fPe=',
  'fPe=new Set',
  'fPe.has(',
  'claude-code-plugins',
  'function r0n',
  'r0n=',
]) {
  const hits = findAll(n, 10)
  log(`FPE ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) log(`  @${i} ${asciiWindow(i - 40, i + 140).replace(/\n/g, ' ')}`)
}

// marketplace remove CLI + handler
dump('gold-gza-cli-remove-scope.txt', `# @223273708\n${asciiWindow(223273400, 223275200)}\n`)

for (const n of [
  'Remove the marketplace declaration from a specific settings scope',
  'Successfully removed marketplace',
  'marketplaceRemoveHandler',
  'tengu_marketplace_removed',
]) {
  const hits = findAll(n, 8)
  log(`RM ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) log(`  @${i} ${asciiWindow(i - 80, i + 200).replace(/\n/g, ' ')}`)
}

// gza re-exports / callers
for (const n of ['gza as ', 'Aea as ', 'await Aea', 'Aea(', 'ft as ', 'await ft(']) {
  const hits = findAll(n, 12)
  log(`GZACALL ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) log(`  @${i} ${asciiWindow(i - 40, i + 120).replace(/\n/g, ' ')}`)
}

// uninstall neighbor that passes r to HFe
dump('gold-gza-uninstall-HFe-r.txt', `# @214613500\n${asciiWindow(214612800, 214614200)}\n`)

// nPe Jr().mutate
for (const n of ['function Jr(', 'Jr().mutate', 'storage lock unavailable']) {
  const hits = findAll(n, 8)
  log(`JR ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) log(`  @${i} ${asciiWindow(i - 60, i + 160).replace(/\n/g, ' ')}`)
}

// getSettingSourceName full
const nameHits = findAll('project, gitignored', 5)
for (const i of nameHits) {
  dump(`gold-gza-qFe-near-${i}.txt`, `# @${i}\n${asciiWindow(i - 400, i + 900)}\n`)
}

// _506 export map: search Ahb in 20809-20815 region and later
dump('gold-gza-506-export-guess.txt', `# 208100000-208110000\n${asciiWindow(208100000, 208110500)}\n`)

// _709 export map near eIc definition
const eIcExp = findAll('eIc as sk', 3)
// find export of eIc from _709 — search backwards from first import of _709
dump('gold-gza-709-export-window.txt', `# 209300000?\n${asciiWindow(209300000, 209322000)}\n`)

// ks export
for (const n of ['ks as ', 'export{ks', 'ks as e']) {
  const hits = findAll(n, 10)
  log(`KS ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) log(`  @${i} ${asciiWindow(i - 40, i + 100).replace(/\n/g, ' ')}`)
}

// DOb module _584 export
dump('gold-gza-584-export-guess.txt', `# 210800000-210900000 too wide; search DOb=\n`)
const dobEq = findAll('DOb=', 10)
log(`DOBEQ count=${dobEq.length} ${dobEq.join(',')}`)

// py module neighbors ui, Br — confirm deletePluginDataDir only
const py = extractFn(209325064)
dump('gold-gza-HFe-py-full.txt', `# py@209325064\n${py.text}\n${asciiWindow(209324800, 209326200)}\n`)

// _0n KBo ame already have; dump unique gold names
dump(
  'gold-gza-_0n-full.txt',
  `# _0n@214579796\n${extractFn(214579796).text}\n\n# KBo@214580005\n${extractFn(214580005).text}\n\n# ame@214576324\n${extractFn(214576324).text}\n`,
)

dump('gold-gza-callee-pass3.txt', report.join('\n') + '\n')
