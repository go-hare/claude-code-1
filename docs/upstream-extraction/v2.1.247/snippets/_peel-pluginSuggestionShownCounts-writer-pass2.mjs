/**
 * Pass 2: 246 VJ bind, all vL/VJ imports, config default, ki/kwc,
 * partial strings, Lhe/mL/Qhe bodies, discover-writer contrast.
 */
import { readFileSync, writeFileSync } from 'fs'

const SEA = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const bufs = {
  246: readFileSync(SEA[246]),
  247: readFileSync(SEA[247]),
}

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
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(buf, needle, limit = 40) {
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
    if (i - start > 12000) break
  }
  return { start, end: start + 400, text: asciiWindow(buf, start, start + 400) }
}

function dump(name, content) {
  writeFileSync(
    `${outDir}/${name}`,
    content.endsWith('\n') ? content : `${content}\n`,
  )
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

const needles247 = [
  'export{p as tL,a as uL,h as vL,m as wL,w as xL,l as yL,c as zL}',
  'vL as ',
  ' as vL',
  'h as vL',
  'xL as ',
  'yL as ',
  'tL as ',
  'kwc as u',
  'owc as s',
  'Lxc as S,kwc as u,owc as s',
  'function p(n,i){let t=s().numStartups;u((o)=>{',
  'function l(n,i){if(n.length===0)return;u((t)=>{let o=t.pluginSuggestionDiscoverShownCounts',
  'pluginSuggestionShownCount',
  'SuggestionShownCounts',
  'pluginSuggestionShown',
  'recordPluginSuggestion',
  'Ohe(',
  'VJ(',
]

const needles246 = [
  'export{p as TJ,a as UJ,h as VJ,m as WJ,w as XJ,l as YJ,c as ZJ}',
  'VJ as ',
  ' as VJ',
  'h as VJ',
  'UJ as ',
  'TJ as ',
  'YJ as ',
  'XJ as ',
  'function h(n){return s().pluginSuggestionShownCounts?.[n]??0}',
  'r.pluginId',
  'Math.max(s,a)>=',
  'pluginId);if(',
  'spinnerTipsEnabled',
  'tips_spinner_show',
  'tengu_tip_shown',
  'tengu_dead_probe_legacy_plugin_tip_counts',
]

for (const ver of [247, 246]) {
  const buf = bufs[ver]
  log(`\n======== PASS2 SEA ${ver} size=${buf.length}`)
  const list = ver === 247 ? needles247 : needles246
  for (const n of list) {
    const hits = findAll(buf, n, 30)
    log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
    for (const i of hits.slice(0, 10)) {
      log(
        `  @${i} ${asciiWindow(buf, i - 50, i + n.length + 160).replace(/\n/g, ' ')}`,
      )
    }
  }
}

// dump full _360 / 246 tipHistory module
{
  const b = bufs[247]
  const i = b.indexOf(
    'function p(n,i){let t=s().numStartups;u((o)=>{let r=o.tipsHistory??{}',
  )
  const exp = b.indexOf(
    'export{p as tL,a as uL,h as vL,m as wL,w as xL,l as yL,c as zL}',
  )
  dump(
    'gold-pluginSuggestionShownCounts-writer-247-360-module.txt',
    `# 247 _360 module @${i} export@${exp}\n${asciiWindow(b, i - 220, exp + 80)}\n`,
  )
  log(`DUMP 247 _360 i=${i} exp=${exp}`)
}
{
  const b = bufs[246]
  const i = b.indexOf(
    'function p(n,i){let t=s().numStartups;u((o)=>{let r=o.tipsHistory??{}',
  )
  const exp = b.indexOf(
    'export{p as TJ,a as UJ,h as VJ,m as WJ,w as XJ,l as YJ,c as ZJ}',
  )
  dump(
    'gold-pluginSuggestionShownCounts-writer-246-345-module.txt',
    `# 246 _345 module @${i} export@${exp}\n${asciiWindow(b, i - 220, exp + 80)}\n`,
  )
  log(`DUMP 246 _345 i=${i} exp=${exp}`)
}

// Qhe / mL 247 bodies
{
  const b = bufs[247]
  const q = b.indexOf('async function Qhe(e){if(MV().spinnerTipsEnabled')
  const m = b.indexOf('function mL(e,t="spinner",o){Lhe(e.id')
  dump(
    'gold-pluginSuggestionShownCounts-writer-247-Qhe.txt',
    `# Qhe @${q}\n${extractFn(b, q).text}\n`,
  )
  dump(
    'gold-pluginSuggestionShownCounts-writer-247-mL.txt',
    `# mL @${m}\n${extractFn(b, m).text}\n`,
  )
  log(`DUMP Qhe@${q} mL@${m}`)
}

// 246 Qhe-like: search after VJ import
{
  const b = bufs[246]
  const ev = findAll(b, 'spinnerTipsEnabled', 10)
  log(`246 spinnerTipsEnabled count=${ev.length}`)
  for (const [n, i] of ev.entries()) {
    dump(
      `gold-pluginSuggestionShownCounts-writer-246-spinnerTips-${n}.txt`,
      `# 246 spinnerTipsEnabled @${i}\n${asciiWindow(b, i - 80, i + 700)}\n`,
    )
    log(`  spinner @${i} ${asciiWindow(b, i - 40, i + 200).replace(/\n/g, ' ')}`)
  }
}

// config default larger window
for (const ver of [247, 246]) {
  const b = bufs[ver]
  const i = b.indexOf('tipsHistory:{}')
  dump(
    `gold-pluginSuggestionShownCounts-writer-${ver}-default-config.txt`,
    `# ${ver} default config around tipsHistory:{} @${i}\n${asciiWindow(b, i - 900, i + 700)}\n`,
  )
  log(`DUMP ${ver} default @${i}`)
}

// kwc saveGlobalConfig identity
{
  const b = bufs[247]
  for (const n of [
    'kwc as ',
    ' as kwc',
    'function ki(',
    'saveGlobalConfig',
    'export{',
  ]) {
    const hits = findAll(b, n, 8)
    if (n === 'export{') continue
    log(`KI ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
    for (const i of hits.slice(0, 6)) {
      log(`  @${i} ${asciiWindow(b, i - 40, i + 140).replace(/\n/g, ' ')}`)
    }
  }
  const hits = findAll(b, ' as kwc', 10)
  for (const [n, i] of hits.entries()) {
    dump(
      `gold-pluginSuggestionShownCounts-writer-247-kwc-${n}.txt`,
      `# as kwc @${i}\n${asciiWindow(b, i - 200, i + 200)}\n`,
    )
  }
}

// 246 VJ import + call sites
{
  const b = bufs[246]
  const hits = findAll(b, 'VJ as ', 15)
  log(`246 VJ as count=${hits.length}`)
  for (const [n, i] of hits.entries()) {
    dump(
      `gold-pluginSuggestionShownCounts-writer-246-VJ-import-${n}.txt`,
      `# VJ as @${i}\n${asciiWindow(b, i - 80, i + 220)}\n`,
    )
    log(`  VJ-import @${i} ${asciiWindow(b, i - 20, i + 180).replace(/\n/g, ' ')}`)
  }
  const calls = findAll(b, 'VJ(', 20)
  log(`246 VJ( count=${calls.length} hits=${calls.join(',')}`)
  for (const [n, i] of calls.slice(0, 12).entries()) {
    const win = asciiWindow(b, i - 60, i + 160)
    log(`  VJ( @${i} ${win.replace(/\n/g, ' ')}`)
    dump(
      `gold-pluginSuggestionShownCounts-writer-246-VJ-call-${n}.txt`,
      `# VJ( @${i}\n${win}\n`,
    )
  }
}

// 247 Ohe( call sites (collision-ban listed functions)
{
  const b = bufs[247]
  const calls = findAll(b, 'Ohe(', 25)
  log(`247 Ohe( count=${calls.length} hits=${calls.join(',')}`)
  for (const [n, i] of calls.entries()) {
    const win = asciiWindow(b, i - 50, i + 140)
    log(`  Ohe( @${i} ${win.replace(/\n/g, ' ')}`)
    dump(
      `gold-pluginSuggestionShownCounts-writer-247-Ohe-call-${n}.txt`,
      `# Ohe( @${i}\n${win}\n`,
    )
  }
}

dump('gold-pluginSuggestionShownCounts-writer-scan2.txt', report.join('\n') + '\n')
console.log('WROTE scan2')
