/**
 * Pass5: REPL AppRoot parent + 246 zs full + Kc/M callers.
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

function findAll(buf, needle, limit = 20) {
  const n = Buffer.from(needle)
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

function walkBackFunction(buf, pos, maxBack = 40000) {
  const floor = Math.max(0, pos - maxBack)
  const needles = ['async function ', 'function ']
  let best = -1
  for (const p of needles) {
    const n = Buffer.from(p)
    let from = floor
    let last = -1
    while (from < pos) {
      const i = buf.indexOf(n, from)
      if (i < 0 || i >= pos) break
      last = i
      from = i + n.length
    }
    if (last > best) best = last
  }
  return best
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

log('# PASS5 REPL parent + 246 zs + leftover Kc/M')

// REPL key
for (const n of ['},"repl")', '},"resume")', 'export{a as AppRoot}', 'AppRoot']) {
  const hits = findAll(buf247, n, 10)
  log(`${JSON.stringify(n)} count=${hits.length} ${hits.join(',')}`)
  for (const i of hits) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 80, i + 100))}`)
  }
}

{
  const i = 222168735
  dump(
    'gold-We-provider-mount-REPL-before-2k.txt',
    `# REPL AppRoot props @${i}\n${asciiWindow(buf247, i - 800, i + 500)}\n`,
  )
  const fnAt = walkBackFunction(buf247, i, 30000)
  log(`REPL-prop @${i} fn@${fnAt}`)
  if (fnAt >= 0) {
    const fn = extractFn(buf247, fnAt)
    log(`REPL-fn len=${fn.end - fnAt} end=${fn.end}`)
    dump(
      `gold-We-provider-mount-REPL-fn-${fnAt}.txt`,
      `# REPL AppRoot parent @${fnAt} end=${fn.end} len=${fn.end - fnAt}\n${fn.text}\n`,
    )
  }
}

// also try},"repl") site
{
  const i = 222168989
  const fnAt = walkBackFunction(buf247, i, 30000)
  log(`repl-key @${i} fn@${fnAt}`)
  if (fnAt >= 0 && fnAt !== 222168735) {
    const fn = extractFn(buf247, fnAt)
    dump(
      `gold-We-provider-mount-REPL-fn2-${fnAt}.txt`,
      `# },"repl") parent @${fnAt} end=${fn.end} len=${fn.end - fnAt}\n${fn.text}\n`,
    )
  }
}

// 246 zs full
{
  const i = buf246.indexOf(Buffer.from('function zs(Jc){'))
  log(`246 function zs(Jc){ @${i}`)
  if (i >= 0) {
    const fn = extractFn(buf246, i)
    log(`246 zs len=${fn.end - i}`)
    dump(
      `gold-We-provider-mount-246-zs-${i}.txt`,
      `# 246 zs (Us leftover) @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
    )
  }
}

// 246 F0 / H0 leftover
{
  const i = buf246.indexOf(Buffer.from('function F0(e,o){'))
  log(`246 function F0(e,o){ @${i}`)
  if (i >= 0) {
    const fn = extractFn(buf246, i)
    dump(
      `gold-We-provider-mount-246-F0-${i}.txt`,
      `# 246 F0 (H0 leftover) @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
    )
  }
}

// Kc sites — dump windows not walkBack (walkBack hit stdin reader)
for (const i of [223847292, 223848200]) {
  dump(
    `gold-We-provider-mount-Kc-win-${i}.txt`,
    `# Kc jsx @${i}\n${asciiWindow(buf247, i - 600, i + 350)}\n`,
  )
  const fnAt = walkBackFunction(buf247, i, 8000)
  log(`Kc @${i} fn@${fnAt}`)
  if (fnAt >= 0) {
    const fn = extractFn(buf247, fnAt)
    log(`  Kc-fn len=${fn.end - fnAt} head=${compact(fn.text).slice(0, 160)}`)
    if (fn.end - fnAt > 200 && fn.end - fnAt < 8000) {
      dump(
        `gold-We-provider-mount-Kc-fn-${fnAt}.txt`,
        `# Kc @${fnAt} end=${fn.end} len=${fn.end - fnAt}\n${fn.text}\n`,
      )
    }
  }
}

// M / _ function with storageV5:p — extract from 'function _(' nearby 231944275
{
  const i = 231944275
  dump(
    'gold-We-provider-mount-M-win.txt',
    `# M jsx storageV5:p @231944437\n${asciiWindow(buf247, i, i + 1200)}\n`,
  )
  // find first { that is function body: after the param list
  const head = asciiWindow(buf247, i, i + 200)
  log(`M-head ${head}`)
}

// who imports AppRoot
{
  const hits = findAll(buf247, 'AppRoot', 15)
  log(`AppRoot count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${compact(asciiWindow(buf247, i - 40, i + 80))}`)
  }
}

// confirm Y7b === Tr in Us module already; dump ce again near Us
{
  const i = 223161300
  log(`Us-mod Y7b as Tr @${i} ${compact(asciiWindow(buf247, i - 10, i + 80))}`)
}

dump('gold-We-provider-mount-pass5-scan.txt', report.join('\n') + '\n')
