import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(needle, limit = 40) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFn(start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        const end = i + 1
        return { start, end, text: asciiWindow(start, end) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
  return `${outDir}/${name}`
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log(`# j0n/yln peel official-247 size=${buf.length}`)

const AME = 214576324
const DPE = 213653071
const _0N = 214579796

log(`LOCKED ame@${AME}`)
log(`LOCKED dPe@${DPE}`)
log(`LOCKED _0n@${_0N}`)

dump(
  'gold-j0n-ame-before-8k.txt',
  `# ame@${AME} before 8k\n${asciiWindow(AME - 8000, AME)}\n`,
)
dump(
  'gold-j0n-ame-after-2k.txt',
  `# ame@${AME} after 2k\n${asciiWindow(AME, AME + 2000)}\n`,
)
dump(
  'gold-yln-dPe-before-8k.txt',
  `# dPe@${DPE} before 8k\n${asciiWindow(DPE - 8000, DPE)}\n`,
)
dump(
  'gold-yln-dPe-after-2k.txt',
  `# dPe@${DPE} after 2k\n${asciiWindow(DPE, DPE + 2000)}\n`,
)

const uniqueNeedles = [
  'installed_plugins.json',
  'Failed to load installed_plugins',
  'Failed to write installed_plugins',
  'Failed to save installed_plugins',
  "doesn't exist, returning empty",
  'Loaded and converted',
  'Removed installed plugin for marketplace removal:',
  'pluginUsage',
  'installedPlugins',
  'plugin-registry',
  'plugins/installed',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(
      `  @${i} ${asciiWindow(i - 100, i + n.length + 120).replace(/\n/g, ' ')}`,
    )
  }
}

const fnNeedles = [
  'async function TB(',
  'function TB(',
  'async function j0n(',
  'function j0n(',
  'async function IR(',
  'function IR(',
  'async function N0n(',
  'function N0n(',
  'async function yln(',
  'function yln(',
  'var TB=',
  'var j0n=',
  'var IR=',
  'var N0n=',
  'var yln=',
]

for (const n of fnNeedles) {
  const hits = findAll(n, 30)
  log(`FN ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 10)) {
    const win = asciiWindow(i, i + 220).replace(/\n/g, ' ')
    log(`  @${i} ${win}`)
  }
}

const aliasNeedles = [
  ' as TB',
  'TB as ',
  ' as j0n',
  'j0n as ',
  ' as IR',
  'IR as ',
  ' as N0n',
  'N0n as ',
  ' as yln',
  'yln as ',
]

for (const n of aliasNeedles) {
  const hits = findAll(n, 20)
  log(`ALIAS ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 10)) {
    log(`  @${i} ${asciiWindow(i - 60, i + 100).replace(/\n/g, ' ')}`)
  }
}

// calls from locked callers
for (const n of [
  'let n=TB(t)',
  'TB(t)',
  'return j0n(',
  'j0n(t,n,e)',
  'let r=IR()',
  'IR()',
  'await N0n(',
  'N0n(r)',
  'yln(n)',
  'yln(n),ki(',
]) {
  const hits = findAll(n, 15)
  log(`CALL ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${asciiWindow(i - 50, i + n.length + 80).replace(/\n/g, ' ')}`)
  }
}

// dump each uniquely-named fn hit
for (const [label, needle] of [
  ['TB-async', 'async function TB('],
  ['TB', 'function TB('],
  ['j0n-async', 'async function j0n('],
  ['j0n', 'function j0n('],
  ['IR-async', 'async function IR('],
  ['IR', 'function IR('],
  ['N0n-async', 'async function N0n('],
  ['N0n', 'function N0n('],
  ['yln-async', 'async function yln('],
  ['yln', 'function yln('],
]) {
  const hits = findAll(needle, 20)
  hits.forEach((i, idx) => {
    const fn = extractFn(i)
    const prefix = label.startsWith('yln') ? 'gold-yln' : 'gold-j0n'
    dump(
      `${prefix}-fn-${label}-${idx}.txt`,
      `# needle=${needle} pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
    )
    log(`DUMP ${label}#${idx} @${i} end=${fn.end} len=${fn.end - i}`)
  })
}

dump('gold-j0n-yln-scan.txt', report.join('\n') + '\n')
