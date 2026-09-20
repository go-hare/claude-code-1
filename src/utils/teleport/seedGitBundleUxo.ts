/**
 * densable TCt / uXo leftovers: T4n, $4n/x4n/P4n, cXo, wXo/vXo,
 * U4n/B4n, JS/eo, He/nI, Bc. Gold: gold-forged-TCt-*.txt,
 * gold-forged-He-nI.txt, gold-forged-Bc.txt.
 *
 * Skip: oQ, fr/zn/mr extra stamp arms.
 *
 * He/nI: `function He(` not unique — lock `_604` `JVb`/`KVb`.
 * TCt `JVb as nI` @212826502; E4n `$3o(e,nI())` / iXo `Z3o(e,nI())`.
 * Bc: `function Bc(` not unique — lock `_845` `Pzd`=`R`. TCt
 * `Pzd as Bc` @212858642. `$I` stays `clipSeedGitError`.
 */

import { constants, createReadStream, createWriteStream } from 'fs'
import { lstat, mkdtemp, open, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import { getErrnoCode } from '../errors.js'
import { clipSeedGitError, formatSeedPathList } from './seedDisplay.js'
import { storeStamps, type SeedStoreStamps } from './seedGitLayout.js'
import { readCommondir, resolveCommondir } from './seedGitLinked.js'
import { getPlatform } from '../platform.js'

const SEED_REF_PREFIX = 'refs/seed/'
/** densable `q3o` */
const BUNDLE_HEADER_LINE_MAX = 65536
/** densable `fCt` */
const BUNDLE_OID = /^[0-9a-f]{40,64}$/
/** densable `rYn` / `sXo=(rYn+1)*65` */
const SHALLOW_MAX_LINES = 64
const SHALLOW_MAX_BYTES = (SHALLOW_MAX_LINES + 1) * 65
/** densable `kXo` */
const PARTIAL_CLONE_GIT_PATCH = new Map([
  [39, 4],
  [40, 2],
  [41, 1],
  [42, 2],
  [43, 4],
  [44, 1],
])

export const SEED_STAMP_DRIFT_ERROR =
  'Not uploading this working tree: its git directory changed while the upload was being prepared, holds something git itself never puts there, or could not be inspected \u2014 another git process (a background fetch or gc) may have written packs meanwhile, in which case let it finish and retry; otherwise look for a commondir or objects/info/alternates file, or a link, special file, or extra directory git did not write.'

export const SEED_PARTIAL_CLONE_OLD_GIT =
  'Not uploading this working tree: the checkout is configured as a partial clone (a promisor remote), and the installed git is too old to be kept from fetching from that remote while the upload is prepared. Update git (2.45 or newer, or a current maintenance release of your version), or start from a full clone.'

/** densable `L4n` */
export function formatSeedRelabelFail(detail: string): string {
  return `Could not prepare the upload of this working tree (${detail}). Retry; if it keeps failing, check that the temporary directory has room for a second copy of the bundle and that nothing else is writing to this checkout.`
}

export const SEED_SHALLOW_NOTE = {
  complete:
    "HEAD's history is complete \u2014 bundling it as usual, without the widest tier",
  cut: "HEAD's history crosses the boundary \u2014 bundling a snapshot of the working tree, without history",
  unborn: 'HEAD is unborn and other refs sit behind the shallow boundary',
  unborn_cut:
    'The current branch has no commits yet, and the other branches of this shallow clone are cut short, so nothing here can be bundled; commit first, or deepen the clone (git fetch --unshallow)',
} as const

export type SeedShallowKind =
  | 'not_shallow'
  | 'complete'
  | 'cut'
  | 'unborn'
  | 'unborn_cut'

type EnvGet = Record<string, string | undefined>

function envGet(env: EnvGet, name: string): string | undefined {
  if (name in env) return env[name]
  if (getPlatform() !== 'windows') return
  const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
}

/** densable `ro` / TCt `Z4n` */
export function seedBundleTmpDir(env: EnvGet = process.env): string {
  const fromClaude = envGet(env, 'CLAUDE_CODE_TMPDIR')
  if (fromClaude !== undefined && fromClaude !== '') return fromClaude
  if (getPlatform() === 'windows') {
    const win = envGet(env, 'TEMP') ?? envGet(env, 'TMP')
    return win !== undefined && win !== '' ? win : tmpdir()
  }
  const unix =
    getPlatform() === 'macos'
      ? undefined
      : (envGet(env, 'TMPDIR') ?? envGet(env, 'TMP') ?? envGet(env, 'TEMP'))
  if (unix !== undefined && unix !== '') {
    return unix.length > 1 && unix.endsWith('/') ? unix.slice(0, -1) : unix
  }
  return '/tmp'
}

/** densable `T4n` — `D3o`=`mkdtemp`, `v4n`=`join`, `L3o`=`rm`. */
export async function makePrivateBundleFile(
  prefix = 'claude-seed',
  dir = seedBundleTmpDir(),
  name = 'out.bundle',
): Promise<{ path: string; dispose: () => Promise<void> }> {
  const made = await mkdtemp(join(dir, `${prefix}-`))
  return {
    path: join(made, name),
    dispose: () => rm(made, { recursive: true, force: true }).catch(() => {}),
  }
}

/** densable `no` / TCt `Y4n` */
export function parseGitVersion(
  text: string,
): { major: number; minor: number; patch: number } | null {
  const match = /^git version (\d+)\.(\d+)\.(\d+)/.exec(text.trim())
  return match === null
    ? null
    : {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
      }
}

/** densable `lYn` */
export function configListsPartialClone(listed: string): boolean {
  return listed.split('\0').some(row => {
    const nl = row.indexOf('\n')
    const key = nl === -1 ? row : row.slice(0, nl)
    const value = nl === -1 ? 'true' : row.slice(nl + 1)
    return (
      key === 'extensions.partialclone' ||
      /^remote\..*\.partialclonefilter$/s.test(key) ||
      (/^remote\..*\.promisor$/s.test(key) &&
        !['false', 'no', 'off', '0', ''].includes(value.toLowerCase()))
    )
  })
}

/** densable `vXo` after `Y4n` */
export function gitSupportsPartialCloneBundle(version: string): boolean {
  const parsed = parseGitVersion(version)
  if (parsed === null) return false
  if (parsed.major !== 2) return parsed.major > 2
  if (parsed.minor >= 45) return true
  const minPatch = PARTIAL_CLONE_GIT_PATCH.get(parsed.minor)
  return minPatch !== undefined && parsed.patch >= minPatch
}

/** densable `aXo` */
export function commitHasParent(text: string): boolean {
  return text.split(/\r?\n/).some(line => line.startsWith('parent '))
}

type SeedGitExec = (args: string[]) => Promise<{
  code: number
  exitCode?: number
  stdout: string
  stderr: string
}>

/**
 * densable `nI` / `_604` `d` / `KVb` @210529130.
 * Windows: `0`. Else `O_NOFOLLOW|O_NONBLOCK`.
 */
export function seedGitNI(): number {
  if (getPlatform() === 'windows') return 0
  return constants.O_NOFOLLOW | constants.O_NONBLOCK
}

/**
 * densable `He` / `_604` `m` / `JVb` @210529090 — `O_RDONLY|nI()`.
 * TCt imports `JVb as nI`; E4n/iXo `open(path, nI())`.
 */
export function seedGitHe(): number {
  return constants.O_RDONLY | seedGitNI()
}

/**
 * densable `Bc` / `_845` `R` / `Pzd` @206469431.
 * `C(t,n)` = `indexOf` then slice; `R(t)` = first line (`\n`).
 * U4n: `unlisted:Bc(s.stderr.trim())||exit`. Not `$I`.
 */
export function washSeedStderr(text: string): string {
  const at = text.indexOf('\n')
  return at === -1 ? text : text.slice(0, at)
}

/**
 * densable `cXo` (Hu/hardened when layout given).
 * `oQ` skipped — extra shallow probes use the same runner.
 */
export async function classifySeedShallow(
  gitRoot: string,
  run: SeedGitExec,
): Promise<SeedShallowKind> {
  const parsed = await run([
    'rev-parse',
    '--is-shallow-repository',
    '--git-path',
    'shallow',
  ])
  const [flag, gitPath] = parsed.stdout.split(/\r?\n/)
  if (parsed.code !== 0 || flag !== 'true') return 'not_shallow'
  const headCommit = await run([
    'rev-parse',
    '--verify',
    '--quiet',
    'HEAD^{commit}',
  ])
  const unborn = (headCommit.exitCode ?? headCommit.code) === 1
  const cut: SeedShallowKind = unborn ? 'unborn_cut' : 'cut'
  const oids = await readShallowOids(
    resolve(gitRoot, gitPath || join('.git', 'shallow')),
  )
  if (oids === null) return cut
  for (const oid of oids) {
    if (unborn) {
      const contains = await run([
        'for-each-ref',
        '--count=1',
        '--format=%(refname)',
        `--contains=${oid}`,
        'refs/heads/',
        'refs/tags/',
      ])
      if (
        (contains.exitCode ?? contains.code) === 0 &&
        contains.stdout.trim() === ''
      ) {
        continue
      }
    } else {
      const ancestor = await run(['merge-base', '--is-ancestor', oid, 'HEAD'])
      if ((ancestor.exitCode ?? ancestor.code) === 1) continue
      if ((ancestor.exitCode ?? ancestor.code) !== 0) return cut
    }
    const commit = await run(['cat-file', 'commit', oid])
    if (
      (commit.exitCode ?? commit.code) !== 0 ||
      commitHasParent(commit.stdout)
    ) {
      return cut
    }
  }
  return unborn ? 'unborn' : 'complete'
}

/**
 * densable `E4n` — `$3o`=`open`, flags `nI()` = `He`/`JVb`.
 */
export async function readSeedBundleFile(
  path: string,
  maxBytes: number,
): Promise<
  | { kind: 'read'; content: Buffer }
  | { kind: 'too_large'; sizeBytes: number }
  | { kind: 'unreadable'; detail: string }
> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, seedGitHe())
  } catch (err) {
    return { kind: 'unreadable', detail: String(err) }
  }
  try {
    const st = await handle.stat()
    if (!st.isFile() || st.nlink !== 1) {
      return { kind: 'unreadable', detail: 'not a single regular file' }
    }
    if (st.size > maxBytes) {
      return { kind: 'too_large', sizeBytes: st.size }
    }
    const buf = Buffer.alloc(st.size)
    let offset = 0
    while (offset < st.size) {
      const { bytesRead } = await handle.read(
        buf,
        offset,
        st.size - offset,
        offset,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return offset === st.size
      ? { kind: 'read', content: buf }
      : { kind: 'unreadable', detail: 'changed while being read' }
  } catch (err) {
    return { kind: 'unreadable', detail: String(err) }
  } finally {
    await handle.close()
  }
}

/** densable `iXo` — `Z3o`=`open`, flags `nI()` = `He`/`JVb`. */
export async function readShallowOids(path: string): Promise<string[] | null> {
  try {
    const st = await lstat(path)
    if (!st.isFile()) return null
    const handle = await open(path, seedGitHe())
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > SHALLOW_MAX_BYTES) return null
      const buf = Buffer.allocUnsafe(info.size)
      const { bytesRead } = await handle.read(buf, 0, info.size, 0)
      if (bytesRead !== info.size) return null
      const lines = buf
        .toString('utf8')
        .split(/\r?\n/)
        .filter(line => line !== '')
      return lines.length > SHALLOW_MAX_LINES ||
        lines.some(line => !/^[0-9a-f]{40,64}$/.test(line))
        ? null
        : lines
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

/**
 * densable `x4n` — rewrite bundle header refs via `labels`.
 */
class RelabelBundleTransform extends Transform {
  labels: Map<string, string>
  outputBytes = 0
  state: 'signature' | 'header' | 'pack' = 'signature'
  version = 2
  sawRef = false
  // Buffer<ArrayBufferLike>, not the Buffer<ArrayBuffer> that Buffer.alloc
  // infers — _transform chunks arrive as the looser type.
  pending: Buffer = Buffer.alloc(0)
  applied = new Set<string>()

  constructor(labels: Map<string, string>) {
    super()
    this.labels = labels
  }

  override _transform(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    done: (err?: Error | null) => void,
  ) {
    try {
      if (this.state === 'pack') this.writeOut(chunk)
      else {
        const buf =
          typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk
        this.pending =
          this.pending.length === 0 ? buf : Buffer.concat([this.pending, buf])
        this.consumeHeaderLines()
      }
      done()
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)))
    }
  }

  override _flush(done: (err?: Error | null) => void) {
    done(
      this.state === 'pack'
        ? null
        : new Error('bundle ended before the end of its header'),
    )
  }

  writeOut(chunk: Buffer | string) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk
    this.outputBytes += buf.length
    this.push(buf)
  }

  consumeHeaderLines() {
    for (;;) {
      const nl = this.pending.indexOf(10)
      if (nl < 0) {
        if (this.pending.length > BUNDLE_HEADER_LINE_MAX) {
          throw new Error('bundle header line too long')
        }
        return
      }
      const line = this.pending.toString('latin1', 0, nl)
      this.pending = this.pending.subarray(nl + 1)
      if (this.state === 'signature') {
        if (line === '# v2 git bundle') this.version = 2
        else if (line === '# v3 git bundle') this.version = 3
        else throw new Error('not a v2 or v3 git bundle')
        this.state = 'header'
        this.writeOut(`${line}\n`)
        continue
      }
      if (line === '') {
        if (this.applied.size !== this.labels.size) {
          throw new Error('bundle header does not name every ref to relabel')
        }
        this.state = 'pack'
        this.writeOut('\n')
        this.writeOut(this.pending)
        this.pending = Buffer.alloc(0)
        return
      }
      this.writeOut(`${this.headerLine(line)}\n`)
    }
  }

  headerLine(line: string): string {
    if (line.startsWith('@')) {
      if (this.version !== 3 || this.sawRef) {
        throw new Error('bundle capability line out of place')
      }
      return line
    }
    this.sawRef = true
    const sp = line.indexOf(' ')
    const first = sp < 0 ? line : line.slice(0, sp)
    if (line.startsWith('-')) {
      if (!BUNDLE_OID.test(first.slice(1))) {
        throw new Error('malformed bundle prerequisite line')
      }
      return line
    }
    const oid = first
    const ref = line.slice(sp + 1)
    if (sp < 0 || ref === '' || !BUNDLE_OID.test(oid)) {
      throw new Error('malformed bundle ref line')
    }
    const mapped = this.labels.get(ref)
    if (mapped !== undefined) {
      if (this.applied.has(ref)) {
        throw new Error('bundle header names a ref to relabel twice')
      }
      this.applied.add(ref)
      return `${oid} ${mapped}`
    }
    if (ref.startsWith(SEED_REF_PREFIX)) {
      throw new Error(
        "bundle header carries a seed ref that is not this build's",
      )
    }
    return line
  }
}

