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

function dump(buf, name, needle, before, after, idx = 0) {
  const hits = allHits(buf, needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[Math.min(idx, hits.length - 1)]
  const start = Math.max(0, i - before)
  const s = asciiWindow(buf, start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} idx=${idx}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, i, 'hits', hits.length, 'len', s.length)
}

const extra = [
  'Claude apps gateway',
  'Marketplace name cannot contain control',
  'Plugin name cannot contain control',
  'bidirectional-formatting',
  'Copied to tmux buffer',
  'Sent via OSC 52',
  'headless browser',
  'isHeadless',
  'no browser can',
  'assumeSupport',
  'ClipboardPath',
  'tmux-buffer',
  'getClipboardPath',
  '/^c+$/',
  'probeLinuxClipboardTool',
  'forceLoginGatewayUrl',
  'managed settings configure',
  'skip connectivity',
  'skipConnectivity',
  'gatewayForced',
  'appsGateway',
  'claude_apps_gateway',
  'CLAUDE_CODE_USE_GITHUB_APP',
  'live cache',
  'plugin cache directory',
  'cache directory being',
  'recreated',
  'version-less',
  'without version',
  'plugin.version',
  'orphanedAt',
  'inUseMarker',
  'pluginInUse',
  'working tree dirty',
  'working tree changes',
  'git status --porcelain',
  'diffStat',
  'session.gitDiff',
  'cwdGitDiff',
  'reportGitDiff',
  'self-hosted runner sessions',
  'waiting for your input',
  'Claude is waiting',
  'status":"running"',
  'status: "starting"',
  '"starting"',
  'environment_runner',
  'escape-safe',
  'escapeSafe',
  'unprintable',
  'safePluginText',
  'marketplace-supplied',
]

console.log('\n=== more counts ===')
for (const n of extra) {
  const c247 = count(b247, n)
  const c246 = b246 ? count(b246, n) : -1
  if (c247 || c246) {
    const mark = c247 !== c246 ? ' DIFF' : ''
    console.log(`${c247}\t${c246}\t${JSON.stringify(n)}${mark}`)
  }
}

dump(b247, 'gold-22-apps-gateway.txt', 'Claude apps gateway', 4000, 2500)
dump(
  b247,
  'gold-25-mkt-control.txt',
  'Marketplace name cannot contain control',
  1500,
  800,
)
dump(
  b247,
  'gold-25-plugin-control.txt',
  'Plugin name cannot contain control',
  800,
  400,
)
dump(b247, 'gold-17-tmux-copy.txt', 'Copied to tmux buffer', 2000, 800, 2)
dump(b247, 'gold-17-osc52.txt', 'Sent via OSC 52', 1500, 600, 2)
dump(b247, 'gold-17-headless.txt', 'headless browser', 1500, 800, 0)
dump(b247, 'gold-17-headless-1.txt', 'headless browser', 1500, 800, 1)
dump(b247, 'gold-17-headless-2.txt', 'headless browser', 1500, 800, 2)
dump(b247, 'gold-17-headless-3.txt', 'headless browser', 1500, 800, 3)
dump(b247, 'gold-17-headless-4.txt', 'headless browser', 1500, 800, 4)
dump(b247, 'gold-17-headless-5.txt', 'headless browser', 1500, 800, 5)
