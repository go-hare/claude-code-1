import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import { execa } from 'execa'
import { tmpdir } from 'os'
import { basename, extname, isAbsolute, join } from 'path'
import {
  API_IMAGE_MAX_BASE64_SIZE,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
} from '../constants/apiLimits.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getImageProcessor } from '@claude-code/builtin-tools/tools/FileReadTool/imageProcessor.js'
import { isInBundledMode } from './bundledMode.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import {
  detectImageFormatFromBase64,
  type ImageDimensions,
  maybeResizeAndDownsampleImageBuffer,
} from './imageResizer.js'
import { logError } from './log.js'

// Native NSPasteboard reader. GrowthBook gate tengu_collage_kaleidoscope is
// a kill switch (default on). Falls through to osascript when off.
// The gate string is inlined at each callsite INSIDE the feature() condition
// — module-scope helpers are NOT tree-shaken (see docs/feature-gating.md).

type SupportedPlatform = 'darwin' | 'linux' | 'win32'

// Threshold in characters for when to consider text a "large paste"
export const PASTE_THRESHOLD = 800
function getClipboardCommands() {
  const platform = process.platform as SupportedPlatform

  // Platform-specific temporary file paths
  // Use CLAUDE_CODE_TMPDIR if set, otherwise fall back to platform defaults.
  // tmpdir() honors $TMPDIR so non-/tmp environments (Termux/Android, containers) work out of the box.
  const baseTmpDir =
    process.env.CLAUDE_CODE_TMPDIR ||
    (platform === 'win32' ? process.env.TEMP || 'C:\\Temp' : tmpdir())
  const screenshotFilename = 'claude_cli_latest_screenshot.png'
  const tempPaths: Record<SupportedPlatform, string> = {
    darwin: join(baseTmpDir, screenshotFilename),
    linux: join(baseTmpDir, screenshotFilename),
    win32: join(baseTmpDir, screenshotFilename),
  }

  const screenshotPath = tempPaths[platform] || tempPaths.linux

  // Platform-specific clipboard commands
  const commands: Record<
    SupportedPlatform,
    {
      checkImage: string
      saveImage: string
      getPath: string
      deleteFile: string
    }
  > = {
    darwin: {
      checkImage: `osascript -e 'the clipboard as «class PNGf»'`,
      saveImage: `osascript -e 'set png_data to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "${screenshotPath}" with write permission' -e 'write png_data to fp' -e 'close access fp'`,
      getPath: `osascript -e 'get POSIX path of (the clipboard as «class furl»)'`,
      deleteFile: `rm -f "${screenshotPath}"`,
    },
    linux: {
      checkImage:
        'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)" || wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"',
      saveImage: `xclip -selection clipboard -t image/png -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/png > "${screenshotPath}" 2>/dev/null || xclip -selection clipboard -t image/bmp -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/bmp > "${screenshotPath}"`,
      getPath:
        'xclip -selection clipboard -t text/plain -o 2>/dev/null || wl-paste 2>/dev/null',
      deleteFile: `rm -f "${screenshotPath}"`,
    },
    win32: {
      checkImage:
        'powershell -NoProfile -Command "(Get-Clipboard -Format Image) -ne $null"',
      saveImage: `powershell -NoProfile -Command "$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${screenshotPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png) }"`,
      getPath: 'powershell -NoProfile -Command "Get-Clipboard"',
      deleteFile: `del /f "${screenshotPath}"`,
    },
  }

  return {
    commands: commands[platform] || commands.linux,
    screenshotPath,
  }
}

export type ImageWithDimensions = {
  base64: string
  mediaType: string
  dimensions?: ImageDimensions
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Run PowerShell without `shell: true`.
 *
 * Critical on Windows: Claude Code is often launched from Git Bash / MSYS.
 * `execa(..., { shell: true })` then goes through bash, which expands `$img`
 * / `$null` out of the PowerShell script before powershell.exe ever sees them.
 * That makes the historical win32 clipboard commands always fail.
 */
async function runPowerShell(
  script: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Prefer Windows PowerShell 5.1 (Desktop) — System.Windows.Forms clipboard
  // works more reliably there than some pwsh hosts. -STA helps apartment-model
  // clipboard access when the parent process is MTA.
  const result = await execa(
    'powershell.exe',
    ['-NoProfile', '-STA', '-NonInteractive', '-Command', script],
    {
      shell: false,
      reject: false,
      timeout: 15_000,
      windowsHide: true,
    },
  )
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  }
}

