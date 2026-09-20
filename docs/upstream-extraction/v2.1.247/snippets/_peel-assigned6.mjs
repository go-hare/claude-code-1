import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
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
  }
  return hits
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

function count(needle) {
  return allHits(b247, needle).length
}

const extra = [
  'id:"preflight"',
  "id:'preflight'",
  'id:"theme"',
  'Checking connectivity',
  'tengu_preflight_check_failed',
  'oauthEnabled',
  'forceLoginMethod==="gateway"',
  'forceLoginMethod==="gateway"',
  'updateSessionWorkerState(',
  '"running"',
  "'running'",
  'git status --porcelain',
  'git diff --stat',
  'workingTree',
  'reportDiff',
  'session_diff',
  'cwd_diff',
  'escapeSafe',
  'safeMarketplace',
  'safePlugin',
  'inspect(',
  'JSON.stringify(name)',
  'rm(versionedPath',
  'recursive:!0,force:!0',
  'cacheResult.path',
  'version==="unknown"',
  'version==="unknown"',
  'live cache',
  'inUse',
  'pluginInUse',
]

console.log('=== counts ===')
for (const n of extra) {
  const c = count(n)
  if (c) console.log(`${c}\t${JSON.stringify(n)}`)
}

dump('gold-22-checking.txt', 'Checking connectivity', 6000, 2000)
dump('gold-22-preflight-failed.txt', 'tengu_preflight_check_failed', 4000, 2500)
dump('gold-22-gateway-eq-0.txt', 'forceLoginMethod==="gateway"', 2500, 1500, 0)
dump('gold-22-gateway-eq-1.txt', 'forceLoginMethod==="gateway"', 2500, 1500, 1)
dump('gold-22-gateway-eq-2.txt', 'forceLoginMethod==="gateway"', 2500, 1500, 2)
dump('gold-21-update-call.txt', 'updateSessionWorkerState', 200, 200, 1)
dump('gold-21-update-call-2.txt', 'updateSessionWorkerState', 200, 200, 2)
dump('gold-21-update-call-3.txt', 'updateSessionWorkerState', 200, 200, 3)
dump('gold-21-update-call-4.txt', 'updateSessionWorkerState', 200, 200, 4)
dump('gold-25-plugin-control-1.txt', 'Plugin name cannot contain control', 800, 400, 1)
dump('gold-19-unknown-version.txt', 'version==="unknown"', 2000, 1500, 0)
