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
  return s
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

function dump(name, buf, start, end, extra = '') {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# ${extra}\n# start=${start} end=${end} len=${end - start}\n\n${asciiWindow(buf, start, end)}\n`,
  )
  console.log('OK', name, end - start)
}

const modStart = 235250550 // after version, at import
const modEnd = 235258220 // after export
dump('gold-20-45-full.txt', buf247, 235250480, 235258230, 'complete _45.js Yt/Cf')

console.log('=== Yt / function names in _45 ===')
for (const n of [
  'async function Yt',
  'function Yt',
  'async function Yt(',
  'function Yt(',
  'Yt=async',
  'async function ',
  'function ',
]) {
  const hits = allHits(buf247, n, 235250480, 235258230)
  console.log(hits.length, JSON.stringify(n), hits)
}

// 246 same module markers
const markers = [
  'export{Yt as Cf}',
  'perFileMs:5000,totalMs:1e4',
  'perFileMs:400,totalMs:1500',
  'kind:"too-large"',
  'kind:"restricted"',
  'kind:"missing"',
  'skippedLarge:[],restricted:[]',
]
console.log('=== 247 vs 246 _45 markers ===')
for (const n of markers) {
  console.log(
    JSON.stringify(n),
    '247',
    allHits(buf247, n).length,
    allHits(buf247, n),
    '246',
    allHits(buf246, n).length,
    allHits(buf246, n),
  )
}

// useReplBridge Pt budget
const ptHits = allHits(buf247, 'workspaceDiffComputeBudget:Pt')
console.log('workspaceDiffComputeBudget:Pt', ptHits)
for (const [idx, pos] of ptHits.entries()) {
  dump(`gold-20-budget-Pt-${idx}.txt`, buf247, pos - 4000, pos + 400)
}

// print.ts / headless
const eHits = allHits(buf247, 'workspaceDiffComputeBudget:')
console.log('workspaceDiffComputeBudget: all', eHits)
for (const [idx, pos] of eHits.entries()) {
  dump(`gold-20-wsbudget-${idx}.txt`, buf247, pos - 800, pos + 400)
}

// 247 second case
dump('gold-20-247-case-getws-1.txt', buf247, 222820688 - 200, 222820688 + 600)

// timeout helper ye
const yeDef = allHits(buf247, 'function ye(', 210000000, 211000000)
console.log('function ye( near jn', yeDef)
const yeAsync = allHits(buf247, 'async function ye(', 210000000, 211000000)
console.log('async function ye( near jn', yeAsync)

// search timeout wrapper near the error string
const timeoutStr = buf247.indexOf(
  Buffer.from(
    'get_workspace_diff timed out: the workspace diff is still being computed; retry shortly',
  ),
)
console.log('timeout str', timeoutStr)
dump('gold-20-timeout-str-src.txt', buf247, timeoutStr - 2500, timeoutStr + 400)

// 246 _45 equivalent: search unique inner strings
const uniqueInner = 'symlink and hardlinked worktree files are refused'
console.log(
  'schema refuse 247',
  allHits(buf247, uniqueInner).length,
  '246',
  allHits(buf246, uniqueInner).length,
)

// Does 246 have the hunk compute module?
const lsTree = 'ls-tree","-r","-l","-z","--full-tree"'
console.log(
  'ls-tree full-tree 247',
  allHits(buf247, lsTree),
  '246',
  allHits(buf246, lsTree),
)