/**
 * Some providers reject tiny images (e.g. "both width and height must be at
 * least 8 pixels"). Client-side floor so we don't ship a 1×1 placeholder /
 * leftover test pixel as a real paste.
 */
export const MIN_CLIPBOARD_IMAGE_EDGE = 8

/**
 * Windows clipboard → temp PNG via PowerShell (argv, no bash shell).
 *
 * Prefer raw PNG/DIB streams from IDataObject (full-res screenshot bytes)
 * before GetImage()/Get-Clipboard Image — those can surface a 1×1 or
 * thumbnail-like bitmap when multiple formats are on the clipboard (or when a
 * prior test left a tiny image on the clipboard).
 */
async function saveClipboardImageWin32(
  screenshotPath: string,
): Promise<{ ok: boolean; width?: number; height?: number }> {
  const pathLit = escapePowerShellSingleQuoted(screenshotPath)
  // PowerShell: try PNG stream → DIB stream → GetImage → Get-Clipboard.
  // Write dims as "W H" on stdout for logging.
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    "$out = '" + pathLit + "'",
    '$saved = $false',
    '$w = 0',
    '$h = 0',
    // 1) Prefer raw PNG bytes if present (browser / snipping tool often set this)
    'try {',
    '  $data = [System.Windows.Forms.Clipboard]::GetDataObject()',
    '  if ($data -ne $null -and $data.GetDataPresent("PNG")) {',
    '    $ms = $data.GetData("PNG")',
    '    if ($ms -is [System.IO.MemoryStream]) {',
    '      $bytes = $ms.ToArray()',
    '      if ($bytes.Length -gt 32) {',
    '        [System.IO.File]::WriteAllBytes($out, $bytes)',
    '        $imgPng = [System.Drawing.Image]::FromFile($out)',
    '        $w = $imgPng.Width; $h = $imgPng.Height',
    '        $imgPng.Dispose()',
    '        $saved = $true',
    '      }',
    '    }',
    '  }',
    '} catch {}',
    // 2) Fall back to GDI+ bitmap from clipboard
    'if (-not $saved) {',
    '  $img = $null',
    '  try { $img = [System.Windows.Forms.Clipboard]::GetImage() } catch {}',
    '  if ($null -eq $img) {',
    '    try { $img = Get-Clipboard -Format Image -ErrorAction SilentlyContinue } catch {}',
    '  }',
    '  if ($null -ne $img) {',
    '    $w = $img.Width; $h = $img.Height',
    '    $img.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)',
    '    if ($img -is [System.IDisposable]) { $img.Dispose() }',
    '    $saved = $true',
    '  }',
    '}',
    'if (-not $saved -or -not (Test-Path -LiteralPath $out)) { exit 1 }',
    'Write-Output ("$w $h")',
    'exit 0',
  ].join('; ')

  const result = await runPowerShell(script)
  if (result.code !== 0) {
    logForDebugging(
      `win32 clipboard image save failed code=${result.code} stderr=${result.stderr.trim()}`,
      { level: 'warn' },
    )
    return { ok: false }
  }
  const match = result.stdout.trim().match(/(\d+)\s+(\d+)/)
  const width = match ? Number(match[1]) : undefined
  const height = match ? Number(match[2]) : undefined
  logForDebugging(
    `win32 clipboard image saved ${width ?? '?'}x${height ?? '?'} → ${screenshotPath}`,
  )
  return { ok: true, width, height }
}

async function hasClipboardImageWin32(): Promise<boolean> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    "if ([System.Windows.Forms.Clipboard]::ContainsImage()) { 'true'; exit 0 }",
    'try {',
    '  $img = Get-Clipboard -Format Image -ErrorAction SilentlyContinue',
    "  if ($null -ne $img) { 'true'; exit 0 }",
    '} catch {}',
    "'false'; exit 1",
  ].join('; ')
  const result = await runPowerShell(script)
  return (
    result.code === 0 && result.stdout.trim().toLowerCase().includes('true')
  )
}

/**
 * Check if clipboard contains an image without retrieving it.
 */
