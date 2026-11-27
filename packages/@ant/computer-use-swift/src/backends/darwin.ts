/**
 * macOS backend for computer-use-swift
 *
 * Uses AppleScript/JXA/screencapture for display info, app management,
 * and screenshots.
 */

import { spawn, spawnSync } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { readFileSync, unlinkSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type {
  AppInfo,
  AppsAPI,
  DisplayAPI,
  DisplayGeometry,
  InstalledApp,
  PrepareDisplayResult,
  RunningApp,
  ScreenshotAPI,
  ScreenshotResult,
  SwiftBackend,
  WindowDisplayInfo,
} from '../types.js'

export type {
  DisplayGeometry,
  PrepareDisplayResult,
  AppInfo,
  InstalledApp,
  RunningApp,
  ScreenshotResult,
  ResolvePrepareCaptureResult,
  WindowDisplayInfo,
} from '../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spawnCollectStdout(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    proc.stdout?.on('data', (chunk: Buffer | string) => {
      chunks.push(
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
      )
    })
    proc.stderr?.resume()
    proc.on('error', reject)
    proc.on('close', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

function jxaSync(script: string): string {
  const result = spawnSync('osascript', ['-l', 'JavaScript', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return result.stdout ? result.stdout.toString('utf8').trim() : ''
}

function osascriptSync(script: string): string {
  const result = spawnSync('osascript', ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return result.stdout ? result.stdout.toString('utf8').trim() : ''
}

async function osascript(script: string, args: string[] = []): Promise<string> {
  const argv = args.length > 0 ? ['-e', script, '--', ...args] : ['-e', script]
  const text = await spawnCollectStdout('osascript', argv)
  return text.trim()
}

async function jxa(script: string): Promise<string> {
  const text = await spawnCollectStdout('osascript', [
    '-l',
    'JavaScript',
    '-e',
    script,
  ])
  return text.trim()
}

// ---------------------------------------------------------------------------
// DisplayAPI
// ---------------------------------------------------------------------------

export const display: DisplayAPI = {
  getSize(displayId?: number): DisplayGeometry {
    const all = this.listAll()
    if (displayId !== undefined) {
      const found = all.find(d => d.displayId === displayId)
      if (found) return found
    }
    return all[0] ?? { width: 1920, height: 1080, scaleFactor: 2, displayId: 1 }
  },

  listAll(): DisplayGeometry[] {
    try {
      const raw = jxaSync(`
        ObjC.import("CoreGraphics");
        var displays = $.CGDisplayCopyAllDisplayModes ? [] : [];
        var active = $.CGGetActiveDisplayList(10, null, Ref());
        var countRef = Ref();
        $.CGGetActiveDisplayList(0, null, countRef);
        var count = countRef[0];
        var idBuf = Ref();
        $.CGGetActiveDisplayList(count, idBuf, countRef);
        var result = [];
        for (var i = 0; i < count; i++) {
          var did = idBuf[i];
          var w = $.CGDisplayPixelsWide(did);
          var h = $.CGDisplayPixelsHigh(did);
          var mode = $.CGDisplayCopyDisplayMode(did);
          var pw = $.CGDisplayModeGetPixelWidth(mode);
          var sf = pw > 0 && w > 0 ? pw / w : 2;
          result.push({width: w, height: h, scaleFactor: sf, displayId: did});
        }
        JSON.stringify(result);
      `)
      return (JSON.parse(raw) as DisplayGeometry[]).map(d => ({
        width: Number(d.width),
        height: Number(d.height),
        scaleFactor: Number(d.scaleFactor),
        displayId: Number(d.displayId),
      }))
    } catch {
      try {
        const raw = jxaSync(`
          ObjC.import("AppKit");
          var screens = $.NSScreen.screens;
          var result = [];
          for (var i = 0; i < screens.count; i++) {
            var s = screens.objectAtIndex(i);
            var frame = s.frame;
            var desc = s.deviceDescription;
            var screenNumber = desc.objectForKey($("NSScreenNumber")).intValue;
            var backingFactor = s.backingScaleFactor;
            result.push({
              width: Math.round(frame.size.width),
              height: Math.round(frame.size.height),
              scaleFactor: backingFactor,
              displayId: screenNumber
            });
          }
          JSON.stringify(result);
        `)
        return (JSON.parse(raw) as DisplayGeometry[]).map(d => ({
          width: Number(d.width),
          height: Number(d.height),
          scaleFactor: Number(d.scaleFactor),
          displayId: Number(d.displayId),
        }))
      } catch {
        return [{ width: 1920, height: 1080, scaleFactor: 2, displayId: 1 }]
      }
    }
  },
}

// ---------------------------------------------------------------------------
// AppsAPI
// ---------------------------------------------------------------------------

export const apps: AppsAPI = {
  async prepareDisplay(_allowlistBundleIds, _surrogateHost, _displayId) {
    return { activated: '', hidden: [] }
  },

  async previewHideSet(_bundleIds, _displayId) {
    return []
  },

  async findWindowDisplays(bundleIds) {
    return bundleIds.map(bundleId => ({ bundleId, displayIds: [1] }))
  },

  async appUnderPoint(_x, _y) {
    try {
      const result = await jxa(`
        ObjC.import("CoreGraphics");
        ObjC.import("AppKit");
        var pt = $.CGPointMake(${_x}, ${_y});
        var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
        JSON.stringify({bundleId: app.bundleIdentifier.js, displayName: app.localizedName.js});
      `)
      return JSON.parse(result)
    } catch {
      return null
    }
  },

  async listInstalled() {
    try {
      // Use fs.readdir + mdls directly (no shell interpolation) to enumerate
      // apps and read real bundle identifiers (e.g. com.google.Chrome).
      const dirs = ['/Applications', '~/Applications', '/System/Applications']
      const allApps: InstalledApp[] = []
      const candidates: Array<{ appPath: string; displayName: string }> = []
      const home = process.env.HOME || homedir()
      for (const dir of dirs) {
        const expanded = dir.startsWith('~') ? join(home, dir.slice(1)) : dir
        let entries: import('node:fs').Dirent[]
        try {
          entries = await readdir(expanded, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of entries) {
          if (!entry.name.endsWith('.app')) continue
          const appPath = join(expanded, entry.name)
          let isDir = entry.isDirectory()
          if (!isDir && entry.isSymbolicLink()) {
            try {
              isDir = (await stat(appPath)).isDirectory()
            } catch {
              isDir = false
            }
          }
          if (!isDir) continue
          const displayName = entry.name.slice(0, -'.app'.length)
          if (displayName) {
            candidates.push({ appPath, displayName })
          }
        }
      }

      // Query mdls in bounded parallel batches so large /Applications folders
      // resolve quickly without spawning unbounded concurrent processes.
      const MDLS_CONCURRENCY = 16
      for (let i = 0; i < candidates.length; i += MDLS_CONCURRENCY) {
        const batch = candidates.slice(i, i + MDLS_CONCURRENCY)
        const batchResults = await Promise.all(
          batch.map(async ({ appPath, displayName }) => {
            try {
              const mdlsOut = await spawnCollectStdout('mdls', [
                '-name',
                'kMDItemCFBundleIdentifier',
                appPath,
              ])
              const match = mdlsOut.match(
                /kMDItemCFBundleIdentifier\s*=\s*"([^"]+)"/,
              )
              const bundleId = match?.[1]
              if (bundleId && bundleId !== '(null)') {
                return { bundleId, displayName, path: appPath }
              }
            } catch {
              // Skip unreadable app bundles
            }
            return null
          }),
        )
        for (const app of batchResults) {
          if (app) allApps.push(app)
        }
      }
      // Deduplicate by bundleId (prefer /Applications over ~/Applications)
      const seen = new Set<string>()
      return allApps.filter(app => {
        if (seen.has(app.bundleId)) return false
        seen.add(app.bundleId)
        return true
      })
    } catch {
      return []
    }
  },

  iconDataUrl(_path) {
    return null
  },

  listRunning() {
    try {
      const raw = jxaSync(`
        var apps = Application("System Events").applicationProcesses.whose({backgroundOnly: false});
        var result = [];
        for (var i = 0; i < apps.length; i++) {
          try {
            var a = apps[i];
            result.push({bundleId: a.bundleIdentifier(), displayName: a.name()});
          } catch(e) {}
        }
        JSON.stringify(result);
      `)
      return JSON.parse(raw)
    } catch {
      return []
    }
  },

  async open(bundleId) {
    await osascript(
      `on run argv
        tell application id (item 1 of argv) to activate
      end run`,
      [bundleId],
    )
  },

  async unhide(bundleIds) {
    for (const bundleId of bundleIds) {
      await osascript(
        `on run argv
          set targetBundleId to item 1 of argv
          tell application "System Events"
            set visible of application process (name of application process whose bundle identifier is targetBundleId) to true
          end tell
        end run`,
        [bundleId],
      )
    }
  },
}

// ---------------------------------------------------------------------------
// ScreenshotAPI
// ---------------------------------------------------------------------------

async function captureScreenToBase64(
  args: string[],
): Promise<{ base64: string; width: number; height: number }> {
  const tmpFile = join(tmpdir(), `cu-screenshot-${Date.now()}.png`)
  await spawnCollectStdout('screencapture', [...args, tmpFile])
  try {
    const buf = readFileSync(tmpFile)
    const base64 = buf.toString('base64')
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    return { base64, width, height }
  } finally {
    try {
      unlinkSync(tmpFile)
    } catch {}
  }
}

export const screenshot: ScreenshotAPI = {
  async captureExcluding(
    _allowedBundleIds,
    _quality,
    _targetW,
    _targetH,
    displayId,
  ) {
    const args = ['-x']
    if (displayId !== undefined) args.push('-D', String(displayId))
    return captureScreenToBase64(args)
  },

  async captureRegion(
    _allowedBundleIds,
    x,
    y,
    w,
    h,
    _outW,
    _outH,
    _quality,
    displayId,
  ) {
    const args = ['-x', '-R', `${x},${y},${w},${h}`]
    if (displayId !== undefined) args.push('-D', String(displayId))
    return captureScreenToBase64(args)
  },

  captureWindowTarget(_titleOrHwnd: string | number): ScreenshotResult | null {
    // Window capture not supported on macOS via this backend
    return null
  },
}
