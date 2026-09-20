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

function findAll(needle, limit = 20) {
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
        return { start, end: i + 1, text: asciiWindow(start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log('# j0n/yln pass2 aliases + unique bind')

const needles = [
  'XX("installed",Fs())',
  'function TB(e){return!Ne()||e===void 0?null:XX("installed",Fs())}',
  'Failed to load installed plugins from disk',
  'Saved ${Object.keys(r.written.plugins).length} installed plugins through the storage interface',
  'function IR(){try{let e=GSt()',
  'let r=IR()',
  'function GSt(){',
  'async function N0n(e,t)',
  'Failed to save installed_plugins.json to',
  'installed plugins through the storage interface',
  'function yln(e){let{pendingUsage:t}=HP()',
  'yln(n),ki(',
  'pendingUsage',
  'function XX(',
  'async function XX(',
  'XX as ',
  ' as XX',
  'function Fs(',
  'function sme(){return vB(Fs(),"installed_plugins.json")}',
  'export{',
]

for (const n of needles) {
  const hits = findAll(n, 12)
  log(`N ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 40, i + Math.min(n.length, 80) + 80).replace(/\n/g, ' ')}`)
  }
}

// chunk export near installed-plugins module (~21457xxxx) and yln (~21364xxxx)
// search export{ backwards/forwards from locked fns
const anchors = [
  ['TB', 214573412],
  ['j0n', 214574841],
  ['N0n', 214573520],
  ['IR', 214577454],
  ['ame', 214576324],
  ['yln', 213648410],
  ['dPe', 213653071],
]

for (const [label, pos] of anchors) {
  const before = asciiWindow(pos - 200, pos)
  const afterFn = extractFn(pos)
  log(`ANCHOR ${label}@${pos} end=${afterFn.end} len=${afterFn.end - pos}`)
}

// find nearest export{ after each cluster
for (const [label, pos] of [
  ['installed-cluster', 214590000],
  ['yln-cluster', 213660000],
]) {
  const hits = []
  let from = pos
  for (let k = 0; k < 8; k++) {
    const i = buf.indexOf(Buffer.from('export{'), from)
    if (i < 0 || i > pos + 200000) break
    hits.push(i)
    from = i + 7
  }
  log(`EXPORT after ${label}@${pos}: ${hits.join(',')}`)
  for (const i of hits.slice(0, 3)) {
    log(`  @${i} ${asciiWindow(i, i + 400).replace(/\n/g, ' ')}`)
    dump(
      `gold-j0n-export-${label}-${i}.txt`,
      `# export{ @${i} after ${label}\n${asciiWindow(i, i + 800)}\n`,
    )
  }
}

// import lines mentioning TB/j0n/IR/N0n/yln in ame/dPe neighborhoods
for (const [label, start, end] of [
  ['ame-mod-imports', 214560000, 214573400],
  ['dPe-mod-imports', 213640000, 213648400],
]) {
  const win = asciiWindow(start, end)
  const importHits = []
  let idx = 0
  while (true) {
    const i = win.indexOf('import{', idx)
    if (i < 0) break
    importHits.push(start + i)
    idx = i + 7
  }
  log(`IMPORT ${label} count=${importHits.length}`)
  for (const i of importHits.slice(0, 15)) {
    log(`  @${i} ${asciiWindow(i, i + 200).replace(/\n/g, ' ')}`)
  }
}

// XX definition uniqueness
const xxHits = findAll('function XX(', 15)
log(`XX defs ${xxHits.join(',')}`)
for (const i of xxHits) {
  const fn = extractFn(i)
  dump(
    `gold-j0n-XX-${i}.txt`,
    `# function XX( @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
  log(`  XX@${i} len=${fn.end - i} ${fn.text.slice(0, 160).replace(/\n/g, ' ')}`)
}

// confirm other IR bodies are NOT disk load
const irHits = findAll('function IR(', 10)
for (const i of irHits) {
  const fn = extractFn(i)
  log(`IR@${i} len=${fn.end - i} ${fn.text.slice(0, 120).replace(/\n/g, ' ')}`)
}

dump('gold-j0n-yln-pass2.txt', report.join('\n') + '\n')
