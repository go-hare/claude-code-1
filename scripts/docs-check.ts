#!/usr/bin/env bun
/**
 * 文档站体检。防止 docs/ 再次腐烂成和代码脱节的状态。
 *
 * 检查四件事：
 *  1. docs.json 导航引用的页面文件都存在
 *  2. 已发布页面里的 `代码路径` 引用都能解析到真实文件
 *  3. `路径:行号` 形式的引用行号没有越界
 *  4. 哪些文档文件不在导航里（孤儿页，仅提示不算失败）
 *
 * 用法:
 *   bun scripts/docs-check.ts            # 人读的报告
 *   bun scripts/docs-check.ts --quiet    # 只在有问题时输出
 *
 * 退出码非 0 表示 1–3 里有失败项。
 */
import { existsSync, readdirSync } from 'node:fs'

/** 冻结归档：不该跟随代码演进而改写。 */
const ARCHIVE_DIRS = new Set(['upstream-extraction', 'superpowers'])
const ASSET_DIRS = new Set(['images', 'logo', 'diagrams'])

/**
 * 有意提及"已不存在"的路径。这类引用是正文论点本身（"这个文件已被删除"），
 * 改写反而会让句子变错，所以从失效判定里豁免。
 */
const KNOWN_ABSENT = new Map([
  [
    'scripts/health-check.ts',
    'package.json 的 `bun run health` 指向缺失文件，build-system 页在记录这个坑',
  ],
  ['scripts/production-test.ts', '同上，`bun run test:production` 系列缺失'],
  [
    'src/migrations/migrateAutoUpdatesToSettings.ts',
    '已删除，逻辑并入 config.ts；auto-updater 页在说明这次搬迁',
  ],
  ['src/commands/ultraplan', '早期文档误记的空目录，ultraplan 页在证伪它'],
])

const quiet = process.argv.includes('--quiet')
const out: string[] = []
const log = (line = '') => out.push(line)

// ── 1. 导航完整性 ────────────────────────────────────────────────
const config = await Bun.file('docs.json').json()
const navPages: string[] = []
function collectPages(group: { pages?: unknown[] }) {
  for (const page of group.pages ?? []) {
    if (typeof page === 'string') navPages.push(page)
    else collectPages(page as { pages?: unknown[] })
  }
}
for (const group of config.navigation.groups) collectPages(group)

const resolvePage = (page: string) =>
  ['.mdx', '.md'].map(ext => page + ext).find(existsSync)

const missingPages = navPages.filter(page => !resolvePage(page))

// ── 收集文件 ────────────────────────────────────────────────────
// 引用检查只针对「已发布」页面。未收录进导航的文档多是带日期的审计稿、任务规格和
// 设计计划——和 upstream-extraction/ 一样属于历史记录，不该跟着代码漂移。
const docFiles: string[] = []
function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (!ARCHIVE_DIRS.has(entry.name) && !ASSET_DIRS.has(entry.name))
        walk(path)
    } else if (/\.mdx?$/.test(entry.name)) {
      docFiles.push(path)
    }
  }
}
walk('docs')

const publishedFiles = navPages
  .map(resolvePage)
  .filter((f): f is string => Boolean(f))

// ── 2 & 3. 路径与行号引用 ───────────────────────────────────────
const PATH_REF =
  /`((?:src|packages|scripts|tests|vendor)\/[A-Za-z0-9_@./-]*?)(?::(\d+)(?:-\d+)?)?`/g

const deadPaths = new Map<string, Set<string>>()
const badLines: Array<{ ref: string; actual: number; file: string }> = []
let refCount = 0

for (const file of publishedFiles) {
  const text = await Bun.file(file).text()
  for (const match of text.matchAll(PATH_REF)) {
    refCount++
    const path = match[1].replace(/\/$/, '')
    const line = match[2]
    if (!existsSync(path)) {
      if (KNOWN_ABSENT.has(path)) continue
      if (!deadPaths.has(path)) deadPaths.set(path, new Set())
      deadPaths.get(path)?.add(file)
      continue
    }
    if (!line) continue
    const contents = await Bun.file(path)
      .text()
      .catch(() => null)
    if (contents === null) continue // 目录带行号，跳过
    const total = contents.split('\n').length
    if (Number(line) > total)
      badLines.push({ ref: `${path}:${line}`, actual: total, file })
  }
}

// ── 4. 孤儿页 ───────────────────────────────────────────────────
const navSet = new Set(navPages)
const orphans = docFiles.filter(f => !navSet.has(f.replace(/\.mdx?$/, '')))

// ── 报告 ────────────────────────────────────────────────────────
const failures = missingPages.length + deadPaths.size + badLines.length

log(
  `文档体检 — 导航 ${navPages.length} 页 · 已发布页引用 ${refCount} 处 · ` +
    `豁免 ${KNOWN_ABSENT.size} 条已知缺失`,
)
log()

log(`[1] 导航引用的缺失页面: ${missingPages.length}`)
for (const page of missingPages) log(`      ✗ ${page}`)

log(`[2] 解析不到的代码路径: ${deadPaths.size}`)
for (const [path, files] of [...deadPaths].sort()) {
  log(`      ✗ ${path}`)
  for (const file of files) log(`          ← ${file}`)
}

log(`[3] 越界的行号引用: ${badLines.length}`)
for (const { ref, actual, file } of badLines) {
  log(`      ✗ ${ref} (该文件仅 ${actual} 行) ← ${file}`)
}

log(`[4] 未收录进导航的文档: ${orphans.length}（不计为失败）`)
if (!quiet) for (const file of orphans) log(`      ○ ${file}`)

log()
log(failures === 0 ? '通过：无失效引用。' : `失败：${failures} 项需要修复。`)

if (!quiet || failures > 0) console.log(out.join('\n'))
process.exit(failures > 0 ? 1 : 0)
