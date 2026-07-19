/**
 * densable F9u mermaid gate pure — whether publish should attempt mermaid inject.
 */
export function shouldInjectMermaidRuntime(input: {
  mermaidIntent: boolean
  mermaidEnabled?: boolean
  html: string
}): boolean {
  if (!input.mermaidIntent) return false
  const enabled =
    input.mermaidEnabled !== undefined
      ? input.mermaidEnabled
      : isMermaidArtifactEnabled()
  if (!enabled) return false
  return htmlHasMermaidPre(input.html)
}

/** densable I8g — style block prepended inside mermaid runtime payload. */
export const MERMAID_RUNTIME_STYLE =
  '<style>.mermaid-diagram{margin-block:4px}.mermaid-diagram svg{display:block;margin:0 auto;max-width:100%;height:auto}</style>'

/**
 * densable k8g — light/dark palettes baked into H8g boot CFG.
 */
export const MERMAID_RUNTIME_PALETTES = {
  light: {
    surface: '#f4efe4',
    text: '#42392e',
    line: '#8a7f6d',
    border: '#7a6c52',
    bg: '#fffdf8',
  },
  dark: {
    surface: '#262b34',
    text: '#f2f3f5',
    line: '#a8adb8',
    border: '#9aa4b8',
    bg: '#1f232b',
  },
} as const

/**
 * densable Fso/Gso path anchors for mermaid.min.js (official embeds at bunfs).
 */
export const MERMAID_UMD_BUNFS_PATH = '/$bunfs/root/mermaid.min.js'
export const MERMAID_UMD_RELATIVE_CANDIDATES = [
  'vendor/mermaid.min.js',
  'src/frame/mermaid.min.js',
  'src/frame/$bunfs/root/mermaid.min.js',
] as const

/**
 * densable Ll half used by p9u — escape text for embedding inside HTML.
 * densable Ul then also quotes; Ul ≈ & < > escape.
 */
