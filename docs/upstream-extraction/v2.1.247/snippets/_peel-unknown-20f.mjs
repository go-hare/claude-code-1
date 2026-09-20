import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
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

function dumpAround(name, pos, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# pos=${pos}\n\n${asciiWindow(buf247, Math.max(0, pos - before), pos + after)}\n`,
  )
  console.log('OK', name, pos)
}

function dump(name, needle, before, after, idx = 0) {
  const hits = allHits(buf247, needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle), 'hits', hits)
    return
  }
  const i = hits[Math.min(idx, hits.length - 1)]
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)}\n\n${asciiWindow(buf247, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, 'hits', hits.length, hits)
}

// initReplBridge wiring we already know
const wire = buf247.indexOf(Buffer.from('onGetWorkspaceDiff:a?'))
console.log('onGetWorkspaceDiff:a?', wire)
dumpAround('gold-20-init-wire-back.txt', wire, 25000, 4000)

dump('gold-20-workspaceDiff-0.txt', 'workspaceDiff', 2500, 2500, 0)
dump('gold-20-workspaceDiff-1.txt', 'workspaceDiff', 2500, 2500, 1)
dump('gold-20-workspaceDiff-2.txt', 'workspaceDiff', 2500, 2500, 2)
dump('gold-20-workspaceDiff-3.txt', 'workspaceDiff', 2500, 2500, 3)

dump('gold-20-dd-assign.txt', 'var dd=', 200, 800)
dump('gold-20-ad-assign.txt', 'var ad=', 200, 800)
dump('gold-20-dd-eq.txt', 'dd=', 200, 400)
dump('gold-20-export-budgets.txt', 'export{dd as HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET', 8000, 200)

// look for ki(a,n,t) specifically
dump('gold-20-ki-ant.txt', 'ki(a,n,t)', 5000, 2000)
dump('gold-20-async-ki-1.txt', 'async function ki(', 400, 4000, 1)

dump('gold-20-pendingWaiters-1.txt', 'pendingWaiters', 3000, 4000, 1)
dump('gold-20-pendingWaiters-2.txt', 'pendingWaiters', 3000, 4000, 2)
dump('gold-20-pendingWaiters-3.txt', 'pendingWaiters', 3000, 4000, 3)
dump('gold-20-pendingWaiters-4.txt', 'pendingWaiters', 3000, 4000, 4)

// timeout helper ye(W(o.signal),ht,kt)
dump('gold-20-ye-signal.txt', 'ye(W(o.signal)', 2000, 1500)
dump('gold-20-ht-kt.txt', 'get_workspace_diff timed out: the workspace diff is still being computed', 8000, 2000)
