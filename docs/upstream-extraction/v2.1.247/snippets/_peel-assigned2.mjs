import { readFileSync, writeFileSync, existsSync } from 'fs'

const paths = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}

const b247 = readFileSync(paths[247])
const b246 = existsSync(paths[246]) ? readFileSync(paths[246]) : null

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

function dumpAll(buf, name, needle, before, after, limit = 8) {
  const hits = allHits(buf, needle)
  console.log('HITS', name, hits.length, hits.slice(0, 8))
  hits.slice(0, limit).forEach((i, idx) => {
    const start = Math.max(0, i - before)
    const s = asciiWindow(buf, start, i + after)
    writeFileSync(
      `docs/upstream-extraction/v2.1.247/snippets/${name}-${idx}.txt`,
      `# offset=${i} needle=${JSON.stringify(needle)}\n\n${s}\n`,
    )
  })
}

function count(buf, needle) {
  return allHits(buf, needle).length
}

const extra = [
  'browser could not',
  'via OSC',
  'first-run',
  'apps gateway',
  'working tree',
  'self-hosted runner',
  'plugin cache',
  'Sent via OSC',
  'could not be opened',
  'Could not open',
  'openBrowser',
  'noBrowser',
  'NO_BROWSER',
  'copyPath',
  'osc52',
  'copyResult',
  'clipboardResult',
  'how the URL was copied',
  'URL was copied',
  'copied instead',
  'always claiming',
  'appears immediately',
  'live cache directory',
  'cache directory',
  'deleteCache',
  'rmSync',
  'version-less',
  'without a version',
  'without version',
  'pluginVersion',
  'marketplaceVersion',
  'workingTreeDiff',
  'working_tree_diff',
  'worktree_diff',
  'git status --porcelain',
  'reportDiff',
  'sessionDiff',
  'Claude Code had started',
  'before Claude',
  'status: "running"',
  'status:"running"',
  'setStatus',
  'runner status',
  'managed settings configure',
  'force gateway',
  'forceLoginGateway',
  'skipPreflight',
  'skipConnectivity',
  'preflight',
  'escapeAnsi',
  'stripAnsi',
  'sanitizeMarketplace',
  'invalid marketplace name',
  'Marketplace name',
  'must not contain',
  'control character',
  'zero-width',
  'ZERO WIDTH',
  '\\u200B',
  'Cf category',
  'General_Category',
]

console.log('\n=== extra counts ===')
for (const n of extra) {
  const c247 = count(b247, n)
  const c246 = b246 ? count(b246, n) : -1
  if (c247 || c246) {
    const mark = c247 !== c246 ? ' DIFF' : ''
    console.log(`${c247}\t${c246}\t${JSON.stringify(n)}${mark}`)
  } else {
    // still print misses that look unique
    if (
      /browser could|first-run|apps gateway|live cache|version-less|workingTree|forceLogin|escapeAnsi|sanitizeMarketplace|zero-width/.test(
        n,
      )
    ) {
      console.log(`${c247}\t${c246}\t${JSON.stringify(n)}`)
    }
  }
}

dumpAll(b247, 'gold-browser-could-not', 'browser could not', 2500, 1500, 2)
dumpAll(b247, 'gold-via-osc', 'via OSC', 800, 400, 5)
dumpAll(b247, 'gold-first-run', 'first-run', 1500, 800, 6)
dumpAll(b247, 'gold-apps-gateway', 'apps gateway', 2000, 800, 4)