export async function hasImageInClipboard(): Promise<boolean> {
  if (process.platform === 'win32') {
    return hasClipboardImageWin32()
  }
  if (process.platform !== 'darwin') {
    return false
  }
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
    // Native NSPasteboard check (~0.03ms warm). Fall through to osascript
    // when the module/export is missing. Catch a throw too: it would surface
    // as an unhandled rejection in useClipboardImageHint's setTimeout.
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const nativeModule = getNativeModule()
      if (nativeModule && 'hasClipboardImage' in nativeModule) {
        const hasImage = (nativeModule as unknown as Record<string, Function>)
          .hasClipboardImage
        if (hasImage) return hasImage()
      }
    } catch (e) {
      logError(e as Error)
    }
  }
  const result = await execFileNoThrowWithCwd('osascript', [
    '-e',
    'the clipboard as «class PNGf»',
  ])
  return result.code === 0
}

/**
 * Read PNG IHDR width/height without native image deps.
 * PNG signature 8 bytes + IHDR length/type 8 bytes → dims at offset 16.
 */
function readPngIhdrDims(
  buffer: Buffer,
): { width: number; height: number } | undefined {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return undefined
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

/**
 * bun --compile cannot load sharp's win32 native addon (optionalDependency
 * .node is not embedded). Use System.Drawing to resize/recompress the temp
 * file in place so packaged Windows binaries can still paste large screenshots.
 *
 * Returns display dims + whether the file was rewritten as JPEG.
 */
async function downsampleClipboardFileWin32(
  path: string,
  originalWidth: number,
  originalHeight: number,
): Promise<{ width: number; height: number; jpeg: boolean } | null> {
  const pathLit = escapePowerShellSingleQuoted(path)
  const maxW = IMAGE_MAX_WIDTH
  const maxH = IMAGE_MAX_HEIGHT
  const targetRaw = Math.floor(IMAGE_TARGET_RAW_SIZE)
  // Write to a sibling temp file then Move-Item — GDI+ locks the source path
  // while FromFile is open; overwriting $path in-place often fails.
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    `$path = '${pathLit}'`,
    `$maxW = ${maxW}`,
    `$maxH = ${maxH}`,
    `$targetRaw = ${targetRaw}`,
    '$img = $null',
    '$bmp = $null',
    'try {',
    '  $img = [System.Drawing.Image]::FromFile($path)',
    '  if ($null -eq $img) { exit 1 }',
    '  $w = [double]$img.Width',
    '  $h = [double]$img.Height',
    '  if ($w -le 0 -or $h -le 0) { exit 1 }',
    '  $scale = 1.0',
    '  if ($w -gt $maxW) { $scale = [Math]::Min($scale, $maxW / $w) }',
    '  if ($h -gt $maxH) { $scale = [Math]::Min($scale, $maxH / $h) }',
    '  $nw = [int][Math]::Max(1, [Math]::Round($w * $scale))',
    '  $nh = [int][Math]::Max(1, [Math]::Round($h * $scale))',
    '  $fi = New-Object System.IO.FileInfo $path',
    '  $needResize = ($scale -lt 1.0)',
    '  $needCompress = ($fi.Length -gt $targetRaw)',
    '  if (-not $needResize -and -not $needCompress) {',
    '    Write-Output ("$([int]$w) $([int]$h) png")',
    '    exit 0',
    '  }',
    '  if ($needResize) {',
    '    $bmp = New-Object System.Drawing.Bitmap $nw, $nh',
    '    $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '    $g.DrawImage($img, 0, 0, $nw, $nh)',
    '    $g.Dispose()',
    '  } else {',
    '    $bmp = New-Object System.Drawing.Bitmap $img',
    '    $nw = $bmp.Width; $nh = $bmp.Height',
    '  }',
    '  $img.Dispose(); $img = $null',
    '  $tmp = $path + ".claude-ds.tmp.jpg"',
    '  $codec = $null',
    '  foreach ($c in [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()) {',
    '    if ($c.MimeType -eq "image/jpeg") { $codec = $c; break }',
    '  }',
    '  if ($null -eq $codec) { exit 1 }',
    '  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1',
    '  foreach ($q in @(85, 70, 55, 40, 25)) {',
    '    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]$q)',
    '    $bmp.Save($tmp, $codec, $ep)',
    '    $fi2 = New-Object System.IO.FileInfo $tmp',
    '    if ($fi2.Length -le $targetRaw) { break }',
    '  }',
    '  $bmp.Dispose(); $bmp = $null',
    '  Move-Item -LiteralPath $tmp -Destination $path -Force',
    '  Write-Output ("$nw $nh jpeg")',
    '  exit 0',
    '} catch {',
    '  if ($null -ne $img) { try { $img.Dispose() } catch {} }',
    '  if ($null -ne $bmp) { try { $bmp.Dispose() } catch {} }',
    '  Write-Error $_',
    '  exit 1',
    '}',
  ].join('; ')

  const result = await runPowerShell(script)
  if (result.code !== 0) {
    logForDebugging(
      `win32 System.Drawing downsample failed code=${result.code} stderr=${result.stderr.trim()} stdout=${result.stdout.trim()}`,
      { level: 'warn' },
    )
    return null
  }
  const match = result.stdout.trim().match(/(\d+)\s+(\d+)\s+(png|jpeg)/i)
  if (!match) {
    logForDebugging(
      `win32 System.Drawing downsample bad stdout: ${result.stdout.trim()}`,
      { level: 'warn' },
    )
    return null
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    jpeg: match[3]!.toLowerCase() === 'jpeg',
  }
}

