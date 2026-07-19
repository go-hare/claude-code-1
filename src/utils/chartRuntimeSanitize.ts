/**
 * densable pewter_canteen chart-runtime sanitize helpers (B4u/U4u/S8g/E8g/q4u).
 *
 * When artifacts include `data-chart-runtime`, densable strips prior chart-runtime
 * markers then (if gate allows) injects a trusted Chart.js bundle. Full bundle
 * injection still needs the vendored chart.umd.min.js residual; this module
 * covers the pure safety gates used before any inject.
 *
 * densable:
 *   B4u() = !et("tengu_pewter_canteen", false)  // inject allowed when flag false
 *   U4u(html) = html includes "data-chart-runtime"
 *   S8g(bundle) = reject unsafe bundle strings
 *   E8g(inner) = inner is only one-or-more <script>…</script> blocks
 *   q4u(html) = strip safe prior chart-runtime sentinel regions
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { CHART_RUNTIME_BOOT_SCRIPT as GENERATED_CHART_BOOT } from './chartRuntimeBootScript.generated.js'
import { stripFrameThenMermaid } from './frameRuntimeSanitize.js'
import {
  applyMermaidRuntimeRegionToHtml,
  buildMermaidRuntimeRegion,
  stripMermaidRuntimeRegions,
} from './mermaidRuntimeSanitize.js'

export const CHART_RUNTIME_ATTR = 'data-chart-runtime'
export const CHART_RUNTIME_OPEN = '<!-- chart-runtime -->'
export const CHART_RUNTIME_CLOSE = '<!-- /chart-runtime -->'

/**
 * densable Fso / b8g path anchors. Official binary embeds chart.umd at
 * `/$bunfs/root/chart.umd.min.js`; local forks may place a vendored copy under
 * `vendor/` or `src/frame/`. Loader tries absolute Fso first, then relative
 * candidates from process.cwd / import.meta-ish roots.
 */
export const CHART_UMD_BUNFS_PATH = '/$bunfs/root/chart.umd.min.js'
export const CHART_UMD_RELATIVE_CANDIDATES = [
  'vendor/chart.umd.min.js',
  'src/frame/chart.umd.min.js',
  'src/frame/$bunfs/root/chart.umd.min.js',
] as const

/** densable B4u — chart runtime inject enabled unless pewter_canteen kills it. */
export function isChartRuntimeInjectEnabled(): boolean {
  return !getFeatureValue_CACHED_MAY_BE_STALE('tengu_pewter_canteen', false)
}

/** densable U4u */
export function htmlNeedsChartRuntime(html: string): boolean {
  return html.includes(CHART_RUNTIME_ATTR)
}

/**
 * densable S8g — reject chart bundles that look attacker-controlled.
 * Returns a reason string when unsafe, else null.
 */
export function getUnsafeChartBundleReason(bundle: string): string | null {
  if (/<\/script/i.test(bundle)) return 'bundle contains </script'
  if (bundle.includes('<!--') && /<script/i.test(bundle)) {
    return 'bundle contains <!-- together with <script (double-escaped state)'
  }
  if (
    bundle.includes(CHART_RUNTIME_OPEN) ||
    bundle.includes(CHART_RUNTIME_CLOSE)
  ) {
    return 'bundle contains the chart-runtime sentinel'
  }
  return null
}

/** densable E8g — region between sentinels is only <script>…</script> blocks. */
export function isScriptOnlyRegion(inner: string): boolean {
  let t = inner.trim()
  if (!t.length) return false
  let count = 0
  while (t.length) {
    if (!t.startsWith('<script>')) return false
    const end = t.indexOf('</script>', 8)
    if (end < 0) return false
    count++
    t = t.slice(end + 9).trimStart()
  }
  return count >= 1
}

/**
 * densable q4u — remove prior safe chart-runtime sentinel regions so a
 * re-publish can re-inject a trusted runtime without stacking scripts.
 */
