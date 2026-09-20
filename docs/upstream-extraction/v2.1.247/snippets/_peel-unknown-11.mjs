import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'

if (!existsSync(p247) || !existsSync(p246)) {
  console.log('MISSING SEA', { p247: existsSync(p247), p246: existsSync(p246) })
  process.exit(1)
}

const b247 = readFileSync(p247)
const b246 = readFileSync(p246)
console.log('loaded', b247.length, b246.length)

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

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

function printableRun(buf, pos) {
  let a = pos
  let b = pos
  while (a > 0) {
    const c = buf[a - 1]
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) a--
    else break
  }
  while (b < buf.length) {
    const c = buf[b]
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) b++
    else break
  }
  return { start: a, end: b, len: b - a }
}

function allHits(buf, needle) {
  const n = Buffer.from(needle)
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

function classify(buf, i) {
  const run = printableRun(buf, i)
  const win = asciiWindow(buf, Math.max(0, i - 80), i + 80)
  const jsScore =
    (win.match(/[{}();=]/g) || []).length +
    (win.includes('function') ? 8 : 0) +
    (win.includes('return') ? 4 : 0)
  const kind = run.len >= 200 && jsScore >= 8 ? 'js' : 'tbl'
  return { ...run, kind, jsScore }
}

function findLast(buf, needle, before, afterFrom) {
  const n = Buffer.from(needle)
  let found = -1
  let from = Math.max(0, afterFrom)
  while (from < before) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= before) break
    found = i
    from = i + 1
  }
  return found
}

function isIdentStart(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95
}

function isIdent(c) {
  return isIdentStart(c) || (c >= 48 && c <= 57)
}

function readIdent(buf, i) {
  if (!isIdentStart(buf[i])) return null
  let j = i
  while (j < buf.length && isIdent(buf[j])) j++
  return buf.toString('ascii', i, j)
}

function extractBraced(buf, bracePos) {
  if (buf[bracePos] !== 123) return null
  let depth = 0
  let i = bracePos
  let inStr = null
  let esc = false
  const limit = Math.min(buf.length, bracePos + 200000)
  while (i < limit) {
    const c = buf[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === 92) esc = true
      else if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inStr = c
      i++
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        return {
          start: bracePos,
          end: i + 1,
          body: buf.toString('ascii', bracePos, i + 1),
        }
      }
    }
    i++
  }
  return null
}

function extractNamedFunction(buf, pos) {
  const searchFrom = Math.max(0, pos - 120000)
  const fnAt = findLast(buf, 'function ', pos, searchFrom)
  if (fnAt < 0) return null
  let start = fnAt
  if (fnAt >= 6 && buf.toString('ascii', fnAt - 6, fnAt) === 'async ') {
    start = fnAt - 6
  }
  let i = fnAt + 9
  const name = readIdent(buf, i) || ''
  if (name) i += name.length
  while (i < buf.length && (buf[i] === 32 || buf[i] === 10 || buf[i] === 13)) i++
  if (buf[i] !== 40) return null
  let depth = 0
  let inStr = null
  let esc = false
  while (i < buf.length) {
    const c = buf[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === 92) esc = true
      else if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inStr = c
      i++
      continue
    }
    if (c === 40) depth++
    else if (c === 41) {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
    i++
  }
  while (i < buf.length && (buf[i] === 32 || buf[i] === 10 || buf[i] === 13)) i++
  if (buf[i] !== 123) return null
  const braced = extractBraced(buf, i)
  if (!braced) return null
  if (pos < start || pos >= braced.end) return null
  const src = buf.toString('ascii', start, braced.end)
  return {
    start,
    end: braced.end,
    name,
    async: start !== fnAt,
    len: braced.end - start,
    src,
    sha: createHash('sha256').update(src).digest('hex').slice(0, 16),
  }
}

function extractInnermostFunction(buf, pos) {
  const searchFrom = Math.max(0, pos - 120000)
  let from = searchFrom
  const needle = Buffer.from('function ')
  let best = null
  while (from < pos) {
    const i = buf.indexOf(needle, from)
    if (i < 0 || i >= pos) break
    const cand = extractNamedFunction(buf, i + 9)
    if (cand && cand.start <= pos && pos < cand.end) best = cand
    from = i + 1
  }
  return best
}

function extractFunctionByNameNear(buf, name, near, radius = 80000) {
  const needle = `function ${name}(`
  const hits = allHits(buf, needle)
  if (hits.length === 0) return null
  let best = null
  let bestDist = Infinity
  for (const i of hits) {
    const fn = extractNamedFunction(buf, i + 9)
    if (!fn || fn.name !== name) continue
    const dist = Math.abs(i - near)
    if (dist < bestDist && dist <= radius) {
      best = fn
      bestDist = dist
    }
  }
  return best
}

