import { readFileSync, writeFileSync, existsSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = existsSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
  ? readFileSync(
      'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
    )
  : null

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
  }
  return hits
}

function count(buf, needle) {
  return allHits(buf, needle).length
}

function dump(name, needle, before, after, idx = 0) {
  const hits = allHits(b247, needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[Math.min(idx, hits.length - 1)]
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)}\n\n${asciiWindow(b247, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, 'hits', hits.length)
}

const extra = [
  'Claude apps gateway',
  'apps gateway',
  'Marketplace name cannot contain control',
  'Plugin name cannot contain control',
  'bidirectional-formatting',
  'Copied to tmux buffer',
  'headless browser',
  'cwdDiff',
  'workingTreeDiff',
  'updateSessionWorkerState',
  'registerWorker',
  'versionedPath',
  'cache/marketplace',
  'unknown',
  'escapeAnsi',
  'safeCliText',
  'sanitizeCli',
  'plugin output',
  'unprintable characters',
  'first-run',
  'preflight',
  'skipPreflight',
  'forceLoginMethod==="gateway"',
  'forceLoginMethod==="gateway"',
  'isGatewayForced',
  'gatewayForced',
]

console.log('=== counts ===')
for (const n of extra) {
  const c247 = count(b247, n)
  const c246 = b246 ? count(b246, n) : -1
  if (c247 || c246) console.log(`${c247}\t${c246}\t${JSON.stringify(n)}${c247 !== c246 ? ' DIFF' : ''}`)
}

dump('gold-22-apps-gateway.txt', 'Claude apps gateway', 5000, 2500)
dump('gold-22-apps-gateway-short.txt', 'apps gateway', 3000, 1500, 3)
dump('gold-25-mkt-control.txt', 'Marketplace name cannot contain control', 2000, 600)
dump('gold-17-tmux-2.txt', 'Copied to tmux buffer', 8000, 2000, 2)
dump('gold-17-headless-0.txt', 'headless browser', 2000, 800, 0)
dump('gold-17-headless-1.txt', 'headless browser', 2000, 800, 1)
dump('gold-17-headless-2.txt', 'headless browser', 2000, 800, 2)
dump('gold-17-headless-3.txt', 'headless browser', 2000, 800, 3)
dump('gold-17-headless-4.txt', 'headless browser', 2000, 800, 4)
dump('gold-17-headless-5.txt', 'headless browser', 2000, 800, 5)
dump('gold-20-cwdDiff.txt', 'cwdDiff', 2500, 1500)
dump('gold-21-updateSessionWorkerState.txt', 'updateSessionWorkerState', 3000, 2000)
dump('gold-22-preflight-onboard.txt', 'tengu_began_setup', 2000, 4000)
dump('gold-25-bidirectional.txt', 'bidirectional-formatting', 1500, 1500)
