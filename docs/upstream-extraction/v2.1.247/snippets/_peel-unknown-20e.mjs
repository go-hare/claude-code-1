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

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
    if (hits.length > 20) break
  }
  return hits
}

function dump(buf, name, needle, before, after, idx = 0) {
  const hits = allHits(buf, needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[Math.min(idx, hits.length - 1)]
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)} c247=${allHits(buf247, needle).length} c246=${allHits(buf246, needle).length}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, 'hits', hits.length)
}

const extra = [
  'HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET',
  'REPL_WORKSPACE_DIFF_COMPUTE_BUDGET',
  'get_workspace_diff timed out',
  'get_workspace_diff is not supported',
  'workspace diff is still being computed',
  'async function ki(',
  'function ki(',
  'function ki(e,t,n)',
  'async function ki(e,t,n)',
  'pendingWaiters',
  'settledAt',
  'permissionContext',
  'computeWorkspaceDiff',
  'workspaceDiff',
  'getWorkspaceDiff',
  'onGetWorkspaceDiff:',
  'onGetWorkspaceDiff:a',
  'onGetWorkspaceDiff: a',
]

console.log('=== ki/budget counts ===')
for (const n of extra) {
  const a = allHits(buf247, n).length
  const b = allHits(buf246, n).length
  console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

dump(buf247, 'gold-20-headless-budget.txt', 'HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET', 2000, 2000)
dump(buf247, 'gold-20-repl-budget.txt', 'REPL_WORKSPACE_DIFF_COMPUTE_BUDGET', 2000, 2000)
dump(buf247, 'gold-20-ws-timeout.txt', 'get_workspace_diff timed out', 3000, 2000)
dump(buf247, 'gold-20-ws-not-supported.txt', 'get_workspace_diff is not supported', 1500, 1500)
dump(buf247, 'gold-20-pendingWaiters.txt', 'pendingWaiters', 4000, 4000)
dump(buf247, 'gold-20-fn-ki.txt', 'async function ki(', 400, 5000)
dump(buf247, 'gold-20-fn-ki-sync.txt', 'function ki(e,t,n)', 400, 5000)
dump(buf246, 'gold-20-246-ws-not-supported.txt', 'get_workspace_diff is not supported', 1500, 1500)
dump(buf246, 'gold-20-246-pendingWaiters.txt', 'pendingWaiters', 2000, 2000)
dump(buf246, 'gold-20-246-ws-timeout.txt', 'get_workspace_diff timed out', 3000, 2000)

// dump remaining getws 247 hits that are likely the handler
for (let i = 1; i <= 6; i++) {
  dump(buf247, `gold-20-getws-${i}.txt`, 'get_workspace_diff', 2500, 2500, i)
}
for (let i = 1; i <= 3; i++) {
  dump(buf246, `gold-20-246-getws-${i}.txt`, 'get_workspace_diff', 2500, 2500, i)
}
