#!/usr/bin/env bun
/**
 * 构建产物完整性检查脚本
 *
 * 检查 Bun.build({ splitting: true }) 输出的 dist/ 目录中是否存在：
 * 1. 引用了不存在的 chunk 文件（断链）
 * 2. 通过 __require() 或 import() 引用的第三方模块（非 Node.js 内置），在生产环境中会找不到
 * 3. 缺失的静态 import 依赖（跨 chunk 引用目标不存在）
 *
 * 用法：
 *   bun scripts/check-bundle-integrity.ts          # 检查当前 dist/
 *   bun scripts/check-bundle-integrity.ts ./dist    # 指定目录
 */

import { readdir, readFile } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ─── 从 package.json 读取 dependencies 作为白名单 ────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  await readFile(join(__dirname, '..', 'package.json'), 'utf-8'),
)
const PKG_DEPS = new Set(Object.keys(pkg.dependencies ?? {}))

// ─── Node.js 内置模块白名单（显式固定列表；勿使用 Bun 运行时的 node:module builtinModules，因为 Bun 会混入 ws / undici） ──
const NODE_BUILTINS = new Set([
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_stream_duplex',
  '_stream_passthrough',
  '_stream_readable',
  '_stream_transform',
  '_stream_wrap',
  '_stream_writable',
  '_tls_common',
  '_tls_wrap',
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
  'node:sea',
  'node:sqlite',
  'node:test',
])

function isNodeBuiltin(mod: string): boolean {
  if (NODE_BUILTINS.has(mod)) return true
  if (mod.startsWith('node:')) {
    return NODE_BUILTINS.has(mod.slice(5))
  }
  return false
}

// Bun 专用模块（仅在 Bun 运行时可用，Node.js 环境会失败）
const BUN_MODULES = new Set([
  'bun',
  'bun:ffi',
  'bun:jsc',
  'bun:sqlite',
  'bun:test',
  'bun:wrap',
])

function isBunOnlyModule(mod: string): boolean {
  return BUN_MODULES.has(mod) || mod.startsWith('bun:')
}

// macOS JXA / native 框架（通过 ObjC.import，非真正的 require）
const NATIVE_FRAMEWORKS = new Set([
  'AppKit',
  'CoreGraphics',
  'Foundation',
  'UIKit',
])

