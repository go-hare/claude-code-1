import { existsSync } from 'fs'
import { chmod, mkdir, rm, writeFile } from 'fs/promises'
import { homedir, platform } from 'os'
import { dirname, isAbsolute, join, resolve, sep } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { distRoot } from '../distRoot.js'
import { unzipFile } from '../dxt/zip.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { logForDebugging } from '../debug.js'
import { openInChrome } from './common.js'

/** Official production extension id — requires manifest.key for unpacked. */
export const LOCAL_CHROME_EXTENSION_PROD_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn'

/**
 * Default release asset for fork local unpacked install.
 * Override with CLAUDE_CHROME_LOCAL_EXTENSION_ZIP_URL.
 */
export const DEFAULT_LOCAL_CHROME_EXTENSION_ZIP_URL =
  'https://github.com/go-hare/claude-chrome/releases/download/claude_1.0.81/claude_1.0.81.zip'

/** Tag / folder name under ~/.claude/chrome/extensions/ */
export const DEFAULT_LOCAL_CHROME_EXTENSION_VERSION = 'claude_1.0.81'

const MAX_ZIP_BYTES = 80 * 1024 * 1024 // 80MB — extension zip is small

/**
 * Where downloaded + extracted packages live:
 * `~/.claude/chrome/extensions/<version>/`
 */
export function getLocalChromeExtensionInstallDir(
  version = DEFAULT_LOCAL_CHROME_EXTENSION_VERSION,
): string {
  return join(getClaudeConfigHomeDir(), 'chrome', 'extensions', version)
}

export function getLocalChromeExtensionZipUrl(): string {
  const env = process.env.CLAUDE_CHROME_LOCAL_EXTENSION_ZIP_URL?.trim()
  return env && env.length > 0 ? env : DEFAULT_LOCAL_CHROME_EXTENSION_ZIP_URL
}

/**
 * Candidate roots for an already-present Load-unpacked package.
 * Override with CLAUDE_CHROME_LOCAL_EXTENSION_DIR (absolute or ~).
 */
export function resolveLocalChromeExtensionPackageDir(): string | null {
  const envRaw = process.env.CLAUDE_CHROME_LOCAL_EXTENSION_DIR?.trim()
  if (envRaw) {
    const expanded = envRaw.startsWith('~/')
      ? join(homedir(), envRaw.slice(2))
      : envRaw
    const abs = isAbsolute(expanded)
      ? expanded
      : resolve(process.cwd(), expanded)
    // Explicit env wins: valid → path; invalid → null (do not fall through).
    return isValidUnpackedExtensionDir(abs) ? abs : null
  }

  const installDir = getLocalChromeExtensionInstallDir()
  if (isValidUnpackedExtensionDir(installDir)) {
    return installDir
  }

  // distRoot is a resolved string (not a function) — same as setup.ts.
  let root: string
  try {
    root = distRoot || process.cwd()
  } catch {
    root = process.cwd()
  }

  const candidates = [
    join(root, '..', 'claude_1.0.81'),
    join(root, 'claude_1.0.81'),
    join(root, 'extensions', 'claude-in-chrome'),
    join(root, 'vendor', 'claude-in-chrome'),
    join(homedir(), 'work-py', 'hare-code', 'claude_1.0.81'),
  ]

  for (const c of candidates) {
    try {
      const abs = resolve(c)
      if (isValidUnpackedExtensionDir(abs)) {
        return abs
      }
    } catch {
      // ignore
    }
  }
  return null
}

export function isValidUnpackedExtensionDir(dir: string): boolean {
  try {
    return existsSync(join(dir, 'manifest.json'))
  } catch {
    return false
  }
}

/** Drop macOS resource-fork junk from zip listings. */
export function isZipJunkPath(name: string): boolean {
  const norm = name.replace(/\\/g, '/')
  if (norm.startsWith('__MACOSX/') || norm === '__MACOSX') return true
  const base = norm.split('/').pop() ?? ''
  if (base.startsWith('._')) return true
  if (base === '.DS_Store') return true
  return false
}