/**
 * Finalize a win32 clipboard temp file into API-ready base64.
 *
 * Packaged (`bun --compile`) binaries cannot load sharp's native addon on
 * Windows — resize/metadata would throw and large screenshots fail paste.
 * Prefer a no-sharp path when bundled, or when the sharp path fails.
 */
async function finalizeClipboardImageWin32(
  screenshotPath: string,
  known?: { width?: number; height?: number },
): Promise<ImageWithDimensions | null> {
  const fs = getFsImplementation()
  let imageBuffer = fs.readFileBytesSync(screenshotPath)
  if (imageBuffer.length === 0) {
    return null
  }

  let originalWidth = known?.width
  let originalHeight = known?.height
  if (
    (originalWidth === undefined || originalHeight === undefined) &&
    imageBuffer.length >= 24
  ) {
    const ihdr = readPngIhdrDims(imageBuffer)
    if (ihdr) {
      originalWidth = ihdr.width
      originalHeight = ihdr.height
    }
  }

  if (
    typeof originalWidth === 'number' &&
    typeof originalHeight === 'number' &&
    (originalWidth < MIN_CLIPBOARD_IMAGE_EDGE ||
      originalHeight < MIN_CLIPBOARD_IMAGE_EDGE)
  ) {
    logForDebugging(
      `win32 clipboard image ${originalWidth}x${originalHeight} below floor — ignoring`,
      { level: 'warn' },
    )
    return null
  }

  const needsResize =
    imageBuffer.length > IMAGE_TARGET_RAW_SIZE ||
    (typeof originalWidth === 'number' && originalWidth > IMAGE_MAX_WIDTH) ||
    (typeof originalHeight === 'number' && originalHeight > IMAGE_MAX_HEIGHT)

  // Dev (non-bundled): sharp works — keep existing high-quality path.
  // Bundled: skip sharp entirely when we need resize, or try pass-through first.
  if (!isInBundledMode()) {
    try {
      return await finalizeClipboardImageBuffer(imageBuffer)
    } catch (e) {
      logForDebugging(
        `win32 sharp finalize failed, falling back to System.Drawing: ${e}`,
        { level: 'warn' },
      )
    }
  } else if (!needsResize) {
    // Under caps: ship raw PNG without native image deps.
    const base64Image = imageBuffer.toString('base64')
    const mediaType = detectImageFormatFromBase64(base64Image)
    return {
      base64: base64Image,
      mediaType,
      dimensions:
        typeof originalWidth === 'number' && typeof originalHeight === 'number'
          ? {
              originalWidth,
              originalHeight,
              displayWidth: originalWidth,
              displayHeight: originalHeight,
            }
          : undefined,
    }
  }

  // System.Drawing downsample (bundled large images, or sharp failed).
  const ow = originalWidth ?? IMAGE_MAX_WIDTH
  const oh = originalHeight ?? IMAGE_MAX_HEIGHT
  const ds = await downsampleClipboardFileWin32(screenshotPath, ow, oh)
  if (!ds) {
    // Last resort: if raw still under base64 limit, ship uncompressed.
    const base64Size = Math.ceil((imageBuffer.length * 4) / 3)
    if (base64Size <= API_IMAGE_MAX_BASE64_SIZE) {
      const base64Image = imageBuffer.toString('base64')
      return {
        base64: base64Image,
        mediaType: detectImageFormatFromBase64(base64Image),
        dimensions:
          typeof originalWidth === 'number' &&
          typeof originalHeight === 'number'
            ? {
                originalWidth,
                originalHeight,
                displayWidth: originalWidth,
                displayHeight: originalHeight,
              }
            : undefined,
      }
    }
    return null
  }

  imageBuffer = fs.readFileBytesSync(screenshotPath)
  if (imageBuffer.length === 0) {
    return null
  }
  const base64Image = imageBuffer.toString('base64')
  const mediaType = ds.jpeg
    ? 'image/jpeg'
    : detectImageFormatFromBase64(base64Image)
  return {
    base64: base64Image,
    mediaType,
    dimensions: {
      originalWidth: originalWidth ?? ds.width,
      originalHeight: originalHeight ?? ds.height,
      displayWidth: ds.width,
      displayHeight: ds.height,
    },
  }
}