export function escapeMermaidPreText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * densable p9u — fenced ```mermaid → <pre class="mermaid">…</pre> or false.
 */
export function mermaidFencedCodeToPre(
  text: string,
  lang: string | null | undefined,
  opts?: { mermaidEnabled?: boolean },
): string | false {
  const token = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (token !== 'mermaid') return false
  const enabled =
    opts?.mermaidEnabled !== undefined
      ? opts.mermaidEnabled
      : isMermaidArtifactEnabled()
  if (!enabled) return false
  return `<pre class="mermaid">${escapeMermaidPreText(text)}</pre>\n`
}

/**
 * densable H8g — trusted mermaid boot script (palettes JSON-inlined).
 * Does not load mermaid.umd; assumes `mermaid` global from prior script.
 */
export function buildMermaidRuntimeBootScript(
  palettes: typeof MERMAID_RUNTIME_PALETTES = MERMAID_RUNTIME_PALETTES,
): string {
  const cfg = JSON.stringify({ palettes })
  return `(function(){
var CFG=${cfg};
var pres=Array.prototype.slice.call(document.querySelectorAll('pre.mermaid')).filter(function(p){if(p.hasAttribute('data-claude-mermaid-claimed'))return false;p.setAttribute('data-claude-mermaid-claimed','1');return true;});
if(!pres.length||typeof mermaid==='undefined')return;
var mq=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
var root=document.documentElement;
var items=pres.map(function(pre){
var mount=document.createElement('div');mount.className='mermaid-diagram';
return {pre:pre,mount:mount,src:pre.textContent||''};
});
var seq=0;
var renderGen=0;
var lastKey='';
function pageBg(fallback){
var els=[document.body,document.documentElement];
for(var i=0;i<els.length;i++){
var c=els[i]&&getComputedStyle(els[i]).backgroundColor;
if(c&&c!=='transparent'&&c!=='rgba(0, 0, 0, 0)')return c;
}
return fallback;
}
function render(){
var theme=root.getAttribute('data-theme');
var dark=theme==='dark'||(!!(mq&&mq.matches)&&theme!=='light');
var pal=dark?CFG.palettes.dark:CFG.palettes.light;
var bg=pageBg(pal.bg);
var key=(dark?'d':'l')+'|'+bg;
if(key===lastKey)return;
lastKey=key;
var gen=++renderGen;
var font=getComputedStyle(document.body).fontFamily||'sans-serif';
var nat={useMaxWidth:false};
mermaid.initialize({
startOnLoad:false,securityLevel:'strict',theme:'base',
flowchart:nat,sequence:nat,er:nat,state:nat,class:nat,pie:nat,
gantt:nat,journey:nat,timeline:nat,gitGraph:nat,mindmap:nat,xyChart:nat,
quadrantChart:nat,sankey:nat,c4:nat,requirement:nat,block:nat,
packet:nat,kanban:nat,architecture:nat,radar:nat,
themeVariables:{background:bg,mainBkg:pal.surface,primaryColor:pal.surface,
primaryTextColor:pal.text,lineColor:pal.line,primaryBorderColor:pal.border,
nodeBorder:pal.border,clusterBorder:pal.border,edgeLabelBackground:bg,
clusterBkg:'rgba(127,127,127,0.07)',titleColor:pal.text,
darkMode:dark,rowOdd:bg,rowEven:'rgba(127,127,127,0.07)',
attributeBackgroundColorOdd:bg,attributeBackgroundColorEven:'rgba(127,127,127,0.07)',
fontSize:'16px',fontFamily:font},
themeCSS:'.node rect, .node circle, .node polygon, .node path, .cluster rect { stroke-width: 2px; }'
});
items.forEach(function(it){
var id='claude-mermaid-'+seq++;
mermaid.render(id,it.src).then(function(r){
if(gen!==renderGen)return;
var prev=it.pre.previousElementSibling;
if(prev&&prev.className==='mermaid-diagram'&&prev!==it.mount)return;
it.mount.innerHTML=r.svg;
if(!it.mount.parentNode)it.pre.parentNode.insertBefore(it.mount,it.pre);
it.pre.style.display='none';
},function(){
var scratch=document.getElementById(id);
if(scratch)scratch.parentNode.removeChild(scratch);
scratch=document.getElementById('d'+id);
if(scratch)scratch.parentNode.removeChild(scratch);
if(gen!==renderGen)return;
if(it.mount.parentNode)it.mount.parentNode.removeChild(it.mount);
it.pre.style.display='';
});
});
}
render();
if(mq&&mq.addEventListener)mq.addEventListener('change',render);
if(typeof MutationObserver!=='undefined')new MutationObserver(render).observe(root,{attributes:true,attributeFilter:['data-theme']});
})();`
}

/** densable H8g default boot (module-level). */
export const MERMAID_RUNTIME_BOOT_SCRIPT: string =
  buildMermaidRuntimeBootScript()

/**
 * densable c9u pure wrap — style + bundle script + boot script in length-matched
 * mermaid runtime sentinels. Caller must pass S8g-safe bundle.
 */
export function wrapMermaidRuntimeRegion(
  mermaidBundleJs: string,
  bootScript: string = MERMAID_RUNTIME_BOOT_SCRIPT,
): string | null {
  if (getUnsafeMermaidBundleReason(mermaidBundleJs) !== null) return null
  if (getUnsafeMermaidBundleReason(bootScript) !== null) return null
  const body =
    `\n${MERMAID_RUNTIME_STYLE}\n<script>` +
    mermaidBundleJs +
    `</script>\n<script>` +
    bootScript +
    `</script>\n`
  // densable: `\n`+P8g(t.length)+t+rGr+`\n`
  return `\n${wrapMermaidRuntimeOpen(body.length)}${body}${MERMAID_RUNTIME_CLOSE}\n`
}

/**
 * densable x8g/b8g-ish pure path resolution for mermaid.min.js.
 */
export async function loadMermaidBundleJs(input?: {
  readFile?: (path: string, encoding: 'utf8') => Promise<string>
  isAbsolute?: (path: string) => boolean
  join?: (...parts: string[]) => string
  cwd?: string
  bunfsPath?: string
  relativeCandidates?: readonly string[]
}): Promise<string | null> {
  const readFile = input?.readFile
  if (!readFile) return null
  const isAbsolute = input?.isAbsolute ?? ((p: string) => p.startsWith('/'))
  const join =
    input?.join ??
    ((...parts: string[]) =>
      parts.filter(Boolean).join('/').replace(/\/+/g, '/'))
  const cwd = input?.cwd ?? ''
  const bunfs = input?.bunfsPath ?? MERMAID_UMD_BUNFS_PATH
  const relatives = input?.relativeCandidates ?? MERMAID_UMD_RELATIVE_CANDIDATES

  const candidates: string[] = []
  if (isAbsolute(bunfs)) candidates.push(bunfs)
  for (const rel of relatives) {
    candidates.push(cwd ? join(cwd, rel) : rel)
  }

  for (const path of candidates) {
    try {
      const text = await readFile(path, 'utf8')
      if (typeof text === 'string' && text.length > 0) return text
    } catch {
      // try next
    }
  }
  return null
}

/**
 * densable c9u async pure — load + D8g validate + wrap, or fail reason.
 */
export async function buildMermaidRuntimeRegion(input?: {
  readFile?: (path: string, encoding: 'utf8') => Promise<string>
  isAbsolute?: (path: string) => boolean
  join?: (...parts: string[]) => string
  cwd?: string
  mermaidBundleJs?: string | null
  bootScript?: string
}): Promise<
  | { ok: true; region: string }
  | {
      ok: false
      reason: 'mermaid_bundle_unreadable' | 'mermaid_bundle_unsafe'
    }
> {
  let bundle = input?.mermaidBundleJs
  if (bundle === undefined) {
    bundle = await loadMermaidBundleJs(input)
  }
  if (bundle === null || bundle === undefined || bundle === '') {
    return { ok: false, reason: 'mermaid_bundle_unreadable' }
  }
  if (getUnsafeMermaidBundleReason(bundle) !== null) {
    return { ok: false, reason: 'mermaid_bundle_unsafe' }
  }
  const region = wrapMermaidRuntimeRegion(
    bundle,
    input?.bootScript ?? MERMAID_RUNTIME_BOOT_SCRIPT,
  )
  if (region === null) {
    return { ok: false, reason: 'mermaid_bundle_unsafe' }
  }
  return { ok: true, region }
}

/**
 * densable F9u mermaid inject pure — append region when gate allows.
 * densable always appends (no </body> seek for mermaid).
 */
export function applyMermaidRuntimeRegionToHtml(
  html: string,
  region: string | null,
  opts: {
    mermaidIntent: boolean
    mermaidEnabled?: boolean
  },
): string {
  if (!region) return html
  if (
    !shouldInjectMermaidRuntime({
      mermaidIntent: opts.mermaidIntent,
      mermaidEnabled: opts.mermaidEnabled,
      html,
    })
  ) {
    return html
  }
  return html + region
}

export function isMermaidArtifactEnabled(
  input: { gbValue?: boolean } = {},
): boolean {
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_artifact_mermaid_diagrams',
    true,
  )
}

export function preOpenAttrsHaveMermaidClass(attrs: string): boolean {
  const t = attrs
  const len = t.length
  let r = 0
  while (r < len) {
    const n = t.indexOf('class', r)
    if (n < 0) return false
    const prev = t[n - 1]
    if (
      !(
        prev === ' ' ||
        prev === '\t' ||
        prev === '\n' ||
        prev === '\f' ||
        prev === '\r' ||
        prev === undefined
      )
    ) {
      // densable also rejects non-boundary; at start-of-string prev is undefined —
      // treat as boundary so `class=` alone still matches.
      if (n !== 0) {
        r = n + 5
        continue
      }
    }
    let i = n + 5
    while (i < len && /\s/.test(t[i]!)) i++
    if (t[i] !== '=') {
      r = n + 5
      continue
    }
    i++
    while (i < len && /\s/.test(t[i]!)) i++
    const quote = t[i]
    let a: string
    if (quote === '"' || quote === "'") {
      const end = t.indexOf(quote, i + 1)
      if (end < 0) return false
      a = t.slice(i + 1, end)
    } else {
      let end = i
      while (end < len && !/[\s>]/.test(t[end]!)) end++
      a = t.slice(i, end)
    }
    for (const token of a.split(/\s+/)) {
      if (token === 'mermaid') return true
    }
    r = n + 5
  }
  return false
}

export function htmlHasMermaidPre(html: string): boolean {
  const t = html.toLowerCase()
  let r = 0
  for (;;) {
    r = t.indexOf('<pre', r)
    if (r < 0) return false
    const follower = t[r + 4]
    if (follower === undefined) return false
    if (!PRE_OPEN_FOLLOWERS.has(follower)) {
      r += 4
      continue
    }
    const scanEnd = Math.min(r + MERMAID_PRE_OPEN_SCAN_CAP, t.length)
    let close = scanEnd
    let foundClose = false
    for (let a = r + 4; a < scanEnd; a++) {
      if (t[a] === '>') {
        close = a
        foundClose = true
        break
      }
    }
    // densable M8g on original-case slice? densable lowercases whole string first,
    // so attrs are lowercased — class names stay "mermaid".
    if (preOpenAttrsHaveMermaidClass(t.slice(r + 4, close))) return true
    r = foundClose ? close + 1 : close
  }
}

export function getUnsafeMermaidBundleReason(bundle: string): string | null {
  if (/<\/script/i.test(bundle)) return 'bundle contains </script'
  if (bundle.includes('<!--') && /<script/i.test(bundle)) {
    return 'bundle contains <!-- together with <script (double-escaped state)'
  }
  if (/<base\s+href="\/_f\//i.test(bundle)) {
    return 'bundle matches the stale /_f/ base-tag strip regex'
  }
  if (/\sdata-frame-runtime="/i.test(bundle)) {
    return 'bundle matches the stale data-frame-runtime strip regex'
  }
  if (
    bundle.includes(MERMAID_RUNTIME_OPEN_PREFIX) ||
    bundle.includes(MERMAID_RUNTIME_CLOSE)
  ) {
    return 'bundle contains a mermaid runtime sentinel'
  }
  return null
}

export function wrapMermaidRuntimeOpen(payloadLength: number): string {
  return `${MERMAID_RUNTIME_OPEN_PREFIX}${payloadLength}-->`
}

export function isMermaidRuntimePayloadShape(payload: string): boolean {
  return (
    payload.startsWith('\n<style>') &&
    payload.endsWith('</script>\n') &&
    !payload.includes(MERMAID_RUNTIME_OPEN_PREFIX)
  )
}

export function stripMermaidRuntimeRegions(html: string): string {
  let t = 0
  let ranges: Array<[number, number]> | null = null
  for (;;) {
    const i = html.indexOf(MERMAID_RUNTIME_OPEN_PREFIX, t)
    if (i < 0) break
    const s = i + MERMAID_RUNTIME_OPEN_PREFIX.length
    let a = s
    const digitCap = s + MERMAID_RUNTIME_LEN_DIGITS_CAP
    while (a < digitCap) {
      const p = html.charCodeAt(a)
      if (p < 48 || p > 57) break
      a++
    }
    if (a === s || !html.startsWith('-->', a)) {
      t = s
      continue
    }
    const c = Number(html.slice(s, a))
    const u = a + 3
    const d = u + c
    if (
      c < MERMAID_RUNTIME_MAX_PAYLOAD_BYTES &&
      html.startsWith(MERMAID_RUNTIME_CLOSE, d) &&
      isMermaidRuntimePayloadShape(html.slice(u, d))
    ) {
      let p = d + MERMAID_RUNTIME_CLOSE.length
      if (html[p] === '\n') p++
      const f = i > 0 && html[i - 1] === '\n' ? i - 1 : i
      ranges ??= []
      ranges.push([f, p])
      t = p
    } else {
      t = s
    }
  }
  if (ranges === null) return html
  let n = ''
  let o = 0
  for (const [i, s] of ranges) {
    n += html.slice(o, i)
    o = s
  }
  return n + html.slice(o)
}