export function stripChartRuntimeRegions(html: string): string {
  let out = html
  let from = 0
  for (;;) {
    const open = out.indexOf(CHART_RUNTIME_OPEN, from)
    if (open < 0) return out
    const afterOpen = open + CHART_RUNTIME_OPEN.length
    const close = out.indexOf(CHART_RUNTIME_CLOSE, afterOpen)
    if (close < 0) return out
    const inner = out.slice(afterOpen, close)
    if (isScriptOnlyRegion(inner)) {
      out = out.slice(0, open) + out.slice(close + CHART_RUNTIME_CLOSE.length)
      from = open
    } else {
      from = afterOpen
    }
  }
}

/**
 * densable j4u region wrapper — wrap a trusted Chart.js bundle + boot script
 * in chart-runtime sentinels. Caller must pass already-validated bundle
 * (getUnsafeChartBundleReason === null). Does not load chart.umd from disk.
 */
export function wrapChartRuntimeRegion(
  chartBundleJs: string,
  bootScript: string = GENERATED_CHART_BOOT,
): string | null {
  if (getUnsafeChartBundleReason(chartBundleJs) !== null) return null
  if (getUnsafeChartBundleReason(bootScript) !== null) return null
  return (
    CHART_RUNTIME_OPEN +
    '\n<script>' +
    chartBundleJs +
    '</script>\n<script>' +
    bootScript +
    '</script>\n' +
    CHART_RUNTIME_CLOSE
  )
}

/**
 * densable v8g full Chart.js boot (from 2.1.211). Parses data-chart-runtime
 * JSON + #primary-chart canvas, builds Chart.js config, re-renders on theme.
 */
export const CHART_RUNTIME_BOOT_SCRIPT: string = GENERATED_CHART_BOOT

/**
 * densable b8g pure path resolution — pick first readable chart.umd candidate.
 * I/O is injected so unit tests do not touch disk; production callers pass
 * fs.promises.readFile + path helpers.
 */
