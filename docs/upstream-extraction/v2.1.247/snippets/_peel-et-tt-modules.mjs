import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

const xt = buf.indexOf(Buffer.from('class Xt{knownMarketplaces=void 0'))
const head = asciiWindow(buf, xt - 25000, xt)

function importOf(alias) {
  const re = new RegExp(
    `import\\{[^}]*as ${alias}[,}][^}]*\\}from"B:/~BUN/root/(_\\d+\\.js)"`,
  )
  const m = head.match(re)
  return m ? { chunk: m[1], snippet: m[0].slice(0, 280) } : null
}

for (const a of ['et', 'tt', 'Je', 'Ze', 'w']) {
  console.log(a, importOf(a))
}

// locate module files for vea / Cea exports
function findExport(exportName) {
  const needles = [
    `export{${exportName}`,
    ` as ${exportName}`,
    `function ${exportName}(`,
  ]
  // search nearby by finding `export{` blocks containing the name near marketplace strings
  return needles
}

// Find the chunk file start for _??? that exports vea
// SEA embeds `B:/~BUN/root/_NNN.js` then the module body
function dumpChunkExport(exportAs, hint) {
  // find `vea as et` import already known: vea from same chunk as other marketplace fns
  const i = buf.indexOf(Buffer.from(` as ${exportAs},`))
  console.log('first as', exportAs, i)
}

// Extract Cea/vea function from their source chunks by finding
// `function XX(` near `export{` that lists them.

const ceaImp = head.match(
  /import\{([^}]*Cea as tt[^}]*)\}from"(B:\/~BUN\/root\/_[0-9]+\.js)"/,
)
const veaImp = head.match(
  /import\{([^}]*vea as et[^}]*)\}from"(B:\/~BUN\/root\/_[0-9]+\.js)"/,
)
console.log('cea-full', ceaImp && [ceaImp[2], ceaImp[1].slice(0, 400)])
console.log('vea-full', veaImp && [veaImp[2], veaImp[1].slice(0, 400)])

const ceaChunk = ceaImp?.[2]
const veaChunk = veaImp?.[2]

function dumpChunk(chunkName, outName) {
  const marker = Buffer.from(`B:/~BUN/root/${chunkName.slice('B:/~BUN/root/'.length)}`)
  // chunk path appears in importer; the module itself starts with // Version or import after a header
  // Better: find `// ${chunkName}` or just search export of Cea
  const file = chunkName.replace('B:/~BUN/root/', '')
  const startNeedle = Buffer.from(`// ${file}`)
  let i = buf.indexOf(startNeedle)
  if (i < 0) {
    // bun sometimes uses `var {` after filename string
    i = buf.indexOf(Buffer.from(file + '"'))
  }
  console.log('chunk-start', file, i)
}

if (ceaChunk) dumpChunk(ceaChunk, 'cea')
if (veaChunk) dumpChunk(veaChunk, 'vea')

// Find function assigned to Cea export: look for `Cea` in that module
// Common bun minify: `async function ke(e,t)` then `export {ke as Cea}`
function findExportBinding(chunkFile, exportName) {
  const marker = `from"B:/~BUN/root/${chunkFile}"`
  // Find the actual module by searching for unique export list
  const exportListNeedle = `as ${exportName}`
  // Search for `export{` containing exportName near marketplace
  let from = 0
  const hits = []
  const n = Buffer.from(`export{`)
  while (hits.length < 200) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    const win = asciiWindow(buf, i, i + 400)
    if (win.includes(`as ${exportName}`) || win.includes(`${exportName},`) || win.startsWith(`export{${exportName}`)) {
      if (win.includes(exportName)) {
        hits.push({ i, win: win.slice(0, 300) })
      }
    }
    from = i + 7
    if (from > buf.length) break
  }
  return hits.slice(0, 8)
}

console.log('--- Cea exports ---')
if (ceaChunk) {
  const file = ceaChunk.replace('B:/~BUN/root/', '')
  console.log(findExportBinding(file, 'Cea').map((h) => h.win))
}
console.log('--- vea exports ---')
if (veaChunk) {
  const file = veaChunk.replace('B:/~BUN/root/', '')
  console.log(findExportBinding(file, 'vea').map((h) => h.win))
}