async function finalizeClipboardImageBuffer(
  imageBuffer: Buffer,
): Promise<ImageWithDimensions | null> {
  if (imageBuffer.length === 0) {
    return null
  }

  // BMP is not supported by the API — convert to PNG via Sharp.
  // This handles WSL2 / some Windows copy paths that produce BMP.
  // (win32 clipboard save path already writes PNG via System.Drawing.)
  let buffer = imageBuffer
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    const sharp = await getImageProcessor()
    buffer = await sharp(buffer).png().toBuffer()
  }

  const resized = await maybeResizeAndDownsampleImageBuffer(
    buffer,
    buffer.length,
    'png',
  )

  // Reject tiny images before shipping to the API (providers require ≥8px).
  // Common sources: leftover test 1×1 on clipboard, icon-only formats.
  const w =
    resized.dimensions?.displayWidth ?? resized.dimensions?.originalWidth
  const h =
    resized.dimensions?.displayHeight ?? resized.dimensions?.originalHeight
  if (
    typeof w === 'number' &&
    typeof h === 'number' &&
    (w < MIN_CLIPBOARD_IMAGE_EDGE || h < MIN_CLIPBOARD_IMAGE_EDGE)
  ) {
    logForDebugging(
      `clipboard image ${w}x${h} below ${MIN_CLIPBOARD_IMAGE_EDGE}px floor — ignoring`,
      { level: 'warn' },
    )
    return null
  }

  const base64Image = resized.buffer.toString('base64')
  const mediaType = detectImageFormatFromBase64(base64Image)
  return {
    base64: base64Image,
    mediaType,
    dimensions: resized.dimensions,
  }
}