export async function loadChartBundleJs(input?: {
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
  const bunfs = input?.bunfsPath ?? CHART_UMD_BUNFS_PATH
  const relatives = input?.relativeCandidates ?? CHART_UMD_RELATIVE_CANDIDATES

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
 * densable j4u async half — load + S8g-validate bundle, wrap region or null.
 * Emits no analytics here; callers may log chart_bundle_unreadable/unsafe.
 */
export async function buildChartRuntimeRegion(input?: {
  readFile?: (path: string, encoding: 'utf8') => Promise<string>
  isAbsolute?: (path: string) => boolean
  join?: (...parts: string[]) => string
  cwd?: string
  chartBundleJs?: string | null
  bootScript?: string
}): Promise<
  | { ok: true; region: string }
  | { ok: false; reason: 'chart_bundle_unreadable' | 'chart_bundle_unsafe' }
> {
  let bundle = input?.chartBundleJs
  if (bundle === undefined) {
    bundle = await loadChartBundleJs(input)
  }
  if (bundle === null || bundle === undefined || bundle === '') {
    return { ok: false, reason: 'chart_bundle_unreadable' }
  }
  if (getUnsafeChartBundleReason(bundle) !== null) {
    return { ok: false, reason: 'chart_bundle_unsafe' }
  }
  const region = wrapChartRuntimeRegion(
    bundle,
    input?.bootScript ?? CHART_RUNTIME_BOOT_SCRIPT,
  )
  if (region === null) {
    return { ok: false, reason: 'chart_bundle_unsafe' }
  }
  return { ok: true, region }
}

/**
 * densable F9u pure half — strip prior regions; when inject allowed + needs
 * runtime + region provided, append (densable appends; we also support </body>).
 * Full async F9u still loads j4u separately.
 */
export function applyChartRuntimeRegionToHtml(
  html: string,
  region: string | null,
  opts?: { injectEnabled?: boolean },
): string {
  let out = stripChartRuntimeRegions(html)
  const inject = opts?.injectEnabled ?? isChartRuntimeInjectEnabled()
  if (!inject || !region) return out
  if (!htmlNeedsChartRuntime(out)) return out
  const bodyClose = out.lastIndexOf('</body>')
  if (bodyClose >= 0) {
    return out.slice(0, bodyClose) + region + out.slice(bodyClose)
  }
  // densable F9u appends when no body close consideration — keep append fallback.
  return out + region
}

/**
 * Pre-publish sanitize + optional inject (partial densable F9u):
 * always strip prior chart-runtime regions; if injectEnabled and bundle
 * provided and page needs runtime, append a trusted region.
 */
export function sanitizeArtifactHtmlForPublish(
  html: string,
  opts?: {
    injectEnabled?: boolean
    chartBundleJs?: string | null
  },
): string {
  const inject = opts?.injectEnabled ?? isChartRuntimeInjectEnabled()
  const bundle = opts?.chartBundleJs
  if (!inject || !bundle) {
    return stripChartRuntimeRegions(html)
  }
  if (getUnsafeChartBundleReason(bundle) !== null) {
    return stripChartRuntimeRegions(html)
  }
  const region = wrapChartRuntimeRegion(bundle)
  return applyChartRuntimeRegionToHtml(html, region, { injectEnabled: inject })
}

/**
 * densable F9u async publish sanitize pure half:
 *   r = q4u(N9u(html))
 *     N9u = frame strip → wWg mermaid strip → stale /_f/ + data-frame-runtime
 *     q4u = strip prior chart-runtime regions
 *   if U4u(r)&&B4u → j4u chart inject append
 *   if mermaidIntent&&zso()&&l9u(r) → c9u mermaid inject append
 *
 * Bundles injectable via opts; disk load uses readFile injection (tests/prod).
 */
export async function sanitizeArtifactHtmlForPublishAsync(
  html: string,
  opts?: {
    injectEnabled?: boolean
    chartBundleJs?: string | null
    mermaidBundleJs?: string | null
    mermaidIntent?: boolean
    mermaidEnabled?: boolean
    readFile?: (path: string, encoding: 'utf8') => Promise<string>
    cwd?: string
  },
): Promise<{
  body: string
  chartInjected: boolean
  mermaidInjected: boolean
  chartFailReason?: string
  mermaidFailReason?: string
}> {
  const inject = opts?.injectEnabled ?? isChartRuntimeInjectEnabled()
  // densable: q4u(N9u(e)) — N9u does frame→mermaid→stale; then chart strip.
  let out = stripChartRuntimeRegions(
    stripFrameThenMermaid(html, stripMermaidRuntimeRegions),
  )

  let chartInjected = false
  let chartFailReason: string | undefined
  if (inject && htmlNeedsChartRuntime(out)) {
    const built = await buildChartRuntimeRegion({
      chartBundleJs: opts?.chartBundleJs,
      readFile: opts?.readFile,
      cwd: opts?.cwd,
    })
    if (!built.ok) {
      chartFailReason = built.reason
    } else {
      // densable j4u appends (F9u: r+=s); also support </body> via apply helper.
      out = applyChartRuntimeRegionToHtml(out, built.region, {
        injectEnabled: true,
      })
      chartInjected = true
    }
  }

  let mermaidInjected = false
  let mermaidFailReason: string | undefined
  const mermaidIntent = opts?.mermaidIntent === true
  if (
    mermaidIntent &&
    (opts?.mermaidEnabled !== undefined
      ? opts.mermaidEnabled
      : true /* gate re-checked in apply */)
  ) {
    // densable o = t===true && zso() && l9u(r) — apply helper re-checks l9u/zso.
    const mBuilt = await buildMermaidRuntimeRegion({
      mermaidBundleJs: opts?.mermaidBundleJs,
      readFile: opts?.readFile,
      cwd: opts?.cwd,
    })
    if (!mBuilt.ok) {
      mermaidFailReason = mBuilt.reason
    } else {
      const before = out
      out = applyMermaidRuntimeRegionToHtml(out, mBuilt.region, {
        mermaidIntent: true,
        mermaidEnabled: opts?.mermaidEnabled,
      })
      mermaidInjected = out !== before
    }
  }

  return {
    body: out,
    chartInjected,
    mermaidInjected,
    ...(chartFailReason !== undefined && { chartFailReason }),
    ...(mermaidFailReason !== undefined && { mermaidFailReason }),
  }
}
