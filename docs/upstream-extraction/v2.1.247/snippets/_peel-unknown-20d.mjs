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
    `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)} count247=${allHits(buf247, needle).length} count246=${allHits(buf246, needle).length}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
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

const extra = [
  'get_workspace_diff',
  'onGetWorkspaceDiff',
  'remote_workspace_diff_fetch',
  'workspace_diff',
  'collectWorktreeState',
  'worktree_state',
  'current_branches',
  'Unsupported control request subtype',
  'get_workspace_diff',
  'subtype:"get_workspace_diff"',
  "subtype:'get_workspace_diff'",
  'Workspace changes aren',
  'cannot report workspace changes',
  'showing per-turn changes only',
  'is_dirty',
  'unpushed_count',
  'head_sha',
]

console.log('=== workspace-diff counts ===')
for (const n of extra) {
  const a = allHits(buf247, n).length
  const b = allHits(buf246, n).length
  console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

dumpHits(buf247, 'gold-20-getws', 'get_workspace_diff', 4000, 4000)
dumpHits(buf246, 'gold-20-246-getws', 'get_workspace_diff', 4000, 4000)
dumpHits(buf247, 'gold-20-onGetWS', 'onGetWorkspaceDiff', 3000, 3000)
dumpHits(buf246, 'gold-20-246-onGetWS', 'onGetWorkspaceDiff', 3000, 3000)
dump(buf247, 'gold-20-collectWorktree.txt', 'collectWorktreeState', 3000, 4000)
dump(buf246, 'gold-20-246-collectWorktree.txt', 'collectWorktreeState', 3000, 4000)
dump(buf247, 'gold-20-worktree-state.txt', 'worktree_state', 2500, 2500)
dump(buf247, 'gold-20-unsupported-subtype.txt', 'Unsupported control request subtype', 2500, 2500)
