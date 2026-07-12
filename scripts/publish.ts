#!/usr/bin/env bun
/**
 * Publish script — builds and publishes @go-hare/claude-code packages.
 *
 * Usage:
 *   bun run scripts/publish.ts                    # build current platform + publish platform pkg
 *   bun run scripts/publish.ts --build-only       # build binary only (no publish)
 *   bun run scripts/publish.ts --publish-only     # publish pre-built packages
 *   bun run scripts/publish.ts --platform darwin-arm64  # target specific platform
 *   bun run scripts/publish.ts --with-main        # also publish the main @go-hare/claude-code pkg
 *   bun run scripts/publish.ts --dry-run          # npm publish --dry-run
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { DEFAULT_BUILD_FEATURES, getMacroDefines } from './defines.ts'

const ROOT = resolve(import.meta.dir, '..')

const args = process.argv.slice(2)
const buildOnly = args.includes('--build-only')
const publishOnly = args.includes('--publish-only')
const dryRun = args.includes('--dry-run')
const withMain = args.includes('--with-main')
const platformIdx = args.indexOf('--platform')
const platformArg =
  platformIdx >= 0 ? args[platformIdx + 1] : process.env.TARGET_PLATFORM

interface PlatformInfo {
  bunTarget: string
  binaryName: string
  pkgDir: string
  ripgrepDir?: string
}

const PLATFORMS: Record<string, PlatformInfo> = {
  'darwin-arm64': {
    bunTarget: 'bun-darwin-arm64',
    binaryName: 'claude',
    pkgDir: 'packages/@go-hare/claude-code-darwin-arm64',
    ripgrepDir: 'arm64-darwin',
  },
  'darwin-x64': {
    bunTarget: 'bun-darwin-x64',
    binaryName: 'claude',
    pkgDir: 'packages/@go-hare/claude-code-darwin-x64',
  },
  'linux-x64': {
    bunTarget: 'bun-linux-x64',
    binaryName: 'claude',
    pkgDir: 'packages/@go-hare/claude-code-linux-x64',
  },
  'linux-arm64': {
    bunTarget: 'bun-linux-arm64',
    binaryName: 'claude',
    pkgDir: 'packages/@go-hare/claude-code-linux-arm64',
  },
  'linux-x64-musl': {
    bunTarget: 'bun-linux-x64',
    binaryName: 'claude',
    pkgDir: 'packages/@go-hare/claude-code-linux-x64-musl',
  },
  'linux-arm64-musl': {
    bunTarget: 'bun-linux-arm64',
    binaryName: 'claude',
    pkgDir: 'packages/@go-hare/claude-code-linux-arm64-musl',
  },
  'win32-x64': {
    bunTarget: 'bun-windows-x64',
    binaryName: 'claude.exe',
    pkgDir: 'packages/@go-hare/claude-code-win32-x64',
  },
  'win32-arm64': {
    bunTarget: 'bun-windows-arm64',
    binaryName: 'claude.exe',
    pkgDir: 'packages/@go-hare/claude-code-win32-arm64',
  },
}

function getCurrentPlatform(): string {
  return `${process.platform}-${process.arch}`
}

function buildBinary(platformKey: string): string {
  const info = PLATFORMS[platformKey]
  if (!info) {
    console.error(`Unknown platform: ${platformKey}`)
    console.error(`Supported: ${Object.keys(PLATFORMS).join(', ')}`)
    process.exit(1)
  }

  const outdir = 'dist'
  rmSync(outdir, { recursive: true, force: true })
  mkdirSync(outdir, { recursive: true })

  const envFeatures = Object.keys(process.env)
    .filter(k => k.startsWith('FEATURE_'))
    .map(k => k.replace('FEATURE_', ''))
  const features = [...new Set([...DEFAULT_BUILD_FEATURES, ...envFeatures])]

  const defines = getMacroDefines()
  const defineArgs = Object.entries(defines).flatMap(([k, v]) => [
    '-d',
    `${k}:${v}`,
  ])
  const featureArgs = features.flatMap(name => ['--feature', name])

  const outFile = join(outdir, info.binaryName)
  const isCurrentPlatform = platformKey === getCurrentPlatform()
  const targetArgs = isCurrentPlatform ? [] : ['--target', info.bunTarget]
  const executablePathArgs = process.env.BUN_COMPILE_EXECUTABLE_PATH
    ? ['--compile-executable-path', process.env.BUN_COMPILE_EXECUTABLE_PATH]
    : []

  console.log(`\nBuilding for ${platformKey} (target: ${info.bunTarget})...`)
  const result = Bun.spawnSync(
    [
      'bun',
      'build',
      'src/entrypoints/cli.tsx',
      '--compile',
      '--outfile',
      outFile,
      ...targetArgs,
      ...executablePathArgs,
      ...defineArgs,
      ...featureArgs,
    ],
    { stdio: ['inherit', 'inherit', 'inherit'] },
  )

  if (result.exitCode !== 0) {
    console.error(`Compile failed for ${platformKey}`)
    process.exit(1)
  }

  console.log(`Compiled: ${outFile}`)
  return outFile
}

function copyToPlatformPkg(binaryPath: string, platformKey: string): void {
  const info = PLATFORMS[platformKey]
  const pkgDir = join(ROOT, info.pkgDir)
  const dest = join(pkgDir, info.binaryName)

  if (!existsSync(pkgDir)) {
    console.error(`Platform package dir not found: ${pkgDir}`)
    process.exit(1)
  }

  copyFileSync(binaryPath, dest)
  console.log(`Copied binary to ${dest}`)
}

function copyRipgrepToPlatformPkg(platformKey: string): void {
  const info = PLATFORMS[platformKey]
  const binaryName = platformKey.startsWith('win32') ? 'rg.exe' : 'rg'
  const ripgrepDir = info.ripgrepDir

  if (!ripgrepDir) {
    console.warn(`No vendored ripgrep configured for ${platformKey}, skipping.`)
    return
  }

  const src = join(
    ROOT,
    'src',
    'utils',
    'vendor',
    'ripgrep',
    ripgrepDir,
    binaryName,
  )
  if (!existsSync(src)) {
    console.warn(`Vendored ripgrep not found at ${src}, skipping.`)
    return
  }

  const destDir = join(ROOT, info.pkgDir, 'vendor', 'ripgrep', ripgrepDir)
  const dest = join(destDir, binaryName)
  mkdirSync(destDir, { recursive: true })
  copyFileSync(src, dest)
  if (!platformKey.startsWith('win32')) chmodSync(dest, 0o755)
  console.log(`Copied ripgrep to ${dest}`)
}

function copyClipboardImageToPlatformPkg(platformKey: string): void {
  // Only arm64 macOS has a vendored NSPasteboard helper today.
  if (platformKey !== 'darwin-arm64') return

  const info = PLATFORMS[platformKey]
  const binaryName = 'arm64-darwin'
  const src = join(ROOT, 'vendor', 'clipboard-image', binaryName)
  if (!existsSync(src)) {
    console.warn(`Vendored clipboard-image not found at ${src}, skipping.`)
    return
  }

  const destDir = join(ROOT, info.pkgDir, 'vendor', 'clipboard-image')
  const dest = join(destDir, binaryName)
  mkdirSync(destDir, { recursive: true })
  copyFileSync(src, dest)
  chmodSync(dest, 0o755)
  console.log(`Copied clipboard-image to ${dest}`)
}

function publishPkg(pkgDir: string): void {
  const dryRunFlag = dryRun ? ['--dry-run'] : []
  console.log(`\nPublishing ${pkgDir}${dryRun ? ' (dry-run)' : ''}...`)

  const result = Bun.spawnSync(
    ['npm', 'publish', '--access', 'public', ...dryRunFlag],
    { cwd: pkgDir, stdio: ['inherit', 'inherit', 'inherit'] },
  )

  if (result.exitCode !== 0) {
    console.error(`Publish failed for ${pkgDir}`)
    process.exit(1)
  }
}

function main() {
  const targetPlatform = platformArg || getCurrentPlatform()

  if (!publishOnly) {
    const binaryPath = buildBinary(targetPlatform)
    copyToPlatformPkg(binaryPath, targetPlatform)
    copyRipgrepToPlatformPkg(targetPlatform)
    copyClipboardImageToPlatformPkg(targetPlatform)
    console.log(`\nBuild complete for ${targetPlatform}.`)
  }

  if (!buildOnly) {
    const info = PLATFORMS[targetPlatform]
    if (!info) {
      console.error(`Unknown platform: ${targetPlatform}`)
      process.exit(1)
    }
    publishPkg(join(ROOT, info.pkgDir))

    if (withMain) {
      publishPkg(ROOT)
    }
  }

  console.log('\nDone.')
}

main()
