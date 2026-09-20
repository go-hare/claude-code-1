import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
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
    `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, 'hits', hits.length)
}

function count(buf, needle) {
  return allHits(buf, needle).length
}

const extra = [
  'Registered worker',
  'worker_status',
  'worker_status:"running"',
  "worker_status:'running'",
  ',"running"',
  ",'running'",
  'Ae()||Ie()',
  'function Ae(',
  'CUSTOM_OAUTH',
  'isCustomOAuth',
  'gatewayForced',
  'skipPreflight',
  'gitDiff',
  'workingTreeDiff',
  'diffForRemote',
  'reportWorkingTree',
  'versionedPath',
  'cacheAndRegister',
  'safePluginText',
  'escapePlugin',
  'inspectPlugin',
  'JSON.stringify(e.name)',
]

console.log('=== counts ===')
for (const n of extra) {
  const c247 = count(b247, n)
  const c246 = count(b246, n)
  if (c247 || c246) console.log(`${c247}\t${c246}\t${JSON.stringify(n)}${c247 !== c246 ? ' DIFF' : ''}`)
}

dump(b247, 'gold-21-registered-worker.txt', 'Registered worker', 4000, 4000)
dump(b247, 'gold-21-worker-status.txt', 'worker_status', 2500, 1500)
dump(b247, 'gold-22-onboard-skip.txt', 'id:"preflight"', 8000, 500)
dump(b247, 'gold-22-ae-ie.txt', 'Ae()||Ie()', 3000, 500)
