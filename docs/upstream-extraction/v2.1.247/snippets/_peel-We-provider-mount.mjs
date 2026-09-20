/**
 * We Provider mount peel — official 2.1.247 vs 246.
 * Invent-ban: do not invent a React Provider mount if not uniquely found.
 * Do not claim getPinnedStorageV5 ≡ We().
 *
 * Goal: who RENDERS z/jdb with {storageV5, credentials, children}.
 * a(e.Provider,{value,children}) is the Provider BODY — find CALLERS of z/jdb.
 */
import { readFileSync, writeFileSync } from 'fs'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf247 = readFileSync(SEA[247])
const buf246 = readFileSync(SEA[246])
console.log('loaded', buf246.length, buf247.length)

function asciiWindow(buf, start, end) {
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
  return s
}

function compact(s) {
  return s.replace(/[.]{4,}/g, '...').replace(/\n/g, ' ')
}

function findAll(buf, needle, limit = 200) {
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

function findAllInRange(buf, needle, start, end, limit = 200) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
  const hits = []
  let from = start
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= end) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function isIdentChar(c) {
  return (
    (c >= 48 && c <= 57) ||
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    c === 36 ||
    c === 95
  )
}

function findIdent(buf, ident, start, end, limit = 400) {
  const n = Buffer.from(ident)
  const hits = []
  let from = start
  while (hits.length < limit && from < end) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= end) break
    const prev = i > 0 ? buf[i - 1] : 0
    const next = i + n.length < buf.length ? buf[i + n.length] : 0
    if (!isIdentChar(prev) && !isIdentChar(next)) hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFn(buf, start) {
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
        return { start, end: i + 1, text: asciiWindow(buf, start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(buf, start, start + 200) }
}

function walkBackToFn(buf, pos, maxBack = 8000) {
  const floor = Math.max(0, pos - maxBack)
  const probes = [
    'async function ',
    'function ',
    'const ',
    'let ',
    'var ',
    '=()=>',
    '=e=>',
    '=t=>',
  ]
  let best = -1
  let kind = ''
  for (const p of probes) {
    const n = Buffer.from(p)
    let from = floor
    let last = -1
    while (from < pos) {
      const i = buf.indexOf(n, from)
      if (i < 0 || i >= pos) break
      last = i
      from = i + n.length
    }
    if (last > best) {
      best = last
      kind = p
    }
  }
  return { at: best, kind }
}

const VER247 = Buffer.from('// Version: 2.1.247')
const VER246 = Buffer.from('// Version: 2.1.246')

function findModuleBounds(buf, near, verNeedle) {
  const start = buf.lastIndexOf(verNeedle, near)
  if (start < 0) return { start: -1, end: -1 }
  const next = buf.indexOf(verNeedle, start + verNeedle.length)
  const bun = Buffer.from('.// @bun @bytecode')
  let end = next >= 0 ? next : buf.length
  const bunAt = buf.indexOf(bun, near)
  if (bunAt >= 0 && bunAt < end) {
    const exp = Buffer.from('export{')
    const expAt = buf.lastIndexOf(exp, bunAt)
    if (expAt > start) end = bunAt + bun.length
  }
  return { start, end }
}

function parse499Import(win) {
  const m = win.match(
    /import\{([^}]*)\}from"B:\/~BUN\/root\/_499\.js"/,
  )
  if (!m) return null
  const aliases = {}
  for (const part of m[1].split(',')) {
    const mm = part.trim().match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/)
    if (mm) aliases[mm[1]] = mm[2]
  }
  return { clause: m[1], aliases }
}

function quotedStrings(text, minLen = 10, limit = 40) {
  const out = []
  const re = /"((?:[^"\\]|\\.){10,120})"/g
  let m
  while ((m = re.exec(text)) && out.length < limit) {
    if (m[1].length >= minLen) out.push(m[1])
  }
  return out
}

