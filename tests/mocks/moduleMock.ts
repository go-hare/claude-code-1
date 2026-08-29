/**
 * 通用「部分 mock 修复」助手。
 *
 * Bun 的 `mock.module` 是进程全局的（last-write-wins），不是 per-file 隔离。工厂返回的导出
 * 比真实模块少时，同进程里 import 缺失导出的兄弟文件会在 ESM link 阶段炸掉，bun 报成
 * "Unhandled error between tests" —— 那个文件的测试从总数里**静默消失**。
 *
 * 所以覆盖一个模块的正确姿势永远是「摊开真实导出，只改需要改的那几个」。
 *
 * 用法：
 *   import * as realAnalytics from 'src/services/analytics/index.js'
 *   import { overrideModule } from '../../../tests/mocks/moduleMock.js'
 *
 *   const restore = overrideModule('src/services/analytics/index.js', realAnalytics, {
 *     logEvent: logEventMock,
 *   })
 *   afterAll(restore)
 *
 * 注意：`overrideModule` 会在注册 mock 之前抓取快照，所以别在同一文件里先
 * `mock.module` 同一个模块再调它 —— ESM live binding 那时已经指向 mock，快照会存进假值。
 *
 * 闸门 `bun run check:mocks` 会拦住新增的部分 mock（见 CLAUDE.md）。
 */
import { mock } from 'bun:test'

/**
 * 把模块导出抓成普通对象（不是 live namespace binding）。
 * 必须在对该模块调用 `mock.module` **之前**执行。
 */
export function snapshotExports<T extends object>(
  mod: T,
): { [K in keyof T]: T[K] } {
  const snap = {} as { [K in keyof T]: T[K] }
  for (const key of Object.keys(mod) as Array<keyof T>) {
    snap[key] = mod[key]
  }
  return snap
}

/**
 * 注册一个保留全部真实导出、只覆盖 `overrides` 的 mock。
 *
 * `specs` 传数组可以一次覆盖同模块的多种写法（`.js` / `.ts` / 相对路径）—— 它们解析到同一
 * 模块，但 bun 按 specifier 记账，测试树里两种写法混用时需要都注册。
 *
 * @returns 还原函数：重新注册未经改动的快照。放进 `afterAll`，否则 mock 会漏给后面的文件。
 */
export function overrideModule<T extends object>(
  specs: string | readonly string[],
  real: T,
  overrides: Record<string, unknown> = {},
): () => void {
  const snap = snapshotExports(real)
  const list = typeof specs === 'string' ? [specs] : specs

  for (const spec of list) {
    mock.module(spec, () => ({ ...snap, ...overrides }))
  }

  return () => {
    for (const spec of list) {
      mock.module(spec, () => ({ ...snap }))
    }
  }
}
