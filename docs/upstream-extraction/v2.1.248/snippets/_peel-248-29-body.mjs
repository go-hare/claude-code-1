/**
 * Extract unique 248 #29 handleCycleMode body vs 247.
 * Gold needle: Vr((Ci)=>Ci.show?{show:!1}:Ci) next to Lu(!1) / chat:cycleMode.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  EXE_247,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  `when=${new Date().toISOString()}`,
  `sea248=${b248.length} sea247=${b247.length}`,
]

function dumpHits(buf, label, needle, max = 8, before = 200, after = 400) {
  const hits = allHits(buf, needle)
  lines.push('')
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`)
  for (const [n, h] of hits.slice(0, max).entries()) {
    lines.push(`- #${n} @${h}`)
    lines.push(asciiSlice(buf, h - before, h + after))
  }
  return hits
}

function tryExtractArrow(buf, off, maxLookback = 4000, maxLen = 8000) {
  const start = Math.max(0, off - maxLookback)
  const win = asciiSlice(buf, start, off + maxLen)
  // find last `=U(()=>{` or `=B((` or `function ` before off
  const rel = off - start
  const prefixes = [
    /=U\(\(\)=>\{/,
    /=U\(\([A-Za-z_$][\w$]*\)=>\{/,
    /=B\(\([A-Za-z_$][\w$]*\)=>\{/,
    /=B\(\(\)=>\{/,
    /function [A-Za-z_$][\w$]*\([^)]*\)\{/,
  ]
  let best = -1
  let kind = ''
  for (const re of prefixes) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(win)) && m.index < rel) {
      if (m.index > best) {
        best = m.index
        kind = m[0]
      }
    }
  }
  if (best < 0) {
    return { miss: true, preview: win.slice(Math.max(0, rel - 200), rel + 80) }
  }
  const abs = start + best
  // find `{` after assignment
  const brace = win.indexOf('{', best)
  if (brace < 0) return { missEnd: true, kind, abs }
  let depth = 0
  let inStr = null
  let esc = false
  for (let p = brace; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(best, p + 1)
        return { abs, kind, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { missEnd: true, kind, abs, preview: win.slice(best, best + 300) }
}

// unique 248 needle
const n248 = 'Vr((Ci)=>Ci.show?{show:!1}:Ci)'
const hitsShow = dumpHits(b248, '248 Vr show clear', n248, 6, 300, 800)

const n247miss = dumpHits(b247, '247 Vr show clear', n248, 4, 80, 80)
const n247alt = dumpHits(
  b247,
  '247 show?{show:!1}',
  'show?{show:!1}',
  8,
  200,
  400,
)
dumpHits(b248, '248 show?{show:!1}', 'show?{show:!1}', 8, 200, 400)

// handleCycleMode code (not string table)
const hcm248 = allHits(b248, '[auto-mode] handleCycleMode')
const hcm247 = allHits(b247, '[auto-mode] handleCycleMode')
lines.push('')
lines.push(`## hcm offsets 248=${hcm248.join(',')} 247=${hcm247.join(',')}`)

for (const [i, h] of hcm248.entries()) {
  if (i === 0) continue // string table
  lines.push('')
  lines.push(`## 248-hcm-code @${h}`)
  const ext = tryExtractArrow(b248, h, 6000, 5000)
  if (ext.body) {
    lines.push(`kind=${ext.kind} abs=${ext.abs} len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(JSON.stringify(ext))
    lines.push(asciiSlice(b248, h - 2500, h + 2500))
  }
}

for (const [i, h] of hcm247.entries()) {
  if (i === 0) continue
  lines.push('')
  lines.push(`## 247-hcm-code @${h}`)
  const ext = tryExtractArrow(b247, h, 6000, 5000)
  if (ext.body) {
    lines.push(`kind=${ext.kind} abs=${ext.abs} len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(JSON.stringify(ext))
    lines.push(asciiSlice(b247, h - 2500, h + 2500))
  }
}

// chat:cycleMode":()=>  binding
dumpHits(b248, '248 cycleMode bind', '"chat:cycleMode":()', 4, 80, 200)
dumpHits(b247, '247 cycleMode bind', '"chat:cycleMode":()', 4, 80, 200)
dumpHits(b248, '248 cycleMode a9', '"chat:cycleMode":()=>', 4, 80, 200)

// Lu(!1),Vr  nearby
dumpHits(b248, '248 Lu(!1),Vr', 'Lu(!1),Vr(', 6, 200, 500)
dumpHits(b247, '247 ro(!1),_o', 'ro(!1),_o', 4, 200, 400)

// Footer Press {key} again — PromptInput left side
dumpHits(b248, '248 exit-message key', 'exit-message', 6, 200, 400)
dumpHits(b248, '248 Press .. again to', 'Press ",d.key', 4, 80, 160)
dumpHits(b248, '248 FY exitMessage', 'function FY({exitMessage', 2, 40, 2000)

// a9 definition — look backward from chat:cycleMode":()=>a9
const bind = allHits(b248, '"chat:cycleMode":()=>')
for (const h of bind) {
  lines.push('')
  lines.push(`## bind-win @${h}`)
  lines.push(asciiSlice(b248, h - 80, h + 220))
}

writeFileSync(`${outDir}/gold-248-29-body.txt`, lines.join('\n'))
console.log('wrote', `${outDir}/gold-248-29-body.txt`, 'lines', lines.length)