function dump(name, text) {
  writeFileSync(
    `${outDir}/${name}`,
    text.endsWith('\n') ? text : `${text}\n`,
  )
  console.log('WROTE', name, text.length)
}

function summarizeFn(fn) {
  if (!fn) return 'NONE'
  return `${fn.async ? 'async ' : ''}function ${fn.name}() start=${fn.start} end=${fn.end} len=${fn.len} sha=${fn.sha}`
}

const countNeedles = [
  'home-manager',
  'home_manager',
  'homeManager',
  'stow',
  'dotfile-managed',
  'dotfile managed',
  'repointed',
  'writable area',
  'outside the sandbox',
  'settings.json symlink',
  'settings.json',
  '~/.claude/settings.json',
  '.claude/settings.json',
  'cleanupAfterCommand',
  'sandbox cleanupAfterCommand failed',
  'Cleaned up bwrap mount point',
  'Deferring mount point cleanup',
  'isSymbolicLink',
  'lstatSync',
  'lstat(',
  'unlinkSync',
  'unlink(',
  'readlinkSync',
  'getSettingsFilePathForSource',
  'scrubbed planted',
  'scrubBareGit',
  'denyWrite',
  'cleanupAfterCommand:kD',
  'cleanupAfterCommand:ED',
  'function kD(){Ec()}',
  'function Ec(e){',
  'PZ(),LZ()',
  'xZ(),TZ()',
  'Re.cleanupAfterCommand(),PZ(),LZ()',
  'Le.cleanupAfterCommand(),xZ(),TZ()',
]

const countLines = [
  '# gold-11-unk-counts 247 vs 246 settings-symlink / cleanup / lstat',
  '',
]
const jsHits = { 247: [], 246: [] }

for (const needle of countNeedles) {
  const h246 = allHits(b246, needle)
  const h247 = allHits(b247, needle)
  const mark = h246.length === h247.length ? 'same' : 'DIFF'
  countLines.push(
    `${mark} 246=${h246.length} 247=${h247.length} ${JSON.stringify(needle)}`,
  )
  for (const [ver, buf, hits] of [
    ['246', b246, h246],
    ['247', b247, h247],
  ]) {
    hits.slice(0, 8).forEach((i, idx) => {
      const c = classify(buf, i)
      countLines.push(
        `  ${ver}#${idx} offset=${i} kind=${c.kind} run=${c.len} jsScore=${c.jsScore}`,
      )
      if (c.kind === 'js') jsHits[ver].push({ needle, idx, offset: i, ...c })
    })
    if (hits.length > 8) {
      countLines.push(`  ${ver} ... ${hits.length - 8} more hits omitted`)
    }
  }
}

dump('gold-11-unk-counts.txt', countLines.join('\n'))

// Wrapper extras: extract PZ/LZ (247) and xZ/TZ (246) near cleanupAfterCommand wrapper.
const wrap247 = allHits(
  b247,
  'cleanupAfterCommand:()=>{Re.cleanupAfterCommand(),PZ(),LZ()}',
)
const wrap246 = allHits(
  b246,
  'cleanupAfterCommand:()=>{Le.cleanupAfterCommand(),xZ(),TZ()}',
)

const wrapLines = [
  '# gold-11-unk-wrap cleanupAfterCommand extras PZ/LZ vs xZ/TZ',
  '',
  `247 wrap hits=${wrap247.length} ${wrap247.join(',')}`,
  `246 wrap hits=${wrap246.length} ${wrap246.join(',')}`,
  '',
]

function dumpFn(tag, fn, extra = '') {
  if (!fn) {
    wrapLines.push(`${tag} NONE ${extra}`)
    return
  }
  wrapLines.push(`${tag} ${summarizeFn(fn)} ${extra}`)
  dump(
    `gold-11-unk-${tag}.txt`,
    `# ${tag} ${summarizeFn(fn)} ${extra}\n\n${fn.src}\n`,
  )
}

const near247 = wrap247[0] ?? 210435229
const near246 = wrap246[0] ?? 209177589

const pz = extractFunctionByNameNear(b247, 'PZ', near247)
const lz = extractFunctionByNameNear(b247, 'LZ', near247)
const xz = extractFunctionByNameNear(b246, 'xZ', near246)
const tz = extractFunctionByNameNear(b246, 'TZ', near246)

