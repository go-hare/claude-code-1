/**
 * densable 2.1.246 runner `os` / `Xt` / `is` — host prefetch_ok file.
 *
 * Official @218346529:
 *   tn="/tmp" Ln="ccr-byoc-prefetch-network.state"
 *   os(e={}) { t=await Xt(join(e.dir??tn,Ln)); return (is(t,now).prefetch_ok??0)>=1 }
 *   Xt: open O_RDONLY, read Jr=4096, first line trim, missing → undefined
 *   is: `ok=<digits>` via Dn `/(?:^|\s)([a-z_]+)=(\S+)/g`
 */
import { constants as fsConstants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

/** densable `tn`. */
export const PREFETCH_STATE_DIR = '/tmp'
/** densable `Ln`. */
export const PREFETCH_NETWORK_STATE_FILE = 'ccr-byoc-prefetch-network.state'
/** densable `Jr`. */
const PREFETCH_STATE_MAX_BYTES = 4096
const PREFETCH_PAIR_RE = /(?:^|\s)([a-z_]+)=(\S+)/g

/** densable `Dn`. */
function parsePrefetchPairs(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of text.matchAll(PREFETCH_PAIR_RE)) {
    out.set(match[1]!, match[2]!)
  }
  return out
}

/** densable `gt`. */
function parsePrefetchUint(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return
  return Number(raw)
}

/**
 * densable `Xt` — first line of the prefetch state file, or undefined.
 * Official also ORs an unidentified `es` open flag; O_RDONLY is the locked bit.
 */
export async function readPrefetchStateFirstLine(
  path: string,
): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, fsConstants.O_RDONLY)
    const buf = Buffer.alloc(PREFETCH_STATE_MAX_BYTES)
    const { bytesRead } = await handle.read(buf, 0, PREFETCH_STATE_MAX_BYTES, 0)
    const text = buf.subarray(0, bytesRead).toString('utf8')
    const nl = text.indexOf('\n')
    const line = (nl === -1 ? text : text.slice(0, nl)).trim()
    return line || undefined
  } catch {
    return
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** densable `is(...).prefetch_ok`. */
export function prefetchOkCount(text: string | undefined): number | undefined {
  if (text === undefined) return
  return parsePrefetchUint(parsePrefetchPairs(text).get('ok'))
}

/** densable `os`. */
export async function readWarmupCompleteOs(
  opts: { dir?: string } = {},
): Promise<boolean> {
  const text = await readPrefetchStateFirstLine(
    join(opts.dir ?? PREFETCH_STATE_DIR, PREFETCH_NETWORK_STATE_FILE),
  )
  return (prefetchOkCount(text) ?? 0) >= 1
}
