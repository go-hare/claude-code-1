import { mkdirSync, readFileSync, writeFileSync } from 'fs'

const src = readFileSync(
  'C:/Users/Administrator/.cursor/projects/d-work-py-claude-claude-code/agent-tools/a5c4b7f8-1123-45c7-a454-c7fdfa4451ed.txt',
  'utf8',
)
const start = src.indexOf('## 2.1.251')
const end = src.indexOf('## 2.1.250')
if (start < 0 || end < 0) throw new Error(`bounds ${start} ${end}`)
const body = src.slice(start, end)
const lines = body.split(/\n/).filter(l => l.startsWith('- '))
const dir = 'docs/upstream-extraction/v2.1.251'
mkdirSync(`${dir}/boards`, { recursive: true })
mkdirSync(`${dir}/snippets`, { recursive: true })

const numbered = lines.map((l, i) => `${i + 1}. ${l.slice(2)}`).join('\n')
const md = `# densable 2.1.251 — Changelog

> 来源：GitHub/\`CHANGELOG.md\` **## 2.1.251**（2026-08-28）  
> Tag：[\`v2.1.251\`](https://github.com/anthropics/claude-code/releases/tag/v2.1.251) · raw：[CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)  
> SEA：**未下**。checklist/board 已开。changelog **只是索引**。  
> 口径：densable-first 1:1 · invent-ban · **只盘 251**（249 跳号、250 stub 不折入；252 四条 hotfix 另包）  
> 基线：本地 tip npm **2.7.51** = densable **2.1.248**。  
> 更新：2026-09-22 — 开 pack。无函数体前不升 HAVE。

## What's changed（官方原文 · ${lines.length} bullets）

编号跟 GitHub \`CHANGELOG.md\` **## 2.1.251** 原文顺序。

${numbered}

## 邻版（勿折入本 pack）

| 版本 | 官方 CHANGELOG |
| ---- | -------------- |
| **2.1.248** | 已收口（HAVE 47 / N/A 2）。本 pack 不回改 248 |
| **2.1.249** | **无此节**（跳号） |
| **2.1.250** | 1 条 stub：Bug fixes and reliability improvements |
| **2.1.252** | 4 条 hotfix（Bash swap / always-allow / RC stall / 大失败通知）。另包，不折入 |
`
writeFileSync(`${dir}/changelog-2.1.251.md`, md)

const rows = lines
  .map((l, i) => {
    const t = l.slice(2).replace(/\|/g, '/').slice(0, 80)
    return `| ${i + 1} | | ${t} | **UNKNOWN** | 待 SEA / 本地扫 |`
  })
  .join('\n')

const checklist = `# densable 2.1.251 — 官方更新清单 × tip 对照

> 来源：CHANGELOG **2.1.251**（${lines.length} bullets）。SEA **未下**。  
> 基线：本地 tip npm **2.7.51** = densable **2.1.248**。**本 pack 只盘点 2.1.251**（勿折入 249 跳号 / 250 stub / 252 hotfix）。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 更新：2026-09-22 — 开 pack。无 SEA 函数体前**不升 HAVE**。扫员标的 HAVE/GAP **不进桶**。  
> 口径：本地实现 + 已锁 SEA 函数体是合同。changelog 字面大于代码 → **不升桶、不 invent**。

## Summary

| 状态 | 计数 | 备注 |
| ---- | ---- | ---- |
| **HAVE** | **0** | 无 SEA 前不升 |
| **PARTIAL** | **0** | |
| **GAP** | **0** | 未证伪前不标 GAP |
| **UNKNOWN** | **${lines.length}** | 待 SEA + 本地扫 |
| **N/A** | **0** | #70 #71 VSCode 为候选，SEA 前不升 N/A |

## Checklist

| # | key | 官方要点 | 状态 | 证据 |
| - | --- | -------- | ---- | ---- |
${rows}

## 已锁合同

1. changelog 是索引。金标待 SEA。  
2. 扫员结论只写 \`snippets/scan-251-*.md\`，**不改桶**。  
3. 249 跳号、250 stub、252 另包。不 invent VSCode / 云宿主。
`
writeFileSync(`${dir}/official-251-checklist.md`, checklist)

const board = `# Alignment board — densable 2.1.251

> **开 pack** · 2026-09-22 · SEA **未下** · changelog 是索引  
> HAVE **0** / PARTIAL **0** / GAP **0** / UNKNOWN **${lines.length}** / N/A **0**  
> tip：npm **2.7.51** = 248 · **只盘 251** · 不折入 249/250/252  
> 计数以 \`official-251-checklist.md\` 为准。扫员不升桶。

## 桶

| 桶 | # |
| -- | - |
| HAVE | |
| PARTIAL | |
| GAP | |
| UNKNOWN | #1–#${lines.length} |
| N/A | |

## 并行初盘

1. changelog ${lines.length} 条已落 \`changelog-2.1.251.md\`。  
2. 四路本地扫进行中（\`snippets/scan-251-a.md\` … \`scan-251-d.md\`）。**扫员标的 HAVE/GAP 不进桶**。  
3. SEA 未下。无函数体前不升 HAVE。

## N/A 候选（SEA 前不升）

- #70 #71 \`[VSCode]\` 宿主。  
- 云 session / Claude Desktop 专属：有 SEA 体才谈 HAVE，无体同缺 = 对齐。
`
writeFileSync(`${dir}/boards/alignment-251.md`, board)
console.log('bullets', lines.length)