dumpFn('247-PZ', pz, `near=${near247}`)
dumpFn('247-LZ', lz, `near=${near247}`)
dumpFn('246-xZ', xz, `near=${near246}`)
dumpFn('246-TZ', tz, `near=${near246}`)

if (pz && xz) {
  wrapLines.push(`PZ vs xZ sameSha=${pz.sha === xz.sha} len ${pz.len}/${xz.len}`)
}
if (lz && tz) {
  wrapLines.push(`LZ vs TZ sameSha=${lz.sha === tz.sha} len ${lz.len}/${tz.len}`)
}

dump('gold-11-unk-wrap.txt', wrapLines.join('\n'))

// Extract Ec / 246 equivalent from bwrap cleanup log string.
const bwrapNeedle = 'Cleaned up bwrap mount point (file):'
const ec247hits = allHits(b247, bwrapNeedle)
const ec246hits = allHits(b246, bwrapNeedle)
const ecLines = [
  '# gold-11-unk-ec bwrap empty-mount cleanup function',
  '',
  `247 ${JSON.stringify(bwrapNeedle)} hits=${ec247hits.length} ${ec247hits.slice(0, 4).join(',')}`,
  `246 ${JSON.stringify(bwrapNeedle)} hits=${ec246hits.length} ${ec246hits.slice(0, 4).join(',')}`,
  '',
]

function dumpEc(ver, buf, hits) {
  const seen = new Set()
  hits.slice(0, 4).forEach((i, idx) => {
    const fn = extractInnermostFunction(buf, i)
    ecLines.push(`${ver}#${idx} @${i} → ${summarizeFn(fn)}`)
    if (!fn) {
      dump(
        `gold-11-unk-${ver}-bwrap-win-${idx}.txt`,
        `# ver=${ver} offset=${i} NO_FN\n\n${asciiWindow(buf, i - 800, i + 1200)}\n`,
      )
      return
    }
    const key = `${fn.start}:${fn.end}`
    if (seen.has(key)) return
    seen.add(key)
    dump(
      `gold-11-unk-${ver}-bwrap-${fn.name || 'anon'}.txt`,
      `# ver=${ver} ${summarizeFn(fn)} needle=${JSON.stringify(bwrapNeedle)}\n\n${fn.src}\n`,
    )
  })
}

dumpEc('247', b247, ec247hits)
dumpEc('246', b246, ec246hits)
dump('gold-11-unk-ec.txt', ecLines.join('\n'))

// Extract kD / 246 ED cleanupAfterCommand package functions.
const kd247 = allHits(b247, 'function kD(){Ec()}')
const ed246 = allHits(b246, 'function ED(){')
const pkgLines = [
  '# gold-11-unk-pkg cleanupAfterCommand package fn',
  '',
  `247 function kD(){Ec()} hits=${kd247.length} ${kd247.join(',')}`,
  `246 function ED(){ hits=${ed246.length} ${ed246.slice(0, 8).join(',')}`,
  '',
]
for (const i of kd247.slice(0, 2)) {
  const fn = extractNamedFunction(b247, i + 9)
  pkgLines.push(`247 kD @${i} ${summarizeFn(fn)}`)
  if (fn) {
    dump(
      `gold-11-unk-247-kD.txt`,
      `# 247 ${summarizeFn(fn)}\n\n${fn.src}\n`,
    )
  }
}
for (const i of ed246.slice(0, 6)) {
  const win = asciiWindow(b246, i, i + 80)
  if (!win.includes('Ec(') && !win.includes('cleanup') && !win.includes('{Ec')) {
    continue
  }
  const fn = extractNamedFunction(b246, i + 9)
  pkgLines.push(`246 ED @${i} ${summarizeFn(fn)} win=${JSON.stringify(win.slice(0, 60))}`)
  if (fn) {
    dump(
      `gold-11-unk-246-ED.txt`,
      `# 246 ${summarizeFn(fn)}\n\n${fn.src}\n`,
    )
  }
}
dump('gold-11-unk-pkg.txt', pkgLines.join('\n'))

// Hunt JS windows where settings.json sits next to lstat / unlink / symlink / cleanup.
const pairNeedles = [
  'settings.json',
  'isSymbolicLink',
  'lstatSync',
  'unlinkSync',
  'cleanupAfterCommand',
]
const huntLines = [
  '# gold-11-unk-hunt settings.json near lstat/unlink/symlink in JS',
  '',
]

