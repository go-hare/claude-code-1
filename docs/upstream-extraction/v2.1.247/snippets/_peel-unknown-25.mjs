/**
 * Peel leftover 247 #25 — marketplace-supplied text escape-safe output.
 * Name schema already locked. Hunt print-time sanitizer vs 246.
 */
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const bufs = {
  246: readFileSync(SEA[246]),
  247: readFileSync(SEA[247]),
}

console.log('loaded', bufs[246].length, bufs[247].length)

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function allHits(buf, needle) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
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
  return s
}

function looksJs(s) {
  return (
    s.includes('function ') ||
    s.includes('=>') ||
    s.includes('if(') ||
    s.includes('return ') ||
    s.includes('var ') ||
    s.includes('const ')
  )
}

function dump(name, text) {
  writeFileSync(`${outDir}/${name}`, text.endsWith('\n') ? text : `${text}\n`)
  console.log('WROTE', name, text.length)
}

const needles = [
  'escape-safe',
  'escapeSafe',
  'marketplace-supplied',
  'safePluginText',
  'safeMarketplace',
  'safeDisplay',
  'sanitizeName',
  'sanitizePlugin',
  'sanitizeMarketplace',
  'escapeAnsi',
  'escapeOSC',
  'stripAnsi',
  'util.inspect',
  'inspect(',
  'JSON.stringify',
  'Installed plugins:',
  'Configured marketplaces:',
  'Successfully added marketplace:',
  'Successfully installed plugin:',
  'Successfully removed marketplace:',
  'Marketplace \'',
  'control or invisible',
  'control or bidirectional',
  'Default_Ignorable',
  '\\p{Cc}',
  '\\x1b',
  '\\u001b',
  '\\x1b]',
  'OSC',
  'replace(/\\x1b',
  'replace(/[\\x00',
  'replace(/[\\x00-\\x1f',
  'replace(/[\\u0000',
  '\\u001B',
  '\\u009b',
  '\\u009d',
  'escapeForTerminal',
  'escapeControl',
  'visibleName',
  'printSafe',
  'safePrint',
  'cliSafe',
  'pluginText',
  'marketplaceText',
  'unprintable',
  'nonprintable',
  'escape sequences',
  'escape sequence',
  'ANSI escape',
  'osc52',
  'OSC 52',
  '\\x1b[',
  '\\u001b[',
  'stringify(name',
  'stringify(e.name',
  'stringify(plugin',
  'inspect(name',
  'inspect(plugin',
  'error detail withheld',
  'graphemes',
  'FFFD',
  '\\uFFFD',
  'hasControlOrBidi',
  'NAME_CONTROL',
  'bidirectional-formatting',
  'Marketplace name cannot contain control',
  'Plugin name cannot contain control',
  'Human-readable name shown in UI',
  'Unlike `name`, may contain spaces',
  'displayName',
  'Session-only plugins',
  'Synced plugins:',
  'No plugins installed',
  'No marketplaces configured',
  'Adding marketplace...',
  'Updating marketplace:',
  'Failed to add marketplace',
  'Failed to list marketplaces',
  'plugin list',
  '/plugin',
]

const lines = ['# gold-25-escape counts 247 vs 246', '']
lines.push('## string counts')
for (const n of needles) {
  const a = allHits(bufs[246], n).length
  const b = allHits(bufs[247], n).length
  if (a || b) {
    lines.push(`${a === b ? 'same' : 'DIFF'} 246=${a} 247=${b} ${JSON.stringify(n)}`)
  }
}

// binary-ish JS source fragments
const binNeedles = [
  ['replace-x1b-slash', Buffer.from('replace(/\\x1b')],
  ['replace-x00-class', Buffer.from('replace(/[\\x00')],
  ['replace-u001b', Buffer.from('replace(/\\u001b')],
  ['x1b-literal', Buffer.from('\\x1b')],
  ['u001b-literal', Buffer.from('\\u001b')],
  ['esc-bracket', Buffer.from('\\x1b[')],
  ['esc-osc', Buffer.from('\\x1b]')],
  ['u001b-osc', Buffer.from('\\u001b]')],
  ['json-stringify-name', Buffer.from('JSON.stringify(')],
  ['inspect-call', Buffer.from('inspect(')],
  ['strip-ansi-id', Buffer.from('stripAnsi')],
  ['strip-ansi-mod', Buffer.from('strip-ansi')],
]

lines.push('', '## extra / binary-ish counts')
for (const [tag, n] of binNeedles) {
  const a = allHits(bufs[246], n).length
  const b = allHits(bufs[247], n).length
  if (a || b) {
    lines.push(`${a === b ? 'same' : 'DIFF'} 246=${a} 247=${b} ${tag}`)
  }
}

dump('gold-25-escape-counts.txt', lines.join('\n'))

function dumpWin(ver, tag, needle, before, after, which = 0) {
  const hits = allHits(bufs[ver], needle)
  if (!hits.length) {
    console.log('MISS', ver, tag, JSON.stringify(needle.toString?.() ?? needle))
    return
  }
  const i = hits[Math.min(which, hits.length - 1)]
  const start = Math.max(0, i - before)
  const s = asciiWindow(bufs[ver], start, i + after)
  dump(
    `gold-25-escape-${tag}-${ver}-${which}.txt`,
    `# offset=${i} ver=${ver} hit=${which + 1}/${hits.length} js=${looksJs(s)} sha=${sha(s)} needle=${JSON.stringify(typeof needle === 'string' ? needle : tag)}\n\n${s}\n`,
  )
}

const dumpNeedles = [
  ['installed', 'Installed plugins:', 4000, 4000],
  ['configured', 'Configured marketplaces:', 3000, 2500],
  ['added-mkt', 'Successfully added marketplace:', 2500, 1500],
  ['installed-plugin', 'Successfully installed plugin:', 2500, 1500],
  ['removed-mkt', 'Successfully removed marketplace:', 2000, 800],
  ['session-only', 'Session-only plugins', 2500, 1500],
  ['synced', 'Synced plugins:', 2500, 1500],
  ['mkt-control', 'Marketplace name cannot contain control', 800, 400],
  ['plugin-control', 'Plugin name cannot contain control', 800, 400],
  ['human-readable', 'Human-readable name shown in UI', 1500, 800],
  ['unlike-name', 'Unlike `name`, may contain spaces', 1500, 800],
  ['withheld', 'error detail withheld', 2000, 800],
  ['bidirectional', 'bidirectional-formatting', 2000, 800],
  ['cc-class', '[\\p{Cc}\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]', 1500, 800],
]

for (const [tag, needle, before, after] of dumpNeedles) {
  dumpWin(247, tag, needle, before, after, 0)
  dumpWin(246, tag, needle, before, after, 0)
}

// dump extra hits of installed plugins if more than one
for (let i = 1; i < 4; i++) {
  dumpWin(247, 'installed', 'Installed plugins:', 2500, 2000, i)
}

console.log('phase1 done')