export async function getImageFromClipboard(): Promise<ImageWithDimensions | null> {
  // Fast path: native NSPasteboard reader (macOS only). Reads PNG bytes
  // directly in-process and downsamples via CoreGraphics if over the
  // dimension cap. ~5ms cold, sub-ms warm — vs. ~1.5s for the osascript
  // path below. Throws if the native module is unavailable, in which case
  // the catch block falls through to osascript. A `null` return from the
  // native call is authoritative (clipboard has no image).
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    process.platform === 'darwin' &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const nativeModule = getNativeModule()
      const readClipboard =
        nativeModule && 'readClipboardImage' in nativeModule
          ? (nativeModule as unknown as Record<string, Function>)
              .readClipboardImage
          : undefined
      if (!readClipboard) {
        throw new Error('native clipboard reader unavailable')
      }
      const native = readClipboard(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
      if (!native) {
        return null
      }
      // The native path caps dimensions but not file size. A complex
      // 2000×2000 PNG can still exceed the 3.75MB raw / 5MB base64 API
      // limit — for that edge case, run through the same size-cap that
      // the osascript path uses (degrades to JPEG if needed). Cheap if
      // already under: just a sharp metadata read.
      const buffer: Buffer = native.png
      if (buffer.length > IMAGE_TARGET_RAW_SIZE) {
        const resized = await maybeResizeAndDownsampleImageBuffer(
          buffer,
          buffer.length,
          'png',
        )
        return {
          base64: resized.buffer.toString('base64'),
          mediaType: `image/${resized.mediaType}`,
          dimensions: {
            originalWidth: native.originalWidth,
            originalHeight: native.originalHeight,
            displayWidth: resized.dimensions?.displayWidth ?? native.width,
            displayHeight: resized.dimensions?.displayHeight ?? native.height,
          },
        }
      }
      return {
        base64: buffer.toString('base64'),
        mediaType: 'image/png',
        dimensions: {
          originalWidth: native.originalWidth,
          originalHeight: native.originalHeight,
          displayWidth: native.width,
          displayHeight: native.height,
        },
      }
    } catch (e) {
      logError(e as Error)
      // Fall through to osascript fallback.
    }
  }

  // Windows: never shell out a PS one-liner through bash (see runPowerShell).
  // Use a unique temp path per read so a concurrent/stale claude_cli_latest_*
  // file (e.g. leftover 1×1 from a previous test) cannot be re-read.
  if (process.platform === 'win32') {
    const { screenshotPath: basePath } = getClipboardCommands()
    const screenshotPath = basePath.replace(
      /\.png$/i,
      `-${Date.now()}-${randomBytes(4).toString('hex')}.png`,
    )
    try {
      const saved = await saveClipboardImageWin32(screenshotPath)
      if (!saved.ok) {
        return null
      }
      // Fast reject if PowerShell already reported tiny dims (before sharp).
      if (
        typeof saved.width === 'number' &&
        typeof saved.height === 'number' &&
        (saved.width < MIN_CLIPBOARD_IMAGE_EDGE ||
          saved.height < MIN_CLIPBOARD_IMAGE_EDGE)
      ) {
        logForDebugging(
          `win32 clipboard image ${saved.width}x${saved.height} below floor — ignoring`,
          { level: 'warn' },
        )
        try {
          getFsImplementation().unlinkSync(screenshotPath)
        } catch {
          // best-effort
        }
        return null
      }
      // Keep the temp file until finalize finishes — bundled mode may rewrite
      // it via System.Drawing when sharp's native addon is unavailable.
      const finalized = await finalizeClipboardImageWin32(screenshotPath, {
        width: saved.width,
        height: saved.height,
      })
      try {
        getFsImplementation().unlinkSync(screenshotPath)
      } catch {
        // best-effort cleanup
      }
      return finalized
    } catch (e) {
      logError(e as Error)
      try {
        getFsImplementation().unlinkSync(screenshotPath)
      } catch {
        // best-effort
      }
      return null
    }
  }

  const { commands, screenshotPath } = getClipboardCommands()
  try {
    // Check if clipboard has image
    const checkResult = await execa(commands.checkImage, {
      shell: true,
      reject: false,
    })
    if (checkResult.exitCode !== 0) {
      return null
    }

    // Save the image
    const saveResult = await execa(commands.saveImage, {
      shell: true,
      reject: false,
    })
    if (saveResult.exitCode !== 0) {
      return null
    }

    // Read the image and convert to base64
    const imageBuffer = getFsImplementation().readFileBytesSync(screenshotPath)

    // Cleanup (fire-and-forget, don't await)
    void execa(commands.deleteFile, { shell: true, reject: false })

    return finalizeClipboardImageBuffer(imageBuffer)
  } catch {
    return null
  }
}

export async function getImagePathFromClipboard(): Promise<string | null> {
  const { commands } = getClipboardCommands()

  try {
    // Try to get text from clipboard
    const result = await execa(commands.getPath, {
      shell: true,
      reject: false,
    })
    if (result.exitCode !== 0 || !result.stdout) {
      return null
    }
    return result.stdout.trim()
  } catch (e) {
    logError(e as Error)
    return null
  }
}

/**
 * Regex pattern to match supported image file extensions. Kept in sync with
 * MIME_BY_EXT in BriefTool/upload.ts — attachments.ts uses this to set isImage
 * on the wire, and remote viewers fetch /preview iff isImage is true. An ext
 * here but not in MIME_BY_EXT (e.g. bmp) uploads as octet-stream and has no
 * /preview variant → broken thumbnail.
 */
export const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp)$/i

/**
 * Remove outer single or double quotes from a string
 * @param text Text to clean
 * @returns Text without outer quotes
 */
function removeOuterQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * Remove shell escape backslashes from a path (for macOS/Linux/WSL)
 * On Windows systems, this function returns the path unchanged
 * @param path Path that might contain shell-escaped characters
 * @returns Path with escape backslashes removed (on macOS/Linux/WSL only)
 */
function stripBackslashEscapes(path: string): string {
  const platform = process.platform as SupportedPlatform

  // On Windows, don't remove backslashes as they're part of the path
  if (platform === 'win32') {
    return path
  }

  // On macOS/Linux/WSL, handle shell-escaped paths
  // Double-backslashes (\\) represent actual backslashes in the filename
  // Single backslashes followed by special chars are shell escapes

  // First, temporarily replace double backslashes with a placeholder
  // Use random salt to prevent injection attacks where path contains literal placeholder
  const salt = randomBytes(8).toString('hex')
  const placeholder = `__DOUBLE_BACKSLASH_${salt}__`
  const withPlaceholder = path.replace(/\\\\/g, placeholder)

  // Remove single backslashes that are shell escapes
  // This handles cases like "name\ \(15\).png" -> "name (15).png"
  const withoutEscapes = withPlaceholder.replace(/\\(.)/g, '$1')

  // Replace placeholders back to single backslashes
  return withoutEscapes.replace(new RegExp(placeholder, 'g'), '\\')
}

/**
 * Check if a given text represents an image file path
 * @param text Text to check
 * @returns Boolean indicating if text is an image path
 */
export function isImageFilePath(text: string): boolean {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)
  return IMAGE_EXTENSION_REGEX.test(unescaped)
}

/**
 * Clean and normalize a text string that might be an image file path
 * @param text Text to process
 * @returns Cleaned text with quotes removed, whitespace trimmed, and shell escapes removed, or null if not an image path
 */
export function asImageFilePath(text: string): string | null {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)

  if (IMAGE_EXTENSION_REGEX.test(unescaped)) {
    return unescaped
  }

  return null
}

/**
 * Try to find and read an image file, falling back to clipboard search
 * @param text Pasted text that might be an image filename or path
 * @returns Object containing the image path and base64 data, or null if not found
 */
export async function tryReadImageFromPath(
  text: string,
): Promise<(ImageWithDimensions & { path: string }) | null> {
  // Strip terminal added spaces or quotes to dragged in paths
  const cleanedPath = asImageFilePath(text)

  if (!cleanedPath) {
    return null
  }

  const imagePath = cleanedPath
  let imageBuffer

  try {
    if (isAbsolute(imagePath)) {
      imageBuffer = getFsImplementation().readFileBytesSync(imagePath)
    } else {
      // VSCode Terminal just grabs the text content which is the filename
      // instead of getting the full path of the file pasted with cmd-v. So
      // we check if it matches the filename of the image in the clipboard.
      const clipboardPath = await getImagePathFromClipboard()
      if (clipboardPath && imagePath === basename(clipboardPath)) {
        imageBuffer = getFsImplementation().readFileBytesSync(clipboardPath)
      }
    }
  } catch (e) {
    logError(e as Error)
    return null
  }
  if (!imageBuffer) {
    return null
  }
  if (imageBuffer.length === 0) {
    logForDebugging(`Image file is empty: ${imagePath}`, { level: 'warn' })
    return null
  }

  // BMP is not supported by the API — convert to PNG via Sharp.
  if (
    imageBuffer.length >= 2 &&
    imageBuffer[0] === 0x42 &&
    imageBuffer[1] === 0x4d
  ) {
    const sharp = await getImageProcessor()
    imageBuffer = await sharp(imageBuffer).png().toBuffer()
  }

  // Resize if needed to stay under 5MB API limit
  // Extract extension from path for format hint
  const ext = extname(imagePath).slice(1).toLowerCase() || 'png'
  const resized = await maybeResizeAndDownsampleImageBuffer(
    imageBuffer,
    imageBuffer.length,
    ext,
  )
  const base64Image = resized.buffer.toString('base64')

  // Detect format from the actual file contents using magic bytes
  const mediaType = detectImageFormatFromBase64(base64Image)
  return {
    path: imagePath,
    base64: base64Image,
    mediaType,
    dimensions: resized.dimensions,
  }
}
