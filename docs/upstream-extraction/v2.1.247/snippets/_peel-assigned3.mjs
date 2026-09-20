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
    console.log('MISS', name, needle)
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
  'Create Authentication Token',
  'Creating a long-lived token for GitHub Actions',
  'Opening browser to sign in with your Claude account',
  'Paste code here if prompted',
  'Browser didn',
  'Copied to tmux buffer',
  'Sent via OSC 52',
  'isHeadlessBrowserEnvironment',
  'headless browser',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'SSH_TTY',
  'DISPLAY=',
  'no DISPLAY',
  'Unable to connect to Anthropic services',
  'Checking connectivity',
  'preflight_endpoint',
  'forceLoginMethod',
  'forceLoginGateway',
  'claude_code_first_run',
  'firstRun',
  'Onboarding',
  'skipConnectivityCheck',
  'skipPreflight',
  'managedSettings',
  'Claude apps gateway',
  'apps gateway sign-in',
  'Marketplace name cannot',
  'control or invisible characters',
  'invisible or control',
  'escape-safe',
  'escapeSafeText',
  'safeText',
  'sanitizeForTerminal',
  'stripControl',
  'hasInvisible',
  'hasControlOrInvisible',
  'containsInvisible',
  'live cache',
  'cached plugin',
  'plugin install cache',
  'install cache',
  'cachePath',
  'getPluginCache',
  'deletePlugin',
  'uninstallPlugin',
  'second scope',
  'scope install',
  'project scope',
  'user scope',
  'local scope',
  'working tree diff',
  'working-tree diff',
  'git diff --stat',
  'diff to connected',
  'reportWorkingTree',
  'cwdDiff',
  'repoDiff',
  'Claude is waiting for your input',
  'status running',
  '"running"',
  'session_status',
  'runner session',
  'self-hosted-runner',
  'environment-runner',
]

console.log('\n=== targeted counts ===')
for (const n of extra) {
  const c247 = count(b247, n)
  const c246 = b246 ? count(b246, n) : -1
  if (c247 || c246) {
    const mark = c247 !== c246 ? ' DIFF' : ''
    console.log(`${c247}\t${c246}\t${JSON.stringify(n)}${mark}`)
  }
}

dump(b247, 'gold-17-oauth-token.txt', 'Create Authentication Token', 4000, 4000)
dump(b247, 'gold-17-opening-browser.txt', 'Opening browser to sign in with your Claude account', 3000, 3000)
dump(b247, 'gold-22-unable-connect.txt', 'Unable to connect to Anthropic services', 4000, 2500)
dump(b247, 'gold-25-mkt-name-cannot.txt', 'Marketplace name cannot', 2500, 2500)
dump(b247, 'gold-20-working-tree.txt', 'working tree', 800, 400, 0)
