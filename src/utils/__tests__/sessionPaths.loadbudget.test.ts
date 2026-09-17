/**
 * 冷加载预算回归 —— Task 017 的护栏。
 *
 * `sessionPaths.ts` 存在的唯一理由是留在依赖环外。环内任意入口冷加载约 8 秒
 * （`sessionStorage.ts` 7977ms、`messages.ts` 8737ms、`commands.ts` 7539ms），
 * 环外模块 1–210ms，中间没有东西。所以只要误引入一条环内依赖，就是 8 秒，
 * 不存在"稍微慢一点"这种中间状态。
 *
 * 必须用独立子进程：同一进程里 `sessionStorage.ts` 可能已被别的测试加载过，
 * 模块缓存会让 import 瞬间返回，把回归完全掩盖掉。
 */
import { spawnSync } from 'child_process'
import { describe, expect, test } from 'bun:test'

/** 环内约 8000ms，环外约 200ms。取 1500ms 留足 CI 抖动余量，同时远低于环内。 */
const BUDGET_MS = 1500

function coldImportMs(modulePath: string): number {
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

describe('sessionPaths 冷加载预算', () => {
  test(`独立冷加载低于 ${BUDGET_MS}ms（超了说明引入了环内依赖）`, () => {
    // 跑 2 次取小：第一次可能撞上磁盘冷启动
    const best = Math.min(
      coldImportMs('./src/utils/sessionPaths.ts'),
      coldImportMs('./src/utils/sessionPaths.ts'),
    )
    expect(best).toBeLessThan(BUDGET_MS)
  }, 60_000)

  test('不得依赖 settings/settings.ts（环内 7055ms）', () => {
    // 直接查传递闭包，比只看耗时更早暴露问题：即便某次计时侥幸过线，
    // 只要这条边接上了就判失败。
    const code = `
      const seen=new Set();const stack=['./src/utils/sessionPaths.ts'];
      const {readFileSync,existsSync}=require('fs');
      const {dirname,resolve}=require('path');
      while(stack.length){
        const f=stack.pop();if(!f||seen.has(f))continue;seen.add(f);
        let src;try{src=readFileSync(f,'utf8')}catch{continue}
        const re=/(?:^|\\n)\\s*(?:import|export)(\\s+type)?\\s+([\\s\\S]*?)from\\s*['"]([^'"]+)['"]/g;
        for(const m of src.matchAll(re)){
          if(m[1])continue;
          const clause=m[2]||'';
          if(/^\\s*\\{[\\s\\S]*\\}\\s*$/.test(clause)&&clause.replace(/[{}]/g,'').split(',').map(s=>s.trim()).filter(Boolean).every(s=>s.startsWith('type ')))continue;
          const spec=m[3]||'';if(!spec.startsWith('.')&&!spec.startsWith('src/'))continue;
          const base=spec.startsWith('.')?resolve(dirname(f),spec):resolve(spec);
          for(const c of [base,base.replace(/\\.js$/,'.ts'),base.replace(/\\.js$/,'.tsx'),base+'.ts',base+'.tsx',base+'/index.ts']){
            if(existsSync(c)){stack.push(c);break}
          }
        }
      }
      console.log([...seen].filter(f=>f.replace(/\\\\/g,'/').endsWith('src/utils/settings/settings.ts')).length)
    `
    const r = spawnSync('bun', ['-e', code], {
      encoding: 'utf8',
      cwd: process.cwd(),
    })
    expect(r.status).toBe(0)
    expect((r.stdout ?? '').trim().split('\n').pop()).toBe('0')
  }, 60_000)
})
