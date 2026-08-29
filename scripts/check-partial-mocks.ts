#!/usr/bin/env bun
/**
 * 部分 mock 体检。防止测试套件再次被进程全局的 `mock.module` 污染。
 *
 * Bun 的 `mock.module` 是**进程全局**的（last-write-wins），不是 per-file 隔离。
 * 一个工厂如果返回的导出比真实模块少，同进程里任何 import 缺失导出的兄弟文件都会在
 * ESM link 阶段失败 —— bun 把它报成 "Unhandled error between tests"，那个文件的测试
 * 会**从总数里静默消失**，而不是显示为失败。即使导出齐全，被替换成假值也会让兄弟文件
 * 的断言错得莫名其妙。
 *
 * 本脚本找出所有「提供的导出少于真实导出」的 `mock.module` 工厂，并与 baseline 对比：
 *
 *   - 出现 baseline 之外的新条目 → 退出码 1（拦住新增污染）
 *   - baseline 里的条目已被修好 → 只提示，不失败（修东西的人不该被罚）
 *
 * 修法：`import * as realX from '...'` + `snapshotModuleExports`（见 tests/mocks/settings.ts），
 * 然后 `mock.module(spec, () => ({ ...realXSnap, 只覆盖需要的 }))`。
 * 加 spread 不会弄坏污染者自己的测试 —— 新暴露的那些导出此前对它就是 undefined，
 * 它的代码路径从来没成功用过。
 *
 * 用法:
 *   bun scripts/check-partial-mocks.ts            # 人读的报告
 *   bun scripts/check-partial-mocks.ts --quiet    # 只在有问题时输出
 *   bun scripts/check-partial-mocks.ts --update    # 把当前结果写回 baseline
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = process.cwd()
const BASELINE_PATH = join(ROOT, 'scripts', 'partial-mocks-baseline.json')
const SCAN_ROOTS = ['src', 'packages', 'tests']

const quiet = process.argv.includes('--quiet')
const update = process.argv.includes('--update')

type Finding = {
  /** 测试文件（仓库相对，正斜杠） */
  file: string
  /** 被 mock 的模块（仓库相对，正斜杠） */
  target: string
  /** 源码里写的 specifier，可能有多个写法指向同一模块 */
  specs: string[]
  provided: number
  real: number
  missing: string[]
}

// ── 收集测试文件 ──────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) {
      continue
    }
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

// ── 提取对象字面量的顶层键 ────────────────────────────────────────
/**
 * 从 `{` 开始扫到配对的 `}`，返回顶层键名。会跳过字符串/注释/嵌套结构。
 * 解析不出来（括号不配对等）返回 null —— 宁可漏报也不误报，因为这是构建闸门。
 */
function topLevelKeys(src: string, openBrace: number): string[] | null {
  const keys: string[] = []
  let depth = 0
  let atKeyPosition = true
  let quote: string | null = null

  for (let i = openBrace; i < src.length; i++) {
    const c = src[i]!

    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      if (nl === -1) return null
      i = nl
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i)
      if (end === -1) return null
      i = end + 1
      continue
    }

    if (c === '{' || c === '(' || c === '[') {
      depth++
      if (depth === 1) atKeyPosition = true
      continue
    }
    if (c === '}' || c === ')' || c === ']') {
      depth--
      if (depth === 0) return keys
      if (depth < 0) return null
      continue
    }
    if (depth !== 1) continue

    if (c === ',') {
      atKeyPosition = true
      continue
    }
    if (!atKeyPosition || /\s/.test(c)) continue

    if (c === '.') {
      // spread：认为覆盖了剩余导出面
      keys.push('...')
      atKeyPosition = false
      continue
    }
    const m = /^([A-Za-z_$][\w$]*)\s*[:,}]/.exec(src.slice(i))
    if (m?.[1]) {
      keys.push(m[1])
      i += m[1].length - 1
    }
    atKeyPosition = false
  }
  return null
}

// ── specifier → 文件路径 ──────────────────────────────────────────
function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec)
  } else if (SCAN_ROOTS.some(r => spec.startsWith(`${r}/`))) {
    base = resolve(ROOT, spec)
  } else {
    return null // bare module（bun:bundle / axios / ...）不在体检范围
  }

  const stripped = base.replace(/\.(js|ts|tsx)$/, '')
  for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.tsx']) {
    const p = stripped + ext
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  if (existsSync(base) && statSync(base).isFile()) return base
  return null
}

