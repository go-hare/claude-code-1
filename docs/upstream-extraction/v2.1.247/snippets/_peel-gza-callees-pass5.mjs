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

function findAll(needle, limit = 12) {
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

// UI Zr caller: walk back to function / component
const zr = findAll('await Zr(ne.name,void 0,p,g)', 3)
for (const i of zr) {
  dump('gold-gza-ui-Zr-8k.txt', `# Zr@${i}\n${asciiWindow(i - 8000, i + 200)}\n`)
  log(`ZR @${i}`)
}

// credentials / storage destructure near ManageMarketplaces
for (const n of [
  '{storageV5:p,credentials:g}',
  '{storageV5:p',
  'credentials:g}',
  'storageV5:p,credentials',
  'let{storageV5:p',
  'let{storageV5:',
  'Sr()',
]) {
  const hits = findAll(n, 10)
  log(`CRED ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 60, i + 120).replace(/\n/g, ' ')}`)
  }
}

// CLI wrapper t / createSubcommandRoot — what is s
dump('gold-gza-cli-action-wide.txt', `# @223273850\n${asciiWindow(223273800, 223274050)}\n`)

for (const n of [
  'createSubcommandRoot',
  'function Qe(',
  'Qe=e=>',
  'function ce(',
]) {
  const hits = findAll(n, 8)
  log(`CLI2 ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${asciiWindow(i, i + 140).replace(/\n/g, ' ')}`)
  }
}

// plugins handler module imports around Tr
dump('gold-gza-Tr-imports.txt', `# @233769560\n${asciiWindow(233769400, 233770200)}\n`)

// Jr in nPe module — search import near 21363
dump('gold-gza-nPe-imports.txt', `# @213620000-213636000\n${asciiWindow(213620000, 213636200)}\n`)

// dump unique clean golds
dump(
  'gold-gza-wB-ii.txt',
  `# wB = _705 ii as cHc; gza imports cHc as wB
# API updateSettingsForSourceWithTransform:()=>ii
# Rs (updateSettingsForSource) = ii(e,()=>t,n,r)
${extractFn(208311609).text}

${extractFn(208311653).text}
`,
)

dump(
  'gold-gza-sk-ks.txt',
  `# sk = _709 ks as eIc; gza imports eIc as sk
# @208099456
ks=["userSettings","projectSettings","localSettings"]
# neighbors
de=["userSettings","projectSettings","localSettings","flagSettings","policySettings"]
Es=new Set(["projectSettings","localSettings"])
Os=["localSettings","projectSettings","userSettings"]
# export @208142871 ks as eIc
`,
)

dump(
  'gold-gza-r0n-Bm.txt',
  `# r0n = Bm as DOb @209536872 (same export as py as mMb)
# unique function Bm in that module @209388952
${extractFn(209388952).text}
# neighbor ur uses Bm to gate claude <cmd> <name> hint
${asciiWindow(209388952, 209389200)}
`,
)

dump(
  'gold-gza-qFe-ie.txt',
  `# qFe = _506 ie as Ahb; gza imports Ahb as qFe
# @210753673
function ie(e){return K[e]}
# K init in same module:
K={policySettings:"managed",userSettings:"user",projectSettings:"project",localSettings:"local",flagSettings:"flag"}
# inverse U={user:"userSettings",project:"projectSettings",local:"localSettings"}
# export ie as Ahb @210754920
`,
)

dump(
  'gold-gza-HFe-py.txt',
  `# HFe = py as mMb @209535620; gza imports mMb as HFe
${extractFn(209325064).text}
`,
)

dump(
  'gold-gza-Xr-h.txt',
  `# Xr already local getSettingsForSource
# _705 getSettingsForSource:()=>h @208304369
# h as vGc; gza imports vGc as Xr
${asciiWindow(208306694, 208306740)}
`,
)

dump(
  'gold-gza-nPe-full.txt',
  `# nPe unique via deletePluginOptions strings @213644976
${extractFn(213644976).text}
`,
)

dump(
  'gold-gza-dPe-full.txt',
  `# dPe unique pluginUsage @213653071 (other function dPe is CSS)
${extractFn(213653071).text}
`,
)

dump(
  'gold-gza-K8-full.txt',
  `# K8 unique via Not marking a symlinked plugin version @214509181
${extractFn(214509181).text}
`,
)

dump(
  'gold-gza-caller-Tr.txt',
  `# marketplaceRemoveHandler Tr @233794096
# Aea as Wn; await Wn(n,a,r) = gza(name,scope,storageV5) — 4th omitted
${extractFn(233794090).text}
`,
)

dump('gold-gza-callee-pass5.txt', report.join('\n') + '\n')
