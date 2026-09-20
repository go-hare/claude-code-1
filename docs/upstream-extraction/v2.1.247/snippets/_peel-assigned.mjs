import { readFileSync, writeFileSync, existsSync } from 'fs'

const paths = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}

function load(ver) {
  const p = paths[ver]
  if (!existsSync(p)) {
    console.log('MISSING', ver, p)
    return null
  }
  const buf = readFileSync(p)
  console.log('loaded', ver, buf.length)
  return buf
}

function count(buf, needle) {
  const n = Buffer.from(needle)
  let i = 0
  let c = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
  }
  return c
}

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

function dump(buf, name, needle, before, after) {
  const i = buf.indexOf(Buffer.from(needle))
  if (i < 0) {
    console.log('MISS', name, needle)
    return
  }
  const start = Math.max(0, i - before)
  const s = asciiWindow(buf, start, i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, i, 'len', s.length)
}

const needles = [
  // #17
  'install-github-app',
  'Copied to clipboard',
  'copied to clipboard',
  'could not copy',
  'Could not copy',
  'copy failed',
  'Copy failed',
  'how the URL',
  'how the sign-in',
  'sign-in URL',
  'URL copied',
  'copied via',
  'via OSC',
  'via tmux',
  'Press c to copy',
  'press c to copy',
  'c to copy',
  'no browser',
  'browser could not',
  'Unable to open browser',
  'Could not open a browser',
  'Could not open browser',
  'Open this URL',
  'open this URL',
  // #19
  'live cache',
  'liveCache',
  'version-less',
  'versionless',
  'second-scope',
  'second scope',
  'cache directory being deleted',
  'plugin cache',
  'cacheDir',
  'installLocation',
  // #20
  'working-tree',
  'working tree',
  'workingTree',
  'worktreeDiff',
  'working_tree',
  'gitDiff',
  'diffStat',
  'remote-control',
  // #21
  'Claude is waiting for your input',
  'waiting for your input',
  'self-hosted runner',
  'self_hosted',
  'selfHosted',
  'reports running',
  'premature',
  // #22
  'Unable to connect to Anthropic services',
  'Unable to connect',
  'first-run',
  'first run',
  'gateway sign-in',
  'apps gateway',
  // #25
  'control or invisible',
  'invisible characters',
  'escape-safe',
  'escapeSafe',
  'isEscapeSafe',
  'contains control',
  'marketplace name',
  'invalid marketplace',
  'plugin marketplace',
]

const b247 = load(247)
const b246 = load(246)

if (b247) {
  console.log('\n=== counts 247 vs 246 ===')
  for (const n of needles) {
    const c247 = count(b247, n)
    const c246 = b246 ? count(b246, n) : -1
    if (c247 || c246) {
      const mark = c247 !== c246 ? ' DIFF' : ''
      console.log(`${c247}\t${c246}\t${JSON.stringify(n)}${mark}`)
    }
  }
}