/**
 * If zip root is a single top-level folder (e.g. claude_1.0.81/manifest.json),
 * strip that prefix so install dir has manifest.json at root.
 * Ignores __MACOSX / AppleDouble junk from `ditto` / Finder zips.
 */
export function normalizeZipRoot(
  files: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  const cleaned: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue
    if (isZipJunkPath(name)) continue
    cleaned[name.replace(/\\/g, '/')] = data
  }

  const names = Object.keys(cleaned)
  if (names.length === 0) {
    return cleaned
  }

  // Already flat with manifest at root
  if (cleaned['manifest.json']) {
    return cleaned
  }

  const firstSegs = new Set(
    names.map(n => n.split('/').filter(Boolean)[0] ?? ''),
  )
  if (firstSegs.size !== 1) {
    return cleaned
  }
  const root = [...firstSegs][0]!
  const allUnder = names.every(n => n === root || n.startsWith(`${root}/`))
  if (!allUnder) {
    return cleaned
  }
  const hasNested = names.some(n => n.includes('/'))
  if (!hasNested) {
    return cleaned
  }

  const out: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(cleaned)) {
    const stripped =
      name === root
        ? ''
        : name.startsWith(`${root}/`)
          ? name.slice(root.length + 1)
          : name
    if (!stripped || isZipJunkPath(stripped)) continue
    out[stripped] = data
  }
  return out
}

/**
 * Download zip from release URL and extract under ~/.claude/chrome/extensions/.
 * Always re-downloads when force=true; otherwise reuses existing valid install.
 */
export async function downloadAndExtractLocalChromeExtension(options?: {
  force?: boolean
  zipUrl?: string
  version?: string
}): Promise<{ packageDir: string; downloaded: boolean }> {
  const version = options?.version ?? DEFAULT_LOCAL_CHROME_EXTENSION_VERSION
  const packageDir = getLocalChromeExtensionInstallDir(version)
  const force = options?.force === true

  if (!force && isValidUnpackedExtensionDir(packageDir)) {
    return { packageDir, downloaded: false }
  }

  const zipUrl = options?.zipUrl ?? getLocalChromeExtensionZipUrl()
  logForDebugging(
    `[Claude in Chrome] Downloading local extension zip: ${zipUrl}`,
  )

  const res = await fetch(zipUrl, {
    redirect: 'follow',
    headers: {
      // GitHub release assets sometimes prefer a UA
      'User-Agent': 'claude-code-local-chrome-extension',
      Accept: 'application/octet-stream',
    },
  })
  if (!res.ok) {
    throw new Error(
      `Failed to download extension zip (${res.status} ${res.statusText}): ${zipUrl}`,
    )
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) {
    throw new Error('Downloaded extension zip is empty')
  }
  if (buf.length > MAX_ZIP_BYTES) {
    throw new Error(
      `Downloaded extension zip too large (${buf.length} bytes, max ${MAX_ZIP_BYTES})`,
    )
  }

  const rawFiles = await unzipFile(buf)
  const files = normalizeZipRoot(rawFiles)
  if (!files['manifest.json']) {
    throw new Error(
      'Zip does not contain manifest.json at package root (after strip). Wrong archive?',
    )
  }

  // Replace install dir atomically-ish: write to tmp then rename via rm+mkdir+write
  const tmpDir = `${packageDir}.tmp-${process.pid}`
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })

  try {
    for (const [rel, data] of Object.entries(files)) {
      if (rel.endsWith('/')) continue
      const norm = rel.replace(/\\/g, '/')
      if (norm.includes('..') || isAbsolute(norm)) {
        throw new Error(`Refusing unsafe zip path: ${rel}`)
      }
      const dest = join(tmpDir, ...norm.split('/'))
      // Ensure dest stays under tmpDir
      if (!dest.startsWith(tmpDir + sep) && dest !== tmpDir) {
        throw new Error(`Zip path escaped install dir: ${rel}`)
      }
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, Buffer.from(data))
    }

    if (!isValidUnpackedExtensionDir(tmpDir)) {
      throw new Error('Extracted package missing manifest.json')
    }

    await rm(packageDir, { recursive: true, force: true })
    await mkdir(dirname(packageDir), { recursive: true })
    // rename across same volume
    const { rename } = await import('fs/promises')
    await rename(tmpDir, packageDir)
  } catch (e) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    throw e
  }

  // Ensure readable for Chrome
  try {
    await chmod(packageDir, 0o755)
  } catch {
    // ignore
  }

  logForDebugging(
    `[Claude in Chrome] Local extension extracted to ${packageDir}`,
  )
  return { packageDir, downloaded: true }
}

