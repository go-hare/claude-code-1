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
 *   bun run scripts/publish.ts --main-only        # publish only the main package (staging)
 *   bun run scripts/publish.ts --dry-run          # npm publish --dry-run
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join, resolve } from 'path'
import { DEFAULT_BUILD_FEATURES, getMacroDefines } from './defines.ts'

const ROOT = resolve(import.meta.dir, '..')

const args = process.argv.slice(2)
const buildOnly = args.includes('--build-only')
const publishOnly = args.includes('--publish-only')
const dryRun = args.includes('--dry-run')
const withMain = args.includes('--with-main')
const mainOnly = args.includes('--main-only')
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
    ripgrepDir: 'x64-win32',
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

  const destDir = join(ROOT, info.pkgDir, 'vendor', 'ripgrep', ripgrepDir)
  const dest = join(destDir, binaryName)
  const sourceCandidates = [
    join(ROOT, 'vendor', 'ripgrep', ripgrepDir, binaryName),
    join(ROOT, 'src', 'utils', 'vendor', 'ripgrep', ripgrepDir, binaryName),
    dest,
  ]
  const src = sourceCandidates.find(candidate => existsSync(candidate))
  if (!src) {
    console.warn(
      `Vendored ripgrep not found for ${platformKey}: ${sourceCandidates.join(', ')}`,
    )
    return
  }

  if (resolve(src) === resolve(dest)) {
    console.log(`Vendored ripgrep already present at ${dest}`)
    return
  }

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

/**
 * Fields that belong only to the monorepo workspace root.
 * Shipping them on the npm tarball confuses arborist (workspace/link
 * resolution) and can crash installs with:
 *   TypeError: Cannot read properties of null (reading 'edgesOut')
 */
const MAIN_PKG_STRIP_FIELDS = [
  'workspaces',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'overrides',
  'resolutions',
  'packageManager',
] as const

/**
 * Scripts that only make sense in the monorepo checkout.
 * Keep postinstall (binary placement) for consumers.
 */
const MAIN_PKG_STRIP_SCRIPTS = [
  'build',
  'build:vite',
  'build:vite:only',
  'build:bun',
  'build:compile',
  'dev',
  'dev:inspect',
  'prepublishOnly',
  'lint',
  'lint:fix',
  'format',
  'check',
  'check:fix',
  'prepare',
  'test',
  'test:production',
  'test:production:offline',
  'test:production:verbose',
  'test:production:bun',
  'check:bundle',
  'check:unused',
  'health',
  'docs:dev',
  'typecheck',
  'precheck',
  'rcs',
] as const

/**
 * Publish the monorepo root as a clean consumer package.
 *
 * Must NOT run `npm publish` from the live monorepo root: even with a
 * temporarily rewritten package.json, arborist/npm may still see workspace
 * state and ship monorepo fields (observed on 2.7.3: workspaces still on
 * registry after in-place strip + bare `npm publish`). Always stage a
 * throwaway directory with only consumer files.
 */
function publishMainPackage(): void {
  const dryRunFlag = dryRun ? ['--dry-run'] : []
  const staging = join(ROOT, '.publish-main-staging')
  console.log(
    `\nPublishing main package from staging${dryRun ? ' (dry-run)' : ''}...`,
  )

  rmSync(staging, { recursive: true, force: true })
  mkdirSync(join(staging, 'bin'), { recursive: true })

  try {
    const original = readFileSync(join(ROOT, 'package.json'), 'utf8')
    const pkg = JSON.parse(original) as Record<string, unknown>

    for (const key of MAIN_PKG_STRIP_FIELDS) {
      delete pkg[key]
    }

    if (pkg.scripts && typeof pkg.scripts === 'object') {
      const scripts = { ...(pkg.scripts as Record<string, string>) }
      for (const name of MAIN_PKG_STRIP_SCRIPTS) {
        delete scripts[name]
      }
      // Consumer postinstall only — never husky/prepublish monorepo hooks.
      pkg.scripts = {
        postinstall: scripts.postinstall ?? 'node install.cjs',
      }
    }

    pkg.files = [
      'bin/claude.exe',
      'install.cjs',
      'cli-wrapper.cjs',
      'README.md',
    ]

    if (pkg.workspaces) {
      console.error(
        'Internal error: staged main package.json still has workspaces',
      )
      process.exit(1)
    }

    writeFileSync(
      join(staging, 'package.json'),
      `${JSON.stringify(pkg, null, 2)}\n`,
    )

    for (const rel of [
      'install.cjs',
      'cli-wrapper.cjs',
      'README.md',
    ] as const) {
      const src = join(ROOT, rel)
      if (!existsSync(src)) {
        console.error(`Missing ${rel} for main package publish`)
        process.exit(1)
      }
      copyFileSync(src, join(staging, rel))
    }

    // Keep the tiny bin stub that npm uses as the package bin entry; real
    // native binary is placed by postinstall from optionalDependencies.
    const binStub = join(ROOT, 'bin', 'claude.exe')
    if (!existsSync(binStub)) {
      console.error('Missing bin/claude.exe stub for main package publish')
      process.exit(1)
    }
    copyFileSync(binStub, join(staging, 'bin', 'claude.exe'))

    const result = Bun.spawnSync(
      ['npm', 'publish', '--access', 'public', ...dryRunFlag],
      { cwd: staging, stdio: ['inherit', 'inherit', 'inherit'] },
    )

    if (result.exitCode !== 0) {
      console.error('Publish failed for main @go-hare/claude-code')
      process.exit(1)
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function publishPkg(pkgDir: string): void {
  if (resolve(pkgDir) === resolve(ROOT)) {
    publishMainPackage()
    return
  }

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
  if (mainOnly) {
    if (buildOnly) {
      console.error('--main-only cannot be combined with --build-only')
      process.exit(1)
    }
    publishMainPackage()
    console.log('\nDone.')
    return
  }

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