// ─── 模式 ──────────────────────────────────────────────────────────
// 匹配 import { ... } from "./chunk-xxxxx.js" 或 import"./chunk-xxxxx.js"
const STATIC_IMPORT_RE = /(?:from\s+|import\s+)"(\.\/[^"]+\.js)"/g
// 匹配 __require("xxx")
const REQUIRE_RE = /__require\("([^"]+)"\)/g
// 匹配动态 import("xxx")，排除 ./chunk-xxx.js 的内部引用
const DYNAMIC_IMPORT_RE = /import\("([^"]+)"\)/g
// 匹配 createRequire(...) 绑定的别名（如 var require2 = createRequire(import.meta.url)、req = createRequire(...)、nodeRequire = createRequire(...)）
const CREATE_REQUIRE_ALIAS_DEF_RE =
  /\b([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$]+\.)?createRequire\s*\(/g

function buildNodeRequireRe(content: string): RegExp {
  const aliases = new Set<string>(['nodeRequire'])
  for (const m of content.matchAll(CREATE_REQUIRE_ALIAS_DEF_RE)) {
    if (m[1]) aliases.add(m[1])
  }
  const escaped = [...aliases].map(a =>
    a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  )
  return new RegExp(
    `\\b(?:${escaped.join('|')})\\(\\s*["']([^"']+)["']\\s*\\)`,
    'g',
  )
}

function findImportLine(lines: string[], mod: string): number {
  const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:from\\s+|import\\s+)["']${escaped}["']`)
  for (let idx = 0; idx < lines.length; idx++) {
    if (re.test(lines[idx]!)) return idx + 1
  }
  return 1
}

interface Finding {
  type:
    | 'broken-chunk-ref'
    | 'third-party-require'
    | 'third-party-import'
    | 'third-party-static-import'
    | 'third-party-node-require'
    | 'optional-native-import'
    | 'bun-runtime-only'
  severity: 'error' | 'warning'
  file: string
  line: number
  module: string
  snippet: string
}

async function main() {
  const distDir = resolve(process.argv[2] || './dist')

  console.log(`\n🔍 检查构建产物完整性: ${distDir}\n`)

  // 1. 列出所有 chunk 文件
  let files: string[]
  try {
    files = (await readdir(distDir)).filter(f => f.endsWith('.js'))
  } catch {
    console.error(`❌ 无法读取目录: ${distDir}`)
    console.error('   请先运行 bun run build')
    process.exit(1)
  }

  const fileSet = new Set(files)
  console.log(`📦 找到 ${files.length} 个 JS 文件\n`)

  const findings: Finding[] = []

  const transpiler = new Bun.Transpiler({ loader: 'js' })
  // 2. 逐文件扫描
  for (const file of files) {
    const filePath = join(distDir, file)
    const content = await readFile(filePath, 'utf-8')
    const lines = content.split('\n')
    const nodeRequireRe = buildNodeRequireRe(content)
    for (const dependency of transpiler.scanImports(
      content.replace(/^#![^\r\n]*/, ''),
    )) {
      if (dependency.kind !== 'import-statement') continue
      const mod = dependency.path
      if (mod.startsWith('.') || isNodeBuiltin(mod) || PKG_DEPS.has(mod)) {
        continue
      }
      const bunOnly = isBunOnlyModule(mod)
      findings.push({
        type: bunOnly ? 'bun-runtime-only' : 'third-party-static-import',
        severity: bunOnly ? 'warning' : 'error',
        file,
        line: findImportLine(lines, mod),
        module: mod,
        snippet: mod,
      })
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNum = i + 1

      // 2a. 检查静态 chunk 引用是否断链
      const staticImportMatches = line.matchAll(STATIC_IMPORT_RE)
      for (const m of staticImportMatches) {
        const ref = m[1]
        // 提取文件名部分（去掉 ./）
        const refFile = ref.replace(/^\.\//, '')
        if (!fileSet.has(refFile)) {
          findings.push({
            type: 'broken-chunk-ref',
            severity: 'error',
            file,
            line: lineNum,
            module: ref,
            snippet: line.trim().slice(0, 120),
          })
        }
      }

      // 2b. 检查 __require 中的第三方模块
      const requireMatches = line.matchAll(REQUIRE_RE)
      for (const m of requireMatches) {
        const mod = m[1]
        // 跳过 ObjC.import（JXA 语法，不是真正的 require）
        if (NATIVE_FRAMEWORKS.has(mod)) continue
        if (isNodeBuiltin(mod) || PKG_DEPS.has(mod)) continue
        if (isBunOnlyModule(mod)) {
          findings.push({
            type: 'bun-runtime-only',
            severity: 'warning',
            file,
            line: lineNum,
            module: mod,
            snippet: line.trim().slice(0, 120),
          })
          continue
        }
        // 第三方模块 — 在生产环境（全局 npm install）中找不到
        findings.push({
          type: 'third-party-require',
          severity: 'error',
          file,
          line: lineNum,
          module: mod,
          snippet: line.trim().slice(0, 120),
        })
      }

      // 2c. 检查动态 import() 中的第三方模块
      const dynImportMatches = line.matchAll(DYNAMIC_IMPORT_RE)
      for (const m of dynImportMatches) {
        const mod = m[1]
        // 跳过内部 chunk 引用和相对路径
        if (mod.startsWith('./') || mod.startsWith('../')) continue
        // 跳过 ObjC.import
        if (NATIVE_FRAMEWORKS.has(mod)) continue
        if (isNodeBuiltin(mod) || PKG_DEPS.has(mod)) continue
        if (isBunOnlyModule(mod)) {
          // bun:test 等只在 Bun 运行时可用，Node.js 运行时会失败
          findings.push({
            type: 'bun-runtime-only',
            severity: 'warning',
            file,
            line: lineNum,
            module: mod,
            snippet: line.trim().slice(0, 120),
          })
          continue
        }
        // keychain.ts catches this optional addon and uses encrypted file storage.
        if (mod === '@napi-rs/keyring') {
          findings.push({
            type: 'optional-native-import',
            severity: 'warning',
            file,
            line: lineNum,
            module: mod,
            snippet: line.trim().slice(0, 120),
          })
          continue
        }
        // 第三方动态 import
        findings.push({
          type: 'third-party-import',
          severity: 'error',
          file,
          line: lineNum,
          module: mod,
          snippet: line.trim().slice(0, 120),
        })
      }

      // 2d. 检查 createRequire 绑定的别名（如 nodeRequire / require2 / req）中的第三方模块
      const nodeRequireMatches = line.matchAll(nodeRequireRe)
      for (const m of nodeRequireMatches) {
        const mod = m[1]
        if (NATIVE_FRAMEWORKS.has(mod)) continue
        if (isNodeBuiltin(mod) || PKG_DEPS.has(mod)) continue
        if (isBunOnlyModule(mod)) {
          findings.push({
            type: 'bun-runtime-only',
            severity: 'warning',
            file,
            line: lineNum,
            module: mod,
            snippet: line.trim().slice(0, 120),
          })
          continue
        }
        findings.push({
          type: 'third-party-node-require',
          severity: 'error',
          file,
          line: lineNum,
          module: mod,
          snippet: line.trim().slice(0, 120),
        })
      }
    }
  }

  // 3. 汇总报告
  const errors = findings.filter(f => f.severity === 'error')
  const warnings = findings.filter(f => f.severity === 'warning')

  // 按 type 分组
  const brokenRefs = errors.filter(f => f.type === 'broken-chunk-ref')
  const thirdPartyRequires = errors.filter(
    f => f.type === 'third-party-require',
  )
  const thirdPartyImports = errors.filter(f => f.type === 'third-party-import')
  const thirdPartyNodeRequires = errors.filter(
    f => f.type === 'third-party-node-require',
  )
  const bunRuntimeOnly = warnings.filter(f => f.type === 'bun-runtime-only')

  if (brokenRefs.length > 0) {
    console.log('❌ 断裂的 chunk 引用（引用了不存在的文件）:')
    for (const f of brokenRefs) {
      console.log(`   ${f.file}:${f.line} → ${f.module}`)
    }
    console.log()
  }

  if (thirdPartyRequires.length > 0) {
    console.log('❌ 通过 __require() 引用的第三方模块（生产环境会找不到）:')
    const grouped = groupByModule(thirdPartyRequires)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — 出现 ${items.length} 次:`)
      for (const f of items.slice(0, 5)) {
        console.log(`     ${f.file}:${f.line}`)
      }
      if (items.length > 5) console.log(`     ... 还有 ${items.length - 5} 处`)
    }
    console.log()
  }

  for (const finding of errors.filter(
    f => f.type === 'third-party-static-import',
  )) {
    console.log(
      `Unbundled static import "${finding.module}" (${finding.file}:${finding.line}).`,
    )
  }

  if (thirdPartyImports.length > 0) {
    console.log('❌ 通过 import() 动态引用的第三方模块（生产环境会找不到）:')
    const grouped = groupByModule(thirdPartyImports)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — 出现 ${items.length} 次:`)
      for (const f of items.slice(0, 5)) {
        console.log(`     ${f.file}:${f.line}`)
      }
      if (items.length > 5) console.log(`     ... 还有 ${items.length - 5} 处`)
    }
    console.log()
  }

  if (thirdPartyNodeRequires.length > 0) {
    console.log(
      '❌ 通过 nodeRequire() 引用的第三方模块（绕过打包，生产环境会找不到）:',
    )
    const grouped = groupByModule(thirdPartyNodeRequires)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — 出现 ${items.length} 次:`)
      for (const f of items.slice(0, 5)) {
        console.log(`     ${f.file}:${f.line}`)
      }
      if (items.length > 5) console.log(`     ... 还有 ${items.length - 5} 处`)
    }
    console.log()
  }

  if (bunRuntimeOnly.length > 0) {
    console.log('⚠️  Bun 运行时专用模块（Node.js 环境会失败）:')
    const grouped = groupByModule(bunRuntimeOnly)
    for (const [mod, items] of grouped) {
      console.log(`   "${mod}" — 出现 ${items.length} 次`)
    }
    console.log()
  }

  for (const finding of warnings.filter(
    f => f.type === 'optional-native-import',
  )) {
    console.log(
      `Optional native dependency "${finding.module}" is not bundled; the vault falls back to encrypted file storage (${finding.file}:${finding.line}).`,
    )
  }

  // 4. 总结
  console.log('─'.repeat(50))
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ 构建产物完整性检查通过，未发现问题。')
  } else {
    console.log(`📊 总计: ${errors.length} 个错误, ${warnings.length} 个警告`)
    if (errors.length > 0) {
      console.log(
        `\n💡 修复建议:
   - 第三方模块问题：在 build.ts 中通过 external 选项排除，或确保它们被正确打包到 chunk 中
   - 断链问题：检查 build 时是否有文件被意外删除或构建不完整
   - Bun 专用模块：确保运行时使用 bun 而非 node`,
      )
    }
  }

  process.exit(errors.length > 0 ? 1 : 0)
}

function groupByModule(items: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>()
  for (const item of items) {
    const list = map.get(item.module) || []
    list.push(item)
    map.set(item.module, list)
  }
  // 按出现次数降序
  return new Map([...map.entries()].sort((a, b) => b[1].length - a[1].length))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(2)
})
