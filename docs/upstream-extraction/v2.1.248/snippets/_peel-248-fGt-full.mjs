/**
 * Peel FULL official class fGt body (SettingsOwner leftover name).
 * Writes gold-248-fGt-full.txt + method roster + D()/primer hunt.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  sha,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fGt-full.txt'

function extractClassAt(i, maxLen = 80000) {
  // Prefer start at "class fGt{"
  const win = asciiSlice(buf, i, i + maxLen)
  const marker = 'class fGt{'
  const at = win.indexOf(marker)
  if (at < 0) return { miss: true, preview: win.slice(0, 200) }
  const from = win.slice(at)
  let depth = 0
  let inStr = null
  let esc = false
  let started = false
  for (let p = 0; p < from.length; p++) {
    const c = from[p]
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
    if (c === '{') {
      depth++
      started = true
    } else if (c === '}') {
      depth--
      if (started && depth === 0) {
        const body = from.slice(0, p + 1)
        return { body, sha: sha(body), len: body.length, start: i + at }
      }
    }
  }
  return { missEnd: true, preview: from.slice(0, 500), lenTried: from.length }
}

function methodNames(body) {
  // field=... and methodName( patterns inside class
  const fields = []
  const methods = []
  // strip "class fGt{"
  const inner = body.slice('class fGt{'.length, -1)
  // Split roughly on `;` at depth 0 — but methods have nested braces.
  // Instead: match identifiers followed by `=` or `(`
  const re = /([A-Za-z_$][\w$]*)\s*(=|\()/g
  let m
  const seen = new Set()
  while ((m = re.exec(inner))) {
    const name = m[1]
    if (seen.has(name)) continue
    // skip keywords / common locals
    if (
      [
        'if',
        'for',
        'let',
        'const',
        'var',
        'return',
        'new',
        'this',
        'else',
        'of',
        'in',
        'async',
        'await',
        'try',
        'catch',
        'throw',
        'typeof',
        'void',
        'true',
        'false',
        'null',
        'undefined',
        'Map',
        'Set',
        'Promise',
        'WeakMap',
      ].includes(name)
    )
      continue
    seen.add(name)
    if (m[2] === '=') fields.push(name)
    else methods.push(name)
  }
  return { fields, methods }
}

const lines = ['# gold-248-fGt-full', '']

// Locate class fGt{
const classHits = allHits(buf, 'class fGt{')
lines.push(`## class fGt{ hits=${classHits.length}`)
for (const i of classHits) lines.push(`@${i}`)
lines.push('')

const start =
  classHits.find(i => i > 178500000 && i < 178520000) ?? classHits[0]
lines.push(`## EXTRACT class fGt @${start}`)
const ext = extractClassAt(start, 100000)
if (ext.body) {
  lines.push(`sha=${ext.sha} len=${ext.len} start=${ext.start}`)
  lines.push('')
  lines.push('### BODY')
  lines.push(ext.body)
  lines.push('')
  const roster = methodNames(ext.body)
  lines.push('### FIELDS')
  lines.push(roster.fields.join('\n'))
  lines.push('')
  lines.push('### METHODS')
  lines.push(roster.methods.join('\n'))
  lines.push('')
} else {
  lines.push(JSON.stringify(ext))
  lines.push('')
}

// Also dump invalidateAll continuation if class extract failed / truncated
lines.push('## invalidateAll @178505706 window')
lines.push(asciiSlice(buf, 178505650, 178509700))
lines.push('')

// D() near fGt / primer — search for "function D()" in settings band
lines.push('## D() hunt in settings band 178500000-178520000')
{
  const hits = allHits(buf, 'function D()').filter(
    i => i > 178480000 && i < 178560000,
  )
  lines.push(`hits_in_band=${hits.length}`)
  for (const i of hits.slice(0, 20)) {
    lines.push(`@${i} ${asciiSlice(buf, i, i + 180).replace(/\n/g, ' ')}`)
  }
  lines.push('')
}

// primer assignment / this.primer
lines.push('## this.primer hits near fGt')
{
  const hits = allHits(buf, 'this.primer').filter(
    i => i > 178500000 && i < 178560000,
  )
  lines.push(`hits=${hits.length}`)
  for (const i of hits.slice(0, 30)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 60), i + 120).replace(/\n/g, ' ')}`)
  }
  lines.push('')
}

// D()&&this.primer
lines.push('## D()&&this.primer')
{
  const hits = allHits(buf, 'D()&&this.primer')
  lines.push(`hits=${hits.length}`)
  for (const i of hits) {
    lines.push(`@${i} ${asciiSlice(buf, i - 80, i + 200).replace(/\n/g, ' ')}`)
  }
  lines.push('')
}

// primedFolderListing / retainLayer method starts for offset map
const methodNeedles = [
  'setPluginBase(e){',
  'clearPluginBase(){',
  'invalidateAll(e){',
  'invalidatePolicyLayer(){',
  'onInvalidate(e){',
  'seedParsedFile(e,t,o,r){',
  'walkReadDiffers(e,t){',
  'unseedParsedFile(e,t,o){',
  'dropDerivedCaches(e){',
  'primedFolderListing(e){',
  'folderListingForPolicyWalk(e){',
  'noteWalkListing(e,t){',
  'get policyWalkCount()',
  'policyInstallVerdict(e,t,o){',
  'folderInstallVerdict(e,t,o){',
  'seedFolderListing(e,t,o){',
  'walkReadManagedFileIn(e,t){',
  'walkRead(e){',
  'hasParsedDropInOutside(e,t){',
  'clearFolderListing(e,t){',
  'retainLayer(e,t){',
  'dropRetainedLayer(e){',
  'retainFolderListing(e,t){',
]

lines.push('## method offset map (near class)')
for (const n of methodNeedles) {
  const hits = allHits(buf, n).filter(i => i > 178504000 && i < 178520000)
  lines.push(`${n} → ${hits.map(String).join(',') || 'NONE'}`)
}

// Also hunt any methods on fGt we might have missed — look for "}get " and method after retainFolderListing
lines.push('')
lines.push('## post-class tail (after expected end)')
if (ext.body && ext.start !== undefined) {
  const end = ext.start + ext.len
  lines.push(`class_end=${end}`)
  lines.push(asciiSlice(buf, end, end + 800))
}

// Hunt D() used inside invalidateAll specifically
lines.push('')
lines.push('## D() def candidates via backrefs from invalidateAll retain')
{
  // From invalidateAll body: e?.userLayer==="retain"&&D()&&this.primer
  const retainHits = allHits(buf, 'userLayer==="retain"&&D()')
  lines.push(`retain_gate_hits=${retainHits.length}`)
  for (const i of retainHits) {
    lines.push(`@${i}`)
    // Find "function D()" before this offset — walk backwards in ascii
    const look = asciiSlice(buf, Math.max(0, i - 50000), i)
    let idx = look.lastIndexOf('function D(){')
    if (idx < 0) idx = look.lastIndexOf('function D()')
    if (idx >= 0) {
      const abs = Math.max(0, i - 50000) + idx
      const peeled = extractFnAt(buf, abs, 4000)
      lines.push(`prev_D_at=${abs}`)
      lines.push(JSON.stringify(peeled))
    } else {
      lines.push('no function D() within 50k lookback')
      // try shorter names: function D(e)
      const idx2 = look.lastIndexOf('function D(')
      if (idx2 >= 0) {
        const abs = Math.max(0, i - 50000) + idx2
        lines.push(`prev_function_D(_at=${abs}`)
        lines.push(JSON.stringify(extractFnAt(buf, abs, 4000)))
      }
    }
  }
}

// primedFolderListing uses D()
lines.push('')
lines.push('## primedFolderListing / folderListingForPolicyWalk bodies')
for (const n of [
  'primedFolderListing(e){',
  'folderListingForPolicyWalk(e){',
  'noteWalkListing(e,t){',
]) {
  const hits = allHits(buf, n).filter(i => i > 178504000 && i < 178520000)
  if (!hits[0]) {
    lines.push(`${n} NONE`)
    continue
  }
  const peeled = extractFnAt(buf, hits[0], 1500)
  lines.push(`### ${n} @${hits[0]}`)
  lines.push(JSON.stringify(peeled))
}

writeFileSync(out, lines.join('\n'))
console.log('wrote', out, 'class_len=', ext.len, 'sha=', ext.sha)