export type OpenLocalExtensionInstallResult = {
  packageDir: string | null
  revealedFolder: boolean
  openedExtensionsPage: boolean
  downloaded: boolean
  zipUrl: string
  hint: string
}

/**
 * Fork: download release zip (if needed) → extract → reveal folder +
 * chrome://extensions. User still Load unpacked (Chrome API cannot silent-install).
 */
export async function openLocalExtensionInstallHelpers(options?: {
  forceDownload?: boolean
}): Promise<OpenLocalExtensionInstallResult> {
  const zipUrl = getLocalChromeExtensionZipUrl()
  let packageDir: string | null = null
  let downloaded = false
  let downloadError: string | null = null

  // Prefer download into ~/.claude so every machine gets the same release.
  // If download fails, fall back to already-discovered local tree.
  try {
    const result = await downloadAndExtractLocalChromeExtension({
      force: options?.forceDownload === true,
      zipUrl,
    })
    packageDir = result.packageDir
    downloaded = result.downloaded
  } catch (e) {
    downloadError = e instanceof Error ? e.message : String(e)
    logForDebugging(
      `[Claude in Chrome] Extension zip download failed: ${downloadError}`,
      { level: 'warn' },
    )
    packageDir = resolveLocalChromeExtensionPackageDir()
  }

  let revealedFolder = false
  let openedExtensionsPage = false

  if (packageDir) {
    revealedFolder = await revealPathInFileManager(packageDir)
  }
  openedExtensionsPage = await openInChrome('chrome://extensions')

  const steps: string[] = []
  if (downloadError && !packageDir) {
    steps.push(`Download failed: ${downloadError}`)
    steps.push(`Zip: ${zipUrl}`)
  } else if (downloadError && packageDir) {
    steps.push(`Download failed (${downloadError}); using existing package.`)
  } else if (downloaded) {
    steps.push(`Downloaded from ${zipUrl}`)
  } else {
    steps.push(`Using cached package (already extracted).`)
  }

  if (packageDir) {
    steps.push(`Package: ${packageDir}`)
    steps.push(
      'In Chrome: Developer mode → Load unpacked → select that folder.',
    )
    steps.push(
      `Confirm extension id is ${LOCAL_CHROME_EXTENSION_PROD_ID} (needs official manifest.key).`,
    )
    steps.push('Then /chrome → Connect local (native socket, no token).')
  } else {
    steps.push(
      'No package available. Check network, or set CLAUDE_CHROME_LOCAL_EXTENSION_DIR / CLAUDE_CHROME_LOCAL_EXTENSION_ZIP_URL.',
    )
  }

  return {
    packageDir,
    revealedFolder,
    openedExtensionsPage,
    downloaded,
    zipUrl,
    hint: steps.join(' '),
  }
}

async function revealPathInFileManager(path: string): Promise<boolean> {
  const p = platform()
  if (p === 'darwin') {
    const { code } = await execFileNoThrow('open', ['-R', path], {
      timeout: 10_000,
      useCwd: false,
    })
    return code === 0
  }
  if (p === 'win32') {
    const { code } = await execFileNoThrow('explorer', ['/select,', path], {
      timeout: 10_000,
      useCwd: false,
    })
    return code === 0
  }
  const { code } = await execFileNoThrow('xdg-open', [path], {
    timeout: 10_000,
    useCwd: false,
  })
  return code === 0
}