/** densable `$4n` + `P4n` */
export async function relabelSeedBundle(
  src: string,
  dest: string,
  labels: Map<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: true; sizeBytes: number } | { ok: false; error: string }> {
  const transform = new RelabelBundleTransform(labels)
  try {
    await pipeline(
      createReadStream(src),
      transform,
      createWriteStream(dest, { flags: 'wx' }),
      { signal },
    )
    return { ok: true, sizeBytes: transform.outputBytes }
  } catch (err) {
    if (getErrnoCode(err) !== 'EEXIST') {
      await rm(dest, { force: true }).catch(() => {})
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export type BundleHeadCheck = {
  missing: string[]
  foreign: string[]
  unlisted?: string
  notHeld?: string[]
}

/** densable `U4n` parse of `bundle list-heads` stdout + expected map. */
export function reviewBundleHeads(
  listed: { code: number; stdout: string; stderr: string },
  wanted: string[],
  expected: Record<string, string>,
  shown?: Map<string, string>,
  held?: { code: number; stdout: string },
): BundleHeadCheck {
  const oids = wanted.filter(name => !name.startsWith('-'))
  if (listed.code !== 0) {
    return {
      missing: oids,
      foreign: [],
      unlisted: washSeedStderr(listed.stderr.trim()) || `exit ${listed.code}`,
    }
  }
  const have = new Map(
    listed.stdout.split('\n').flatMap(row => {
      const [oid, name] = row.split(' ')
      return oid === undefined || name === undefined
        ? []
        : [[name, oid] as const]
    }),
  )
  const missing = oids.filter(name => {
    const oid = have.get(name)
    const want = expected[name]
    return oid === undefined || (want !== undefined && oid !== want)
  })
  const foreign =
    shown === undefined
      ? []
      : [...have].flatMap(([name, oid]) =>
          Object.hasOwn(expected, name) || shown.get(name) === oid
            ? []
            : [name],
        )
  if (shown === undefined || missing.length > 0 || foreign.length > 0) {
    return { missing, foreign }
  }
  if (held === undefined) return { missing, foreign }
  const notHeld =
    held.code === 0
      ? [...have].flatMap(([name, oid]) =>
          held.stdout.includes(`${oid} missing`) ? [name] : [],
        )
      : [...have.keys()]
  return { missing, foreign, notHeld }
}

/** densable `_Xo` / `j4n` / `B4n` — unlisted already `Bc`; `$I` clips. */
export function bundleHeadsRefuse(
  check: BundleHeadCheck,
  hardened = false,
): {
  ok: false
  error: string
  failReason: 'git_error' | 'git_dir_tampered'
} | null {
  if (check.unlisted !== undefined) {
    return {
      ok: false,
      error: `git bundle list-heads failed: ${clipSeedGitError(check.unlisted, hardened)}`,
      failReason: 'git_error',
    }
  }
  if (check.missing.length > 0) {
    return {
      ok: false,
      error: `git bundle create left out or altered ${formatSeedPathList(check.missing)}: another ref in this repository (a branch or tag spelled like it) makes the name ambiguous, or the temporary ref was rewritten while the bundle was made, so the upload would not carry your changes as captured. Make sure nothing else is writing to this checkout, rename or delete such a branch or tag (see \`git for-each-ref\`), then retry.`,
      failReason: 'git_error',
    }
  }
  if (check.foreign.length > 0) {
    return {
      ok: false,
      error: `git bundle create packed ${formatSeedPathList(check.foreign)}, which this checkout did not show when the upload read its refs: its refs changed, or were redirected elsewhere, while the bundle was made. Make sure nothing else is writing to this checkout, inspect its git directory (a commondir file there was not written by git), then retry.`,
      failReason: 'git_dir_tampered',
    }
  }
  if ((check.notHeld?.length ?? 0) > 0) {
    return {
      ok: false,
      error: `git bundle create packed ${formatSeedPathList(check.notHeld ?? [])} at commits this checkout's own object store does not hold: another object store stood in while the bundle was made. Make sure nothing else is writing to this checkout's git directory (objects/info in particular), then retry.`,
      failReason: 'git_dir_tampered',
    }
  }
  return null
}

type PathKind = 'file' | 'directory' | 'absent' | 'other'

async function pathKind(path: string): Promise<PathKind> {
  try {
    const st = await lstat(path)
    if (st.isFile()) return 'file'
    if (st.isDirectory()) return 'directory'
    return 'other'
  } catch {
    return 'absent'
  }
}

/**
 * densable `eo` / TCt `JS`.
 * `fr`/`zn`/`mr` extra arms skipped (more accept).
 */
export async function seedLayoutStampOk(
  layout: {
    gitDir: string
    commonDir: string
    gitDirId?: string
    storeStamps?: SeedStoreStamps
  },
  refs: string[],
): Promise<boolean> {
  const { gitDir, commonDir } = layout
  const [gitId, refsKind, objectsKind, reftableKind, headKind, listedCommon] =
    await Promise.all([
      lstat(gitDir, { bigint: true })
        .then(st => `${st.dev}:${st.ino}`)
        .catch(() => undefined),
      pathKind(join(commonDir, 'refs')),
      pathKind(join(commonDir, 'objects')),
      pathKind(join(commonDir, 'reftable')),
      pathKind(join(gitDir, 'HEAD')),
      readCommondir(gitDir),
    ])
  if (layout.gitDirId !== undefined && layout.gitDirId !== gitId) return false
  if (resolveCommondir(listedCommon, gitDir) !== commonDir) return false
  if (layout.storeStamps !== undefined) {
    const now = await storeStamps(commonDir)
    if (
      now.info !== layout.storeStamps.info ||
      now.pack !== layout.storeStamps.pack ||
      now.alternates !== layout.storeStamps.alternates ||
      now.httpAlternates !== layout.storeStamps.httpAlternates
    ) {
      return false
    }
  }
  if (
    refsKind !== 'directory' ||
    objectsKind !== 'directory' ||
    reftableKind !== 'absent'
  ) {
    return false
  }
  const infoKind = await pathKind(join(commonDir, 'objects', 'info'))
  const packKind = await pathKind(join(commonDir, 'objects', 'pack'))
  const remapped = [
    await pathKind(join(commonDir, 'packed-refs')),
    await pathKind(join(gitDir, 'logs', 'HEAD')),
    infoKind === 'directory' ? 'absent' : 'other',
    packKind === 'directory' ? 'absent' : 'other',
    headKind === 'file' ? 'absent' : 'other',
    ...(await Promise.all(
      refs.map(ref => pathKind(join(commonDir, ...ref.split('/')))),
    )),
    ...(await Promise.all(
      refs.map(ref => pathKind(join(commonDir, 'logs', ...ref.split('/')))),
    )),
  ]
  return remapped.every(kind => kind === 'absent' || kind === 'file')
}
