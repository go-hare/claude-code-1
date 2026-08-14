# densable 2.1.232 #2 — 输入 `@` 按名 mention 另一 Claude 会话 → SendMessage

## Changelog

> 输入 `@` 按名 mention 另一 Claude 会话 → SendMessage

## densable gold (SEA 2.1.232)

### Regex `spv` (peer @-token)

```js
// UCa module
spv = /(?:^|[\s。、？！])@(?:"([^"\n]{1,200})"|([\w-]{1,128})(?=$|[\s,;!?)\]}>'"”’。、？！]|[.:](?:$|\s)|\[[0-9a-f]{6,12}\]))(?:[ \t]*\[([0-9a-f]{6,12})\])?/gu
s4p = /\[[0-9a-f]{6,12}\]/i   // ref shape
c4p = /^[\w-]+$/
tpv = 128   // bare name max code points
rpv = 200   // quoted name max
epv = 3     // ask candidates shown
Qdv = 20    // typeahead cap
```

### Parse / resolve

| densable | role |
| --- | --- |
| `p4p(text)` | matchAll `spv` → `{name, ref?}`；同名 bare 被 ref 条目覆盖 |
| `l4p(name)` | name filter（拒 `"`/`<>`/newline/`agent-` 前缀/`(agent)` 后缀/ref 形状） |
| `npv` / `Zii` | 候选池：UDS sessions + cloud + bridge − in-process main/teammate/subagent − defaultNamed |
| `f4p(parsed, pool)` | resolve：`ref` 精确 → resolved/not_found；唯一 bare → resolved；多候选 → **ask** |
| `$Ca` | candidate → `{token: YRe(…), where: mMo(…)}` |
| `FCa` | analytics `tengu_at_mention_peer_{success\|ask\|not_found}` + `input_peer_at_mention` |
| `d4p` | typeahead：`dm-peer-${kind}-${ref}-${name}` · display `@name` / `@"name"` · desc `message session · ${where}` |
| `_mv(preExpansionInput, toolUseContext, fileMentions)` | attachment 管线：`ig()` 门 → `p4p` 滤掉已是 file path 的 token → `Zii` → `f4p` → `{type:"peer_mention", status, candidates, total}` |

### Attachment wiring

```js
// getAttachments peer branch (human-typed only)
sE("peer_mentions", () =>
  s?.isHumanTypedPrompt && s.preExpansionInput !== void 0
    ? p.then(S => _mv(s.preExpansionInput, t, S))
    : Promise.resolve([]))
```

Gate: densable `ig()`（cross-session / harbor kite 同类门；本地 ≈ `UDS_INBOX` + cross-session inbound 配置）。

### Downstream product intent

Resolved `peer_mention` 驱动 SendMessage 到该 live bare name（与 #3 bare-name resolve 衔接）；`ask` 状态让用户消歧。

## Local

| 面 | 状态 |
| --- | --- |
| `@file` / MCP resource / agent skill mentions | **有**（`attachments.ts` extractAtMentionedFiles / agent_mentions） |
| **peer_mention** parse/resolve/typeahead/attachment | **HAVE** — `src/utils/peerAtMention.ts` + `attachments.ts` `_mv` 分支 + `messages.ts` case + `useTypeahead` `dm-peer-…` + null-rendering |
| SendMessage bare name (#3) | **HAVE** — resolved mention 复用 bare-name SendMessage |
| ListAgents / UDS peer enum | **有** — `listPeers` + `listBridgePeers` → `buildPeerCandidates` 作 `npv` 子集 |

## Status

**HAVE**（产品面 1:1 主路径）。residual：cloud-session 池、完整 densable `inProcess`（team-file teammates / self session name 注入）、`Fii` defaultNamed 全量、`input_peer_at_mention` 埋点若 densable 另有独立事件名需再对 SEA。

## Snippets

- `hit-peer-mention-blob.txt` / `hit-peer-resolve-fn.txt` / `hit-mv-peer-fn.txt`
- 测试：`src/utils/__tests__/peerAtMention.232.test.ts`
