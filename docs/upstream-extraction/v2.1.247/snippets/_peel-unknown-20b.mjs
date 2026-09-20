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

function dumpHits(buf, name, needle, before, after, ver) {
  const hits = allHits(buf, needle)
  console.log(ver, name, 'hits', hits.length, hits)
  hits.forEach((i, idx) => {
    writeFileSync(
      `docs/upstream-extraction/v2.1.247/snippets/${name}-${ver}-${idx}.txt`,
      `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
    )
  })
}

function dumpAround(buf, name, pos, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# pos=${pos}\n\n${asciiWindow(buf, Math.max(0, pos - before), pos + after)}\n`,
  )
  console.log('OK', name, pos)
}

dumpHits(buf247, 'gold-20-refe', 're(fe)', 600, 400, '247')
dumpHits(buf246, 'gold-20-refe', 're(fe)', 600, 400, '246')

// create-session module: walk back from report:fe to find oe/re defs
const reportFe = buf247.indexOf(Buffer.from('report:fe'))
console.log('report:fe', reportFe)
dumpAround(buf247, 'gold-20-create-mod-back.txt', reportFe, 20000, 2000)

const reportFe246 = buf246.indexOf(Buffer.from('report:fe'))
console.log('246 report:fe', reportFe246)
dumpAround(buf246, 'gold-20-246-create-mod-back.txt', reportFe246, 20000, 2000)

const needles = [
  'await oe(o,r,s)',
  'sources:_e,outcomes:me,report:fe',
  'function oe(e,t,n)',
  'async function oe(e,t,n)',
  'async function oe(e,t,n){',
  'function re(e)',
  'function re(e){',
  'repl_diff',
  'git_diff',
  'workingTree',
  'kind:"working-tree"',
  'publishDiff',
  'sendGit',
  'git_state',
  'file_changes',
  'cwd_changed',
  'working_tree_status',
  'uncommitted_changes',
  'diff_files',
  'diffFiles',
  'session.git',
  'git_info',
  'changed_files',
  'changedFiles',
  'dirty_files',
  'dirtyFiles',
  'worktree_status',
  'worktreeStatus',
  'reportGit',
  'reportCwd',
  'reportWorktree',
  'uploadWorkingTree',
  'seed_bundle',
  'seedBundle',
  'dir_sync',
  'dirSync',
  'ccr_dir_sync',
]

console.log('=== more counts ===')
for (const n of needles) {
  const a = allHits(buf247, n).length
  const b = allHits(buf246, n).length
  if (a || b) console.log(`${a}\t${b}\t${JSON.stringify(n)}${a !== b ? ' DIFF' : ''}`)
}

dumpHits(buf247, 'gold-20-oe-etn', 'async function oe(e,t,n)', 200, 4000, '247')
dumpHits(buf246, 'gold-20-oe-etn', 'async function oe(e,t,n)', 200, 4000, '246')
dumpHits(buf247, 'gold-20-kindwt', '{kind:"working-tree"}', 1500, 1500, '247')
