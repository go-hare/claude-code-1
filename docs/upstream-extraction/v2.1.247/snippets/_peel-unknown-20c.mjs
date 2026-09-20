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
    if (hits.length > 40) break
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

function dumpHits(buf, name, needle, before, after) {
  const hits = allHits(buf, needle)
  console.log(name, hits.length, hits)
  hits.forEach((i, idx) => {
    writeFileSync(
      `docs/upstream-extraction/v2.1.247/snippets/${name}-${idx}.txt`,
      `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
    )
  })
}

dumpHits(buf247, 'gold-20-fn-oe-etn', 'function oe(e,t,n)', 400, 6000)
dumpHits(buf247, 'gold-20-reportGit', 'reportGit', 1500, 2000)
dumpHits(buf247, 'gold-20-refe247', 're(fe)', 400, 400)

const extra = [
  'workingTreeDiff',
  'worktreeDiff',
  'treeDiff',
  'wtDiff',
  'cwd_diff',
  'gitDiffResult',
  'getGitDiff',
  'computeGitDiff',
  'collectGitDiff',
  'fetchGitDiff',
  'reportWorking',
  'publishWorking',
  'sendWorking',
  'syncWorking',
  'uploadWorking',
  'working_tree_diff',
  'worktree_diff',
  'uncommitted_changes',
  'uncommittedChanges',
  'git_status_event',
  'gitStatusEvent',
  'session_git',
  'sessionGit',
  'repl_diff',
  'replDiff',
  'diff_tab',
  'diffTab',
  'publishDiff',
  'sendDiff',
  'pushDiff',
  'emitDiff',
  'broadcastDiff',
  'notifyDiff',
  'files_changed',
  'filesChanged',
  'status_porcelain',
  'porcelain',
  'numstat',
  'kind:"working-tree"',
  'tengu_bridge',
  'bridge_git',
  'bridgeGit',
  'git_context',
  'gitContext',
  'working_tree_status',
  'worktree_status',
  'dirtyTree',
  'dirty_tree',
  'hasUncommitted',
  'uncommittedCount',
  'changedTrackedBytes',
  'seedBytes',
  'overlayAvailable',
  '/remote-control is active',
  'replBridgeExplicit:!0',
  'Remote Control connecting',
  'connecting\u2026',
  'connecting...',
]

console.log('=== extra ===')
for (const n of extra) {
  const a = allHits(buf247, n).length
  const b = allHits(buf246, n).length
  if (a || b || /Diff|Working|worktree|replDiff|porcelain|gitDiff|publish|broadcast/.test(n)) {
    console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
  }
}

dump(buf247, 'gold-20-repl-diff.txt', 'repl_diff', 2000, 2000)
dump(buf247, 'gold-20-getGitDiff.txt', 'getGitDiff', 2000, 2000)
dump(buf247, 'gold-20-porcelain.txt', 'porcelain', 2000, 2000)
dump(buf247, 'gold-20-uncommittedChanges.txt', 'uncommittedChanges', 2000, 2000)
dump(buf247, 'gold-20-hasUncommitted.txt', 'hasUncommitted', 2000, 2000)
dump(buf247, 'gold-20-gitContext.txt', 'gitContext', 2000, 2000)
dump(buf247, 'gold-20-bridge-git.txt', 'bridge_git', 2000, 2000)
dump(buf247, 'gold-20-kindwt-0.txt', '{kind:"working-tree"}', 2500, 2500, 0)
dump(buf247, 'gold-20-kindwt-5.txt', '{kind:"working-tree"}', 2500, 2500, 5)
dump(buf247, 'gold-20-kindwt-6.txt', '{kind:"working-tree"}', 2500, 2500, 6)
