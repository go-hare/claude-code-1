# Upstream changelog slice — densable 2.1.227

Source: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md (section `## 2.1.227`).

Official binary SEA: densable **2.1.227** (`// Version: 2.1.227` HIT ×6), size **285046400** bytes, sha256 `7432511ba3be818e01f23f6eef8630d214a8b618451e188c3c7d61a987eef6c7`.

Path: `/tmp/official-227/plat/package/claude`  
Snippet root: `docs/upstream-extraction/v2.1.227/snippets/`.

## 2.1.227

- Fixed feature flags being evaluated without the user's subscription tier when a session started with an expired login token, which could wrongly prompt Max plan users to enable usage credits for Fable
- Fixed every Bash command failing under `claude-code-action` with `allowed_non_write_users` on GitHub-hosted runners
- Fixed `/tui` bringing back a conversation that had been rewound to before its first message
- Improved slash-command menu: blue now marks only the selected row, matched characters are bolded instead of recolored, and emoji or accented names keep their glyphs
- Improved performance: fewer event-loop stalls on file-not-found suggestions and at-mention size checks

## Neighbor versions (do not fold into this pack)

- **2.1.225** — gateway spend / agents trust / OAuth keep env / RC pin / CCR tip (local tip `814ff6dc`, HAVE 13/14)
- **2.1.226** — opaque reliability stamp (NOOP product)
- **2.1.228** — 18 bullets (layout hang / Windows git / SHR hooks / …) — **do not fold**

## SEA meta

| 项 | 值 |
| -- | -- |
| size | 285046400 |
| BUILD_TIME | 2026-08-10T18:40:15Z |
| GIT_SHA | 5ecc7d5389d8b682652d0ea32eadd3e0eb537ee8 |
| vs 226 size | +5 384 448 (real delta; 226 was stamp-only) |

## densable gold anchors (extract)

| Anchor | 含义 |
| --- | --- |
| `GrowthBook: pre-init OAuth refresh failed` | createClient awaits OAuth refresh with 5s timeout before attributes |
| `GrowthBook: auth header resolution failed` | catch on getAuthHeaders → continue without auth |
| `function iTu` + `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | force permission mode `default` + notification |
| `CLAUDE_CODE_MEMORY_API_TOKEN` in R_s scrub list | 227-only vs 226 |
| `async function kmt` / `findSimilarFile failed for` | async readdir for similar-file suggest |
| `freshIfNoTranscript&&!await d2p` / `transcriptHasBytes` | skip `--resume` when transcript empty |
| `rewound:!0` on last-prompt | rewind-before-first-message anchor |
| `function Zsm` / `function wZt` / `function tam` | slash menu match ranges + bold-not-recolor + grapheme expand |
| `UgT=/[^ -˿]/` | expand ranges when emoji/high codepoints present |
| `query:n` on command suggestion item (`hNl`) | footer `kh.query` → `wZt` |
