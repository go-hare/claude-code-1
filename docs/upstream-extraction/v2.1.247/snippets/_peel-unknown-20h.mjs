import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function allHits(buf, needle, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j >= to) break
    hits.push(j)
    i = j + n.length
    if (hits.length > 40) break
  }
  return hits
}

function dumpAround(name, buf, pos, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# pos=${pos}\n\n${asciiWindow(buf, Math.max(0, pos - before), pos + after)}\n`,
  )
  console.log('OK', name, pos)
}

function count(buf, needle) {
  return allHits(buf, needle).length
}

const kiPos = 235451116
dumpAround('gold-20-fn-ki-at-451.txt', buf247, kiPos, 2000, 18000)

// what is immediately at that pos?
console.log('AT 235451116:', JSON.stringify(asciiWindow(buf247, kiPos, kiPos + 80)))

const needles = [
  'as ki}',
  'as ki,',
  'function ki(',
  'async function ki(',
  'ki=a',
  'import{Cf as ki',
  'import{Cf as a',
  'function ki(a',
  'function ki(i',
  'async function ki(a',
  'async function ki(i',
  'async function ki(e',
]
console.log('=== module window 235400000-235580000 ===')
for (const n of needles) {
  const hits = allHits(buf247, n, 235400000, 235580000)
  console.log(hits.length, JSON.stringify(n), hits)
}

console.log('=== whole-file ki import-ish ===')
for (const n of ['as ki}', 'as ki,', 'import{Cf as ki', 'Cf as ki']) {
  const h247 = allHits(buf247, n)
  const h246 = allHits(buf246, n)
  console.log(JSON.stringify(n), '247', h247, '246', h246)
}

// compare 246 unique markers
const markers = [
  'onGetWorkspaceDiff',
  'pendingWaiters',
  'REPL_WORKSPACE_DIFF_COMPUTE_BUDGET',
  'HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET',
  'workspaceDiffComputeBudget',
  'case"get_workspace_diff"',
  'get_workspace_diff is not supported',
  'get_workspace_diff timed out',
  'onGetWorkspaceDiff:a?',
  'ki(a,n,t)',
  'kind:"working-tree"',
  'remote_workspace_diff_fetch',
]
console.log('=== 247 vs 246 counts ===')
for (const n of markers) {
  console.log(
    JSON.stringify(n),
    '247',
    count(buf247, n),
    '246',
    count(buf246, n),
  )
}

// dump every `as ki}` 
for (const [idx, pos] of allHits(buf247, 'as ki}').entries()) {
  dumpAround(`gold-20-as-ki-${idx}.txt`, buf247, pos, 400, 200)
}

// extract complete _45.js: from Version comment near first perFileMs git module
const cfExport = buf247.indexOf(Buffer.from('export{Yt as Cf}'))
console.log('export{Yt as Cf}', cfExport)
if (cfExport > 0) {
  dumpAround('gold-20-yt-cf-export.txt', buf247, cfExport, 200, 400)
  // walk back to module start
  const ver = buf247.lastIndexOf(Buffer.from('// Version: 2.1.247'), cfExport)
  console.log('_45 version comment', ver)
  dumpAround('gold-20-45-module-start.txt', buf247, ver, 200, 800)
}

// find ht,kt near ye(W(o.signal)
const ye = buf247.indexOf(Buffer.from('ye(W(o.signal)'))
console.log('ye(W(o.signal)', ye)
if (ye > 0) {
  // search var ht= and var kt= backwards in same module
  const htHits = allHits(buf247, 'var ht=', Math.max(0, ye - 200000), ye)
  const ktHits = allHits(buf247, 'var kt=', Math.max(0, ye - 200000), ye)
  console.log('var ht= before ye', htHits)
  console.log('var kt= before ye', ktHits)
  for (const [idx, pos] of htHits.slice(-3).entries()) {
    dumpAround(`gold-20-var-ht-${idx}.txt`, buf247, pos, 80, 200)
  }
  for (const [idx, pos] of ktHits.slice(-3).entries()) {
    dumpAround(`gold-20-var-kt-${idx}.txt`, buf247, pos, 80, 200)
  }
}

// useReplBridge host + budget
for (const n of [
  'workspaceDiffComputeBudget:',
  'host:S.host',
  'host:e.host',
  'REPL_WORKSPACE_DIFF_COMPUTE_BUDGET',
]) {
  const hits = allHits(buf247, n)
  console.log(JSON.stringify(n), hits)
  if (hits[0] != null) {
    dumpAround(
      `gold-20-callsite-${n.replace(/[^A-Za-z0-9]+/g, '-')}.txt`,
      buf247,
      hits[0],
      1500,
      800,
    )
  }
}

// 246 inbound get_workspace_diff case
const c246 = allHits(buf246, 'case"get_workspace_diff"')
console.log('246 case get_workspace_diff', c246)
if (c246[0] != null) {
  dumpAround('gold-20-246-case-getws.txt', buf246, c246[0], 400, 800)
}
const c247 = allHits(buf247, 'case"get_workspace_diff"')
console.log('247 case get_workspace_diff', c247)
if (c247[0] != null) {
  dumpAround('gold-20-247-case-getws.txt', buf247, c247[0], 400, 800)
}