const realExportCache = new Map<string, string[] | null>()
async function realExports(path: string): Promise<string[] | null> {
  const cached = realExportCache.get(path)
  if (cached !== undefined) return cached
  let names: string[] | null = null
  try {
    const mod = (await import(path)) as Record<string, unknown>
    names = Object.keys(mod).filter(k => k !== 'default' && k !== '__esModule')
  } catch {
    // 真实模块 import 不起来（缺 build define、需要 mock 的副作用等）：跳过而非误报
    names = null
  }
  realExportCache.set(path, names)
  return names
}

const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/')

// ── 扫描 ──────────────────────────────────────────────────────────
const files = SCAN_ROOTS.flatMap(r =>
  existsSync(join(ROOT, r)) ? walk(join(ROOT, r)) : [],
)

/** key = `${file}\u0000${target}`，同一对多次 mock 只记最严重的一次 */
const byKey = new Map<string, Finding>()

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const namespaceImports = new Set(
    [...src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g)].map(
      m => m[1]!,
    ),
  )
  const snapshotted = new Set(
    [
      ...src.matchAll(
        /snapshot(?:ModuleExports|Exports)\(\s*([A-Za-z_$][\w$]*)\s*\)/g,
      ),
    ].map(m => m[1]!),
  )
  const re = /mock\.module\(\s*(['"])([^'"]+)\1\s*,/g
  let m: RegExpExecArray | null

  while ((m = re.exec(src))) {
    const spec = m[2]!
    const target = resolveSpec(spec, file)
    if (!target) continue

    const brace = src.indexOf('{', re.lastIndex)
    if (brace === -1) continue

    // 只认 `() => ({ ... })` 这种直接返回对象字面量的写法：
    //   - `mock.module(spec, sharedMockObject)` 不是字面量（tests/mocks 的共享 mock，合规）
    //   - `() => { return {...} }` 的第一个 `{` 是函数体，按对象字面量解析会得到零个键，
    //     那是假阳性，而这是构建闸门，不能误伤
    // 两个条件合起来正好区分：`{` 之前只能是空白/箭头/括号，且紧邻的必须是 `(`。
    const between = src.slice(re.lastIndex, brace).replace(/\basync\b/g, '')
    if (!/^[\s()=>]*$/.test(between)) continue
    if (!/\(\s*$/.test(between)) continue

    const keys = topLevelKeys(src, brace)
    if (!keys) continue
    if (keys.includes('...')) {
      // 有 spread，导出面够了 —— 但要确认 spread 的是快照而不是 live namespace。
      // `import * as realX` 的 binding 在 mock 注册后会指回 mock，直接 spread 它
      // 会把 override 折进"还原"里，等于永久留下假实现。
      const spread = /\{[\s\S]{0,600}?\}\s*\)/.exec(src.slice(brace))?.[0] ?? ''
      for (const s of spread.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) {
        const name = s[1]!
        if (!namespaceImports.has(name) || snapshotted.has(name)) continue
        const key = `${rel(file)}\u0000${rel(target)}`
        byKey.set(key, {
          file: rel(file),
          target: rel(target),
          specs: [`spread of live namespace \`${name}\``],
          provided: -1,
          real: -1,
          missing: [`${name} 未经 snapshotModuleExports 快照`],
        })
      }
      continue
    }

    const real = await realExports(target)
    if (!real) continue

    const missing = real.filter(k => !keys.includes(k))
    if (missing.length === 0) continue

    const key = `${rel(file)}\u0000${rel(target)}`
    const prev = byKey.get(key)
    if (prev) {
      if (!prev.specs.includes(spec)) prev.specs.push(spec)
      if (missing.length > prev.missing.length) {
        prev.provided = keys.length
        prev.missing = missing
      }
      continue
    }
    byKey.set(key, {
      file: rel(file),
      target: rel(target),
      specs: [spec],
      provided: keys.length,
      real: real.length,
      missing,
    })
  }
}

// ── tests/mocks 里的共享工厂 ───────────────────────────────────────
// 共享 mock 是 `mock.module(spec, sharedFn)` 的形式，上面的字面量扫描看不到它，
// 但它污染面最大（一份不完整的共享 mock 会同时坑掉所有引用它的文件）。
// 这些工厂必须从真实模块派生，手列导出必然漂移。
const SHARED_MOCKS: ReadonlyArray<readonly [string, string, string]> = [
  ['tests/mocks/debug.ts', 'debugMock', 'src/utils/debug.ts'],
  ['tests/mocks/log.ts', 'logMock', 'src/utils/log.ts'],
  [
    'tests/mocks/growthbook.ts',
    'growthbookMock',
    'src/services/analytics/growthbook.ts',
  ],
  ['tests/mocks/auth.ts', 'authMock', 'src/utils/auth.ts'],
]

for (const [mockPath, exportName, realPath] of SHARED_MOCKS) {
  const abs = join(ROOT, mockPath)
  if (!existsSync(abs)) continue
  let provided: string[]
  try {
    const mod = (await import(abs)) as Record<string, unknown>
    const factory = mod[exportName]
    if (typeof factory !== 'function') continue
    provided = Object.keys((factory as () => object)())
  } catch {
    continue
  }
  const real = await realExports(join(ROOT, realPath))
  if (!real) continue
  const missing = real.filter(k => !provided.includes(k))
  if (missing.length === 0) continue
  byKey.set(`${mockPath}\u0000${realPath}`, {
    file: mockPath,
    target: realPath,
    specs: [`${exportName}()`],
    provided: provided.length,
    real: real.length,
    missing,
  })
}

const findings = [...byKey.values()].sort(
  (a, b) =>
    b.missing.length - a.missing.length ||
    a.file.localeCompare(b.file) ||
    a.target.localeCompare(b.target),
)

// ── baseline 对比 ─────────────────────────────────────────────────
type Baseline = { known: string[] }
const keyOf = (f: Finding) => `${f.file} -> ${f.target}`

if (update) {
  const payload: Baseline = { known: findings.map(keyOf).sort() }
  await Bun.write(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(
    `baseline 已更新：${payload.known.length} 条已知部分 mock → ${rel(BASELINE_PATH)}`,
  )
  process.exit(0)
}

let known = new Set<string>()
if (existsSync(BASELINE_PATH)) {
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline
  known = new Set(parsed.known ?? [])
}

const currentKeys = new Set(findings.map(keyOf))
const added = findings.filter(f => !known.has(keyOf(f)))
const fixed = [...known].filter(k => !currentKeys.has(k)).sort()

const out: string[] = []
if (added.length > 0) {
  out.push(`新增部分 mock（${added.length} 条）——会污染整个测试进程：\n`)
  for (const f of added) {
    out.push(`  ${f.file}`)
    out.push(`    mock: ${f.specs.join(' , ')}  →  ${f.target}`)
    if (f.real < 0) {
      // live namespace spread：导出面不缺，缺的是快照
      out.push(`    ${f.missing[0]}`)
    } else {
      out.push(
        `    提供 ${f.provided}/${f.real} 个导出，缺 ${f.missing.length} 个：`,
      )
      out.push(
        `      ${f.missing.slice(0, 8).join(', ')}${f.missing.length > 8 ? ` …（另 ${f.missing.length - 8} 个）` : ''}`,
      )
    }
    out.push('')
  }
  out.push('修法：spread 真实导出快照，只覆盖需要改的那几个。')
  out.push("  import * as realX from '...'")
  out.push("  import { snapshotModuleExports } from 'tests/mocks/settings.js'")
  out.push('  const xSnap = snapshotModuleExports(realX)')
  out.push('  mock.module(spec, () => ({ ...xSnap, 只覆盖需要的 }))')
  out.push('')
  out.push(
    '如果真实模块 import 不进来（重型传递依赖 / 副作用），改成 mock 更底层的依赖，',
  )
  out.push('或按真实签名补齐缺失导出。')
}

if (fixed.length > 0) {
  out.push(`已修好 ${fixed.length} 条（baseline 可收缩）：`)
  for (const k of fixed) out.push(`  ${k}`)
  out.push('')
  out.push('跑 `bun run check:mocks -- --update` 把它们从 baseline 里摘掉。')
}

if (added.length === 0 && fixed.length === 0 && !quiet) {
  out.push(`部分 mock 体检：${findings.length} 条已知，无新增。`)
}

if (out.length > 0) console.log(out.join('\n'))

process.exit(added.length > 0 ? 1 : 0)
