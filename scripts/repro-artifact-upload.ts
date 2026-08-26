/**
 * Local-only repro for ArtifactTool upload socket failures.
 * Do NOT commit. Mirrors production uploadArtifact() + optional proxy/keepalive hammer.
 *
 * Usage:
 *   bun scripts/repro-artifact-upload.ts
 *   bun scripts/repro-artifact-upload.ts --proxy
 *   bun scripts/repro-artifact-upload.ts --parallel 4 --repeat 3
 *   bun scripts/repro-artifact-upload.ts --file .claude/artifacts/review-234-238.md
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  getArtifactsToken,
  getUploadUrl,
} from '../packages/builtin-tools/src/tools/ArtifactTool/config.ts'
import { uploadArtifact } from '../packages/builtin-tools/src/tools/ArtifactTool/client.ts'
import { markdownToHtml } from '../packages/builtin-tools/src/tools/ArtifactTool/markdown.ts'

type Mode = {
  proxy: boolean
  clearProxy: boolean
  parallel: number
  repeat: number
  keepaliveProbe: boolean
  file?: string
  htmlInline?: string
}

function parseArgs(argv: string[]): Mode {
  const mode: Mode = {
    proxy: false,
    clearProxy: false,
    parallel: 1,
    repeat: 1,
    keepaliveProbe: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--proxy') mode.proxy = true
    else if (a === '--no-proxy' || a === '--clear-proxy') mode.clearProxy = true
    else if (a === '--parallel') mode.parallel = Number(argv[++i] ?? 1)
    else if (a === '--repeat') mode.repeat = Number(argv[++i] ?? 1)
    else if (a === '--no-keepalive-probe') mode.keepaliveProbe = false
    else if (a === '--file') mode.file = argv[++i]
    else if (a === '--html') mode.htmlInline = argv[++i]
  }
  return mode
}

async function loadHtml(mode: Mode): Promise<{ html: string; label: string }> {
  if (mode.htmlInline) {
    return { html: mode.htmlInline, label: 'inline-html' }
  }
  const file =
    mode.file ?? resolve(process.cwd(), '.claude/artifacts/review-234-238.md')
  const raw = await readFile(file, 'utf8')
  const lower = file.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { html: markdownToHtml(raw, file), label: file }
  }
  return { html: raw, label: file }
}

async function oneUpload(
  label: string,
  html: string,
  attempt: number,
): Promise<{ ok: boolean; ms: number; detail: string }> {
  const started = Date.now()
  try {
    const result = await uploadArtifact({
      html,
      token: getArtifactsToken(),
      uploadUrl: getUploadUrl(),
      ttl: 7,
      hash: `repro-${Date.now().toString(36)}-${attempt}`,
    })
    return {
      ok: true,
      ms: Date.now() - started,
      detail: `${label} -> ${result.url}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      ms: Date.now() - started,
      detail: `${label} FAIL: ${msg}`,
    }
  }
}

async function rawFetchProbe(
  html: string,
  opts: { keepalive?: boolean; redirect?: RequestRedirect } = {},
): Promise<{ ok: boolean; ms: number; detail: string }> {
  const started = Date.now()
  const url = new URL(getUploadUrl())
  url.searchParams.set('ttl', '7')
  url.searchParams.set('hash', `raw-${Date.now().toString(36)}`)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getArtifactsToken()}`,
        'Content-Type': 'text/html',
      },
      body: html,
      keepalive: opts.keepalive ?? false,
      redirect: opts.redirect ?? 'follow',
    })
    const text = await response.text()
    return {
      ok: response.ok && !text.includes('"error"'),
      ms: Date.now() - started,
      detail: `rawFetch keepalive=${opts.keepalive ?? false} status=${response.status} body=${text.slice(0, 160)}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      ms: Date.now() - started,
      detail: `rawFetch keepalive=${opts.keepalive ?? false} FAIL: ${msg}`,
    }
  }
}

async function main() {
  const mode = parseArgs(process.argv.slice(2))
  const envBefore = {
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    ALL_PROXY: process.env.ALL_PROXY,
    NO_PROXY: process.env.NO_PROXY,
  }

  if (mode.clearProxy) {
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.ALL_PROXY
    delete process.env.http_proxy
    delete process.env.https_proxy
    delete process.env.all_proxy
  }
  if (mode.proxy) {
    process.env.HTTP_PROXY = process.env.HTTP_PROXY ?? 'http://127.0.0.1:12000'
    process.env.HTTPS_PROXY =
      process.env.HTTPS_PROXY ?? 'http://127.0.0.1:12000'
  }

  const { html, label } = await loadHtml(mode)
  const bytes = Buffer.byteLength(html, 'utf8')

  console.log(
    JSON.stringify(
      {
        uploadUrl: getUploadUrl(),
        tokenSet: Boolean(getArtifactsToken()),
        label,
        htmlBytes: bytes,
        mode,
        env: {
          HTTP_PROXY: process.env.HTTP_PROXY ?? null,
          HTTPS_PROXY: process.env.HTTPS_PROXY ?? null,
          ALL_PROXY: process.env.ALL_PROXY ?? null,
          NO_PROXY: process.env.NO_PROXY ?? null,
          envBefore,
        },
        bun: process.versions.bun ?? null,
        node: process.version,
      },
      null,
      2,
    ),
  )

  const results: Array<{ ok: boolean; ms: number; detail: string }> = []

  for (let r = 0; r < mode.repeat; r++) {
    const batch = Array.from({ length: mode.parallel }, (_, i) =>
      oneUpload(`prod-uploadArtifact r${r + 1}#${i + 1}`, html, r * 100 + i),
    )
    results.push(...(await Promise.all(batch)))
  }

  if (mode.keepaliveProbe) {
    // Warm then reuse — production client never sets keepalive:false.
    results.push(
      await rawFetchProbe('<html>keepalive-warm</html>', { keepalive: true }),
    )
    results.push(
      await rawFetchProbe('<html>keepalive-reuse</html>', { keepalive: true }),
    )
    results.push(
      await rawFetchProbe('<html>keepalive-off</html>', { keepalive: false }),
    )
    results.push(
      await rawFetchProbe('<html>redirect-error</html>', { redirect: 'error' }),
    )
  }

  const ok = results.filter(x => x.ok).length
  const fail = results.length - ok
  for (const row of results) {
    console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.ms}ms ${row.detail}`)
  }
  console.log(`SUMMARY ok=${ok} fail=${fail} total=${results.length}`)
  if (fail > 0) process.exitCode = 1
}

await main()
