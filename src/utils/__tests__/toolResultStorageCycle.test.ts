/**
 * `TOOL_RESULTS_SUBDIR` 的循环依赖 TDZ 回归。
 *
 * `toolResultStorage.ts` 在一个 12 跳的导入环里：
 *   toolResultStorage → analytics/metadata → model/model → modelCost →
 *   fastMode → extraUsage → model/fableCreditsLabel → fableConsent →
 *   messageQueueManager → messages → AgentTool/builtInAgents →
 *   AgentTool/built-in/webFetchAgent → 回到 toolResultStorage
 *
 * `webFetchAgent.ts` 在模块级模板字符串里读这个常量，所以只要
 * `toolResultStorage.ts` 是入口，环就会先跑 webFetchAgent 的模块体，抛
 * `ReferenceError: Cannot access 'TOOL_RESULTS_SUBDIR' before initialization`。
 *
 * 常量搬进无依赖的叶子 `src/constants/toolResults.ts` 后不再可能：叶子在
 * 任何环参与者开始执行前就已完成初始化。
 *
 * 必须用独立子进程——TDZ 只在该模块**作为入口**时触发，同进程里若已被别的
 * 测试先加载过，就复现不出来。
 */
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { describe, expect, test } from 'bun:test'

function importInChildProcess(modulePath: string): {
  ok: boolean
  stderr: string
} {
  const r = spawnSync(
    'bun',
    ['-e', `await import(${JSON.stringify(modulePath)})`],
    { encoding: 'utf8', cwd: process.cwd() },
  )
  return { ok: r.status === 0, stderr: r.stderr ?? '' }
}

describe('TOOL_RESULTS_SUBDIR 循环依赖', () => {
  for (const entry of [
    './src/utils/toolResultStorage.ts',
    './packages/builtin-tools/src/tools/AgentTool/built-in/webFetchAgent.ts',
    './src/utils/cleanup.ts',
  ]) {
    test(`以 ${entry} 为入口不触发 TDZ`, () => {
      const { ok, stderr } = importInChildProcess(entry)
      expect(stderr).not.toContain('before initialization')
      expect(ok).toBe(true)
    }, 60_000)
  }

  test('常量留在叶子模块里，该模块不得有 import', () => {
    const src = readFileSync('src/constants/toolResults.ts', 'utf8')
    expect(src).toContain("export const TOOL_RESULTS_SUBDIR = 'tool-results'")
    // 注释里出现的箭头/路径不算，只查真正的 import 语句
    expect(src).not.toMatch(/^\s*(?:import|export)\b[^\n]*\bfrom\b/m)
  })

  test('webFetchAgent 从叶子取值，不再绕经 toolResultStorage', () => {
    const src = readFileSync(
      'packages/builtin-tools/src/tools/AgentTool/built-in/webFetchAgent.ts',
      'utf8',
    )
    expect(src).toMatch(
      /import \{ TOOL_RESULTS_SUBDIR \} from ['"]src\/constants\/toolResults\.js['"]/,
    )
  })
})
