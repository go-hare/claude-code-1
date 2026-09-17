/**
 * `fableConsent.ts → messageQueueManager.ts` 这条边必须保持惰性。
 *
 * `messageQueueManager` 会拉到 `messages.ts` / `sessionStorage.ts`，两者都在
 * 554 模块的强连通分量里。静态 import 时，这一条边把整棵模型/计价子树
 * （model.ts、modelCost.ts、fastMode.ts、extraUsage.ts、fableCreditsLabel.ts）
 * 一起摁进环里：全仓重依赖模块 1464 个，model.ts 冷加载 5261ms。
 * 改成惰性 require 后 1051 个、681ms。
 *
 * 只有 park-watch 那一条分支需要队列，所以惰性在语义上也是对的。
 *
 * 冷加载必须用独立子进程量：同进程里 messageQueueManager 可能已被别的测试
 * 加载过，模块缓存会把回归完全掩盖掉。
 */
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { describe, expect, test } from 'bun:test'

const FABLE_CONSENT = 'src/utils/fableConsent.ts'
const BUDGET_MS = 2500

describe('fableConsent 对 messageQueueManager 的依赖', () => {
  test('不得静态 import —— 那条边会把模型/计价子树摁回环里', () => {
    const src = readFileSync(FABLE_CONSENT, 'utf8')
    expect(src).not.toMatch(
      /^\s*(?:import|export)\b[^\n]*\bfrom\s*['"][^'"]*messageQueueManager\.js['"]/m,
    )
  })

  test('惰性 require 仍在位', () => {
    const src = readFileSync(FABLE_CONSENT, 'utf8')
    expect(src).toMatch(
      /require\(\s*['"]\.\/messageQueueManager\.js['"]\s*\)\s*as\s*typeof\s*import\(/,
    )
  })
})

describe('模型子树冷加载预算', () => {
  test(`model.ts 低于 ${BUDGET_MS}ms（超了说明那条边又静态了）`, () => {
    const coldImportMs = (modulePath: string): number => {
      const code = `const t=Bun.nanoseconds();await import(${JSON.stringify(modulePath)});console.log((Bun.nanoseconds()-t)/1e6)`
      const r = spawnSync('bun', ['-e', code], {
        encoding: 'utf8',
        cwd: process.cwd(),
      })
      if (r.status !== 0) {
        throw new Error(`子进程 import 失败: ${r.stderr?.slice(0, 600) ?? ''}`)
      }
      const ms = Number.parseFloat(
        (r.stdout ?? '').trim().split('\n').pop() ?? 'NaN',
      )
      if (!Number.isFinite(ms)) {
        throw new Error(`没能从子进程读到耗时: ${JSON.stringify(r.stdout)}`)
      }
      return ms
    }
    const best = Math.min(
      coldImportMs('./src/utils/model/model.ts'),
      coldImportMs('./src/utils/model/model.ts'),
    )
    expect(best).toBeLessThan(BUDGET_MS)
  }, 60_000)
})
