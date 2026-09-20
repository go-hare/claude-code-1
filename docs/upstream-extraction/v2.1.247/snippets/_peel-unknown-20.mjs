import { readFileSync, writeFileSync, existsSync } from 'fs'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'
const buf247 = readFileSync(p247)
const buf246 = existsSync(p246) ? readFileSync(p246) : null

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
    if (hits.length > 30) break
  }
  return hits
}

function count(buf, needle) {
  return allHits(buf, needle).length
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
    `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)} count247=${count(buf247, needle)} count246=${buf246 ? count(buf246, needle) : 'NA'}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, 'hits', hits.length)
}

const extra = [
  'reuse_outcome_branches',
  'bridge_session_create',
  'await oe(',
  'report:fe',
  're(fe)',
  'function oe(',
  'async function oe(',
  'function re(',
  'async function re(',
  'working-tree diff',
  'not reporting the working-tree',
  'reporting the working-tree',
  'Remote Control sessions started with',
  'started with /remote-control',
  '/remote-control not reporting',
  'publishes its effort level to connected clients',
  'working-tree diff to connected',
  'Remote Control connecting',
  'Remote Control connecting\u2026',
  'enabling bridge',
  'Prerequisites passed',
  'replBridgeExplicit:!0',
  'replBridgeExplicit:true',
  'replBridgeExplicit:!0',
  'replBridgeEnabled:!0',
  'kind:"working-tree"',
  'git diff --numstat',
  '--numstat',
  'numstat',
  'perFileStats',
  'skippedLarge',
  'createAndUploadGitBundle',
  'uploadGitBundle',
  'working_tree',
  'workingTreeBytes',
  'seedBytes',
  'changedTrackedBytes',
  'File sync is not offered',
  'session_context',
  'defaultBranch',
  'gitRepoUrl',
  '[bridge] Session create',
  'bridge_session_create_3p',
]

console.log('=== extra counts ===')
for (const n of extra) {
  const c247 = count(buf247, n)
  const c246 = buf246 ? count(buf246, n) : -1
  if (c247 || c246) {
    console.log(`${c247}\t${c246}\t${JSON.stringify(n)}${c247 !== c246 ? ' DIFF' : ''}`)
  } else {
    console.log(`${c247}\t${c246}\t${JSON.stringify(n)}`)
  }
}

dump(buf247, 'gold-20-reuse-outcome.txt', 'reuse_outcome_branches', 5000, 4000)
dump(buf247, 'gold-20-bridge-session-create.txt', 'bridge_session_create', 2000, 1500)
dump(buf247, 'gold-20-await-oe.txt', 'await oe(', 1500, 2500)
dump(buf247, 'gold-20-report-fe.txt', 'report:fe', 2000, 2500)
dump(buf247, 'gold-20-re-fe.txt', 're(fe)', 800, 800)
dump(buf247, 'gold-20-fn-oe.txt', 'async function oe(', 200, 5000)
dump(buf247, 'gold-20-fn-oe-sync.txt', 'function oe(', 200, 4000)
dump(buf247, 'gold-20-fn-re.txt', 'function re(', 200, 3000)
dump(buf247, 'gold-20-changelog-rc-started.txt', 'Remote Control sessions started with', 1500, 1500)
dump(buf247, 'gold-20-changelog-reporting.txt', 'reporting the working-tree', 800, 800)
dump(buf247, 'gold-20-started-with-rc.txt', 'started with /remote-control', 800, 800)
dump(buf247, 'gold-20-numstat.txt', '--numstat', 2000, 2000)
dump(buf247, 'gold-20-enabling-bridge.txt', 'Prerequisites passed', 4000, 4000)
dump(buf247, 'gold-20-replBridgeEnabled-true.txt', 'replBridgeEnabled:!0', 3000, 3000)
dump(buf247, 'gold-20-session-create-skip.txt', '[bridge] Session create', 2500, 2500)

if (buf246) {
  dump(buf246, 'gold-20-246-reuse-outcome.txt', 'reuse_outcome_branches', 5000, 4000)
  dump(buf246, 'gold-20-246-await-oe.txt', 'await oe(', 1500, 2500)
  dump(buf246, 'gold-20-246-fn-oe.txt', 'async function oe(', 200, 5000)
  dump(buf246, 'gold-20-246-enabling-bridge.txt', 'Prerequisites passed', 4000, 4000)
  dump(buf246, 'gold-20-246-session-create-skip.txt', '[bridge] Session create', 2500, 2500)
}