function classifyIdentUse(buf, ident, i) {
  const before = asciiWindow(buf, i - 24, i)
  const after = asciiWindow(buf, i + ident.length, i + ident.length + 48)
  const ctx = compact(asciiWindow(buf, i - 40, i + ident.length + 60))
  let kind = 'other'
  if (before.includes('import{') || before.includes(' as ') || after.startsWith(',') || after.startsWith('}from')) {
    if (before.includes('jdb as') || after.includes('from"B:/~BUN/root/_499')) kind = 'import-jdb'
    else if (before.includes('import{') || before.includes(',')) kind = 'import-or-list'
  }
  if (/\bexport\{/.test(before) || before.endsWith('export{')) kind = 'export'
  const call = after.match(/^(\s*)\(/)
  const jsx = after.match(/^,\{/)
  const jsxAny = after.match(/^,/)
  const prev = before.match(/([A-Za-z_$][A-Za-z0-9_$]*)\($/)
  if (jsx && prev) kind = `jsx-factory:${prev[1]}(${ident},{`
  else if (call) kind = `call:${ident}(`
  else if (jsxAny && prev) kind = `factory:${prev[1]}(${ident},`
  else if (/=$/.test(before.trim()) || before.endsWith('=')) kind = 'assign-rhs'
  else if (after.startsWith(' as ')) kind = 'reexport-alias'
  return { kind, ctx }
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

// ---------------------------------------------------------------------------
// PASS 1 — every _499 import + jdb/kdb/ldb/mdb/ndb aliases
// ---------------------------------------------------------------------------
log('# PASS1 every _499 source import + export aliases')
log(`247 size=${buf247.length} 246 size=${buf246.length}`)

const importNeedle = 'from"B:/~BUN/root/_499.js"'
const imp247 = findAll(buf247, importNeedle, 80)
log(`247 ${JSON.stringify(importNeedle)} count=${imp247.length}`)

const parsed247 = []
for (const i of imp247) {
  const win = asciiWindow(buf247, i - 220, i + importNeedle.length + 2)
  const parsed = parse499Import(win)
  const bounds = findModuleBounds(buf247, i, VER247)
  const row = {
    at: i,
    aliases: parsed?.aliases || {},
    clause: parsed?.clause || compact(win).slice(0, 180),
    modStart: bounds.start,
    modEnd: bounds.end,
    span: bounds.end > 0 && bounds.start > 0 ? bounds.end - bounds.start : -1,
  }
  parsed247.push(row)
  log(
    `  @${i} jdb=${row.aliases.jdb || '-'} kdb=${row.aliases.kdb || '-'} ldb=${row.aliases.ldb || '-'} mdb=${row.aliases.mdb || '-'} ndb=${row.aliases.ndb || '-'} mod=${row.modStart}..${row.modEnd} span=${row.span}`,
  )
  log(`    clause={${row.clause}}`)
}

for (const n of ['jdb as ', 'kdb as ', 'ldb as ', 'mdb as ', 'ndb as ', ' as jdb', ' as kdb']) {
  const hits = findAll(buf247, n, 80)
  log(`${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
}

// ---------------------------------------------------------------------------
// PASS 2 — jdb importer modules: ident uses of LR / Ar
// ---------------------------------------------------------------------------
log('\n# PASS2 jdb importer modules — ident uses (collision-safe in-module)')

const jdbImporters = parsed247.filter((r) => r.aliases.jdb)
for (const row of jdbImporters) {
  const alias = row.aliases.jdb
  const { modStart, modEnd } = row
  log(`\n## jdb as ${alias} import@${row.at} mod=${modStart}..${modEnd} span=${row.span}`)
  if (modStart < 0) {
    log('  MODULE BOUNDS UNKNOWN')
    continue
  }
  const head = asciiWindow(buf247, modStart, Math.min(modStart + 2500, modEnd))
  dump(
    `gold-We-provider-mount-mod-${alias}-${modStart}.txt`,
    `# jdb as ${alias} module @${modStart}..${modEnd} import@${row.at}\n${head}\n`,
  )
  const expNeedle = Buffer.from('export{')
  const expAt = buf247.lastIndexOf(expNeedle, modEnd)
  if (expAt > modStart) {
    const expWin = asciiWindow(buf247, expAt, Math.min(expAt + 800, modEnd + 20))
    log(`  export@${expAt} ${compact(expWin).slice(0, 300)}`)
    dump(
      `gold-We-provider-mount-export-${alias}-${expAt}.txt`,
      `# export @${expAt}\n${expWin}\n`,
    )
  }
  const uses = findIdent(buf247, alias, modStart, modEnd, 200)
  log(`  ident ${alias} in-module count=${uses.length}`)
  const kinds = {}
  for (const u of uses) {
    const info = classifyIdentUse(buf247, alias, u)
    kinds[info.kind] = (kinds[info.kind] || 0) + 1
    log(`    @${u} ${info.kind} ${info.ctx}`)
  }
  log(`  kind-tally ${JSON.stringify(kinds)}`)

  const strings = quotedStrings(asciiWindow(buf247, modStart, Math.min(modStart + 80000, modEnd)), 12, 50)
  log(`  strings[0..20]=${JSON.stringify(strings.slice(0, 20))}`)

  // factory needles unique to this alias
  for (const n of [
    `(${alias},{`,
    `(${alias},`,
    `${alias}({`,
    `${alias}(`,
    `${alias} as `,
    `export{${alias}`,
    `${alias},{storageV5`,
    `${alias},{children`,
    `${alias},{...`,
  ]) {
    const hits = findAllInRange(buf247, n, modStart, modEnd, 30)
    log(`  in-mod ${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
    for (const h of hits.slice(0, 8)) {
      log(`    @${h} ${compact(asciiWindow(buf247, h - 50, h + 120))}`)
    }
  }
}

// ---------------------------------------------------------------------------
// PASS 3 — object literals with storageV5 + credentials + children
// ---------------------------------------------------------------------------
log('\n# PASS3 object literals / destructures with storageV5+credentials+children')

const svHits = findAll(buf247, 'storageV5:', 200)
log(`storageV5: count=${svHits.length}`)
const triple = []
for (const i of svHits) {
  const win = asciiWindow(buf247, i - 80, i + 220)
  const hasCred = win.includes('credentials')
  const hasChild = win.includes('children')
  if (!hasCred || !hasChild) continue
  const destructure = win.includes('}=') || /storageV5:[A-Za-z0-9_$]+,credentials:[A-Za-z0-9_$]+,children:[A-Za-z0-9_$]+\}=/.test(win)
  const construct = /\{storageV5:[^}]+credentials:[^}]+children:/.test(win) && !destructure
  triple.push({ i, destructure, construct, win: compact(win) })
  log(`  TRIPLE @${i} destructure=${destructure} construct=${construct}`)
  log(`    ${compact(win)}`)
}
log(`triple-window count=${triple.length} construct=${triple.filter((t) => t.construct).length}`)

for (const n of [
  '{storageV5:',
  '{storageV5,credentials,children',
  '{storageV5,credentials',
  'storageV5:n,credentials:s,children',
  'n===void 0&&s===void 0?c:',
  'a(e.Provider,{value:',
  '.Provider,{value:',
  't(z,{storageV5',
  'jsx(z',
  'jsxs(z',
  'createElement(z',
  't(LR,{',
  't(Ar,{storageV5',
  'LR,{storageV5',
  'Ar,{storageV5',
  'children:S}=j',
]) {
  const hits = findAll(buf247, n, 20)
  log(`P3 ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 60, i + 140))}`)
  }
}

// ---------------------------------------------------------------------------
// PASS 4 — as LR / as Ar uniqueness + collision-ban
// ---------------------------------------------------------------------------
log('\n# PASS4 as LR / as Ar uniqueness (Ar collision-ban vs Jr getSecureStorage)')
for (const n of ['jdb as LR', 'jdb as Ar', ' as LR', ' as Ar', 'Ar as xRc', 'function Ar(){if(oe)return oe']) {
  const hits = findAll(buf247, n, 30)
  log(`${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 40, i + 100))}`)
  }
}

const tAr = findAll(buf247, 't(Ar,{', 20)
log(`t(Ar,{ count=${tAr.length}`)
for (const i of tAr) {
  const bounds = findModuleBounds(buf247, i, VER247)
  const inJdb = jdbImporters.some((r) => i >= r.modStart && i < r.modEnd)
  log(
    `  @${i} inJdbMod=${inJdb} mod=${bounds.start}..${bounds.end} ${compact(asciiWindow(buf247, i - 80, i + 160))}`,
  )
}

// ---------------------------------------------------------------------------
// PASS 5 — 246 vs 247 leftover vs new
// ---------------------------------------------------------------------------
log('\n# PASS5 246 vs 247 Provider leftover?')
const needles246 = [
  'storageV5:n,credentials:s,children',
  'n===void 0&&s===void 0?c:',
  'jdb as ',
  ' as jdb',
  'function z(j){let R=v(6)',
  'export{z as jdb,b as kdb',
  'a(e.Provider,{value:',
  '{storageV5,credentials,children',
  'from"B:/~BUN/root/_499.js"',
]
for (const n of needles246) {
  const a = findAll(buf246, n, 30)
  const b = findAll(buf247, n, 30)
  log(`${a.length === b.length ? 'same' : 'DIFF'} 246=${a.length} 247=${b.length} ${JSON.stringify(n)}`)
  if (a.length) {
    for (const i of a.slice(0, 4)) {
      log(`  246 @${i} ${compact(asciiWindow(buf246, i - 40, i + 120))}`)
    }
  }
  if (b.length && a.length !== b.length) {
    for (const i of b.slice(0, 4)) {
      log(`  247 @${i} ${compact(asciiWindow(buf247, i - 40, i + 120))}`)
    }
  }
}

// 246 _499-like export / Provider body via unique value ternary
{
  const hits = findAll(buf246, 'n===void 0&&s===void 0?c:', 8)
  for (const i of hits) {
    const bounds = findModuleBounds(buf246, i, VER246)
    log(`246 ternary @${i} mod=${bounds.start}..${bounds.end} span=${bounds.end - bounds.start}`)
    dump(
      `gold-We-provider-mount-246-ternary-${i}.txt`,
      `# 246 ternary @${i} mod=${bounds.start}..${bounds.end}\n${asciiWindow(buf246, i - 400, i + 400)}\n`,
    )
    const jdb = findAllInRange(buf246, ' as jdb', Math.max(0, i - 2000), i + 2000, 4)
    const jdbAs = findAll(buf246, 'jdb as ', 15)
    log(`  246 nearby as jdb ${jdb.join(',')}  all jdb as ${jdbAs.join(',')}`)
  }
}

dump('gold-We-provider-mount-pass1-scan.txt', report.join('\n') + '\n')
