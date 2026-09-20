/**
 * Pass4: every Rz (Us) importer JSX + ebb/fbb (m8/h8) callers + 246 Us leftover body.
 * Invent-ban.
 */
import { readFileSync, writeFileSync } from 'fs'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf247 = readFileSync(SEA[247])
const buf246 = readFileSync(SEA[246])

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

function isIdentChar(c) {
  return (
    (c >= 48 && c <= 57) ||
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    c === 36 ||
    c === 95
  )
}

function findAll(buf, needle, limit = 80) {
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

function findIdent(buf, ident, start, end, limit = 80) {
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
  return { start, end: start + 400, text: asciiWindow(buf, start, start + 400) }
}

function walkBackFunction(buf, pos, maxBack = 25000) {
  const floor = Math.max(0, pos - maxBack)
  const n = Buffer.from('function ')
  let from = floor
  let last = -1
  while (from < pos) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= pos) break
    last = i
    from = i + n.length
  }
  return last
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
  if (bunAt >= 0 && bunAt < end) end = bunAt + bun.length
  return { start, end }
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

log('# PASS4 Rz parents + ebb/fbb + 246 Us')

const rzFrom240 = findAll(buf247, 'Rz as ', 40).filter((i) => {
  const win = asciiWindow(buf247, i, i + 80)
  return win.includes('_240.js')
})
log(`Rz as ... from _240.js count=${rzFrom240.length}`)

for (const i of rzFrom240) {
  const win = asciiWindow(buf247, i, i + 60)
  const m = win.match(/Rz as ([A-Za-z0-9_$]+)/)
  const alias = m?.[1]
  const bounds = findModuleBounds(buf247, i, VER247)
  log(`\n## Rz as ${alias} import@${i} mod=${bounds.start}..${bounds.end} span=${bounds.end - bounds.start}`)
  if (!alias || bounds.start < 0) continue
  const uses = findIdent(buf247, alias, bounds.start, bounds.end, 40)
  log(`  ident ${alias} count=${uses.length}`)
  for (const u of uses) {
    const ctx = compact(asciiWindow(buf247, u - 50, u + 90))
    const after = asciiWindow(buf247, u + alias.length, u + alias.length + 40)
    let kind = 'other'
    if (after.startsWith(',') || after.startsWith('}from') || after.startsWith('}')) kind = 'import'
    else if (/^,\s*\{/.test(after) || after.startsWith(',{')) kind = 'jsx'
    else if (after.startsWith('(')) kind = 'call'
    const hasSv = ctx.includes('storageV5')
    log(`    @${u} ${kind}${hasSv ? ' HAS-storageV5' : ''} ${ctx}`)
    if (kind === 'jsx' || hasSv) {
      const fnAt = walkBackFunction(buf247, u, 20000)
      if (fnAt >= 0) {
        const fn = extractFn(buf247, fnAt)
        const name = `gold-We-provider-mount-Rz-${alias}-fn-${fnAt}.txt`
        dump(name, `# Rz as ${alias} use@${u} fn@${fnAt} end=${fn.end} len=${fn.end - fnAt}\n${fn.text}\n`)
        log(`      dumped ${name} len=${fn.end - fnAt}`)
      }
    }
  }
}

// unique Us prop needles
log('\n# Us prop literals')
for (const n of [
  'writesExitHandoff',
  'fleetNudgeStore',
  'messageQueue:',
  'getFpsMetrics:',
  'sessionHooks:',
  'onChangeAppState:',
]) {
  const hits = findAll(buf247, n, 30)
  log(`${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const ctx = compact(asciiWindow(buf247, i - 60, i + 140))
    const hasSv = ctx.includes('storageV5')
    log(`  @${i}${hasSv ? ' HAS-storageV5' : ''} ${ctx}`)
  }
}

// ebb (m8) imports from _490
log('\n# ebb as (m8 ink render) from _490.js')
{
  const hits = findAll(buf247, 'ebb as ', 30)
  for (const i of hits) {
    const win = asciiWindow(buf247, i - 20, i + 80)
    if (!win.includes('_490.js')) {
      log(`  skip ebb@${i} ${compact(win).slice(0, 80)}`)
      continue
    }
    const m = win.match(/ebb as ([A-Za-z0-9_$]+)/)
    const alias = m?.[1]
    const bounds = findModuleBounds(buf247, i, VER247)
    log(`  ebb as ${alias} @${i} mod=${bounds.start}..${bounds.end} span=${bounds.end - bounds.start}`)
    if (!alias || bounds.start < 0) continue
    const uses = findIdent(buf247, alias, bounds.start, bounds.end, 20)
    log(`    ident count=${uses.length}`)
    for (const u of uses) {
      const ctx = compact(asciiWindow(buf247, u - 40, u + 100))
      log(`      @${u} ${ctx}`)
    }
  }
}

// fbb (h8)
log('\n# fbb as (h8) from _490.js')
{
  const hits = findAll(buf247, 'fbb as ', 20)
  for (const i of hits) {
    const win = asciiWindow(buf247, i - 20, i + 80)
    if (!win.includes('_490.js')) continue
    const m = win.match(/fbb as ([A-Za-z0-9_$]+)/)
    log(`  fbb as ${m?.[1]} @${i} ${compact(win)}`)
  }
}

// 246 leftover Us: module with ubb as Eo + AppStateProvider throw
log('\n# 246 Us-equivalent')
{
  const i = 221279172
  const bounds = findModuleBounds(buf246, i, VER246)
  log(`246 AppState throw @${i} mod=${bounds.start}..${bounds.end} span=${bounds.end - bounds.start}`)
  dump(
    'gold-We-provider-mount-246-AppState-before-Us.txt',
    `# 246 AppStateProvider throw @${i} mod=${bounds.start}..${bounds.end}\n${asciiWindow(buf246, i, i + 3500)}\n`,
  )
  const eohits = findAll(buf246, 'n(Eo,{', 10)
  log(`246 n(Eo,{ count=${eohits.length}`)
  for (const h of eohits) {
    log(`  @${h} ${compact(asciiWindow(buf246, h - 80, h + 160))}`)
    dump(
      `gold-We-provider-mount-246-nEo-${h}.txt`,
      `# 246 n(Eo,{ @${h}\n${asciiWindow(buf246, h - 400, h + 200)}\n`,
    )
  }
  for (const n of ['Eo,{...', '{...ge(', 'vbb as ge', 'function Eo', 'hr===void 0', '===void 0){return']) {
    const hits = findAll(buf246, n, 8)
    const near = hits.filter((h) => h > bounds.start && h < bounds.end)
    log(`246 in-mod ${JSON.stringify(n)} count=${near.length} ${near.join(',')}`)
    for (const h of near.slice(0, 4)) {
      log(`  @${h} ${compact(asciiWindow(buf246, h - 40, h + 120))}`)
    }
  }
}

dump('gold-We-provider-mount-pass4-scan.txt', report.join('\n') + '\n')
