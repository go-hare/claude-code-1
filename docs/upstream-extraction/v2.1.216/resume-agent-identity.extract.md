# densable 2.1.216 — resume bg agent identity (1:1)

> **id:** `resume-agent-identity` · Changelog #7  
> **Status:** **HAVE** (spawn identity + H4d $Ns merge + Aye isFork/model/spawnMode restore + disk-missing in-memory transcript mirror landed 2026-08-07)  
> SEA: `/tmp/official-216/plat/package/claude`

---

## 1. Product intent (changelog)

> Fixed resumed background agent sessions reverting to the default agent (losing custom prompt and tool restrictions).

---

## 2. densable binary proof

| Needle | Hit | Notes |
|--------|-----|-------|
| `resumeAgentBackground` | true | Aye entry |
| `subagent_resume_transcript_missing` | true | no disk + no in-memory |
| `subagent_resume_fork_prompt_missing` | true | fork system prompt rebuild fail |
| `isFork` | true | sidecar + mirror |
| `agent_metadata` | true | fireMirror shape |
| `$Ns` / preserve | true | `["isObserver","observerStopped","observerTaskId","armingPermissionMode"]` |
| `H4d` | true | write with $Ns merge-from-disk |

---

## 3. densable runtime (cleaned)

### Spawn write (`vp_` / H4d)

```js
// densable spawn:
vp_(agentId, hasRecordedUuids || B, {
  agentType: e.agentType,
  ...e.agentType === "fork" && { isFork: isBuiltIn(e) },
  ...worktreePath && { worktreePath },
  ...worktreePath && worktreeBranch && { worktreeBranch },
  ...cwd && { cwd },
  ...spawnMode && { spawnMode },
  ...description && { description },
  ...name && { name },
  ...toolUseId && { toolUseId },
  ...parentAgentId && { parentAgentId },
  ...spawnDepth !== undefined && { spawnDepth },
  ...model && { model },
  ...B, // extra patch bag when present
})

// H4d write:
// if any of $Ns undefined on write, read prior sidecar and fill those keys
$Ns = ["isObserver","observerStopped","observerTaskId","armingPermissionMode"]
```

### Aye resume selection

```js
// j = isFork===true ? undefined : activeAgents.find(agentType)
// B = isFork===true || (!j && isFork===undefined && agentType===FORK)
// G = j ?? (B ? FORK_AGENT : GENERAL_PURPOSE)
// model: isObserver ? undefined : meta.model
// mode: observerCap ?? workerPermissionMode ?? spawnMode ?? agent.permissionMode ?? "acceptEdits"
// tools: fork → parent filter; observer → exact observer pool; else assemble(workerMode)
// ...(fork || isObserver) && { useExactTools: true }
```

### Fail strings

- `No transcript found for agent ID: ${id}`
- `Cannot resume fork agent: unable to reconstruct parent system prompt`
- `Observer sidecar for ${id} missing or did not confirm isObserver; refusing delivery`
- disk missing + in-memory: log  
  `[resumeAgentBackground ${id}] disk transcript missing; using ${n} in-memory messages mirrored during the run`

---

## 4. go-hare land map

| Path | Change |
|------|--------|
| `src/utils/sessionStorage.ts` | widen `AgentMetadata`; H4d `$Ns` preserve on `writeAgentMetadata` |
| `packages/.../runAgent.ts` | write full identity (isFork, model, spawnMode, worktree*, cwd, parent/tool ids, …) |
| `packages/.../AgentTool.tsx` | pass worktreeBranch/cwd/spawnMode/toolUseId/parentAgentId into runAgent |
| `packages/.../resumeAgent.ts` | densable j/B/G selection; model pin; typed spawnMode; re-persist identity on resume; disk-missing → `task.messages` mirror |

---

## 5. Tests

- `packages/builtin-tools/src/tools/AgentTool/__tests__/resumeAgentIdentity.216.test.ts`

---

## 6. Risks / do-not-simplify

- Do **not** treat `agentType === "fork"` alone as sufficient when `isFork === false` (custom agent named fork).
- Do **not** drop $Ns on spawn rewrite (observer re-arm breaks).
- In-memory transcript fallback: densable `g.getTranscript(e)?.messages` → local `getAppState().tasks[agentId].messages` (warm path only; cold resume with no task still requires disk).
- densable `me(e,t)` / `Ce(e)` taxonomy landed: `logEvent('tengu_feature_bad'|'tengu_feature_ok', { feature_name: 'subagent_launch', error_code? })` (same as `leftArrowAgents` / print set_model). Codes: `subagent_resume_transcript_missing`, `subagent_resume_fork_prompt_missing`. Success ok on alreadyCompleted + normal return.
- KAIROS/UDS/LAN/TEAMMEM not expanded.
