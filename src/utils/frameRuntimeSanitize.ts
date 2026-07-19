/**
 * densable N9u / CWg frame-runtime residual pure half.
 *
 * densable F9u:
 *   r = q4u(N9u(html))  // N9u: frame strip → wWg mermaid strip → stale attrs
 *   then optional chart (j4u) + mermaid (c9u) inject
 *
 * This module covers frame sentinels + CWg safety + stale /_f/ + data-frame-runtime
 * strip. Mermaid strip stays in mermaidRuntimeSanitize; chart strip in chartRuntime.
 */

export const FRAME_RUNTIME_OPEN = '<!-- frame-runtime -->'
export const FRAME_RUNTIME_CLOSE = '<!-- /frame-runtime -->'

/** densable EWg — open sentinel must appear before this index. */
export const FRAME_RUNTIME_OPEN_INDEX_CAP = 8192

/** densable vWg — max span open→close for a strippable frame region. */
export const FRAME_RUNTIME_REGION_SPAN_CAP = 300_000

/**
 * densable CWg — frame-runtime payload is a leading <base href="/_f/...">
 * followed only by <script…>…</script> blocks (attrs allowed on open tag).
 */
export function isFrameRuntimePayloadShape(inner: string): boolean {
  let t = inner.trim()
  const base = t.match(/^<base\s+href="\/_f\/[^">]*"\s*\/?>/)
  if (!base) return false
  t = t.slice(base[0].length).trimStart()
  while (t.length) {
    const open = t.match(/^<script\b[^>]*>/)
    if (!open) return false
    const end = t.indexOf('</script>', open[0].length)
    if (end < 0) return false
    t = t.slice(end + 9).trimStart()
  }
  return true
}

/**
 * densable N9u pure frame half — strip at most one leading safe frame-runtime
 * region, then drop stale base /_f/ tags and data-frame-runtime attributes.
 * Does not call wWg; callers compose stripMermaidRuntimeRegions around this.
 */
export function stripFrameRuntimeRegion(html: string): string {
  let e = html
  const t = e.indexOf(FRAME_RUNTIME_OPEN)
  if (t >= 0 && t < FRAME_RUNTIME_OPEN_INDEX_CAP) {
    const r = t + FRAME_RUNTIME_OPEN.length
    const n = e.indexOf(FRAME_RUNTIME_CLOSE, r)
    if (
      n >= 0 &&
      n - t < FRAME_RUNTIME_REGION_SPAN_CAP &&
      isFrameRuntimePayloadShape(e.slice(r, n))
    ) {
      let o = n + FRAME_RUNTIME_CLOSE.length
      if (e[o] === '\n') o++
      e = e.slice(0, t) + e.slice(o)
    }
  }
  return stripStaleFrameArtifacts(e)
}

/**
 * densable N9u tail replaces after mermaid strip:
 *   .replace(/<base\s+href="\/_f\/[^">]*"\s*\/?>\n?/gi,"")
 *   .replace(/\sdata-frame-runtime="[^">]*"/gi,"")
 */
export function stripStaleFrameArtifacts(html: string): string {
  return html
    .replace(/<base\s+href="\/_f\/[^">]*"\s*\/?>\n?/gi, '')
    .replace(/\sdata-frame-runtime="[^">]*"/gi, '')
}

/**
 * densable N9u full pure compose — frame strip → mermaidStrip(fn) → stale attrs
 * already applied inside frame strip. When mermaidStrip provided, densable order
 * is frame first then mermaid then stale (stale after mermaid in densable; we
 * re-apply stale after mermaid for parity).
 */
export function stripFrameThenMermaid(
  html: string,
  mermaidStrip: (html: string) => string,
): string {
  // densable: frame region only, then wWg, then stale replaces.
  let e = html
  const t = e.indexOf(FRAME_RUNTIME_OPEN)
  if (t >= 0 && t < FRAME_RUNTIME_OPEN_INDEX_CAP) {
    const r = t + FRAME_RUNTIME_OPEN.length
    const n = e.indexOf(FRAME_RUNTIME_CLOSE, r)
    if (
      n >= 0 &&
      n - t < FRAME_RUNTIME_REGION_SPAN_CAP &&
      isFrameRuntimePayloadShape(e.slice(r, n))
    ) {
      let o = n + FRAME_RUNTIME_CLOSE.length
      if (e[o] === '\n') o++
      e = e.slice(0, t) + e.slice(o)
    }
  }
  e = mermaidStrip(e)
  return stripStaleFrameArtifacts(e)
}
