import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-wKn-v-seed', '', 'Official densable 2.1.248 SEA peel.', '']

function peelAt(label, offset, maxLen = 4000) {
  const ext = extractFnAt(buf, offset, maxLen)
  lines.push(`## ${label}`)
  lines.push(`@${offset}`)
  if (ext.body) {
    lines.push(`sha=${ext.sha} len=${ext.len}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
    lines.push(asciiSlice(buf, offset, offset + 900))
  }
  lines.push('')
}

function peelNear(needle, nearHint, maxLen = 3000, take = 6) {
  const hits = allHits(buf, needle)
  lines.push(`## needle ${JSON.stringify(needle)} hits=${hits.length}`)
  const ranked = hits
    .map(i => ({ i, dist: nearHint === undefined ? 0 : Math.abs(i - nearHint) }))
    .sort((a, b) => a.dist - b.dist)
  for (const { i, dist } of ranked.slice(0, take)) {
    const near = nearHint !== undefined && dist < 80000
    lines.push(`@${i} dist=${dist} near=${near}`)
    const ext = extractFnAt(buf, i, maxLen)
    if (ext.body) {
      lines.push(`sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body.length > 2800 ? ext.body.slice(0, 2800) + '…' : ext.body)
    } else {
      lines.push(asciiSlice(buf, i, i + 700))
    }
    lines.push('')
  }
}

// Contract offsets (user)
peelAt('async function wKn', 179534300, 2000)
peelAt('function Ngn', 179506113, 400)
peelAt('async function Tur', 179534256, 120)
peelAt('function v seedAttested', 179529582, 2500)

// Find S/W near wKn by walking back from callsite
{
  const call = 'g=S(r),d=S(a),u=S(o),c=W(g,d,u)'
  const hits = allHits(buf, call)
  lines.push(`## callsite ${call} hits=${hits.length}`)
  for (const i of hits.slice(0, 2)) {
    lines.push(`@${i}`)
    lines.push(asciiSlice(buf, Math.max(0, i - 200), i + call.length + 80))
    const start = Math.max(0, i - 6000)
    const win = asciiSlice(buf, start, i)
    for (const name of ['function S(', 'function W(']) {
      let best = -1
      let idx = 0
      while (true) {
        const k = win.indexOf(name, idx)
        if (k < 0) break
        best = start + k
        idx = k + 1
      }
      if (best >= 0) {
        const ext = extractFnAt(buf, best, 3500)
        lines.push(`### ${name} @${best}`)
        if (ext.body) {
          lines.push(`sha=${ext.sha} len=${ext.len}`)
          lines.push(ext.body)
        } else lines.push(JSON.stringify(ext))
        lines.push('')
      }
    }
  }
}

// Pc constructor / workspace helper
peelNear('Pc.workspace', 179534300, 400, 3)
peelNear('workspace(e){return{space:"workspace"', 179534300, 800, 3)
peelNear('workspace(t){return{space:"workspace"', 179534300, 800, 3)
peelNear('{home(e){return{space:"home",path:e}', 179534300, 900, 3)
peelNear('home(t){return{space:"home",path:t}', 179534300, 900, 5)

// Ngn helpers
peelNear('function cyn(', 179506113, 600, 4)
peelNear('function H()', 179506113, 400, 6)

// v helpers — search strings from known v body
for (const s of [
  "CLAUDE_CODE_MANAGED_SETTINGS_PATH",
  "the host attests no OS policy folder",
  "systemAttestationContradicted",
  "systemSpaceServingLogged",
  "managed-settings.d",
  "managed-settings.json",
]) {
  const hits = allHits(buf, s)
  lines.push(`## STR ${JSON.stringify(s)} hits=${hits.length}`)
  for (const i of hits.slice(0, 2)) {
    lines.push(`@${i}`)
    lines.push(asciiSlice(buf, Math.max(0, i - 150), i + s.length + 180))
    lines.push('')
  }
}

peelNear('function nyn()', 179529582, 400, 3)
peelNear('function $Me(', 179529582, 800, 3)
peelNear('function nx()', 179529582, 400, 3)
peelNear('function Fte()', 179442060, 200, 2)

// W skipped reason strings near ownership
for (const s of [
  'stat of the root failed',
  'lstat of .git failed',
  'lstat of .claude failed',
  'the root is absent',
  'no owner uid for the root',
  'no .git entry',
  'ownership of the local settings root not read ahead',
]) {
  const hits = allHits(buf, s)
  lines.push(`## STR ${JSON.stringify(s)} hits=${hits.length}`)
  for (const i of hits.slice(0, 2)) {
    lines.push(`@${i}`)
    lines.push(asciiSlice(buf, Math.max(0, i - 200), i + s.length + 220))
    // backtrack to function W
    const start = Math.max(0, i - 3500)
    const win = asciiSlice(buf, start, i)
    let best = -1
    let idx = 0
    while (true) {
      const k = win.indexOf('function W(', idx)
      if (k < 0) break
      best = start + k
      idx = k + 1
    }
    if (best >= 0) {
      const ext = extractFnAt(buf, best, 3500)
      lines.push(`### W @${best}`)
      if (ext.body) {
        lines.push(`sha=${ext.sha} len=${ext.len}`)
        lines.push(ext.body)
      }
    }
    lines.push('')
  }
}

writeFileSync(new URL('./gold-248-wKn-v-seed.txt', import.meta.url), lines.join('\n'))
console.log('wrote gold-248-wKn-v-seed.txt lines', lines.length)