function nearby(buf, aHits, bNeedle, radius) {
  const bHits = allHits(buf, bNeedle)
  const out = []
  for (const a of aHits) {
    for (const b of bHits) {
      if (Math.abs(a - b) <= radius) {
        out.push({ a, b, dist: Math.abs(a - b) })
        break
      }
    }
  }
  return out
}

const pairs = [
  ['settings.json', 'isSymbolicLink', 2500],
  ['settings.json', 'lstatSync', 2500],
  ['settings.json', 'unlinkSync', 2500],
  ['settings.json', 'cleanupAfterCommand', 4000],
  ['settings.json', 'lstat(', 2500],
  ['settings.json', 'unlink(', 2500],
  ['.claude/settings.json', 'isSymbolicLink', 2500],
  ['.claude/settings.json', 'unlinkSync', 2500],
  ['~/.claude/settings.json', 'isSymbolicLink', 2500],
]

for (const [a, b, radius] of pairs) {
  for (const [ver, buf] of [
    ['246', b246],
    ['247', b247],
  ]) {
    const hitsA = allHits(buf, a)
    const near = nearby(buf, hitsA, b, radius)
    huntLines.push(
      `${ver} pair ${JSON.stringify(a)}~${JSON.stringify(b)} r=${radius} near=${near.length}/${hitsA.length}`,
    )
    near.slice(0, 4).forEach((p, idx) => {
      const c = classify(buf, p.a)
      huntLines.push(
        `  #${idx} a=${p.a} b=${p.b} dist=${p.dist} kind=${c.kind} jsScore=${c.jsScore}`,
      )
      if (c.kind !== 'js') return
      const fn = extractInnermostFunction(buf, p.a)
      huntLines.push(`    fn ${summarizeFn(fn)}`)
      if (fn && (fn.src.includes('unlink') || fn.src.includes('lstat') || fn.src.includes('isSymbolicLink'))) {
        const slug = `${ver}-pair-${idx}-${fn.name || 'anon'}-${fn.start}`
        dump(
          `gold-11-unk-${slug}.txt`,
          `# ${ver} pair ${JSON.stringify(a)}~${JSON.stringify(b)} ${summarizeFn(fn)}\n\n${fn.src}\n`,
        )
      } else {
        dump(
          `gold-11-unk-${ver}-pair-${idx}-win.txt`,
          `# ${ver} pair ${JSON.stringify(a)}~${JSON.stringify(b)} a=${p.a} NO_PRESERVE_FN\n\n${asciiWindow(buf, p.a - 800, p.a + 1600)}\n`,
        )
      }
    })
  }
}

dump('gold-11-unk-hunt.txt', huntLines.join('\n'))

// Windows around unique DIFF strings if any exist as JS.
const uniqueNeedles = [
  'home-manager',
  'stow',
  'dotfile-managed',
  'repointed',
  'writable area',
  'settings.json symlink',
]
for (const needle of uniqueNeedles) {
  const h247 = allHits(b247, needle)
  const h246 = allHits(b246, needle)
  if (h247.length === 0 && h246.length === 0) continue
  h247.slice(0, 3).forEach((i, idx) => {
    dump(
      `gold-11-unk-247-unique-${needle.replace(/[^A-Za-z0-9]+/g, '-')}-${idx}.txt`,
      `# 247 unique-ish ${JSON.stringify(needle)} offset=${i} 246hits=${h246.length}\n\n${asciiWindow(b247, i - 600, i + 1200)}\n`,
    )
  })
}

const leftover = [
  '# gold-11-unk-leftover remaining cleanupAfterCommand hits',
  '',
]
for (const [ver, buf] of [
  ['246', b246],
  ['247', b247],
]) {
  const hits = allHits(buf, 'cleanupAfterCommand')
  leftover.push(`## ${ver} cleanupAfterCommand hits=${hits.length}`)
  hits.forEach((i, idx) => {
    const c = classify(buf, i)
    leftover.push(
      `  #${idx} offset=${i} kind=${c.kind} run=${c.len} jsScore=${c.jsScore}`,
    )
    if (c.kind === 'js') {
      leftover.push(
        `    win=${JSON.stringify(asciiWindow(buf, i - 120, i + 180).slice(0, 220))}`,
      )
    }
  })
  leftover.push('')
}
dump('gold-11-unk-leftover.txt', leftover.join('\n'))

console.log('DONE #11 peel', {
  wrap247: wrap247.length,
  wrap246: wrap246.length,
  pz: pz ? pz.sha : null,
  lz: lz ? lz.sha : null,
  xz: xz ? xz.sha : null,
  tz: tz ? tz.sha : null,
})
